'use strict';
/*
 * Idempotent MCP server wiring for `spectoflow init`.
 *
 * MCP-capable clients (Claude Code, and others that read a project `.mcp.json`) discover MCP servers
 * from a JSON file with an `mcpServers` map. init seeds a `playwright` entry so the E2E agent can
 * drive a real browser and generate/run Playwright tests — WITHOUT ever touching an entry the user
 * (or another tool) already put there. Nothing is installed globally: the server runs via `npx`,
 * fetched on first use, so wiring this config IS the whole "install".
 *
 * spectoflow's own zero-runtime-dependency invariant is unaffected — this writes into the USER's
 * project, never into spectoflow.
 */
const fs = require('fs');
const path = require('path');

// The Playwright MCP server (Microsoft). npx fetches it on first use — no global install.
const PLAYWRIGHT_MCP = { command: 'npx', args: ['@playwright/mcp@latest'] };

// Merge a single MCP server into a project's MCP config file, idempotently and non-destructively.
// Returns one of:
//   'created' — file did not exist, created with just this server.
//   'added'   — file existed; server inserted alongside the existing ones.
//   'exists'  — server already present; file left exactly as-is (idempotent).
//   'skipped' — file present but not parseable/shaped as expected; left untouched (never clobbered).
function mergeMcpServer(filePath, name, config) {
  if (fs.existsSync(filePath)) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return 'skipped'; }                 // never clobber a file we can't understand
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'skipped';
    const servers = doc.mcpServers && typeof doc.mcpServers === 'object' && !Array.isArray(doc.mcpServers)
      ? doc.mcpServers : null;
    if (servers && Object.prototype.hasOwnProperty.call(servers, name)) return 'exists';
    doc.mcpServers = { ...(servers || {}), [name]: config };
    fs.writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n');
    return 'added';
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ mcpServers: { [name]: config } }, null, 2) + '\n');
  return 'created';
}

module.exports = { mergeMcpServer, PLAYWRIGHT_MCP };
