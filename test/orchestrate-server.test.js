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
const FIXTURE = path.join(KIT, 'test', 'fixtures', 'chat-agent.js').split(path.sep).join('/');

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-srv-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const cfgP = path.join(d, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
  cfg.mode = 'autopilot';
  cfg.agent = 'claude';
  cfg.runners = { claude: `node ${FIXTURE}` };
  fs.writeFileSync(cfgP, JSON.stringify(cfg, null, 2) + '\n');
  return d;
}
function post(port, p, obj) {
  return new Promise((resolve) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); });
    req.end(data);
  });
}
function startServer(root, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [SERVER], { env: { ...process.env, SPECTOFLOW_ROOT: root, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/dashboard →/.test(d.toString())) resolve(srv); });
  });
}

test('POST /api/orchestrate runs the workflow to done in autopilot', async () => {
  const d = project();
  const port = 4400 + Math.floor(Math.random() * 200);
  const srv = await startServer(d, port);
  try {
    const r = await post(port, '/api/orchestrate', { request: 'add login' });
    assert.strictEqual(r.status, 200); assert.ok(r.body.orchestrationId);
    // poll runtime until terminal
    for (let i = 0; i < 60; i++) {
      const o = store.readRuntime(d).orchestration;
      if (o && ['done', 'failed', 'cancelled'].includes(o.status)) { assert.strictEqual(o.status, 'done'); return; }
      await new Promise((s) => setTimeout(s, 100));
    }
    assert.fail('orchestration did not finish in time');
  } finally { srv.kill(); }
});
