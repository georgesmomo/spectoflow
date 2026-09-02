'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeMcpServer, PLAYWRIGHT_MCP } = require('../lib/mcp');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spf-mcp-'));

test('creates .mcp.json when absent', () => {
  const fp = path.join(tmp(), '.mcp.json');
  assert.equal(mergeMcpServer(fp, 'playwright', PLAYWRIGHT_MCP), 'created');
  const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
  assert.deepEqual(doc.mcpServers.playwright, PLAYWRIGHT_MCP);
});

test('adds server without touching existing ones', () => {
  const fp = path.join(tmp(), '.mcp.json');
  fs.writeFileSync(fp, JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2));
  assert.equal(mergeMcpServer(fp, 'playwright', PLAYWRIGHT_MCP), 'added');
  const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
  assert.deepEqual(doc.mcpServers.other, { command: 'x' });        // preserved
  assert.deepEqual(doc.mcpServers.playwright, PLAYWRIGHT_MCP);
});

test('idempotent: an existing playwright entry is left untouched', () => {
  const fp = path.join(tmp(), '.mcp.json');
  const custom = { command: 'npx', args: ['@playwright/mcp@1.0.0', '--headless'] };
  fs.writeFileSync(fp, JSON.stringify({ mcpServers: { playwright: custom } }, null, 2));
  assert.equal(mergeMcpServer(fp, 'playwright', PLAYWRIGHT_MCP), 'exists');
  const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
  assert.deepEqual(doc.mcpServers.playwright, custom);             // NOT overwritten
});

test('does not clobber an unparseable file', () => {
  const fp = path.join(tmp(), '.mcp.json');
  fs.writeFileSync(fp, '{ not valid json');
  assert.equal(mergeMcpServer(fp, 'playwright', PLAYWRIGHT_MCP), 'skipped');
  assert.equal(fs.readFileSync(fp, 'utf8'), '{ not valid json');   // untouched
});

test('running twice is stable (created then exists)', () => {
  const fp = path.join(tmp(), '.mcp.json');
  assert.equal(mergeMcpServer(fp, 'playwright', PLAYWRIGHT_MCP), 'created');
  assert.equal(mergeMcpServer(fp, 'playwright', PLAYWRIGHT_MCP), 'exists');
});

test('creates nested config path (e.g. .cursor/mcp.json)', () => {
  const fp = path.join(tmp(), '.cursor', 'mcp.json');
  assert.equal(mergeMcpServer(fp, 'playwright', PLAYWRIGHT_MCP), 'created');
  assert.ok(fs.existsSync(fp));
});
