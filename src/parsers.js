/**
 * parsers.js — File parsers for JS/TS/Python codebases
 * Extracts functions, imports, exports, routes, models from source files.
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Ignore rules
// ---------------------------------------------------------------------------

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".cache", "coverage", ".turbo", ".vercel", ".output", "vendor",
  ".svelte-kit", ".nuxt", ".expo", "android", "ios",
]);

const SOURCE_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".pyi",
  ".prisma", ".graphql", ".gql", ".sql",
  ".json", ".yaml", ".yml", ".toml",
  ".vue", ".svelte",
]);

// ---------------------------------------------------------------------------
// Walk directory
// ---------------------------------------------------------------------------

function walkDir(dir, opts = {}) {
  const maxDepth = opts.maxDepth || 12;
  const maxFiles = opts.maxFiles || 5000;
  const files = [];

  function _walk(current, depth) {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          _walk(full, depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTS.has(ext)) {
          files.push(full);
        }
      }
    }
  }

  _walk(dir, 0);
  return files;
}

// ---------------------------------------------------------------------------
// Read file safely
// ---------------------------------------------------------------------------

function safeRead(filePath, maxBytes = 512_000) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) return null; // skip huge files
    return fs.readFileSync(filePath, "utf-8");
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// JS/TS parser
// ---------------------------------------------------------------------------

function parseJSTS(content, filePath) {
  const result = {
    imports: [],
    exports: [],
    functions: [],
    routes: [],
    classes: [],
  };

  const lines = content.split("\n");
  const ext = path.extname(filePath);
  const isTS = ext === ".ts" || ext === ".tsx";

  // --- Imports ---
  const importRe = /(?:import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    result.imports.push(m[1] || m[2]);
  }

  // --- Exports ---
  const exportDefaultRe = /export\s+default\s+(?:function\s+)?(\w+)?/g;
  while ((m = exportDefaultRe.exec(content)) !== null) {
    result.exports.push({ name: m[1] || "default", type: "default" });
  }
  const exportNamedRe = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
  while ((m = exportNamedRe.exec(content)) !== null) {
    result.exports.push({ name: m[1], type: "named" });
  }
  const moduleExportsRe = /module\.exports\s*=\s*(?:\{([^}]*)\}|(\w+))/g;
  while ((m = moduleExportsRe.exec(content)) !== null) {
    if (m[2]) {
      result.exports.push({ name: m[2], type: "cjs" });
    } else if (m[1]) {
      m[1].split(",").map(s => s.trim().split(":")[0].split("(")[0].trim()).filter(Boolean)
        .forEach(n => result.exports.push({ name: n, type: "cjs" }));
    }
  }

  // --- Functions ---
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Collect JSDoc above this line
    let jsdoc = "";
    let params = [];
    let returnType = "";
    if (i > 0 && lines[i - 1]?.trim().endsWith("*/")) {
      let j = i - 1;
      const docLines = [];
      while (j >= 0 && !lines[j].includes("/**")) {
        docLines.unshift(lines[j]);
        j--;
      }
      if (j >= 0) docLines.unshift(lines[j]);
      jsdoc = docLines.map(l => l.trim().replace(/^\/?\*+\/?/g, "").trim()).filter(Boolean).join(" ");

      // Extract @param
      const paramRe = /@param\s+(?:\{([^}]+)\}\s+)?(\w+)\s*[-—]?\s*(.*?)(?=@|$)/g;
      let pm;
      while ((pm = paramRe.exec(jsdoc)) !== null) {
        params.push({ name: pm[2], type: pm[1] || "any", description: pm[3]?.trim() || "" });
      }
      // Extract @returns
      const retRe = /@returns?\s+(?:\{([^}]+)\}\s*)?(.*?)(?=@|$)/;
      const retM = retRe.exec(jsdoc);
      if (retM) returnType = retM[1] || retM[2]?.trim() || "";
    }

    // Function declarations
    const fnRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?/;
    const fnM = fnRe.exec(line);
    if (fnM) {
      const tsReturn = fnM[3] || returnType;
      if (params.length === 0 && fnM[2]) {
        params = parseParamList(fnM[2], isTS);
      }
      result.functions.push({
        name: fnM[1], params, returnType: tsReturn,
        line: i + 1, exported: /export/.test(line), async: /async/.test(line),
        description: jsdoc.split("@")[0].trim(),
      });
      continue;
    }

    // Arrow functions: const foo = (async)? (...) => / : Type =>
    const arrowRe = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\(([^)]*)\)|(\w+))\s*(?::\s*([^\s=>{]+))?\s*=>/;
    const arrowM = arrowRe.exec(line);
    if (arrowM) {
      const tsReturn = arrowM[4] || returnType;
      if (params.length === 0 && arrowM[2]) {
        params = parseParamList(arrowM[2], isTS);
      }
      result.functions.push({
        name: arrowM[1], params, returnType: tsReturn,
        line: i + 1, exported: /export/.test(line), async: /async/.test(line),
        description: jsdoc.split("@")[0].trim(),
      });
      continue;
    }

    // Class methods (indented)
    const methodRe = /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?/;
    const methodM = methodRe.exec(line);
    if (methodM && !["if", "for", "while", "switch", "catch", "return", "new", "else"].includes(methodM[1])) {
      if (params.length === 0 && methodM[2]) {
        params = parseParamList(methodM[2], isTS);
      }
      result.functions.push({
        name: methodM[1], params, returnType: methodM[3] || returnType,
        line: i + 1, exported: false, async: /async/.test(line),
        description: jsdoc.split("@")[0].trim(), isMethod: true,
      });
    }
  }

  // --- Express/Fastify Routes ---
  const routeRe = /(?:app|router|server|fastify)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  while ((m = routeRe.exec(content)) !== null) {
    result.routes.push({ method: m[1].toUpperCase(), path: m[2] });
  }

  // Decorator routes (NestJS style)
  const decoratorRe = /@(Get|Post|Put|Patch|Delete)\s*\(\s*['"`]?([^'"`)\s]*)['"`]?\s*\)/gi;
  while ((m = decoratorRe.exec(content)) !== null) {
    result.routes.push({ method: m[1].toUpperCase(), path: m[2] || "/" });
  }

  // --- Classes ---
  const classRe = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
  while ((m = classRe.exec(content)) !== null) {
    result.classes.push({ name: m[1], extends: m[2] || null });
  }

  return result;
}

function parseParamList(raw, isTS) {
  return raw.split(",").map(p => p.trim()).filter(Boolean).map(p => {
    // Handle TS type annotations: name: Type = default
    const parts = p.split("=")[0].trim();
    const colonIdx = parts.indexOf(":");
    if (colonIdx > -1 && isTS) {
      return { name: parts.slice(0, colonIdx).trim().replace("?", ""), type: parts.slice(colonIdx + 1).trim(), description: "" };
    }
    return { name: parts.replace("?", ""), type: "any", description: "" };
  });
}

// ---------------------------------------------------------------------------
// Python parser
// ---------------------------------------------------------------------------

function parsePython(content, filePath) {
  const result = { imports: [], exports: [], functions: [], routes: [], classes: [] };
  const lines = content.split("\n");

  // Imports
  const importRe = /^(?:from\s+([\w.]+)\s+)?import\s+([\w., *]+)/gm;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    result.imports.push(m[1] || m[2].split(",")[0].trim());
  }

  // Functions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnRe = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?\s*:/;
    const fnM = fnRe.exec(line);
    if (fnM) {
      const indent = fnM[1].length;
      const name = fnM[2];
      const params = fnM[3].split(",").map(p => p.trim().split(":")[0].split("=")[0].trim()).filter(p => p && p !== "self" && p !== "cls");

      // Docstring
      let description = "";
      if (i + 1 < lines.length && /^\s*['"`]{3}/.test(lines[i + 1])) {
        let j = i + 1;
        const docLines = [];
        const opening = lines[j];
        if (/['"`]{3}.*['"`]{3}/.test(opening)) {
          description = opening.replace(/^\s*['"`]{3}/, "").replace(/['"`]{3}\s*$/, "").trim();
        } else {
          docLines.push(opening.replace(/^\s*['"`]{3}/, ""));
          j++;
          while (j < lines.length && !/['"`]{3}/.test(lines[j])) {
            docLines.push(lines[j]);
            j++;
          }
          description = docLines.map(l => l.trim()).filter(Boolean).join(" ").trim();
        }
      }

      result.functions.push({
        name, params: params.map(p => ({ name: p, type: "any", description: "" })),
        returnType: fnM[4] || "", line: i + 1,
        exported: !name.startsWith("_"), async: /async/.test(line),
        description, isMethod: indent > 0,
      });
    }

    // Flask/FastAPI routes
    const routeRe = /@(?:app|router|api)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/i;
    const routeM = routeRe.exec(line);
    if (routeM) {
      result.routes.push({ method: routeM[1].toUpperCase(), path: routeM[2] });
    }

    // Classes
    const classRe = /^class\s+(\w+)(?:\(([^)]*)\))?/;
    const classM = classRe.exec(line);
    if (classM) {
      result.classes.push({ name: classM[1], extends: classM[2]?.split(",")[0]?.trim() || null });
    }
  }

  // __all__ exports
  const allRe = /__all__\s*=\s*\[([^\]]+)\]/;
  const allM = allRe.exec(content);
  if (allM) {
    allM[1].split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean)
      .forEach(n => result.exports.push({ name: n, type: "named" }));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Prisma parser
// ---------------------------------------------------------------------------

function parsePrisma(content) {
  const models = [];
  const modelRe = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let m;
  while ((m = modelRe.exec(content)) !== null) {
    const fields = [];
    m[2].split("\n").forEach(line => {
      const fRe = /^\s+(\w+)\s+([\w\[\]?@]+)/;
      const fM = fRe.exec(line);
      if (fM && !line.trim().startsWith("//") && !line.trim().startsWith("@@")) {
        const attrs = [];
        if (line.includes("@id")) attrs.push("primary key");
        if (line.includes("@unique")) attrs.push("unique");
        if (line.includes("@default")) {
          const def = /@default\(([^)]+)\)/.exec(line);
          if (def) attrs.push(`default: ${def[1]}`);
        }
        if (line.includes("@relation")) attrs.push("relation");
        fields.push({ name: fM[1], type: fM[2], attributes: attrs });
      }
    });
    models.push({ name: m[1], fields });
  }
  return models;
}

// ---------------------------------------------------------------------------
// Sequelize model parser
// ---------------------------------------------------------------------------

function parseSequelizeModel(content) {
  const models = [];
  // sequelize.define('ModelName', { ... })
  const defineRe = /(?:sequelize|db)\.define\s*\(\s*['"](\w+)['"],\s*\{/g;
  let m;
  while ((m = defineRe.exec(content)) !== null) {
    models.push({ name: m[1], fields: [], source: "sequelize" });
  }
  // class Foo extends Model
  const classRe = /class\s+(\w+)\s+extends\s+Model/g;
  while ((m = classRe.exec(content)) !== null) {
    models.push({ name: m[1], fields: [], source: "sequelize" });
  }
  return models;
}

// ---------------------------------------------------------------------------
// GraphQL schema parser
// ---------------------------------------------------------------------------

function parseGraphQL(content) {
  const types = [];
  const typeRe = /type\s+(\w+)\s*(?:implements\s+[^{]+)?\{([^}]+)\}/g;
  let m;
  while ((m = typeRe.exec(content)) !== null) {
    if (["Query", "Mutation", "Subscription"].includes(m[1])) continue;
    const fields = m[2].split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"))
      .map(l => {
        const fM = /(\w+)(?:\([^)]*\))?\s*:\s*(.+)/.exec(l);
        return fM ? { name: fM[1], type: fM[2].trim().replace(/!$/, "") } : null;
      }).filter(Boolean);
    types.push({ name: m[1], fields });
  }
  return types;
}

// ---------------------------------------------------------------------------
// Config file detection
// ---------------------------------------------------------------------------

function detectFramework(dir, fileList) {
  const basenames = new Set(fileList.map(f => path.basename(f)));
  const relPaths = fileList.map(f => path.relative(dir, f));

  const signals = {
    "Next.js": () => basenames.has("next.config.js") || basenames.has("next.config.mjs") || basenames.has("next.config.ts"),
    "Nuxt": () => basenames.has("nuxt.config.js") || basenames.has("nuxt.config.ts"),
    "SvelteKit": () => basenames.has("svelte.config.js"),
    "Remix": () => relPaths.some(p => p.includes("remix.config")),
    "Astro": () => basenames.has("astro.config.mjs") || basenames.has("astro.config.ts"),
    "Vite": () => basenames.has("vite.config.js") || basenames.has("vite.config.ts"),
    "Express": () => fileList.some(f => { try { const c = safeRead(f); return c?.includes("express()") || c?.includes("from 'express'"); } catch { return false; } }),
    "Fastify": () => fileList.some(f => { try { const c = safeRead(f); return c?.includes("fastify(") || c?.includes("from 'fastify'"); } catch { return false; } }),
    "NestJS": () => basenames.has("nest-cli.json") || relPaths.some(p => p.includes(".module.ts")),
    "React": () => relPaths.some(p => /\.(jsx|tsx)$/.test(p)),
    "Vue": () => relPaths.some(p => /\.vue$/.test(p)),
    "Svelte": () => relPaths.some(p => /\.svelte$/.test(p)),
    "Django": () => basenames.has("manage.py") || relPaths.some(p => p.includes("settings.py")),
    "FastAPI": () => fileList.some(f => { try { return safeRead(f)?.includes("from fastapi"); } catch { return false; } }),
    "Flask": () => fileList.some(f => { try { return safeRead(f)?.includes("from flask"); } catch { return false; } }),
    "Prisma": () => relPaths.some(p => p.endsWith(".prisma")),
  };

  const detected = [];
  for (const [name, check] of Object.entries(signals)) {
    try { if (check()) detected.push(name); } catch {}
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Package.json reader
// ---------------------------------------------------------------------------

function readPackageJson(dir) {
  const pkgPath = path.join(dir, "package.json");
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Detect entry points
// ---------------------------------------------------------------------------

function detectEntryPoints(dir, fileList) {
  const entries = [];
  const pkg = readPackageJson(dir);
  if (pkg?.main) entries.push({ file: pkg.main, reason: "package.json main" });
  if (pkg?.bin) {
    const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin;
    for (const [name, file] of Object.entries(bins)) {
      entries.push({ file, reason: `bin: ${name}` });
    }
  }
  const commonEntries = ["src/index.ts", "src/index.js", "src/main.ts", "src/main.js", "src/app.ts", "src/app.js", "index.js", "index.ts", "app.js", "app.ts", "server.js", "server.ts", "main.py", "app.py"];
  for (const ce of commonEntries) {
    const full = path.join(dir, ce);
    if (fileList.includes(full)) {
      entries.push({ file: ce, reason: "common entry point" });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Directory tree
// ---------------------------------------------------------------------------

function directoryTree(dir, maxDepth = 4) {
  const lines = [];

  function _tree(current, prefix, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const filtered = entries.filter(e => !IGNORE_DIRS.has(e.name) && !e.name.startsWith("."));
    filtered.forEach((entry, idx) => {
      const isLast = idx === filtered.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const icon = entry.isDirectory() ? "📁" : "📄";
      lines.push(`${prefix}${connector}${icon} ${entry.name}`);
      if (entry.isDirectory()) {
        const newPrefix = prefix + (isLast ? "    " : "│   ");
        _tree(path.join(current, entry.name), newPrefix, depth + 1);
      }
    });
  }

  lines.push(`📁 ${path.basename(dir)}/`);
  _tree(dir, "", 0);
  return lines.join("\n");
}

module.exports = {
  walkDir, safeRead, parseJSTS, parsePython, parsePrisma, parseSequelizeModel,
  parseGraphQL, detectFramework, readPackageJson, detectEntryPoints, directoryTree,
  IGNORE_DIRS, SOURCE_EXTS,
};
