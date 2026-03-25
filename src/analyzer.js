/**
 * analyzer.js — Core analysis engine
 * Orchestrates file scanning, parsing, and aggregation of codebase information.
 */

const path = require("path");
const fs = require("fs");
const {
  walkDir, safeRead, parseJSTS, parsePython, parsePrisma, parseSequelizeModel,
  parseGraphQL, detectFramework, readPackageJson, detectEntryPoints, directoryTree,
} = require("./parsers");

// ---------------------------------------------------------------------------
// Analyze a full codebase
// ---------------------------------------------------------------------------

function analyzCodebase(dir) {
  if (!fs.existsSync(dir)) throw new Error(`Directory not found: ${dir}`);

  const files = walkDir(dir);
  const frameworks = detectFramework(dir, files);
  const pkg = readPackageJson(dir);
  const entryPoints = detectEntryPoints(dir, files);
  const tree = directoryTree(dir);

  // Parse all files
  const allImports = [];  // { from, to, file }
  const allExports = [];  // { name, type, file }
  const allFunctions = [];
  const allRoutes = [];
  const allClasses = [];
  const allModels = [];    // Prisma/Sequelize/GraphQL
  const fileStats = { total: files.length, byExt: {} };

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    fileStats.byExt[ext] = (fileStats.byExt[ext] || 0) + 1;
    const relPath = path.relative(dir, filePath);
    const content = safeRead(filePath);
    if (!content) continue;

    // JS/TS files
    if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"].includes(ext)) {
      const parsed = parseJSTS(content, filePath);
      parsed.imports.forEach(imp => allImports.push({ from: relPath, to: imp }));
      parsed.exports.forEach(exp => allExports.push({ ...exp, file: relPath }));
      parsed.functions.forEach(fn => allFunctions.push({ ...fn, file: relPath }));
      parsed.routes.forEach(rt => allRoutes.push({ ...rt, file: relPath }));
      parsed.classes.forEach(cls => allClasses.push({ ...cls, file: relPath }));

      // Sequelize detection
      if (content.includes("sequelize") || content.includes("Model")) {
        const models = parseSequelizeModel(content);
        models.forEach(m => allModels.push({ ...m, file: relPath }));
      }
    }

    // Python files
    if ([".py", ".pyi"].includes(ext)) {
      const parsed = parsePython(content, filePath);
      parsed.imports.forEach(imp => allImports.push({ from: relPath, to: imp }));
      parsed.exports.forEach(exp => allExports.push({ ...exp, file: relPath }));
      parsed.functions.forEach(fn => allFunctions.push({ ...fn, file: relPath }));
      parsed.routes.forEach(rt => allRoutes.push({ ...rt, file: relPath }));
      parsed.classes.forEach(cls => allClasses.push({ ...cls, file: relPath }));
    }

    // Prisma
    if (ext === ".prisma") {
      const models = parsePrisma(content);
      models.forEach(m => allModels.push({ ...m, file: relPath, source: "prisma" }));
    }

    // GraphQL
    if ([".graphql", ".gql"].includes(ext)) {
      const types = parseGraphQL(content);
      types.forEach(t => allModels.push({ ...t, file: relPath, source: "graphql" }));
    }
  }

  // Dependency categorization
  const deps = pkg?.dependencies ? Object.keys(pkg.dependencies) : [];
  const devDeps = pkg?.devDependencies ? Object.keys(pkg.devDependencies) : [];

  return {
    name: pkg?.name || path.basename(dir),
    description: pkg?.description || "",
    version: pkg?.version || "0.0.0",
    dir,
    tree,
    frameworks,
    entryPoints,
    fileStats,
    dependencies: { production: deps, development: devDeps },
    imports: allImports,
    exports: allExports,
    functions: allFunctions,
    routes: allRoutes,
    classes: allClasses,
    models: allModels,
    pkg,
  };
}

// ---------------------------------------------------------------------------
// Build dependency graph (internal module-to-module links)
// ---------------------------------------------------------------------------

function buildDependencyGraph(analysis) {
  const graph = {}; // { sourceFile: [targetFile, ...] }
  const fileSet = new Set(analysis.imports.map(i => i.from));

  for (const imp of analysis.imports) {
    // Skip node_modules imports
    if (!imp.to.startsWith(".") && !imp.to.startsWith("/")) continue;

    if (!graph[imp.from]) graph[imp.from] = new Set();

    // Resolve the import to a known file
    const dir = path.dirname(imp.from);
    const candidates = [
      path.join(dir, imp.to),
      path.join(dir, imp.to + ".js"),
      path.join(dir, imp.to + ".ts"),
      path.join(dir, imp.to + ".tsx"),
      path.join(dir, imp.to + ".jsx"),
      path.join(dir, imp.to, "index.js"),
      path.join(dir, imp.to, "index.ts"),
    ].map(c => path.normalize(c));

    for (const cand of candidates) {
      if (fileSet.has(cand)) {
        graph[imp.from].add(cand);
        break;
      }
    }
  }

  // Convert sets to arrays
  const result = {};
  for (const [key, val] of Object.entries(graph)) {
    result[key] = [...val];
  }
  return result;
}

// ---------------------------------------------------------------------------
// External dependency map
// ---------------------------------------------------------------------------

function externalDependencies(analysis) {
  const external = {};
  for (const imp of analysis.imports) {
    if (imp.to.startsWith(".") || imp.to.startsWith("/")) continue;
    const pkg = imp.to.startsWith("@") ? imp.to.split("/").slice(0, 2).join("/") : imp.to.split("/")[0];
    if (!external[pkg]) external[pkg] = new Set();
    external[pkg].add(imp.from);
  }
  // Convert sets
  const result = {};
  for (const [key, val] of Object.entries(external)) {
    result[key] = [...val];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Route analysis: enhance routes with middleware/params
// ---------------------------------------------------------------------------

function analyzeRoutes(analysis) {
  return analysis.routes.map(route => {
    // Extract path params
    const pathParams = (route.path.match(/:(\w+)/g) || []).map(p => p.slice(1));
    return { ...route, pathParams };
  });
}

// ---------------------------------------------------------------------------
// Complexity score (simple heuristic)
// ---------------------------------------------------------------------------

function complexityScore(analysis) {
  const fileCount = analysis.fileStats.total;
  const fnCount = analysis.functions.length;
  const routeCount = analysis.routes.length;
  const depCount = analysis.dependencies.production.length;
  const modelCount = analysis.models.length;

  let score = 0;
  score += Math.min(fileCount / 10, 20);
  score += Math.min(fnCount / 20, 15);
  score += Math.min(routeCount / 5, 10);
  score += Math.min(depCount / 5, 15);
  score += Math.min(modelCount * 3, 10);

  if (score < 20) return { score: Math.round(score), label: "Simple" };
  if (score < 40) return { score: Math.round(score), label: "Moderate" };
  if (score < 60) return { score: Math.round(score), label: "Complex" };
  return { score: Math.round(score), label: "Very Complex" };
}

module.exports = {
  analyzCodebase,
  buildDependencyGraph,
  externalDependencies,
  analyzeRoutes,
  complexityScore,
};
