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
