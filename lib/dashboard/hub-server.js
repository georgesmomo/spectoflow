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
const brain = require('../brain');
const { createHandlers } = require('./handlers');
const store = require('../store');
const { createConnector } = require('./connector');
const { ops, OpError } = require('./ops');
const { injectDesign, DEFAULT_DESIGN } = require('./inject-design');

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

// ---- online dashboard (C1): the connector role ----
// One outbound connection to the online dashboard named in the workspace's remote.json (written by
// `spectoflow dashboard login`). Only published projects (meta.json → published:true, cached here as
// a Set so a chatty run-line stream never re-reads the file) are announced and relayed. Every project's
// emit is teed: SSE clients first, then the connector — the same emit an op called from the relay
// uses, so a local click and an online click hit one orchestrator, one pending gate, one state.
let connector = null;
let publishedIds = new Set();
function refreshPublished() { publishedIds = new Set(workspace.listPublished().map((p) => p.id)); }
const snapshotTimers = new Map();
function scheduleSnapshot(id) {
  clearTimeout(snapshotTimers.get(id));
  snapshotTimers.set(id, setTimeout(async () => {
    snapshotTimers.delete(id);
    if (!connector || !publishedIds.has(id)) return;
    try { const project = await readSnapshot(id); if (project) connector.pushSnapshot(id, project); } catch (_) {}
  }, 500));
}
async function readSnapshot(id) {
  const proj = getProject(id);
  return proj ? ops['project.read'](proj.root, {}, { emit() {} }) : null;
}
function listPublishedForHello() {
  return workspace.listPublished().map((p) => ({ localId: p.id, name: p.name, kind: p.kind || 'spectoflow', stats: projectStats(p.path) }));
}
async function execOp(localId, op, args) {
  if (!publishedIds.has(localId)) throw new OpError(403, 'This project is not published.');
  const proj = getProject(localId);
  if (!proj) throw new OpError(404, projectErrorMessage(localId));
  if (!Object.prototype.hasOwnProperty.call(ops, op)) throw new OpError(404, `Unknown operation "${op}".`);
  return ops[op](proj.root, args || {}, { emit: proj.emit, remote: true });
}
function startConnector() {
  if (connector) { connector.stop(); connector = null; }
  refreshPublished();
  const remote = workspace.readRemote();
  if (!remote) return;
  connector = createConnector({
    url: remote.url, token: remote.token, machineName: remote.machineName || os.hostname(), transport: remote.transport, version: VERSION,
    listPublished: listPublishedForHello, readSnapshot, execOp, log: (m) => console.log(`spectoflow · ${m}`),
  });
  connector.start();
}
function remoteStatus() {
  const remote = workspace.readRemote();
  if (!remote) return { configured: false, url: null, machineName: null, connected: false, transport: null, lastError: null, since: null };
  const s = connector ? connector.status() : { connected: false, transport: remote.transport, lastError: null, since: null };
  return { configured: true, url: remote.url, machineName: remote.machineName, connected: s.connected, transport: s.transport, lastError: s.lastError, since: s.since };
}

function getProject(id) {
  if (projects.has(id)) return projects.get(id);
  const entry = registry.listProjects().find((p) => p.id === id);
  if (!entry || !fs.existsSync(entry.path)) return null;
  const handlers = createHandlers(entry.path);
  const clients = new Set();
  const emit = (obj) => {
    const line = 'data: ' + JSON.stringify(obj) + '\n\n';
    for (const res of clients) res.write(line);
    if (connector && publishedIds.has(id)) { connector.pushEvent(id, obj); if (obj.type === 'change') scheduleSnapshot(id); }
  };
  handlers.onBoot();
  const watchers = [];
  // A single logical write (e.g. store.js's write-then-rename) can fire an fs.watch directory
  // listener several times in a row for one underlying change (worst on Windows, which also reports
  // sibling-entry metadata churn) — coalesce any burst within 150ms into exactly one 'change' emit,
  // so a published project's connector feed gets one 'event' frame per real change, not several.
  let changeTimer = null;
  const onDirChange = () => { clearTimeout(changeTimer); changeTimer = setTimeout(() => emit({ type: 'change' }), 150); };
  handlers.watchDirs.forEach((d) => {
    const dir = path.join(entry.path, d);
    if (fs.existsSync(dir)) { try { watchers.push(fs.watch(dir, { recursive: false }, onDirChange)); } catch (_) {} }
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
  require('./orchestrator').clearPending(proj.root);
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
  return registry.listProjects().map((p) => ({ ...p, stats: projectStats(p.path), published: publishedIds.has(p.id) }));
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
  if (p === '/api/hub/projects' && req.method === 'GET') { sendJSON(res, 200, { projects: listHubProjects(), remote: remoteStatus() }); return true; }
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
    if (ok) { refreshPublished(); if (connector) connector.announce(); }
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
  if (p === '/api/hub/remote' && req.method === 'GET') { sendJSON(res, 200, remoteStatus()); return true; }
  if (p === '/api/hub/remote/reconnect' && req.method === 'POST') { startConnector(); sendJSON(res, 200, { ok: true, ...remoteStatus() }); return true; }
  if (/^\/api\/hub\/projects\/[^/]+\/publish$/.test(p) && req.method === 'POST') {
    const id = decodeURIComponent(p.split('/')[4] || '');
    const { published } = await body(req);
    const meta = workspace.setPublished(id, published !== false);
    if (!meta) { sendJSON(res, 404, { error: 'No project registered with that id.' }); return true; }
    refreshPublished();
    if (connector) connector.announce();
    sendJSON(res, 200, { ok: true, id, published: meta.published });
    return true;
  }
  return false;
}

// A viewer's own localStorage choice (once one exists) always wins client-side (app.js's IIFE at the
// top of the file, and the reconciliation in renderSettings()) — this is only filling the gap for a
// visitor with nothing saved yet, so the very first paint already matches the project's own
// configured design instead of flashing whatever static default shipped in the HTML file.
function projectDesign(root) {
  if (!root) return DEFAULT_DESIGN;
  try { return (store.readConfig(root) || {}).design || DEFAULT_DESIGN; }
  catch { return DEFAULT_DESIGN; }
}

// Serves one static asset (or the SPA index.html fallback for an extensionless path) from the
// shared, globally-installed PUBLIC dir — factored into a function since both the root-level and
// /p/<id>/-prefixed requests need it. `root` (the specific project's folder), when known, is used to
// stamp the served HTML's <html data-design="..."> synchronously with that project's own
// config.design, before the file ever reaches the browser — avoiding a flash of the wrong theme on a
// viewer's very first-ever page load (no localStorage value saved yet to reconcile against).
function serveStatic(reqPath, req, res, root) {
  const file = reqPath === '/' ? '/index.html' : reqPath;
  const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  const noCache = { 'Cache-Control': 'no-store, must-revalidate' };
  fs.readFile(full, (err, data) => {
    if (err) {
      if (req.method === 'GET' && !path.extname(reqPath)) {
        return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); return res.end('Not found'); }
          const html = root ? injectDesign(d2.toString('utf8'), projectDesign(root)) : d2;
          res.writeHead(200, Object.assign({ 'Content-Type': MIME['.html'] }, noCache)); res.end(html);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(full);
    const headers = ext === '.woff2' || ext === '.woff' ? { 'Cache-Control': 'public, max-age=604800' } : noCache;
    const payload = (root && ext === '.html') ? injectDesign(data.toString('utf8'), projectDesign(root)) : data;
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream' }, headers)); res.end(payload);
  });
}

const PROJECT_PREFIX = /^\/p\/([0-9a-f]{6})(\/.*)?$/;

const LOCK = workspace.lockPath();
function writeLock(){ try{ fs.mkdirSync(path.dirname(LOCK),{recursive:true}); fs.writeFileSync(LOCK, JSON.stringify({ pid:process.pid, port:PORT, url:`http://localhost:${PORT}`, version:VERSION, startedAt:new Date().toISOString() })+'\n'); }catch{} }
function clearLock(){ try{ const l=JSON.parse(fs.readFileSync(LOCK,'utf8')); if(l.pid===process.pid) fs.unlinkSync(LOCK); }catch{} }
process.on('exit', clearLock);
['SIGINT','SIGTERM'].forEach((s)=> process.on(s, ()=>{ if (connector) connector.stop(); clearLock(); process.exit(0); }));

const { isLocalRequest } = require('./handlers');
const server = http.createServer(async (req, res) => {
  // This machine only (D74). The hub runs agents and writes project files: it listens on the loopback
  // interfaces only, and still refuses a request whose Host isn't local (DNS rebinding, a tunnel or proxy
  // on this machine) or that another site sent (cross-site fetch/POST). Reaching a project from elsewhere
  // is what the online dashboard (server/) is for.
  if (!isLocalRequest(req, { allowNavigation: true })) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`spectoflow: this dashboard only answers this machine — open http://localhost:${PORT}`);
  }
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
      return serveStatic(m[2] || '/', req, res, proj.root);
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

// The second brain (~/.spectoflow/brain.md) is written by the page, by any agent's `spectoflow mcp`
// server process, and by `::spectoflow learn` run lines. Tell every open LOCAL tab it changed — never
// the connector: the brain is not a project's and stays off the relay, even as a content-free event.
function watchBrain() {
  const file = brain.brainPath();
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (_) { return; }
  let timer = null;
  try {
    fs.watch(path.dirname(file), (_ev, name) => {
      if (name && name !== path.basename(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const line = 'data: ' + JSON.stringify({ type: 'brain' }) + '\n\n';
        for (const proj of projects.values()) for (const res of proj.clients) res.write(line);
      }, 100);
    });
  } catch (_) {}
}

// IPv6 loopback too, best effort: `localhost` may resolve to ::1 first. No ::1 on this machine → IPv4 only.
const server6 = http.createServer((req, res) => server.emit('request', req, res));
server6.on('error', () => {});
server.on('listening', () => server6.listen(PORT, '::1'));
server.listen(PORT, '127.0.0.1', () => { watchBrain(); writeLock(); console.log(`spectoflow · hub → http://localhost:${PORT}${migrated.movedRegistry ? '  (moved your project list into the workspace)' : ''}`); startConnector(); });
