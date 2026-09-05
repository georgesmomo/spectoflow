'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const registry = require('../lib/registry');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const HUB = path.join(KIT, 'lib', 'hub-server.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hub-home-'));
}
function project(home, namePrefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `stf-hub-${namePrefix}-`));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  return registry.addProject(d, home);
}
function get(port, p) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let b = ''; res.on('data', (c) => b += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
  });
}
function getJSON(port, p) {
  return get(port, p).then((r) => ({ status: r.status, body: r.body ? JSON.parse(r.body) : {} }));
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
function startHub(home, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [HUB], { env: { ...process.env, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(srv); });
  });
}

test('two registered projects stay isolated: /api/project?p=<id> returns each project\'s own data', async () => {
  const home = freshHome();
  const a = project(home, 'a');
  const b = project(home, 'b');
  const port = 5300 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const ra = await getJSON(port, `/api/project?p=${a.id}`);
    const rb = await getJSON(port, `/api/project?p=${b.id}`);
    assert.strictEqual(ra.status, 200);
    assert.strictEqual(rb.status, 200);
    assert.strictEqual(ra.body.projectName, path.basename(a.path));
    assert.strictEqual(rb.body.projectName, path.basename(b.path));
    assert.notStrictEqual(ra.body.projectName, rb.body.projectName);
  } finally { srv.kill(); }
});

test('POST /api/task?p=<id> on project A never affects project B (concurrent isolation)', async () => {
  const home = freshHome();
  const a = project(home, 'a2');
  const b = project(home, 'b2');
  const port = 5400 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const created = await reqJSON(port, 'POST', `/api/task?p=${a.id}`, { title: 'only in A' });
    assert.strictEqual(created.status, 200);
    const projA = await getJSON(port, `/api/project?p=${a.id}`);
    const projB = await getJSON(port, `/api/project?p=${b.id}`);
    const foundInA = (projA.body.plans || []).some((pl) => pl.phases.some((ph) => ph.tasks.some((t) => t.id === created.body.task.id)));
    const foundInB = (projB.body.plans || []).some((pl) => pl.phases.some((ph) => ph.tasks.some((t) => t.id === created.body.task.id)));
    assert.ok(foundInA, 'task shows up in project A');
    assert.ok(!foundInB, 'task must NOT leak into project B');
  } finally { srv.kill(); }
});

test('GET /p/<id>/board serves the SPA shell for a registered project', async () => {
  const home = freshHome();
  const a = project(home, 'c');
  const port = 5500 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await get(port, `/p/${a.id}/board`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('<html') || res.body.includes('<!DOCTYPE'));
  } finally { srv.kill(); }
});

test('an unknown project id 404s on both the page route and the API route, no crash', async () => {
  const home = freshHome();
  project(home, 'd'); // at least one real project registered, to prove the hub stays up regardless
  const port = 5600 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const page = await get(port, '/p/ffffff/board');
    assert.strictEqual(page.status, 404);
    const api = await getJSON(port, '/api/project?p=ffffff');
    assert.strictEqual(api.status, 404);
  } finally { srv.kill(); }
});

test('an /api/ call with no ?p= at all 404s instead of crashing', async () => {
  const home = freshHome();
  const port = 5700 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await getJSON(port, '/api/project');
    assert.strictEqual(res.status, 404);
  } finally { srv.kill(); }
});

test('GET / is a placeholder listing every registered project', async () => {
  const home = freshHome();
  const a = project(home, 'e');
  const port = 5800 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await get(port, '/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes(`/p/${a.id}/board`), 'links to the registered project');
  } finally { srv.kill(); }
});

test('a legacy no-prefix route redirects to the most-recently-opened project', async () => {
  const home = freshHome();
  const a = project(home, 'f1');
  const b = project(home, 'f2'); // registered after a -> more recently opened
  const port = 5900 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res1 = await get(port, '/board');
    assert.strictEqual(res1.status, 302);
    assert.strictEqual(res1.headers.location, `/p/${b.id}/board`);

    // Opening A's page touches it -> A becomes the most recent -> redirect target flips to A.
    await get(port, `/p/${a.id}/board`);
    const res2 = await get(port, '/board');
    assert.strictEqual(res2.headers.location, `/p/${a.id}/board`);
  } finally { srv.kill(); }
});

test('a legacy no-prefix route redirects to the hub root when no project is registered', async () => {
  const home = freshHome();
  const port = 6000 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await get(port, '/board');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/');
  } finally { srv.kill(); }
});

test('a static asset with no /p/<id> prefix still serves (every page\'s own asset links are root-absolute)', async () => {
  const home = freshHome();
  project(home, 'g');
  const port = 6100 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await get(port, '/styles.css');
    assert.strictEqual(res.status, 200);
  } finally { srv.kill(); }
});
