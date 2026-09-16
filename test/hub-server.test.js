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
const HUB = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hub-home-'));
}
function project(home, namePrefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `stf-hub-${namePrefix}-`));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  return registry.addProject(d, path.join(home, 'dashboard'));
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
    // The hub page loads projects dynamically via /api/hub/projects, not as static HTML.
    // Verify the page structure includes the elements that hub.js uses.
    assert.ok(res.body.includes('id="hubGrid"'), 'has the grid container for projects');
    assert.ok(res.body.includes('id="hubAddBtn"'), 'has the add button');
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

test('GET /api/hub/projects lists every registered project with basic stats', async () => {
  const home = freshHome();
  const a = project(home, 'x');
  const port = 6200 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await getJSON(port, '/api/hub/projects');
    assert.strictEqual(res.status, 200);
    const found = res.body.projects.find((p) => p.id === a.id);
    assert.ok(found, 'project appears in the list');
    assert.strictEqual(found.name, a.name);
    assert.ok(found.stats && typeof found.stats.total === 'number');
  } finally { srv.kill(); }
});

test('GET /api/hub/browse with no path returns starting points (at least one)', async () => {
  const home = freshHome();
  const port = 6300 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await getJSON(port, '/api/hub/browse');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.entries) && res.body.entries.length > 0);
  } finally { srv.kill(); }
});

test('GET /api/hub/browse?path=<real dir> lists its subfolders', async () => {
  const home = freshHome();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hubapi-browse-'));
  fs.mkdirSync(path.join(parent, 'my-project'));
  const port = 6400 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await getJSON(port, '/api/hub/browse?path=' + encodeURIComponent(parent));
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.entries.some((e) => e.name === 'my-project'));
  } finally { srv.kill(); }
});

test('POST /api/hub/projects registers an already-inited folder without re-initing it', async () => {
  const home = freshHome();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hubapi-add-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const port = 6500 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'POST', '/api/hub/projects', { path: d });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.initialized, false);
    const list = await getJSON(port, '/api/hub/projects');
    assert.ok(list.body.projects.some((p) => p.path === path.resolve(d)));
  } finally { srv.kill(); }
});

test('POST /api/hub/projects auto-inits a plain folder that is not a spectoflow project yet', async () => {
  const home = freshHome();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hubapi-autoinit-'));
  const port = 6600 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'POST', '/api/hub/projects', { path: d });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.initialized, true);
    assert.ok(fs.existsSync(path.join(d, '.spectoflow', 'config.json')), 'the folder is now a real spectoflow project');
  } finally { srv.kill(); }
});

test('POST /api/hub/projects rejects a path that does not exist', async () => {
  const home = freshHome();
  const port = 6700 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'POST', '/api/hub/projects', { path: path.join(os.tmpdir(), 'stf-does-not-exist-xyz') });
    assert.strictEqual(res.status, 400);
  } finally { srv.kill(); }
});

test('DELETE /api/hub/projects/:id removes a registered entry', async () => {
  const home = freshHome();
  const a = project(home, 'del');
  const port = 6800 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'DELETE', `/api/hub/projects/${a.id}`);
    assert.strictEqual(res.status, 200);
    const list = await getJSON(port, '/api/hub/projects');
    assert.ok(!list.body.projects.some((p) => p.id === a.id));
  } finally { srv.kill(); }
});

test('GET / serves the real hub page (hub.html), not the old placeholder', async () => {
  const home = freshHome();
  const port = 6900 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await get(port, '/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('<html') || res.body.includes('<!DOCTYPE'));
  } finally { srv.kill(); }
});

test('hub-server writes the GLOBAL lock file (~/.spectoflow/hub.lock, not a per-project one)', async () => {
  const home = freshHome();
  const port = 7000 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    await get(port, '/'); // ensure the server has fully started before checking the lock
    const registry = require('../lib/registry');
    const lock = JSON.parse(fs.readFileSync(registry.hubLockPath(path.join(home, 'dashboard')), 'utf8'));
    assert.strictEqual(lock.port, port);
    assert.strictEqual(lock.pid, srv.pid);
  } finally { srv.kill(); }
});

test('POST /api/hub/reload/:id on a project the hub never loaded reports reloaded:false, no error', async () => {
  const home = freshHome();
  const a = project(home, 'reload-unloaded');
  const port = 7100 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'POST', `/api/hub/reload/${a.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reloaded, false);
  } finally { srv.kill(); }
});

test('POST /api/hub/reload/:id on a loaded project reports reloaded:true and the project stays servable', async () => {
  const home = freshHome();
  const a = project(home, 'reload-loaded');
  const port = 7200 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    await getJSON(port, `/api/project?p=${a.id}`); // load it into the hub's in-memory map first
    const res = await reqJSON(port, 'POST', `/api/hub/reload/${a.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reloaded, true);
    const after = await getJSON(port, `/api/project?p=${a.id}`);
    assert.strictEqual(after.status, 200, 'still servable immediately after reload');
  } finally { srv.kill(); }
});

test('reloading project A never disturbs project B, concurrently loaded in the same hub', async () => {
  const home = freshHome();
  const a = project(home, 'reload-a');
  const b = project(home, 'reload-b');
  const port = 7300 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    await getJSON(port, `/api/project?p=${a.id}`);
    await getJSON(port, `/api/project?p=${b.id}`);
    const reloadRes = await reqJSON(port, 'POST', `/api/hub/reload/${a.id}`);
    assert.strictEqual(reloadRes.body.reloaded, true);
    const bAfter = await getJSON(port, `/api/project?p=${b.id}`);
    assert.strictEqual(bAfter.status, 200);
    assert.strictEqual(bAfter.body.projectName, path.basename(b.path), 'B unaffected by A\'s reload');
  } finally { srv.kill(); }
});

test('a project that never ran update (no .spectoflow/dashboard at all) opens normally', async () => {
  const home = freshHome();
  const a = project(home, 'needs-update');
  // A no-op on a fresh init now (the route logic is the package's own, D64) — kept for legacy
  // fixtures that still carry a vendored .spectoflow/dashboard/ from before this split.
  fs.rmSync(path.join(a.path, '.spectoflow', 'dashboard'), { recursive: true, force: true });
  const port = 7400 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const api = await get(port, `/api/project?p=${a.id}`);
    assert.strictEqual(api.status, 200);
    const page = await get(port, `/p/${a.id}/board`);
    assert.strictEqual(page.status, 200);
  } finally { srv.kill(); }
});

test('GET /p/<id>/board stamps <html data-design> with that project\'s own config.design, before any client JS runs (D66 first-paint flash fix)', async () => {
  const home = freshHome();
  const a = project(home, 'design-orbit');
  const cfgPath = path.join(a.path, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.design = 'orbit';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const port = 7450 + Math.floor(Math.random() * 40);
  const srv = await startHub(home, port);
  try {
    const res = await get(port, `/p/${a.id}/board`);
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /<html[^>]*\bdata-design="orbit"/);
  } finally { srv.kill(); }
});

test('GET /p/<id>/board defaults <html data-design> to "console" when the project has no design saved yet', async () => {
  const home = freshHome();
  const a = project(home, 'design-default');
  const port = 7500 + Math.floor(Math.random() * 40);
  const srv = await startHub(home, port);
  try {
    const res = await get(port, `/p/${a.id}/board`);
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /<html[^>]*\bdata-design="console"/);
  } finally { srv.kill(); }
});

test('an unknown project id still 404s on the page route (no design leaks for a nonexistent project)', async () => {
  const home = freshHome();
  project(home, 'design-unknown-control');
  const port = 7550 + Math.floor(Math.random() * 40);
  const srv = await startHub(home, port);
  try {
    const res = await get(port, '/p/ffffff/board');
    assert.strictEqual(res.status, 404);
    assert.ok(!/data-design=/.test(res.body));
  } finally { srv.kill(); }
});

test('a pre-0.24 ~/.spectoflow/projects.json is moved into the workspace on first start, projects intact', async () => {
  const home = freshHome();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hub-legacy-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const entry = registry.addProject(d, home); // legacy location: directly under home
  const port = 7400 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await getJSON(port, `/api/project?p=${entry.id}`);
    assert.strictEqual(res.status, 200);
    assert.ok(fs.existsSync(path.join(home, 'dashboard', 'projects.json')));
    assert.ok(!fs.existsSync(path.join(home, 'projects.json')));
  } finally { srv.kill(); }
});

test('the hub answers this machine only: loopback interfaces, a local Host, no cross-site requests (D74)', async () => {
  const home = freshHome();
  const a = project(home, 'sec');
  const port = 5700 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  const call = ({ host = '127.0.0.1', method = 'GET', path: p = `/api/project?p=${a.id}`, headers = {} } = {}) => new Promise((resolve) => {
    const r = http.request({ host, port, path: p, method, headers, timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', (e) => resolve(e.code));
    r.on('timeout', () => { r.destroy(); resolve('TIMEOUT'); });
    r.end();
  });
  try {
    assert.strictEqual(await call(), 200, 'this machine, plain request');
    assert.strictEqual(await call({ headers: { Host: `localhost:${port}` } }), 200, 'Host localhost');
    assert.strictEqual(await call({ headers: { Host: `evil.example:${port}` } }), 403, 'DNS rebinding: foreign Host on a loopback socket');
    assert.strictEqual(await call({ headers: { Host: 'my-tunnel.ngrok.app' } }), 403, 'a tunnel or proxy on this machine');
    assert.strictEqual(await call({ method: 'POST', path: `/api/task?p=${a.id}`, headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' } }), 403, 'cross-site POST');
    assert.strictEqual(await call({ headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' } }), 403, 'cross-site fetch');
    assert.strictEqual(await call({ headers: { 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors', Origin: 'http://localhost:3000' } }), 403, 'another local port');
    assert.strictEqual(await call({ method: 'POST', path: `/api/task?p=${a.id}`, headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' } }), 403, 'a cross-site form POST is not a harmless navigation');
    assert.strictEqual(await call({ path: `/p/${a.id}/board`, headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } }), 200, 'a link to the dashboard clicked on another site still opens it');
    assert.strictEqual(await call({ headers: { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' } }), 200, 'the dashboard tab itself');

    const hasV6Loopback = Object.values(os.networkInterfaces()).flat().some((i) => i && i.internal && i.family === 'IPv6' && i.address === '::1');
    if (hasV6Loopback) assert.strictEqual(await call({ host: '::1', headers: { Host: `[::1]:${port}` } }), 200, 'IPv6 loopback served too');
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
    if (lan) assert.ok(['ECONNREFUSED', 'EHOSTUNREACH', 'TIMEOUT'].includes(await call({ host: lan.address })), `not reachable on ${lan.address}`);
  } finally { srv.kill(); }
});
