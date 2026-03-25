/**
 * Apify Actor entry point
 * Runs the Express MCP server inside Apify's environment.
 */

const app = require("./server");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`codebase-doc-generator (Apify) running on port ${PORT}`);
});
