# Codebase Doc Generator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Point it at any codebase. Get complete documentation.** Architecture overview, dependency graph, API surface, and a ready-to-use README -- all generated locally with zero external APIs.

## Why

You spend hours writing documentation that goes stale in a week. This tool reads your code and generates accurate docs in seconds. It also reduces LLM context window usage by 70% -- feed the generated summary to your AI instead of your entire codebase.

## Install

```bash
npm install
npm start
# Server runs on http://localhost:3000
```

### As MCP Server
Add to your Cursor/Claude Code config:
```json
{
  "mcpServers": {
    "codebase-doc-generator": {
      "command": "node",
      "args": ["path/to/codebase-doc-generator/src/main.js"]
    }
  }
}
```

## API Endpoints

### `POST /generate`
Generate documentation for a codebase.

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/your/project"}'
```

**Response includes:**
```json
{
  "architecture": "Express.js REST API with 3 route modules...",
  "dependencies": { "graph": "...", "external": [...], "internal": [...] },
  "api": { "endpoints": [...], "models": [...] },
  "readme": "# Project Name\n\n## Overview\n..."
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `generate_docs` | Full documentation generation |
| `analyze_architecture` | Architecture overview only |
| `map_dependencies` | Dependency graph (internal + external) |
| `extract_api` | API surface extraction |
| `generate_readme` | README generation |

## What It Generates

- **Architecture** -- project structure, design patterns, entry points, flow diagrams
- **Dependencies** -- internal module graph, external package usage, circular dependency detection
- **API Surface** -- endpoints, parameters, response types, authentication
- **README** -- installation, usage, API docs, contributing guide

## Links

- [GitHub](https://github.com/lazymac2x/codebase-doc-generator)
- [All 29 Tools](https://lazymac2x.github.io/lazymac-api-store/)

## License

MIT
