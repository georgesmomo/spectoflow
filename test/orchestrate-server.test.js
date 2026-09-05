'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const store = require('../lib/store');
const registry = require('../lib/registry');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const HUB = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');
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
  // Single enabled step: minimizes how many child processes this test spawns, which minimizes
  // exposure to intermittent Windows AV/EDR interception of freshly-spawned node.exe processes.
  // Multi-step ordering is already covered by the orchestrator unit tests (Task 3).
  fs.writeFileSync(path.join(d, '.spectoflow', 'workflow.md'),
    '# Active workflow\n\n- [x] Analysis {cap:analysis skill:analyze-requirements}\n');
  return d;
}
function post(port, p, obj) {
  return new Promise((resolve) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port, path: withP(p), method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); });
    req.end(data);
  });
}
// The hub serves many projects; every /api/* call carries ?p=<id>. `withP()` appends the id of the
// project the current test started, so the request helpers below stay one-liners.
let currentId = null;
const withP = (p) => p + (p.includes('?') ? '&' : '?') + 'p=' + currentId;
function startServer(root, port, extraEnv = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-home-'));
  currentId = registry.addProject(root, path.join(home, 'dashboard')).id;
  return new Promise((resolve) => {
    const srv = spawn('node', [HUB], { env: { ...process.env, ...extraEnv, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(srv); });
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
    for (let i = 0; i < 100; i++) {
      const o = store.readRuntime(d).orchestration;
      if (o && ['done', 'failed', 'cancelled'].includes(o.status)) { assert.strictEqual(o.status, 'done'); return; }
      await new Promise((s) => setTimeout(s, 100));
    }
    assert.fail('orchestration did not finish in time');
  } finally { srv.kill(); }
});
