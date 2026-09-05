'use strict';
/*
 * The multi-project hub's server process — global (ships under lib/, never vendored into a
 * project's .spectoflow/). Registry-driven: resolves a project's root on demand from
 * ~/.spectoflow/projects.json (see lib/registry.js), keyed by the opaque id in /p/<id>/... URLs.
 * The route logic is THIS package's own handlers.js (./handlers.js), shared by every project (D64):
 * nothing is ever require()'d from a project, so a project that has never run `spectoflow update`
 * opens exactly like a fresh one (see docs/multi-project-hub-design.md).
 *
 * URL scheme (settled in the design doc): pages use a path prefix (/p/<id>/board, bookmarkable on
 * their own); every /api/* call instead takes a ?p=<id> query param (smaller client diff, and
 * /api/events already needed a query-param shape for its per-project SSE subscription either way).
 * A legacy no-prefix route (e.g. /board, a bookmark from before the hub existed) 302s to the
 * most-recently-opened project, or to the hub root if none are registered yet.
 *
 * GET / serves hub.html — the landing page listing every registered project, with an "+ Add project"
 * flow (browse the filesystem server-side, or paste a path; either way auto-inits a plain folder) —
 * see /api/hub/* below and docs/multi-project-hub-design.md §3bis.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const registry = require('../registry');
const workspace = require('../workspace');
const { createHandlers } = require('./handlers');
const store = require('../store');

const migrated = workspace.migrateLegacyHome();
if (!workspace.exists()) workspace.init({});
const PORT = process.env.SPECTOFLOW_PORT ? Number(process.env.SPECTOFLOW_PORT) : workspace.settings().port;
const PUBLIC = path.join(__dirname, 'public');
const TEMPLATES = path.join(__dirname, '..', '..', 'templates');
const VERSION = require('../../package.json').version;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff' };
function sendJSON(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }

// id -> { id, root, handlers, clients:Set, emit, watchers:[] }. The route logic is THIS package's
// handlers.js for every project (D64): nothing is ever require()'d from a project, so a project that
// has never run `spectoflow update` opens exactly like a fresh one.
const projects = new Map();
function getProject(id) {
  if (projects.has(id)) return projects.get(id);
  const entry = registry.listProjects().find((p) => p.id === id);
  if (!entry || !fs.existsSync(entry.path)) return null;
  const handlers = createHandlers(entry.path);
  const clients = new Set();
  const emit = (obj) => { const line = 'data: ' + JSON.stringify(obj) + '\n\n'; for (const res of clients) res.write(line); };
  handlers.onBoot();
  const watchers = [];
  handlers.watchDirs.forEach((d) => {
    const dir = path.join(entry.path, d);
    if (fs.existsSync(dir)) { try { watchers.push(fs.watch(dir, { recursive: false }, () => emit({ type: 'change' }))); } catch (_) {} }
  });
  const proj = { id, root: entry.path, handlers, clients, emit, watchers };
  projects.set(id, proj);
  return proj;
}

// Only called after getProject(id) returned null. Two causes remain (D64 removed "needs an update").
function projectErrorMessage(id) {
  const entry = registry.listProjects().find((p) => p.id === id);
  if (!entry) return 'Unknown project.';
  return `Project "${entry.name}" is registered, but its folder no longer exists at ${entry.path}.`;
}

// Re-opens a project: drops its cached entry and closes its watchers so the next request re-runs
// onBoot and re-watches (a project's dirs may have changed after `spectoflow update`). Returns false
// (a harmless no-op) if this id was never loaded.
function reloadProject(id) {
  const proj = projects.get(id);
  if (!proj) return false;
  proj.watchers.forEach((w) => { try { w.close(); } catch (_) {} });
  projects.delete(id);
  return true;
}

// ---- hub API: list/add/remove registered projects, browse the filesystem to find one ----
function projectStats(root) {
  try {
    const plans = store.readPlans(root);
    let total = 0, done = 0;
    for (const pl of plans) for (const ph of pl.phases) for (const t of ph.tasks) { total++; if (t.status === 'done') done++; }
    return { total, done };
  } catch { return null; }
}
function listHubProjects() {
  return registry.listProjects().map((p) => ({ ...p, stats: projectStats(p.path) }));
}
function listRoots() {
  const home = os.homedir();
  const roots = [{ name: path.basename(home) || home, path: home }];
  if (process.platform === 'win32') {
    for (const code of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${code}:\\`;
      if (fs.existsSync(drive)) roots.push({ name: drive, path: drive });
    }
  } else if (home !== '/') {
    roots.push({ name: '/', path: '/' });
  }
  return roots;
}
function browseDirs(reqPath) {
  if (!reqPath) return { entries: listRoots(), parent: null, current: null };
  let abs;
  try { abs = path.resolve(reqPath); } catch { return { error: 'Invalid path.' }; }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { error: 'Not a folder.' };
  let names;
  try { names = fs.readdirSync(abs, { withFileTypes: true }); } catch { return { error: 'Cannot read this folder.' }; }
  const entries = names.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(abs) !== abs ? path.dirname(abs) : null;
  return { entries, parent, current: abs };
}
function addHubProject(rawPath) {
  let abs;
  try { abs = path.resolve(rawPath); } catch { return { error: 'Invalid path.' }; }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { error: 'That folder does not exist.' };
  const hasSpectoflow = fs.existsSync(path.join(abs, '.spectoflow'));
  if (!hasSpectoflow) {
    const { runInit } = require('../init');
    runInit({ target: abs, templatesDir: TEMPLATES, version: VERSION });
  }
  const entry = workspace.registerProject(abs);
  return { entry, initialized: !hasSpectoflow };
}
async function handleHubApi(req, res, u) {
  const p = u.pathname;
  if (p === '/api/hub/projects' && req.method === 'GET') { sendJSON(res, 200, { projects: listHubProjects() }); return true; }
  if (p === '/api/hub/projects' && req.method === 'POST') {
    const { path: rawPath } = await body(req);
    if (!rawPath || !String(rawPath).trim()) { sendJSON(res, 400, { error: 'A folder path is required.' }); return true; }
    const r = addHubProject(String(rawPath).trim());
    if (r.error) { sendJSON(res, 400, r); return true; }
    sendJSON(res, 200, r); return true;
  }
  if (/^\/api\/hub\/projects\/[^/]+$/.test(p) && req.method === 'DELETE') {
    const id = decodeURIComponent(p.split('/')[4] || '');
    const ok = registry.removeProject(id);
    sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'No project registered with that id.' });
    return true;
  }
  if (p === '/api/hub/browse' && req.method === 'GET') {
    const reqPath = u.searchParams.get('path') || '';
    const r = browseDirs(reqPath);
    sendJSON(res, r.error ? 400 : 200, r);
    return true;
  }
  if (/^\/api\/hub\/reload\/[^/]+$/.test(p) && req.method === 'POST') {
    const id = decodeURIComponent(p.split('/')[4] || '');
    const reloaded = reloadProject(id);
    sendJSON(res, 200, { ok: true, reloaded });
    return true;
  }
  return false;
}

// Serves one static asset (or the SPA index.html fallback for an extensionless path) from the
// shared, globally-installed PUBLIC dir — factored into a function since both the root-level and
// /p/<id>/-prefixed requests need it.
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

const PROJECT_PREFIX = /^\/p\/([0-9a-f]{6})(\/.*)?$/;

const LOCK = workspace.lockPath();
function writeLock(){ try{ fs.mkdirSync(path.dirname(LOCK),{recursive:true}); fs.writeFileSync(LOCK, JSON.stringify({ pid:process.pid, port:PORT, url:`http://localhost:${PORT}`, startedAt:new Date().toISOString() })+'\n'); }catch{} }
function clearLock(){ try{ const l=JSON.parse(fs.readFileSync(LOCK,'utf8')); if(l.pid===process.pid) fs.unlinkSync(LOCK); }catch{} }
process.on('exit', clearLock);
['SIGINT','SIGTERM'].forEach((s)=> process.on(s, ()=>{ clearLock(); process.exit(0); }));

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  try {
    const m = p.match(PROJECT_PREFIX);

    if (p === '/api/events') {
      const id = u.searchParams.get('p');
      const proj = id && getProject(id);
      if (!proj) return sendJSON(res, 404, { error: projectErrorMessage(id) });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify({ type: 'hello' }) + '\n\n');
      proj.clients.add(res); req.on('close', () => proj.clients.delete(res));
      return;
    }

    if (p.startsWith('/api/hub/')) {
      const handled = await handleHubApi(req, res, u);
      if (handled) return;
      res.writeHead(404); return res.end('Not found');
    }

    if (p.startsWith('/api/')) {
      const id = u.searchParams.get('p');
      const proj = id && getProject(id);
      if (!proj) return sendJSON(res, 404, { error: projectErrorMessage(id) });
      const handled = await proj.handlers.handleApi(req, res, u, proj.emit);
      if (handled) return;
      res.writeHead(404); return res.end('Not found');
    }

    if (m) {
      const id = m[1];
      const proj = getProject(id);
      if (!proj) { res.writeHead(404); return res.end(projectErrorMessage(id)); }
      registry.touchProject(id);
      return serveStatic(m[2] || '/', req, res);
    }

    if (p === '/') {
      return serveStatic('/hub.html', req, res);
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

server.listen(PORT, () => { writeLock(); console.log(`spectoflow · hub → http://localhost:${PORT}${migrated.movedRegistry ? '  (moved your project list into the workspace)' : ''}`); });
