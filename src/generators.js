/**
 * generators.js — Markdown & Mermaid document generators
 * Produces README, full docs, context files, dependency graphs, and more.
 */

const path = require("path");
const {
  analyzCodebase, buildDependencyGraph, externalDependencies,
  analyzeRoutes, complexityScore,
} = require("./analyzer");

// ---------------------------------------------------------------------------
// 1. Architecture Overview
// ---------------------------------------------------------------------------

function generateArchitecture(analysis) {
  const { name, frameworks, fileStats, entryPoints, tree, dependencies, classes } = analysis;
  const complexity = complexityScore(analysis);

  let md = `# Architecture Overview: ${name}\n\n`;
  md += `**Complexity:** ${complexity.label} (${complexity.score}/70)\n`;
  md += `**Frameworks:** ${frameworks.length ? frameworks.join(", ") : "None detected"}\n`;
  md += `**Files:** ${fileStats.total} source files\n\n`;

  // File breakdown
  md += `## File Distribution\n\n`;
  md += `| Extension | Count |\n|-----------|-------|\n`;
  const sorted = Object.entries(fileStats.byExt).sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sorted) {
    md += `| ${ext} | ${count} |\n`;
  }

  // Entry points
  if (entryPoints.length) {
    md += `\n## Entry Points\n\n`;
    for (const ep of entryPoints) {
      md += `- \`${ep.file}\` — ${ep.reason}\n`;
    }
  }

  // Key dependencies
  if (dependencies.production.length) {
    md += `\n## Key Dependencies\n\n`;
    const categories = categorizeDeps(dependencies.production);
    for (const [cat, deps] of Object.entries(categories)) {
      md += `**${cat}:** ${deps.join(", ")}\n\n`;
    }
  }

  // Classes
  if (classes.length) {
    md += `## Classes\n\n`;
    for (const cls of classes) {
      md += `- \`${cls.name}\`${cls.extends ? ` extends \`${cls.extends}\`` : ""} — \`${cls.file}\`\n`;
    }
    md += "\n";
  }

  // Directory tree
  md += `## Directory Structure\n\n\`\`\`\n${tree}\n\`\`\`\n`;

  return md;
}

// ---------------------------------------------------------------------------
// 2. Dependency Graph (Mermaid)
// ---------------------------------------------------------------------------

function generateDependencyGraph(analysis) {
  const internal = buildDependencyGraph(analysis);
  const ext = externalDependencies(analysis);

  let mermaid = "```mermaid\ngraph TD\n";

  // Internal links
  const nodeIds = {};
  let counter = 0;
  const nodeId = (name) => {
    if (!nodeIds[name]) nodeIds[name] = `N${counter++}`;
    return nodeIds[name];
  };

  for (const [from, targets] of Object.entries(internal)) {
    for (const to of targets) {
      mermaid += `  ${nodeId(from)}["${shortName(from)}"] --> ${nodeId(to)}["${shortName(to)}"]\n`;
    }
  }

  // External packages (top 15)
  const extSorted = Object.entries(ext).sort((a, b) => b[1].length - a[1].length).slice(0, 15);
  for (const [pkg, files] of extSorted) {
    const pkgId = nodeId(`ext:${pkg}`);
    mermaid += `  ${pkgId}[("${pkg}")]:::external\n`;
    // Link from most-importing file
    const topFile = files[0];
    if (topFile) mermaid += `  ${nodeId(topFile)} -.-> ${pkgId}\n`;
  }

  mermaid += `\n  classDef external fill:#f9f,stroke:#333,stroke-width:1px\n`;
  mermaid += "```\n";

  let md = `# Dependency Graph: ${analysis.name}\n\n`;
  md += `**Internal modules:** ${Object.keys(internal).length}\n`;
  md += `**External packages:** ${Object.keys(ext).length}\n\n`;
  md += mermaid;

  // Table of external deps
  if (extSorted.length) {
    md += `\n## External Dependencies Usage\n\n`;
    md += `| Package | Used By (files) |\n|---------|----------------|\n`;
    for (const [pkg, files] of extSorted) {
      md += `| ${pkg} | ${files.length} file(s) |\n`;
    }
  }

  return md;
}

function shortName(filePath) {
  const parts = filePath.split(path.sep);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : filePath;
}

// ---------------------------------------------------------------------------
// 3. Function Documentation
// ---------------------------------------------------------------------------

function generateFunctionDocs(analysis) {
  const exported = analysis.functions.filter(f => f.exported);
  const internal = analysis.functions.filter(f => !f.exported && !f.isMethod);
  const methods = analysis.functions.filter(f => f.isMethod);

  let md = `# Function Documentation: ${analysis.name}\n\n`;
  md += `**Total functions:** ${analysis.functions.length} (${exported.length} exported, ${internal.length} internal, ${methods.length} methods)\n\n`;

  if (exported.length) {
    md += `## Exported Functions\n\n`;
    md += formatFunctionTable(exported);
  }

  if (methods.length) {
    md += `## Class Methods\n\n`;
    md += formatFunctionTable(methods);
  }

  if (internal.length) {
    md += `## Internal Functions\n\n`;
    md += formatFunctionTable(internal.slice(0, 100)); // cap at 100
  }

  return md;
}

function formatFunctionTable(fns) {
  let md = "";
  // Group by file
  const byFile = {};
  for (const fn of fns) {
    if (!byFile[fn.file]) byFile[fn.file] = [];
    byFile[fn.file].push(fn);
  }

  for (const [file, fileFns] of Object.entries(byFile)) {
    md += `### \`${file}\`\n\n`;
    for (const fn of fileFns) {
      const asyncTag = fn.async ? "async " : "";
      const paramStr = fn.params.map(p => {
        if (p.type && p.type !== "any") return `${p.name}: ${p.type}`;
        return p.name;
      }).join(", ");
      const retStr = fn.returnType ? ` → ${fn.returnType}` : "";

      md += `#### \`${asyncTag}${fn.name}(${paramStr})${retStr}\`\n\n`;
      if (fn.description) md += `${fn.description}\n\n`;

      if (fn.params.length) {
        md += `| Param | Type | Description |\n|-------|------|-------------|\n`;
        for (const p of fn.params) {
          md += `| ${p.name} | \`${p.type}\` | ${p.description || "—"} |\n`;
        }
        md += "\n";
      }
    }
  }
  return md;
}

// ---------------------------------------------------------------------------
// 4. API Endpoint Documentation
// ---------------------------------------------------------------------------

function generateAPIDocs(analysis) {
  const routes = analyzeRoutes(analysis);

  if (!routes.length) {
    return `# API Documentation: ${analysis.name}\n\nNo API endpoints detected.\n\n> Supported frameworks: Express, Fastify, NestJS, Flask, FastAPI\n`;
  }

  let md = `# API Documentation: ${analysis.name}\n\n`;
  md += `**Total endpoints:** ${routes.length}\n\n`;

  // Summary table
  md += `## Endpoints\n\n`;
  md += `| Method | Path | File | Path Params |\n|--------|------|------|-------------|\n`;
  for (const rt of routes) {
    const params = rt.pathParams.length ? rt.pathParams.map(p => `\`${p}\``).join(", ") : "—";
    md += `| \`${rt.method}\` | \`${rt.path}\` | \`${rt.file}\` | ${params} |\n`;
  }

  // Group by prefix
  const byPrefix = {};
  for (const rt of routes) {
    const prefix = "/" + (rt.path.split("/")[1] || "root");
    if (!byPrefix[prefix]) byPrefix[prefix] = [];
    byPrefix[prefix].push(rt);
  }

  md += `\n## Route Groups\n\n`;
  for (const [prefix, group] of Object.entries(byPrefix)) {
    md += `### ${prefix}\n\n`;
    for (const rt of group) {
      md += `- **${rt.method}** \`${rt.path}\``;
      if (rt.pathParams.length) md += ` (params: ${rt.pathParams.join(", ")})`;
      md += "\n";
    }
    md += "\n";
  }

  return md;
}

// ---------------------------------------------------------------------------
// 5. Database Schema
// ---------------------------------------------------------------------------

function generateSchemaDoc(analysis) {
  if (!analysis.models.length) {
    return `# Database Schema: ${analysis.name}\n\nNo database models detected.\n\n> Supported: Prisma, Sequelize, GraphQL\n`;
  }

  let md = `# Database Schema: ${analysis.name}\n\n`;
  md += `**Total models:** ${analysis.models.length}\n\n`;

  // Group by source
  const bySource = {};
  for (const model of analysis.models) {
    const src = model.source || "unknown";
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(model);
  }

  for (const [source, models] of Object.entries(bySource)) {
    md += `## ${source.charAt(0).toUpperCase() + source.slice(1)} Models\n\n`;

    for (const model of models) {
      md += `### ${model.name}\n\n`;
      if (model.file) md += `*File: \`${model.file}\`*\n\n`;

      if (model.fields?.length) {
        md += `| Field | Type | Attributes |\n|-------|------|------------|\n`;
        for (const f of model.fields) {
          const attrs = f.attributes?.length ? f.attributes.join(", ") : "—";
          md += `| ${f.name} | \`${f.type}\` | ${attrs} |\n`;
        }
        md += "\n";
      }
    }
  }

  // Mermaid ER diagram for Prisma
  const prismaModels = analysis.models.filter(m => m.source === "prisma" && m.fields?.length);
  if (prismaModels.length) {
    md += `## Entity Relationship Diagram\n\n\`\`\`mermaid\nerDiagram\n`;
    for (const model of prismaModels) {
      md += `  ${model.name} {\n`;
      for (const f of model.fields) {
        const type = f.type.replace(/[\[\]?]/g, "");
        if (!type.match(/^[A-Z]/) || ["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal", "Bytes"].includes(type)) {
          md += `    ${type} ${f.name}\n`;
        }
      }
      md += `  }\n`;
    }
    // Relations
    for (const model of prismaModels) {
      for (const f of model.fields) {
        if (f.attributes?.includes("relation")) {
          const targetName = f.type.replace(/[\[\]?]/g, "");
          if (prismaModels.find(m => m.name === targetName)) {
            const rel = f.type.includes("[]") ? "}o--||" : "||--||";
            md += `  ${model.name} ${rel} ${targetName} : "${f.name}"\n`;
          }
        }
      }
    }
    md += `\`\`\`\n`;
  }

  return md;
}

// ---------------------------------------------------------------------------
// 6. LLM Context File (compact summary)
// ---------------------------------------------------------------------------

function generateContext(analysis) {
  const complexity = complexityScore(analysis);
  let ctx = `# ${analysis.name} — LLM Context\n`;
  ctx += `> Auto-generated codebase summary for AI consumption.\n`;
  ctx += `> Complexity: ${complexity.label} | Files: ${analysis.fileStats.total} | Functions: ${analysis.functions.length}\n\n`;

  // Quick overview
  ctx += `## Overview\n`;
  if (analysis.description) ctx += `${analysis.description}\n`;
  ctx += `Frameworks: ${analysis.frameworks.join(", ") || "vanilla"}\n`;
  ctx += `Stack: ${Object.keys(analysis.fileStats.byExt).join(", ")}\n\n`;

  // Key files
  ctx += `## Key Files\n`;
  for (const ep of analysis.entryPoints) {
    ctx += `- ${ep.file} (${ep.reason})\n`;
  }
  ctx += "\n";

  // Exported API surface (compact)
  const exported = analysis.functions.filter(f => f.exported);
  if (exported.length) {
    ctx += `## Public API\n`;
    for (const fn of exported.slice(0, 50)) {
      const params = fn.params.map(p => p.name).join(", ");
      ctx += `- ${fn.file}: ${fn.async ? "async " : ""}${fn.name}(${params})${fn.returnType ? " → " + fn.returnType : ""}\n`;
    }
    if (exported.length > 50) ctx += `... and ${exported.length - 50} more\n`;
    ctx += "\n";
  }

  // Routes (compact)
  if (analysis.routes.length) {
    ctx += `## Endpoints\n`;
    for (const rt of analysis.routes) {
      ctx += `- ${rt.method} ${rt.path} [${rt.file}]\n`;
    }
    ctx += "\n";
  }

  // Models (compact)
  if (analysis.models.length) {
    ctx += `## Data Models\n`;
    for (const m of analysis.models) {
      const fields = m.fields?.map(f => f.name).join(", ") || "—";
      ctx += `- ${m.name}: ${fields}\n`;
    }
    ctx += "\n";
  }

  // Dependencies (just names)
  if (analysis.dependencies.production.length) {
    ctx += `## Dependencies\n`;
    ctx += analysis.dependencies.production.join(", ") + "\n\n";
  }

  // Directory structure (compact)
  ctx += `## Structure\n\`\`\`\n${analysis.tree}\n\`\`\`\n`;

  return ctx;
}

// ---------------------------------------------------------------------------
// 7. Onboarding Guide
// ---------------------------------------------------------------------------

function generateOnboarding(analysis) {
  let md = `# Getting Started with ${analysis.name}\n\n`;

  if (analysis.description) md += `> ${analysis.description}\n\n`;

  // Prerequisites
  md += `## Prerequisites\n\n`;
  if (analysis.frameworks.some(f => ["Express", "Fastify", "Next.js", "React", "NestJS", "Vue", "Nuxt", "SvelteKit", "Svelte", "Vite", "Remix", "Astro"].includes(f))) {
    md += `- Node.js (check \`.nvmrc\` or \`package.json > engines\` for version)\n`;
    md += `- npm or yarn\n`;
  }
  if (analysis.frameworks.some(f => ["Django", "FastAPI", "Flask"].includes(f))) {
    md += `- Python 3.8+\n`;
    md += `- pip or poetry\n`;
  }
  if (analysis.frameworks.includes("Prisma")) {
    md += `- Database (check \`schema.prisma\` for provider)\n`;
  }

  // Quick start
  md += `\n## Quick Start\n\n\`\`\`bash\n`;
  md += `# Clone and install\n`;
  if (analysis.pkg) {
    md += `npm install\n\n`;
    if (analysis.frameworks.includes("Prisma")) {
      md += `# Database setup\nnpx prisma generate\nnpx prisma db push\n\n`;
    }
    if (analysis.pkg.scripts?.dev) md += `# Development\nnpm run dev\n`;
    else if (analysis.pkg.scripts?.start) md += `# Start\nnpm start\n`;
  }
  md += `\`\`\`\n\n`;

  // Architecture
  md += `## Architecture\n\n`;
  md += `**Type:** ${analysis.frameworks.join(" + ") || "Custom"}\n`;
  md += `**Complexity:** ${complexityScore(analysis).label}\n\n`;

  // Key files
  md += `## Key Files to Understand\n\n`;
  md += `| File | Purpose |\n|------|--------|\n`;
  for (const ep of analysis.entryPoints) {
    md += `| \`${ep.file}\` | ${ep.reason} |\n`;
  }
  // Add config files
  const configFiles = ["package.json", "tsconfig.json", ".env.example", "prisma/schema.prisma", "next.config.js", "vite.config.ts"];
  for (const cf of configFiles) {
    const full = path.join(analysis.dir, cf);
    try {
      if (require("fs").existsSync(full)) {
        md += `| \`${cf}\` | Configuration |\n`;
      }
    } catch {}
  }

  // Available scripts
  if (analysis.pkg?.scripts) {
    md += `\n## Available Scripts\n\n`;
    md += `| Script | Command |\n|--------|--------|\n`;
    for (const [name, cmd] of Object.entries(analysis.pkg.scripts)) {
      md += `| \`npm run ${name}\` | \`${cmd}\` |\n`;
    }
  }

  // Routes overview
  if (analysis.routes.length) {
    md += `\n## API Endpoints (${analysis.routes.length} total)\n\n`;
    for (const rt of analysis.routes.slice(0, 10)) {
      md += `- \`${rt.method} ${rt.path}\`\n`;
    }
    if (analysis.routes.length > 10) md += `- ... and ${analysis.routes.length - 10} more\n`;
  }

  md += `\n## Next Steps\n\n`;
  md += `1. Read the entry point(s) listed above\n`;
  md += `2. Explore the directory structure to understand the project layout\n`;
  md += `3. Check available scripts for development workflow\n`;
  if (analysis.routes.length) md += `4. Review the API endpoints for the application's capabilities\n`;
  if (analysis.models.length) md += `5. Study the data models to understand the domain\n`;

  return md;
}

// ---------------------------------------------------------------------------
// 8. README Generator
// ---------------------------------------------------------------------------

function generateReadme(analysis) {
  const complexity = complexityScore(analysis);

  let md = `# ${analysis.name}\n\n`;
  if (analysis.description) md += `${analysis.description}\n\n`;

  // Badges
  if (analysis.pkg) {
    md += `![Version](https://img.shields.io/badge/version-${analysis.version}-blue)\n`;
    if (analysis.frameworks.length) {
      md += `![Stack](https://img.shields.io/badge/stack-${analysis.frameworks[0].replace(/\./g, "_")}-green)\n`;
    }
    md += "\n";
  }

  // Features (inferred from structure)
  md += `## Features\n\n`;
  if (analysis.routes.length) md += `- ${analysis.routes.length} API endpoints\n`;
  if (analysis.models.length) md += `- ${analysis.models.length} data models\n`;
  if (analysis.functions.filter(f => f.exported).length) {
    md += `- ${analysis.functions.filter(f => f.exported).length} exported functions\n`;
  }
  md += `- ${analysis.fileStats.total} source files\n`;
  md += `- Built with: ${analysis.frameworks.join(", ") || "vanilla JS/TS"}\n\n`;

  // Install
  md += `## Installation\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n`;

  // Usage
  md += `## Usage\n\n\`\`\`bash\n`;
  if (analysis.pkg?.scripts?.dev) md += `npm run dev    # development\n`;
  if (analysis.pkg?.scripts?.build) md += `npm run build  # production build\n`;
  if (analysis.pkg?.scripts?.start) md += `npm start      # start server\n`;
  if (analysis.pkg?.scripts?.test) md += `npm test       # run tests\n`;
  md += `\`\`\`\n\n`;

  // API docs (if routes exist)
  if (analysis.routes.length) {
    md += `## API\n\n`;
    md += `| Method | Endpoint | Description |\n|--------|----------|-------------|\n`;
    for (const rt of analysis.routes) {
      md += `| \`${rt.method}\` | \`${rt.path}\` | — |\n`;
    }
    md += "\n";
  }

  // Project structure
  md += `## Project Structure\n\n\`\`\`\n${analysis.tree}\n\`\`\`\n\n`;

  // Tech stack
  if (analysis.dependencies.production.length) {
    md += `## Tech Stack\n\n`;
    const cats = categorizeDeps(analysis.dependencies.production);
    for (const [cat, deps] of Object.entries(cats)) {
      md += `- **${cat}:** ${deps.join(", ")}\n`;
    }
    md += "\n";
  }

  // License
  if (analysis.pkg?.license) {
    md += `## License\n\n${analysis.pkg.license}\n`;
  }

  return md;
}

// ---------------------------------------------------------------------------
// Full documentation set
// ---------------------------------------------------------------------------

function generateFullDocs(analysis) {
  return [
    { title: "Architecture Overview", content: generateArchitecture(analysis) },
    { title: "Dependency Graph", content: generateDependencyGraph(analysis) },
    { title: "Function Documentation", content: generateFunctionDocs(analysis) },
    { title: "API Documentation", content: generateAPIDocs(analysis) },
    { title: "Database Schema", content: generateSchemaDoc(analysis) },
    { title: "LLM Context", content: generateContext(analysis) },
    { title: "Onboarding Guide", content: generateOnboarding(analysis) },
    { title: "README", content: generateReadme(analysis) },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categorizeDeps(deps) {
  const categories = {
    "Framework": [], "Database": [], "Auth": [], "HTTP": [],
    "Testing": [], "Build": [], "Utility": [], "Other": [],
  };

  const rules = {
    "Framework": /^(express|fastify|next|nuxt|react|vue|svelte|angular|nest|remix|astro|hono|koa)/,
    "Database": /^(prisma|sequelize|typeorm|knex|mongoose|pg|mysql|redis|mongodb|drizzle|better-sqlite)/,
    "Auth": /^(passport|jsonwebtoken|bcrypt|jose|next-auth|clerk|auth0|firebase-admin)/,
    "HTTP": /^(axios|node-fetch|got|superagent|undici|cors)/,
    "Testing": /^(jest|mocha|vitest|cypress|playwright|supertest|chai)/,
    "Build": /^(typescript|webpack|vite|esbuild|rollup|babel|tsup|swc)/,
    "Utility": /^(lodash|dayjs|moment|zod|yup|joi|uuid|nanoid|dotenv|chalk|commander|inquirer)/,
  };

  for (const dep of deps) {
    let placed = false;
    for (const [cat, re] of Object.entries(rules)) {
      if (re.test(dep)) { categories[cat].push(dep); placed = true; break; }
    }
    if (!placed) categories["Other"].push(dep);
  }

  return Object.fromEntries(Object.entries(categories).filter(([, v]) => v.length > 0));
}

module.exports = {
  generateArchitecture, generateDependencyGraph, generateFunctionDocs,
  generateAPIDocs, generateSchemaDoc, generateContext, generateOnboarding,
  generateReadme, generateFullDocs,
};
