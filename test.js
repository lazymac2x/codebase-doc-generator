#!/usr/bin/env node
/**
 * test.js — Integration tests for codebase-doc-generator
 * Tests all MCP tools by analyzing this project itself.
 */

const http = require("http");
const path = require("path");

const BASE = "http://localhost:3000";
const PROJECT_DIR = __dirname;

let passed = 0;
let failed = 0;

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, BASE);
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": data.length } }, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { reject(new Error(`Invalid JSON: ${buf}`)); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    http.get(url, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { reject(new Error(`Invalid JSON: ${buf}`)); }
      });
    }).on("error", reject);
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

async function callTool(toolName, args) {
  const res = await post("/mcp", {
    jsonrpc: "2.0", id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  assert(!res.error, `MCP error: ${JSON.stringify(res.error)}`);
  assert(res.result?.content?.[0]?.text, "Missing result text");
  assert(!res.result.isError, `Tool error: ${res.result.content[0].text}`);
  return res.result.content[0].text;
}

async function run() {
  console.log("\n  codebase-doc-generator tests\n");

  // --- Health check ---
  await test("GET / returns server info", async () => {
    const info = await get("/");
    assert(info.name === "codebase-doc-generator", "Wrong name");
    assert(info.status === "running", "Not running");
    assert(Array.isArray(info.tools), "Missing tools");
    assert(info.tools.length === 6, `Expected 6 tools, got ${info.tools.length}`);
  });

  // --- MCP Initialize ---
  await test("initialize returns server info", async () => {
    const res = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize" });
    assert(res.result?.serverInfo?.name === "codebase-doc-generator", "Wrong server name");
    assert(res.result?.protocolVersion === "2024-11-05", "Wrong protocol version");
  });

  // --- Tools list ---
  await test("tools/list returns 6 tools", async () => {
    const res = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert(res.result?.tools?.length === 6, `Expected 6 tools, got ${res.result?.tools?.length}`);
    const names = res.result.tools.map(t => t.name);
    assert(names.includes("analyze_codebase"), "Missing analyze_codebase");
    assert(names.includes("generate_readme"), "Missing generate_readme");
    assert(names.includes("generate_docs"), "Missing generate_docs");
    assert(names.includes("generate_context"), "Missing generate_context");
    assert(names.includes("dependency_graph"), "Missing dependency_graph");
    assert(names.includes("api_docs"), "Missing api_docs");
  });

  // --- analyze_codebase ---
  await test("analyze_codebase returns architecture markdown", async () => {
    const text = await callTool("analyze_codebase", { path: PROJECT_DIR });
    assert(text.includes("# Architecture Overview"), "Missing architecture header");
    assert(text.includes("codebase-doc-generator"), "Missing project name");
    assert(text.includes("File Distribution"), "Missing file distribution");
    assert(text.includes("Directory Structure"), "Missing directory structure");
    assert(text.includes(".js"), "Missing .js extension");
  });

  // --- generate_readme ---
  await test("generate_readme produces valid README", async () => {
    const text = await callTool("generate_readme", { path: PROJECT_DIR });
    assert(text.includes("# codebase-doc-generator"), "Missing title");
    assert(text.includes("## Installation"), "Missing installation");
    assert(text.includes("## Usage"), "Missing usage");
    assert(text.includes("## Project Structure"), "Missing structure");
    assert(text.includes("express"), "Missing express dep");
  });

  // --- generate_docs ---
  await test("generate_docs returns full documentation set", async () => {
    const text = await callTool("generate_docs", { path: PROJECT_DIR });
    assert(text.includes("Architecture Overview"), "Missing architecture");
    assert(text.includes("Dependency Graph"), "Missing dep graph");
    assert(text.includes("Function Documentation"), "Missing function docs");
    assert(text.includes("API Documentation"), "Missing API docs");
    assert(text.includes("LLM Context"), "Missing LLM context");
    assert(text.includes("Getting Started"), "Missing onboarding");
  });

  // --- generate_context ---
  await test("generate_context produces compact summary", async () => {
    const text = await callTool("generate_context", { path: PROJECT_DIR });
    assert(text.includes("LLM Context"), "Missing LLM Context header");
    assert(text.includes("## Overview"), "Missing overview");
    assert(text.includes("## Key Files"), "Missing key files");
    assert(text.includes("## Structure"), "Missing structure");
    // Context should be compact — shorter than full docs
    assert(text.length < 10000, `Context too large: ${text.length} chars`);
  });

  // --- dependency_graph ---
  await test("dependency_graph returns Mermaid diagram", async () => {
    const text = await callTool("dependency_graph", { path: PROJECT_DIR });
    assert(text.includes("# Dependency Graph"), "Missing header");
    assert(text.includes("```mermaid"), "Missing mermaid block");
    assert(text.includes("graph TD"), "Missing graph declaration");
  });

  // --- api_docs ---
  await test("api_docs detects Express routes", async () => {
    const text = await callTool("api_docs", { path: PROJECT_DIR });
    assert(text.includes("# API Documentation"), "Missing header");
    // Should detect POST /mcp and GET /
    assert(text.includes("/mcp") || text.includes("POST"), "Missing /mcp route");
  });

  // --- Error handling ---
  await test("handles non-existent path gracefully", async () => {
    const res = await post("/mcp", {
      jsonrpc: "2.0", id: 1,
      method: "tools/call",
      params: { name: "analyze_codebase", arguments: { path: "/nonexistent/path/xyz" } },
    });
    assert(res.result?.isError === true, "Should report error");
    assert(res.result?.content?.[0]?.text.includes("Error"), "Should contain error message");
  });

  await test("handles unknown method", async () => {
    const res = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "unknown/method" });
    assert(res.error?.code === -32601, "Should return method not found");
  });

  await test("handles unknown tool", async () => {
    const res = await post("/mcp", {
      jsonrpc: "2.0", id: 1,
      method: "tools/call",
      params: { name: "nonexistent_tool", arguments: { path: PROJECT_DIR } },
    });
    assert(res.result?.isError === true, "Should report error");
  });

  // --- Summary ---
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("Test runner error:", err); process.exit(1); });
