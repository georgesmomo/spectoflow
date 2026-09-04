'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const HUB = path.join(KIT, 'lib', 'hub-server.js');

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hub-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  return d;
}
function get(port, p) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let b = ''; res.on('data', (c) => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
  });
}
function getJSON(port, p) {
  return get(port, p).then((r) => ({ status: r.status, body: JSON.parse(r.body || '{}') }));
}
function reqJSON(port, method, p, bodyObj) {
  return new Promise((resolve) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); });
    if (data) r.write(data); r.end();
  });
}
function startHub(root, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [HUB], { env: { ...process.env, SPECTOFLOW_ROOT: root, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(srv); });
  });
}

test('GET /api/project returns this project\'s data via the dynamically-loaded handlers.js', async () => {
  const d = project();
  const port = 4700 + Math.floor(Math.random() * 100);
  const srv = await startHub(d, port);
  try {
    const res = await getJSON(port, '/api/project');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.projectName, path.basename(d));
  } finally { srv.kill(); }
});

test('static index.html is served from the global templates/dashboard/public, not the project\'s vendored copy', async () => {
  const d = project();
  // Prove it's reading the GLOBAL public dir: corrupt the project's own vendored index.html and
  // confirm the hub still serves a real page (it must never have looked at the project's copy).
  fs.writeFileSync(path.join(d, '.spectoflow', 'dashboard', 'public', 'index.html'), 'THIS SHOULD NEVER BE SERVED');
  const port = 4800 + Math.floor(Math.random() * 100);
  const srv = await startHub(d, port);
  try {
    const res = await get(port, '/');
    assert.strictEqual(res.status, 200);
    assert.ok(!res.body.includes('THIS SHOULD NEVER BE SERVED'), 'must serve the global public/, not the project\'s vendored one');
    assert.ok(res.body.includes('<html') || res.body.includes('<!DOCTYPE'), 'looks like a real HTML page');
  } finally { srv.kill(); }
});

test('SPA fallback: an extensionless unknown route still serves index.html', async () => {
  const d = project();
  const port = 4900 + Math.floor(Math.random() * 100);
  const srv = await startHub(d, port);
  try {
    const res = await get(port, '/backlog');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('<html') || res.body.includes('<!DOCTYPE'));
  } finally { srv.kill(); }
});

test('POST /api/task creates a task through the dynamically-loaded handlers, delegated correctly', async () => {
  const d = project();
  const port = 5000 + Math.floor(Math.random() * 100);
  const srv = await startHub(d, port);
  try {
    const res = await reqJSON(port, 'POST', '/api/task', { title: 'hub split parity check' });
    assert.strictEqual(res.status, 200);
    assert.match(res.body.task.id, /^T-\d+$/);
    const proj = await getJSON(port, '/api/project');
    const found = (proj.body.plans || []).some((pl) => pl.phases.some((ph) => ph.tasks.some((t) => t.id === res.body.task.id)));
    assert.ok(found, 'the created task shows up when re-reading the project through the hub');
  } finally { srv.kill(); }
});

test('an unknown /api/ route 404s, matching server.js parity (handleApi returned false, no crash)', async () => {
  const d = project();
  const port = 5100 + Math.floor(Math.random() * 100);
  const srv = await startHub(d, port);
  try {
    const res = await get(port, '/api/this-route-does-not-exist');
    // Not registered in handlers.js -> handleApi returns false -> falls through to static serving,
    // which explicitly excludes /api/* paths from the SPA fallback (same guard as server.js: an
    // unmatched /api/ path 404s, it never silently serves the app shell). No crash either way.
    assert.strictEqual(res.status, 404);
  } finally { srv.kill(); }
});

test('writes .spectoflow/.dashboard.lock with the right pid/port while running, same shape as server.js', async () => {
  const d = project();
  const port = 5200 + Math.floor(Math.random() * 100);
  const srv = await startHub(d, port);
  const lockPath = path.join(d, '.spectoflow', '.dashboard.lock');
  try {
    await get(port, '/api/project'); // ensure the server has fully started before checking the lock
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.strictEqual(lock.port, port);
    assert.strictEqual(lock.pid, srv.pid);
    // Deliberately not asserting the lock is removed after srv.kill(): on Windows, forcefully
    // killing a child process does not reliably run its process.on('exit'/'SIGTERM') handlers — the
    // exact same limitation applies to templates/dashboard/server.js's own identical clearLock() (no
    // existing test in this suite asserts it either, for the same reason). Verified empirically
    // against the unmodified server.js on this machine before writing this comment.
  } finally { srv.kill(); }
});
