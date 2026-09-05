# Multi-project server core (sub-project 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `lib/hub-server.js` (single-project proof-of-concept from sub-project 2) into the
real multi-project server core: registry-driven, serves any number of registered projects
concurrently from one process, with correct per-project isolation (no cross-project data leaking
between two projects open in different browser tabs at once).

**Architecture:** A `Map<id, ProjectEntry>` replaces the fixed single `ROOT`/`handlers` pair.
`ProjectEntry` (`{id, root, handlers, clients:Set, emit}`) is created lazily the first time a
project's id is requested (looked up in `lib/registry.js`'s `listProjects()`, its vendored
`handlers.js` `require()`'d by absolute path) and kept alive for the process's life. Pages use a
`/p/<id>/...` path prefix; every `/api/*` call instead takes a `?p=<id>` query param (settled in the
design doc — smaller client diff, matches `/api/events`'s own shape). A legacy no-prefix route
redirects to the most-recently-opened project. `GET /` is an intentionally plain placeholder (a bare
list of registered projects) — the real, designed landing page is the next sub-project's job; this
one proves the routing/isolation/SSE mechanism, nothing more.

**Tech Stack:** Node.js native `http`/`fs`/`path` only (zero runtime dependencies). `node --test`.

**Spec:** `docs/multi-project-hub-design.md` — §2 (server architecture), §3 (URL scheme, now
settled: path prefix for pages, `?p=<id>` for API calls), §3bis (Add Project — NOT this sub-project's
job, listed for context only), "Sub-project decomposition" item 3.

## Global Constraints

- **Zero runtime dependencies.** Native `http`/`fs`/`path` only.
- **URL scheme is fixed, not renegotiable in this task**: pages `/p/<id>/<rest>`; API calls
  `/api/<rest>?p=<id>` (including `/api/events?p=<id>`); a legacy no-prefix extensionless GET (e.g.
  `/board`) 302-redirects to `/p/<mostRecentlyOpenedId>/board`, or to `/` if the registry is empty.
- **`GET /` is a plain placeholder in this task** — a bare `<ul>` of registered projects linking to
  `/p/<id>/board`. Do not attempt the real designed landing page (cards, stats, Add Project) here —
  that is sub-project 4, which depends on this one.
- **No lock file / no `spectoflow dashboard` wiring in this task.** `lib/hub-server.js` is exercised
  only by its own tests (spawned directly, like sub-project 2's), exactly as before — CLI integration
  (including the eventual global `~/.spectoflow/hub.lock`) is sub-project 4/5's job, not this one's.
- **Registry access uses no explicit `baseDir` argument** in `lib/hub-server.js` itself — every call
  (`registry.listProjects()`, `registry.touchProject(id)`) relies on `lib/registry.js`'s own
  `SPECTOFLOW_HOME` env-var fallback (already built in), so tests can isolate via that env var without
  `lib/hub-server.js` needing to know about it explicitly.
- **A broken/moved project must 404, never crash the whole hub.** If a registered project's
  `handlers.js` can't be `require()`'d (folder moved/deleted, or predates the split), `getProject()`
  returns `null` and the caller responds 404 — the hub process keeps serving every other project.
- **`lib/registry.js` is not modified by this task** — `getProject()` finds an entry by scanning
  `registry.listProjects()` for a matching `id`; no new registry export is needed.

---

### Task 1: Rewrite `lib/hub-server.js` for true multi-project concurrency

**Files:**
- Modify: `lib/hub-server.js` (near-total rewrite — replace the whole file)
- Test: `test/hub-server.test.js` (near-total rewrite — replace the whole file; the single-project
  version from sub-project 2 tested an interface this task removes entirely: `SPECTOFLOW_ROOT`,
  single fixed project, no `?p=` param)

**Interfaces:**
- Consumes: `templates/dashboard/handlers.js`'s `createHandlers(root) → {handleApi, watchDirs,
  onBoot}` (unchanged, from sub-project 2 — Task 1 of `2026-09-04-hub-server-split.md`); `lib/
  registry.js`'s `listProjects()` and `touchProject(id)` (unchanged, from sub-project 1).
- Produces: nothing further in THIS plan consumes `lib/hub-server.js` — it remains a standalone
  process entry point, exercised only by its own tests, exactly as sub-project 2 left it. Sub-project
  4 extends this same file in place (adding the real landing page + Add Project endpoints) rather than
  something else requiring it.

- [ ] **Step 1: Write the failing tests**

Create `test/hub-server.test.js` (replaces the sub-project-2 version entirely):

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/hub-server.test.js`
Expected: every test fails or times out — the current `lib/hub-server.js` (sub-project 2's
single-project version) reads `SPECTOFLOW_ROOT` and has no `?p=` handling, no `/p/<id>/...` routing,
no registry lookup by id. Confirm the failures are because the OLD interface doesn't match (not a
typo) before proceeding.

- [ ] **Step 3: Replace `lib/hub-server.js` with the multi-project version**

Replace the entire file content with:

```js
'use strict';
/*
 * The multi-project hub's server process — global (ships under lib/, never vendored into a
 * project's .spectoflow/). Registry-driven: resolves a project's root + route logic on demand from
 * ~/.spectoflow/projects.json (see lib/registry.js), keyed by the opaque id in /p/<id>/... URLs.
 * Each project's own vendored handlers.js is require()'d dynamically by absolute path — Node's
 * require cache keys by resolved path, so two different projects' identically-named handlers.js
 * files are cached and run completely independently (see docs/multi-project-hub-design.md).
 *
 * URL scheme (settled in the design doc): pages use a path prefix (/p/<id>/board, bookmarkable on
 * their own); every /api/* call instead takes a ?p=<id> query param (smaller client diff, and
 * /api/events already needed a query-param shape for its per-project SSE subscription either way).
 * A legacy no-prefix route (e.g. /board, a bookmark from before the hub existed) 302s to the
 * most-recently-opened project, or to the hub root if none are registered yet.
 *
 * GET / is a functional but intentionally plain placeholder (a bare list of registered projects) —
 * the real hub landing page (cards, stats, "+ Add project") is the next sub-project; this one's job
 * is only to prove the multi-project routing/SSE/static-serving mechanism works.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const registry = require('./registry');

const PORT = process.env.SPECTOFLOW_PORT ? Number(process.env.SPECTOFLOW_PORT) : 4319;
const PUBLIC = path.join(__dirname, '..', 'templates', 'dashboard', 'public');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff' };
function sendJSON(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }

// id -> { id, root, handlers, clients:Set, emit }, populated lazily on first request for that id and
// kept alive for the process's life (registries are small; no need to tear down on last-tab-close).
const projects = new Map();
function getProject(id) {
  if (projects.has(id)) return projects.get(id);
  const entry = registry.listProjects().find((p) => p.id === id);
  if (!entry) return null;
  const handlersPath = path.join(entry.path, '.spectoflow', 'dashboard', 'handlers.js');
  let createHandlers;
  try { ({ createHandlers } = require(handlersPath)); }
  catch { return null; } // project's folder moved/deleted, or predates the handlers.js split
  const handlers = createHandlers(entry.path);
  const clients = new Set();
  const emit = (obj) => { const line = 'data: ' + JSON.stringify(obj) + '\n\n'; for (const res of clients) res.write(line); };
  handlers.onBoot();
  handlers.watchDirs.forEach((d) => {
    const dir = path.join(entry.path, d);
    if (fs.existsSync(dir)) { try { fs.watch(dir, { recursive: false }, () => emit({ type: 'change' })); } catch (_) {} }
  });
  const proj = { id, root: entry.path, handlers, clients, emit };
  projects.set(id, proj);
  return proj;
}

// Serves one static asset (or the SPA index.html fallback for an extensionless path) from the
// shared, globally-installed PUBLIC dir — identical logic to templates/dashboard/server.js's own,
// just factored into a function since both the root-level and /p/<id>/-prefixed requests need it.
function serveStatic(reqPath, req, res) {
  const file = reqPath === '/' ? '/index.html' : reqPath;
  const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  const noCache = { 'Cache-Control': 'no-store, must-revalidate' };
  fs.readFile(full, (err, data) => {
    if (err) {
      if (req.method === 'GET' && !path.extname(reqPath)) {
        return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, Object.assign({ 'Content-Type': MIME['.html'] }, noCache)); res.end(d2);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(full);
    const headers = ext === '.woff2' || ext === '.woff' ? { 'Cache-Control': 'public, max-age=604800' } : noCache;
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream' }, headers)); res.end(data);
  });
}

function hubPlaceholderHtml() {
  const rows = registry.listProjects();
  const items = rows.length
    ? rows.map((r) => `<li><a href="/p/${r.id}/board">${r.name}</a> — <code>${r.path}</code></li>`).join('')
    : '<li>No projects registered yet — run <code>spectoflow dashboard</code> inside one.</li>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow hub</title></head>` +
    `<body><h1>spectoflow — registered projects</h1><ul>${items}</ul>` +
    `<p><em>This is a placeholder — the real hub landing page is the next milestone.</em></p></body></html>`;
}

const PROJECT_PREFIX = /^\/p\/([0-9a-f]{6})(\/.*)?$/;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  try {
    const m = p.match(PROJECT_PREFIX);

    if (p === '/api/events') {
      const id = u.searchParams.get('p');
      const proj = id && getProject(id);
      if (!proj) return sendJSON(res, 404, { error: 'Unknown or unreachable project.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify({ type: 'hello' }) + '\n\n');
      proj.clients.add(res); req.on('close', () => proj.clients.delete(res));
      return;
    }

    if (p.startsWith('/api/')) {
      const id = u.searchParams.get('p');
      const proj = id && getProject(id);
      if (!proj) return sendJSON(res, 404, { error: 'Unknown or unreachable project.' });
      const handled = await proj.handlers.handleApi(req, res, u, proj.emit);
      if (handled) return;
      res.writeHead(404); return res.end('Not found');
    }

    if (m) {
      const id = m[1];
      const proj = getProject(id);
      if (!proj) { res.writeHead(404); return res.end('Unknown project.'); }
      registry.touchProject(id);
      return serveStatic(m[2] || '/', req, res);
    }

    if (p === '/') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(hubPlaceholderHtml());
    }

    if (!path.extname(p)) {
      // legacy no-prefix bookmark (e.g. /board from before the hub existed)
      const rows = registry.listProjects();
      const dest = rows.length ? `/p/${rows[0].id}/board` : '/';
      res.writeHead(302, { Location: dest }); return res.end();
    }

    // a real static asset (styles.css, app.js, fonts) requested without a /p/<id> prefix — every
    // page's own asset links are root-absolute, so this is the common case for every page load.
    return serveStatic(p, req, res);
  } catch (e) { sendJSON(res, 500, { error: String(e && e.message || e) }); }
});

server.listen(PORT, () => { console.log(`spectoflow · hub → http://localhost:${PORT}`); });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/hub-server.test.js`
Expected: all 9 tests pass, 0 failures.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `node --test test/*.test.js`
Expected: same pass count as before this task plus these 9 (replacing the 6 from sub-project 2's
version — net +3); the only tolerated failure is the pre-existing documented
`test/cli-update.test.js` flake ("update restarts an already-running dashboard..."). If anything else
fails, re-run that file alone to confirm it's the known flake before concluding; investigate anything
genuinely new before committing.

- [ ] **Step 6: Commit**

```bash
git add lib/hub-server.js test/hub-server.test.js
git commit -m "$(cat <<'EOF'
lib/hub-server.js: true multi-project concurrency (registry-driven)

Sub-project 3 toward the multi-project hub. Replaces the single fixed-project
proof-of-concept (sub-project 2) with a real Map<id, ...> resolved lazily from
the registry — any number of registered projects served concurrently from one
process, each with its own SSE client set and no cross-project data leaking
(proven by a test that creates a task in project A and asserts it never shows
up in project B's own view).

URL scheme settled: /p/<id>/... path prefix for pages, ?p=<id> query param for
every /api/* call (including /api/events). A legacy no-prefix route (e.g.
/board, a bookmark from before the hub existed) 302s to the most-recently-
opened project, or to / if none are registered. GET / is an intentionally
plain placeholder (a bare project list) -- the real designed landing page,
plus the "+ Add project" flow, is sub-project 4, which depends on this one.

Still not wired into `spectoflow dashboard` -- no lock file, no CLI changes --
that's sub-project 4/5, unchanged in scope from the original decomposition.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

## Self-review notes (completed during authoring)

- **Spec coverage:** design doc's sub-project 3 ("multi-project server core... no UI yet") — fully
  covered by this single task. §3bis (Add Project) and the real landing page are explicitly out of
  scope here, deferred to sub-project 4 per the doc's own decomposition.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code. `GET /`'s "placeholder"
  is a deliberate, spec-sanctioned scope boundary (documented in the Global Constraints and in the
  file's own header comment), not an unfinished corner cut silently.
- **Type/signature consistency:** `getProject(id)` returns the same `{id, root, handlers, clients,
  emit}` shape used consistently by all three call sites (`/api/events`, `/api/*`, `/p/<id>/...`);
  `registry.listProjects()`/`registry.touchProject(id)` are called exactly as `lib/registry.js`
  already exports them (verified against the committed sub-project-1 module, no new export needed).
