'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const store = require('../templates/lib/store');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const SERVER = path.join(KIT, 'templates', 'dashboard', 'server.js');
const CHAT_FIXTURE = path.join(KIT, 'test', 'fixtures', 'chat-agent.js').split(path.sep).join('/');
const SUMMARY_FIXTURE = path.join(KIT, 'test', 'fixtures', 'summary-agent.js').split(path.sep).join('/');

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-agentsapi-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const cfgP = path.join(d, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
  cfg.agent = 'claude';
  cfg.runners = { claude: `node ${CHAT_FIXTURE}`, opencode: `node ${SUMMARY_FIXTURE}` };
  fs.writeFileSync(cfgP, JSON.stringify(cfg, null, 2) + '\n');
  return d;
}
// A fake binary on an otherwise-empty PATH — enough for binOnPath to consider it installed, and
// isolated from whatever the machine actually has installed (this repo's own dev box may well have
// real opencode/kiro/etc. binaries on its real PATH, which would make these tests flaky if we merged
// it in). `node` itself must still resolve, since it's what launches the server subprocess — its own
// directory (not the rest of the real PATH) is included for exactly that, and nothing else.
const NODE_DIR = path.dirname(process.execPath);
function isolatedPath(...names) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-bin-'));
  const ext = process.platform === 'win32' ? '.CMD' : '';
  for (const name of names) fs.writeFileSync(path.join(d, name + ext), process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
  return [d, NODE_DIR].join(path.delimiter);
}
function req(port, method, p, obj) {
  return new Promise((resolve) => {
    const data = obj ? JSON.stringify(obj) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); });
    if (data) r.write(data);
    r.end();
  });
}
function startServer(root, port, extraEnv) {
  return new Promise((resolve) => {
    const srv = spawn('node', [SERVER], { env: { ...process.env, ...extraEnv, SPECTOFLOW_ROOT: root, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/dashboard →/.test(d.toString())) resolve(srv); });
  });
}
async function waitFor(pred, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('GET /api/project exposes knownAgents and installedAgents', async () => {
  const d = project();
  const port = 4500 + Math.floor(Math.random() * 200);
  const srv = await startServer(d, port, { PATH: isolatedPath('claude') });
  try {
    const r = await req(port, 'GET', '/api/project');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.knownAgents) && r.body.knownAgents.length >= 7);
    assert.ok(r.body.knownAgents.some((a) => a.id === 'opencode' && a.label));
    assert.ok(r.body.installedAgents.includes('claude'));
    assert.ok(!r.body.installedAgents.includes('opencode'), 'opencode is not on PATH in this test');
  } finally { srv.kill(); }
});

test('POST /api/settings rejects switching to an agent that is not installed', async () => {
  const d = project();
  const port = 4500 + Math.floor(Math.random() * 200);
  const srv = await startServer(d, port, { PATH: NODE_DIR });
  try {
    const before = JSON.parse(fs.readFileSync(path.join(d, '.spectoflow', 'config.json'), 'utf8')).agent;
    const r = await req(port, 'POST', '/api/settings', { agent: 'opencode' });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /isn.t installed/i);
    const after = JSON.parse(fs.readFileSync(path.join(d, '.spectoflow', 'config.json'), 'utf8')).agent;
    assert.strictEqual(after, before, 'config.agent unchanged on rejection');
  } finally { srv.kill(); }
});

test('POST /api/settings accepts switching to an agent that is genuinely installed', async () => {
  const d = project();
  const port = 4500 + Math.floor(Math.random() * 200);
  const srv = await startServer(d, port, { PATH: isolatedPath('opencode') });
  try {
    const r = await req(port, 'POST', '/api/settings', { agent: 'opencode' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.config.agent, 'opencode');
    const cfg = JSON.parse(fs.readFileSync(path.join(d, '.spectoflow', 'config.json'), 'utf8'));
    assert.strictEqual(cfg.agent, 'opencode');
  } finally { srv.kill(); }
});

test('POST /api/chat/clear empties the message log', async () => {
  const d = project();
  const rt = store.readRuntime(d); rt.messages = [{ id: 'm1', role: 'user', kind: 'message', text: 'hi', at: new Date().toISOString() }];
  store.writeRuntime(d, rt);
  const port = 4500 + Math.floor(Math.random() * 200);
  const srv = await startServer(d, port);
  try {
    const r = await req(port, 'POST', '/api/chat/clear');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(store.readRuntime(d).messages, []);
  } finally { srv.kill(); }
});

test('POST /api/chat/summarize appends a summary message from the configured agent', async () => {
  const d = project();
  const cfgP = path.join(d, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
  cfg.agent = 'opencode'; // routed to summary-agent.js via runners.opencode above
  fs.writeFileSync(cfgP, JSON.stringify(cfg, null, 2) + '\n');
  const rt = store.readRuntime(d); rt.messages = [{ id: 'm1', role: 'user', kind: 'message', text: 'add login', at: new Date().toISOString() }];
  store.writeRuntime(d, rt);
  const port = 4500 + Math.floor(Math.random() * 200);
  const srv = await startServer(d, port);
  try {
    const r = await req(port, 'POST', '/api/chat/summarize', {});
    assert.strictEqual(r.status, 200);
    const ok = await waitFor(() => store.readRuntime(d).messages.some((m) => m.kind === 'summary'));
    assert.ok(ok, 'a summary message appeared');
  } finally { srv.kill(); }
});

test('POST /api/chat/summarize errors when there is nothing to summarize yet', async () => {
  const d = project();
  const port = 4500 + Math.floor(Math.random() * 200);
  const srv = await startServer(d, port);
  try {
    const r = await req(port, 'POST', '/api/chat/summarize', {});
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Nothing to summarize/);
  } finally { srv.kill(); }
});
