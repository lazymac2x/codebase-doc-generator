#!/usr/bin/env node
/**
 * codebase-doc-generator — MCP Server
 *
 * Auto-generates documentation from any codebase.
 * Scans architecture, maps dependencies, extracts APIs, generates README.
 * All local, zero external APIs. Reduces LLM context window usage by 70%.
 *
 * POST /mcp — Model Context Protocol endpoint
 * GET  /     — Health check
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const { analyzCodebase } = require("./analyzer");
const {
  generateArchitecture, generateDependencyGraph, generateFunctionDocs,
  generateAPIDocs, generateSchemaDoc, generateContext, generateOnboarding,
  generateReadme, generateFullDocs,
} = require("./generators");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ---------------------------------------------------------------------------
// MCP Tool Definitions
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: "analyze_codebase",
    description: "Perform full analysis of a project directory. Returns architecture overview, frameworks detected, file statistics, entry points, and complexity score.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the project directory to analyze" },
      },
      required: ["path"],
    },
  },
  {
    name: "generate_readme",
    description: "Generate a professional README.md from codebase analysis. Includes features, installation, usage, API docs, project structure, and tech stack.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the project directory" },
      },
      required: ["path"],
    },
  },
  {
    name: "generate_docs",
    description: "Generate complete documentation set: architecture overview, dependency graph, function docs, API docs, database schema, LLM context, onboarding guide, and README.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the project directory" },
      },
      required: ["path"],
    },
  },
  {
    name: "generate_context",
    description: "Generate an LLM-optimized context file that summarizes the entire codebase in a compact format. Reduces context window usage by ~70% compared to raw source files.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the project directory" },
      },
      required: ["path"],
    },
  },
  {
    name: "dependency_graph",
    description: "Map all imports/requires across files and generate a Mermaid dependency diagram showing internal module relationships and external package usage.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the project directory" },
      },
      required: ["path"],
    },
  },
  {
    name: "api_docs",
    description: "Detect Express, Fastify, NestJS, Flask, and FastAPI routes. Generate endpoint documentation table with methods, paths, path parameters, and route groups.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the project directory" },
      },
      required: ["path"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------

function executeTool(name, args) {
  const targetPath = args.path;
  if (!targetPath) throw new Error("Missing required parameter: path");

  const resolvedPath = path.resolve(targetPath);
  const analysis = analyzCodebase(resolvedPath);

  switch (name) {
    case "analyze_codebase":
      return generateArchitecture(analysis);
    case "generate_readme":
      return generateReadme(analysis);
    case "generate_docs": {
      const docs = generateFullDocs(analysis);
      return docs.map(d => `---\n\n${d.content}`).join("\n\n");
    }
    case "generate_context":
      return generateContext(analysis);
    case "dependency_graph":
      return generateDependencyGraph(analysis);
    case "api_docs":
      return generateAPIDocs(analysis);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// MCP Protocol Handler
// ---------------------------------------------------------------------------

app.post("/mcp", (req, res) => {
  const { method, params, id } = req.body;

  try {
    switch (method) {
      // --- Initialize ---
      case "initialize":
        return res.json({
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: {
              name: "codebase-doc-generator",
              version: "1.0.0",
              description: "Auto-generate documentation from any codebase. Architecture analysis, dependency graphs, API docs, README generation — all local, zero external APIs.",
            },
          },
        });

      // --- List Tools ---
      case "tools/list":
        return res.json({
          jsonrpc: "2.0", id,
          result: { tools: MCP_TOOLS },
        });

      // --- Call Tool ---
      case "tools/call": {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        try {
          const result = executeTool(toolName, toolArgs);
          return res.json({
            jsonrpc: "2.0", id,
            result: {
              content: [{ type: "text", text: result }],
            },
          });
        } catch (err) {
          return res.json({
            jsonrpc: "2.0", id,
            result: {
              content: [{ type: "text", text: `Error: ${err.message}` }],
              isError: true,
            },
          });
        }
      }

      default:
        return res.json({
          jsonrpc: "2.0", id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  } catch (err) {
    return res.json({
      jsonrpc: "2.0", id,
      error: { code: -32603, message: err.message },
    });
  }
});

// ---------------------------------------------------------------------------
// Health / Info
// ---------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    name: "codebase-doc-generator",
    version: "1.0.0",
    description: "MCP server for auto-generating documentation from any codebase",
    tools: MCP_TOOLS.map(t => t.name),
    status: "running",
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`codebase-doc-generator MCP server running on port ${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`Health check: http://localhost:${PORT}/`);
  });
}

module.exports = app;
