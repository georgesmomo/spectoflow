# Hub server split (sub-project 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the dashboard's route logic out of `templates/dashboard/server.js` into a new
vendored `templates/dashboard/handlers.js`, and build a new, never-vendored `lib/hub-server.js` that
can load and serve any one project's handlers dynamically — proving the split preserves 100% of
today's single-project behavior before a later sub-project adds real multi-project concurrency.

**Architecture:** `handlers.js` exports `createHandlers(root) → { handleApi, watchDirs, onBoot }` —
every `/api/*` route (except `/api/events`, which needs the listener's own SSE client set) as a pure
function of `root`, with no HTTP-listener or lock-file concerns. `server.js` is refactored to be a
thin single-project entry point that `require('./handlers')`s and delegates — its own external
behavior does not change at all (verified by the existing test suite passing unmodified). A new
global `lib/hub-server.js` proves the same `handlers.js` can be loaded a different way: dynamically,
by absolute path, from outside the project it serves — the mechanism the real multi-project hub
(sub-project 3) will build on.

**Tech Stack:** Node.js native `http`/`fs`/`path` only (zero runtime dependencies — a project
invariant, see root `CLAUDE.md`). `node --test` for tests, no test framework.

**Spec:** `docs/multi-project-hub-design.md` (see "Addendum (found while planning): the server must
split in two" and "Sub-project decomposition" item 2).

## Global Constraints

- **Zero runtime dependencies.** Native `http`/`fs`/`path` only — no new packages, in either
  `handlers.js` or `lib/hub-server.js`.
- **`templates/dashboard/server.js` must stay 100% behaviorally identical** to how it behaves today.
  The proof is the *existing* test suite (`test/dashboard-backend.test.js`,
  `test/orchestrate-server.test.js`, `test/cli-update.test.js`, and anything else that spawns it)
  passing **unmodified** — no test file's assertions, fixtures, or spawn target change in this plan.
- **The frontend is unavoidably global** (approved in the spec's addendum): `lib/hub-server.js` serves
  `templates/dashboard/public` resolved from **its own** location
  (`path.join(__dirname, '..', 'templates', 'dashboard', 'public')`), never a project's vendored
  `.spectoflow/dashboard/public/`. For a project on the current framework version these are identical
  content; for a project pinned to an older version they may differ — accepted as of this sub-project,
  per the spec.
- **`handlers.js` needs no registry/manifest wiring.** `lib/ownership.js`'s `walk()` derives the
  template file list by recursively reading `templates/` on demand — confirmed by reading the code.
  Dropping a new file under `templates/dashboard/` is sufficient for `init`/`update` to pick it up;
  no test hardcodes a template file count (confirmed by grep across `test/*.test.js`).
- **`lib/hub-server.js` is NOT wired into `spectoflow dashboard` in this sub-project**, and the
  existing dashboard-spawning tests are **not** retargeted at it. Both are explicitly later
  sub-projects (4: CLI integration: `spectoflow dashboard` joins the hub; 5: test-suite migration) —
  out of scope here. `lib/hub-server.js` is proven correct by its **own** new test file only.
- **The per-project lock file stays at `.spectoflow/.dashboard.lock`**, written by whichever process
  (server.js or hub-server.js) is serving that project, in both files — the rename to a single global
  `~/.spectoflow/hub.lock` is sub-project 4's job, not this one.
- Every new/changed file keeps this codebase's existing comment style: sparse, explaining *why*
  (a non-obvious constraint or history), never *what* the code already says.

---

### Task 1: Extract `templates/dashboard/handlers.js`; refactor `server.js` to use it

**Files:**
- Create: `templates/dashboard/handlers.js`
- Modify: `templates/dashboard/server.js` (near-total rewrite — replace the whole file)
- Test: no new test file — this task's correctness is proven by the **existing** suite passing
  unmodified before and after (a pure refactor: zero external behavior change)

**Interfaces:**
- Produces (for Task 2): `templates/dashboard/handlers.js` exports
  `{ createHandlers(root) }`, where `createHandlers(root)` returns:
  - `handleApi(req, res, u, emit): Promise<boolean>` — `u` is a `URL` (already parsed by the caller);
    `emit` is a `(obj) => void` the caller supplies (writes an SSE line to its own client set). Returns
    `true` if this request was an `/api/*` route and was fully handled (caller must not also attempt
    static/SPA fallback); `false` if the path wasn't recognized (caller falls through). Deliberately
    excludes `/api/events` — SSE client registration stays owned by whichever file owns the HTTP
    listener and its client `Set`.
  - `watchDirs: string[]` — paths, relative to `root`, whose changes should trigger `emit({type:
    'change'})`. The caller is responsible for the actual `fs.watch` calls (it owns `emit`).
  - `onBoot(): void` — call exactly once, the first time a project is opened in a server process's
    lifetime: ensures `.spectoflow/dashboard/custom/` exists, reconciles any stale in-flight
    orchestration (`orchestrator.reconcileOnBoot`).

- [ ] **Step 1: Record the baseline**

This is a pure refactor (no new behavior), so there is no new failing test to write. Instead, record
the current green baseline that Step 4 must reproduce exactly:

Run: `node --test test/dashboard-backend.test.js test/orchestrate-server.test.js test/cli-update.test.js`

Note the exact pass count reported (e.g. `# pass 41`) — Step 4 must match it (or exceed it only if a
test was already flaky and passes this time; never fewer passes, and never a different *set* of
failing tests than whatever the pre-existing documented flakes are).

- [ ] **Step 2: Create `templates/dashboard/handlers.js`**

```js
'use strict';
/*
 * spectoflow dashboard — per-project route logic, vendored into every project's
 * .spectoflow/dashboard/ (copied by init/update, exactly like server.js). Split out of server.js so
 * a single global hub process (lib/hub-server.js) can load a different project's routes on demand —
 * see docs/multi-project-hub-design.md's "the server must split in two" addendum.
 *
 * createHandlers(root) returns the per-project surface a listener-owning process needs:
 *   - handleApi(req, res, u, emit): Promise<boolean> — true if this request was an API route and was
 *     handled (caller should not also try static/SPA fallback); false otherwise. Deliberately excludes
 *     /api/events: SSE client registration stays owned by whichever file owns the HTTP listener.
 *   - watchDirs: string[] — dirs (relative to root) whose changes should emit {type:'change'}. The
 *     caller owns the actual fs.watch calls (it owns emit).
 *   - onBoot(): call once, the first time this project is opened in a server's lifetime (creates the
 *     custom-dashboards dir if missing, reconciles any stale in-flight orchestration).
 */
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const { startRun } = require('./runner');
const { runSummarize } = require('./summarize');
const orchestrator = require('./orchestrator');
const agentsRegistry = require('../lib/agents-registry');
const files = require('./files');

function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }

function createHandlers(root) {
  // Installed framework version: the manifest records it at init/update time. Fallback to the kit's
  // own package.json — only reachable (and only used) when the server is run straight from templates/
  // (dev/preview), never from an installed project whose sibling package.json belongs to the user.
  function frameworkVersion() {
    try { return JSON.parse(fs.readFileSync(path.join(root, '.spectoflow', '.manifest.json'), 'utf8')).version; } catch {}
    try { const pk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')); if (pk.name === 'spectoflow') return pk.version; } catch {}
    return null;
  }
  function project() {
    const p = store.readProject(root);
    const v = frameworkVersion(); if (v) p.version = v;
    p.projectName = path.basename(root);
    p.knownAgents = agentsRegistry.KNOWN_AGENTS.map((a) => ({ id: a.id, label: a.label, headless: a.headless, docsUrl: a.docsUrl }));
    p.installedAgents = agentsRegistry.installedAgents(root);
    return p;
  }
  function findPlanFileForTask(id) { for (const pl of store.readPlans(root)) for (const ph of pl.phases) if (ph.tasks.find((t) => t.id === id)) return pl.file; return null; }

  const configPath = () => path.join(root, '.spectoflow', 'config.json');
  function writeConfig(patch) {
    const cp = configPath(); const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
    if (patch.mode && ['autopilot', 'semi', 'manual'].includes(patch.mode)) cfg.mode = patch.mode;
    if (typeof patch.language === 'string' && patch.language.trim()) cfg.language = patch.language.trim();
    if (typeof patch.design === 'string' && /^[a-z0-9-]{1,40}$/.test(patch.design)) cfg.design = patch.design;
    if (typeof patch.agent === 'string' && patch.agent.trim()) {
      const id = patch.agent.trim();
      // Never activate an agent whose CLI isn't actually there — a picked-but-absent agent would just
      // fail silently the next time something tries to run it.
      if (!agentsRegistry.isAgentInstalled(id, root)) {
        const known = agentsRegistry.KNOWN_AGENTS.find((a) => a.id === id);
        const label = known ? known.label : id;
        throw new Error(`${label} isn't installed here (its command wasn't found on PATH). Install it, then try again.`);
      }
      cfg.agent = id;
      const known = agentsRegistry.KNOWN_AGENTS.find((a) => a.id === id);
      if (known && known.runner) { cfg.runners = cfg.runners || {}; if (!cfg.runners[id]) cfg.runners[id] = known.runner; }
    }
    fs.writeFileSync(cp, JSON.stringify(cfg, null, 2) + '\n');
    return cfg;
  }
  function promoteAttention(item) {
    return store.addTask(root, { phase: 'Attention', title: item.text, owner: 'user' });
  }

  async function handleApi(req, res, u, emit) {
    const p = u.pathname;

    if (p === '/api/project') { sendJSON(res, 200, project()); return true; }

    if (p === '/api/agentfile' && req.method === 'GET') {
      const rel = new URL(req.url, 'http://x').searchParams.get('path') || '';
      const base = path.join(root, '.spectoflow');
      const aDir = path.join(base, 'agents'), sDir = path.join(base, 'skills');
      const abs = path.resolve(base, rel);
      const okDir = abs.startsWith(aDir + path.sep) || abs.startsWith(sDir + path.sep);
      if (!okDir || !abs.endsWith('.md') || !fs.existsSync(abs) || fs.statSync(abs).isDirectory())
        { sendJSON(res, 400, { error: 'not an agent/skill file' }); return true; }
      // Symlink guard: the resolved real path must stay within the (real) scope dirs.
      let real; try { real = fs.realpathSync(abs); } catch { real = null; }
      const realA = (() => { try { return fs.realpathSync(aDir); } catch { return aDir; } })();
      const realS = (() => { try { return fs.realpathSync(sDir); } catch { return sDir; } })();
      const okReal = real && (real.startsWith(realA + path.sep) || real.startsWith(realS + path.sep));
      if (!okReal || !real.endsWith('.md') || fs.statSync(real).isDirectory())
        { sendJSON(res, 400, { error: 'not an agent/skill file' }); return true; }
      sendJSON(res, 200, { content: fs.readFileSync(real, 'utf8') }); return true;
    }

    if (p === '/api/files/tree' && req.method === 'GET') { sendJSON(res, 200, { tree: files.tree(root) }); return true; }
    if (p === '/api/files/read' && req.method === 'GET') {
      const rel = new URL(req.url, 'http://x').searchParams.get('path') || '';
      const r = files.readFile(root, rel);
      sendJSON(res, r.error ? 400 : 200, r); return true;
    }
    if (p === '/api/files/write' && req.method === 'POST') {
      const { path: rel, content } = await body(req);
      const r = files.writeFile(root, rel, content);
      if (r.error) { sendJSON(res, 400, r); return true; }
      emit({ type: 'change' }); sendJSON(res, 200, r); return true;
    }
    if (p === '/api/files/mkdir' && req.method === 'POST') {
      const { path: rel } = await body(req);
      const r = files.mkdir(root, rel);
      if (r.error) { sendJSON(res, 400, r); return true; }
      emit({ type: 'change' }); sendJSON(res, 200, r); return true;
    }

    if (p === '/api/task' && req.method === 'POST') {
      const { title, phase, file, owner, level } = await body(req);
      if (!title || !String(title).trim()) { sendJSON(res, 400, { error: 'A title is required.' }); return true; }
      const t = store.addTask(root, { title: String(title).trim(), phase, file, owner, level });
      emit({ type: 'change' }); sendJSON(res, 200, { task: t }); return true;
    }
    if (p.startsWith('/api/task/') && req.method === 'PATCH') {
      const id = decodeURIComponent(p.split('/')[3] || ''); const patch = await body(req);
      const file = findPlanFileForTask(id); if (!file) { sendJSON(res, 404, { error: `Task ${id} not found.` }); return true; }
      store.updateTaskLine(root, file, id, patch); emit({ type: 'change' }); sendJSON(res, 200, { ok: true }); return true;
    }
    if (/^\/api\/task\/[^/]+\/comment$/.test(p) && req.method === 'POST') {
      const id = decodeURIComponent(p.split('/')[3] || ''); const { text, action } = await body(req);
      if (!text || !String(text).trim()) { sendJSON(res, 400, { error: 'Empty comment.' }); return true; }
      const file = findPlanFileForTask(id); if (!file) { sendJSON(res, 404, { error: `Task ${id} not found.` }); return true; }
      store.addTaskComment(root, file, id, String(text).trim(), 'me');
      if (action === 'analyze') store.updateTaskLine(root, file, id, { status: 'to_analyze' });
      emit({ type: 'change' }); sendJSON(res, 200, { ok: true }); return true;
    }
    if (p === '/api/workflow/toggle' && req.method === 'POST') {
      const { name } = await body(req); const wf = path.join(root, '.spectoflow', 'workflow.md');
      const lines = fs.readFileSync(wf, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) { const m = lines[i].match(/^(\s*- \[)( |x|X)(\]\s+)(.*)$/);
        if (m && m[4].replace(/\s*\(optional\)\s*$/i, '').trim() === name) lines[i] = m[1] + (m[2].trim() ? ' ' : 'x') + m[3] + m[4]; }
      fs.writeFileSync(wf, lines.join('\n')); emit({ type: 'change' }); sendJSON(res, 200, { ok: true }); return true;
    }

    if (p === '/api/run' && req.method === 'POST') {
      const { prompt, agent } = await body(req);
      if (!prompt || !String(prompt).trim()) { sendJSON(res, 400, { error: 'Empty request.' }); return true; }
      const r = startRun(root, { prompt, agent }, emit);
      if (r.error) { sendJSON(res, 400, { error: r.error }); return true; }
      sendJSON(res, 200, { runId: r.runId }); return true;
    }

    if (p === '/api/chat/summarize' && req.method === 'POST') {
      const { agent } = await body(req);
      const r = runSummarize(root, { agent }, emit);
      if (r.error) { sendJSON(res, 400, { error: r.error }); return true; }
      sendJSON(res, 200, { ok: true }); return true;
    }
    if (p === '/api/chat/clear' && req.method === 'POST') {
      const rt = store.readRuntime(root); rt.messages = []; store.writeRuntime(root, rt);
      emit({ type: 'change' }); sendJSON(res, 200, { ok: true }); return true;
    }

    if (p === '/api/orchestrate' && req.method === 'POST') {
      const { request } = await body(req);
      if (!request || !String(request).trim()) { sendJSON(res, 400, { error: 'Empty request.' }); return true; }
      const active = store.readRuntime(root).orchestration;
      if (active && ['running', 'awaiting_approval'].includes(active.status))
        { sendJSON(res, 409, { error: 'An orchestration is already active.' }); return true; }
      const mode = store.readConfig(root).mode || 'semi';
      orchestrator.runOrchestration({ root, request: String(request).trim(), mode,
        runStep: orchestrator.defaultRunStep, confirm: orchestrator.defaultConfirm }, emit)
        .catch((e) => emit({ type: 'message', message: { role: 'orchestrator', kind: 'status', text: 'orchestration error: ' + e.message } }));
      const o = store.readRuntime(root).orchestration;
      sendJSON(res, 200, { orchestrationId: o && o.id }); return true;
    }
    if (p === '/api/orchestrate/approve' && req.method === 'POST') {
      const { decision, note } = await body(req);
      const ok = orchestrator.submitDecision(decision, note);
      sendJSON(res, ok ? 200 : 409, ok ? { ok: true } : { error: 'No pending approval.' }); return true;
    }

    if (p === '/api/settings' && req.method === 'POST') {
      const patch = await body(req);
      try { const cfg = writeConfig(patch); emit({ type: 'change' }); sendJSON(res, 200, { config: cfg }); }
      catch (e) { sendJSON(res, 400, { error: String(e && e.message || e) }); }
      return true;
    }

    if (p === '/api/attention' && req.method === 'POST') {
      const { text } = await body(req);
      if (!text || !String(text).trim()) { sendJSON(res, 400, { error: 'Empty note.' }); return true; }
      const rt = store.readRuntime(root); rt.attention = rt.attention || [];
      const item = { id: 'att' + Date.now().toString(36), at: new Date().toISOString(), by: 'me', source: 'user', status: 'open', text: String(text).trim() };
      rt.attention.unshift(item); store.writeRuntime(root, rt); emit({ type: 'change' });
      sendJSON(res, 200, { item }); return true;
    }
    if (/^\/api\/attention\/[^/]+\/promote$/.test(p) && req.method === 'POST') {
      const id = decodeURIComponent(p.split('/')[3] || '');
      const rt = store.readRuntime(root); const it = (rt.attention || []).find((x) => x.id === id);
      if (!it) { sendJSON(res, 404, { error: 'Note not found.' }); return true; }
      const t = promoteAttention(it); it.status = 'resolved'; it.promotedTo = t.id;
      store.writeRuntime(root, rt); emit({ type: 'change' });
      sendJSON(res, 200, { task: t }); return true;
    }
    if (/^\/api\/attention\/[^/]+$/.test(p) && req.method === 'PATCH') {
      const id = decodeURIComponent(p.split('/')[3] || '');
      const patch = await body(req);
      const rt = store.readRuntime(root); const it = (rt.attention || []).find((x) => x.id === id);
      if (!it) { sendJSON(res, 404, { error: 'Note not found.' }); return true; }
      if (typeof patch.text === 'string' && patch.text.trim()) it.text = patch.text.trim();
      if (patch.status && ['open', 'resolved'].includes(patch.status)) it.status = patch.status;
      store.writeRuntime(root, rt); emit({ type: 'change' });
      sendJSON(res, 200, { item: it }); return true;
    }
    if (/^\/api\/attention\/[^/]+$/.test(p) && req.method === 'DELETE') {
      const id = decodeURIComponent(p.split('/')[3] || '');
      const rt = store.readRuntime(root); rt.attention = (rt.attention || []).filter((x) => x.id !== id);
      store.writeRuntime(root, rt); emit({ type: 'change' });
      sendJSON(res, 200, { ok: true }); return true;
    }

    return false;
  }

  function onBoot() {
    // A project that hasn't used Customize yet won't have this dir on disk, and `spectoflow init` on
    // an older install won't have created it either.
    try { fs.mkdirSync(path.join(root, '.spectoflow', 'dashboard', 'custom'), { recursive: true }); } catch (_) {}
    // A process restart loses any in-flight orchestration; without this, a stale 'running' or
    // 'awaiting_approval' status wedges the /api/orchestrate 409 guard forever. Not a real resume —
    // just clears the wedge so a fresh orchestration can start.
    try { orchestrator.reconcileOnBoot(root); } catch (_) {}
  }

  return {
    handleApi,
    watchDirs: ['plans', 'specs', '.spectoflow', '.spectoflow/dashboard/custom'],
    onBoot,
  };
}

module.exports = { createHandlers };
```

- [ ] **Step 3: Replace `templates/dashboard/server.js` with the thin delegating version**

Replace the entire file content with:

```js
'use strict';
/*
 * spectoflow dashboard — ZERO-DEPENDENCY server, real-time (SSE + fs.watch), single project.
 * The actual /api/* route behavior lives in ./handlers.js — split out so the future multi-project hub
 * (lib/hub-server.js) can load a different project's handlers.js on demand (see
 * docs/multi-project-hub-design.md's "the server must split in two" addendum). This file remains the
 * direct single-project entry point (`node .spectoflow/dashboard/server.js`, today's `spectoflow
 * dashboard`) — its own external behavior is unchanged by the split.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHandlers } = require('./handlers');

const PORT = process.env.SPECTOFLOW_PORT ? Number(process.env.SPECTOFLOW_PORT) : 4319;
const PUBLIC = path.join(__dirname, 'public');
const ROOT = process.env.SPECTOFLOW_ROOT || path.resolve(__dirname, '..', '..');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff' };
const clients = new Set();
function sendJSON(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }
function emit(obj){ const line='data: '+JSON.stringify(obj)+'\n\n'; for(const res of clients) res.write(line); }

const handlers = createHandlers(ROOT);

function watch(dir){ try{ fs.watch(dir,{recursive:false},()=>emit({type:'change'})); }catch(_){} }
handlers.onBoot();
handlers.watchDirs.forEach((d)=>{ const p=path.join(ROOT,d); if(fs.existsSync(p)) watch(p); });

const server = http.createServer(async (req,res)=>{
  const u=new URL(req.url,`http://localhost:${PORT}`); const p=u.pathname;
  try{
    if(p==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
      res.write('data: '+JSON.stringify({type:'hello'})+'\n\n');
      clients.add(res); req.on('close',()=>clients.delete(res)); return;
    }

    if (p.startsWith('/api/')) {
      const handled = await handlers.handleApi(req, res, u, emit);
      if (handled) return;
    }

    // ---- static files, with SPA fallback: a route like /backlog (no file extension)
    //      that isn't a real asset serves index.html so client-side routing can take over ----
    let file=p==='/'?'/index.html':p;
    const full=path.join(PUBLIC,path.normalize(file).replace(/^(\.\.[/\\])+/,''));
    if(!full.startsWith(PUBLIC)){ res.writeHead(403); return res.end('Forbidden'); }
    // Local tool: always serve the freshest asset — never let the browser cache a stale app.js/css.
    const noCache = { 'Cache-Control': 'no-store, must-revalidate' };
    fs.readFile(full,(err,data)=>{
      if(err){
        if(req.method==='GET' && !path.extname(p) && !p.startsWith('/api/')){
          return fs.readFile(path.join(PUBLIC,'index.html'),(e2,d2)=>{
            if(e2){ res.writeHead(404); return res.end('Not found'); }
            res.writeHead(200,Object.assign({'Content-Type':MIME['.html']},noCache)); res.end(d2);
          });
        }
        res.writeHead(404); return res.end('Not found');
      }
      const ext=path.extname(full);
      // fonts are content-hashed by name and safe to cache long-term; everything else is no-store
      const headers = ext==='.woff2'||ext==='.woff' ? { 'Cache-Control':'public, max-age=604800' } : noCache;
      res.writeHead(200,Object.assign({'Content-Type':MIME[ext]||'application/octet-stream'},headers)); res.end(data);
    });
  }catch(e){ sendJSON(res,500,{error:String(e&&e.message||e)}); }
});
// pidfile so `spectoflow dashboard stop` can find and stop this server; cleared on exit.
const LOCK = path.join(ROOT, '.spectoflow', '.dashboard.lock');
function writeLock(){ try{ fs.mkdirSync(path.dirname(LOCK),{recursive:true}); fs.writeFileSync(LOCK, JSON.stringify({ pid:process.pid, port:PORT, url:`http://localhost:${PORT}`, startedAt:new Date().toISOString() })+'\n'); }catch{} }
function clearLock(){ try{ const l=JSON.parse(fs.readFileSync(LOCK,'utf8')); if(l.pid===process.pid) fs.unlinkSync(LOCK); }catch{} }
process.on('exit', clearLock);
['SIGINT','SIGTERM'].forEach((s)=> process.on(s, ()=>{ clearLock(); process.exit(0); }));
server.listen(PORT,()=>{ writeLock(); console.log(`spectoflow · dashboard → http://localhost:${PORT}`); console.log(`project root: ${ROOT}`); });
```

- [ ] **Step 4: Run the full existing suite and confirm parity with the Step 1 baseline**

Run: `node --test test/dashboard-backend.test.js test/orchestrate-server.test.js test/cli-update.test.js`

Expected: the exact same pass count as Step 1's baseline (or better, only if a pre-existing flake
happened not to fire this time — never worse, and never a *different* test failing). Every route this
task moved must behave identically: `/api/project`, `/api/agentfile` (including the traversal and
symlink-escape checks), `/api/files/*`, `/api/task*`, `/api/workflow/toggle`, `/api/run`,
`/api/chat/*`, `/api/orchestrate*`, `/api/settings`, `/api/attention*`, plus static serving and the
SPA fallback (all covered by `test/dashboard-backend.test.js`).

Then also run the full suite (`node --test test/*.test.js`) once, to catch any other test file that
happens to spawn `server.js` and isn't in the three named above. Compare its pass/fail counts against
a fresh baseline run of the full suite from before this task's changes (re-run `git stash` +
`node --test test/*.test.js` + `git stash pop` if in doubt about the true pre-task baseline) — the
only tolerated differences are the pre-existing, already-documented environmental flakes
(`test/cli-update.test.js`'s "update restarts an already-running dashboard..." and, if it appears,
`test/orchestrate-server.test.js`'s "POST /api/orchestrate runs the workflow to done in autopilot" —
both known to fail only under full-suite load, never in isolation; re-run the single failing file
alone to confirm before treating a failure as tolerated).

- [ ] **Step 5: Commit**

```bash
git add templates/dashboard/handlers.js templates/dashboard/server.js
git commit -m "$(cat <<'EOF'
split server.js: route logic → handlers.js, server.js becomes a thin delegator

Pure refactor, zero external behavior change (proven by the existing dashboard/
orchestrate/cli-update test suites passing unmodified). handlers.js exports
createHandlers(root) -> {handleApi, watchDirs, onBoot} — every /api/* route as a
function of root, no HTTP-listener or lock-file concerns. This is what lets a
future single global hub process load a different project's route logic
dynamically per request, instead of every project needing its own listener.

First half of sub-project 2 toward the multi-project hub (see
docs/multi-project-hub-design.md). lib/hub-server.js, which proves handlers.js
can be loaded dynamically from outside the project it serves, is the next task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

---

### Task 2: `lib/hub-server.js` — dynamic single-project loader (new, never vendored)

**Files:**
- Create: `lib/hub-server.js`
- Test: `test/hub-server.test.js`

**Interfaces:**
- Consumes: Task 1's `templates/dashboard/handlers.js` — loaded dynamically via
  `require(path.join(root, '.spectoflow', 'dashboard', 'handlers.js'))` (the project's own vendored
  copy, not a relative sibling require), and its returned `{ handleApi, watchDirs, onBoot }` shape
  exactly as Task 1 defined it.
- Produces: nothing other code in this plan consumes — `lib/hub-server.js` is this sub-project's
  terminal deliverable, a standalone process entry point (not `require()`'d by other modules), proven
  by its own tests. Later sub-projects extend this file in place (adding `/p/<id>` routing, a
  registry-driven project map, etc.) rather than something else requiring it.

- [ ] **Step 1: Write the failing tests**

Create `test/hub-server.test.js`:

```js
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

test('an unknown /api/ route falls through to the SPA (handleApi returned false, not a crash)', async () => {
  const d = project();
  const port = 5100 + Math.floor(Math.random() * 100);
  const srv = await startHub(d, port);
  try {
    const res = await get(port, '/api/this-route-does-not-exist');
    // Not registered as an API route in handlers.js -> handleApi returns false -> falls through to
    // the SPA fallback (200, index.html), same as server.js's own behavior for an unmatched /api/ path.
    assert.strictEqual(res.status, 200);
  } finally { srv.kill(); }
});

test('writes and clears .spectoflow/.dashboard.lock, same shape as server.js', async () => {
  const d = project();
  const port = 5200 + Math.floor(Math.random() * 100);
  const srv = await startHub(d, port);
  const lockPath = path.join(d, '.spectoflow', '.dashboard.lock');
  try {
    await get(port, '/api/project'); // ensure the server has fully started before checking the lock
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.strictEqual(lock.port, port);
    assert.strictEqual(lock.pid, srv.pid);
  } finally {
    srv.kill();
    await new Promise((r) => srv.on('exit', r));
    assert.ok(!fs.existsSync(lockPath), 'lock file removed on exit');
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/hub-server.test.js`
Expected: every test fails/errors — `lib/hub-server.js` does not exist yet, so `spawn('node',
[HUB], ...)` fails to start and every `startHub()` promise never resolves (tests will hang or time
out). This is the expected RED state; do not attempt to make a failing spawn "pass" — proceed straight
to Step 3.

- [ ] **Step 3: Write `lib/hub-server.js`**

```js
'use strict';
/*
 * The multi-project hub's server process — global (ships under lib/, never vendored into a
 * project's .spectoflow/). For this sub-project it still serves exactly one project (no /p/<id>
 * routing yet — a later sub-project, see docs/multi-project-hub-design.md's decomposition). Its job
 * here is to prove the split works: same behavior as templates/dashboard/server.js, but loading that
 * one project's route logic dynamically from its own vendored handlers.js, and serving the
 * globally-installed frontend (templates/dashboard/public) rather than the project's own copy — an
 * intentional, approved difference (the frontend is unavoidably global; see the design doc's "the
 * server must split in two" addendum).
 *
 * Not yet wired into `spectoflow dashboard` (that CLI switch is a later sub-project) — this module is
 * exercised directly, the same way templates/dashboard/server.js is exercised by test/
 * dashboard-backend.test.js: spawn it as a subprocess with SPECTOFLOW_ROOT + SPECTOFLOW_PORT env vars.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SPECTOFLOW_PORT ? Number(process.env.SPECTOFLOW_PORT) : 4319;
const ROOT = process.env.SPECTOFLOW_ROOT || process.cwd();
const PUBLIC = path.join(__dirname, '..', 'templates', 'dashboard', 'public');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff' };
const clients = new Set();
function sendJSON(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }
function emit(obj){ const line='data: '+JSON.stringify(obj)+'\n\n'; for(const res of clients) res.write(line); }

const { createHandlers } = require(path.join(ROOT, '.spectoflow', 'dashboard', 'handlers.js'));
const handlers = createHandlers(ROOT);

function watch(dir){ try{ fs.watch(dir,{recursive:false},()=>emit({type:'change'})); }catch(_){} }
handlers.onBoot();
handlers.watchDirs.forEach((d)=>{ const p=path.join(ROOT,d); if(fs.existsSync(p)) watch(p); });

const server = http.createServer(async (req,res)=>{
  const u=new URL(req.url,`http://localhost:${PORT}`); const p=u.pathname;
  try{
    if(p==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
      res.write('data: '+JSON.stringify({type:'hello'})+'\n\n');
      clients.add(res); req.on('close',()=>clients.delete(res)); return;
    }

    if (p.startsWith('/api/')) {
      const handled = await handlers.handleApi(req, res, u, emit);
      if (handled) return;
    }

    let file=p==='/'?'/index.html':p;
    const full=path.join(PUBLIC,path.normalize(file).replace(/^(\.\.[/\\])+/,''));
    if(!full.startsWith(PUBLIC)){ res.writeHead(403); return res.end('Forbidden'); }
    const noCache = { 'Cache-Control': 'no-store, must-revalidate' };
    fs.readFile(full,(err,data)=>{
      if(err){
        if(req.method==='GET' && !path.extname(p) && !p.startsWith('/api/')){
          return fs.readFile(path.join(PUBLIC,'index.html'),(e2,d2)=>{
            if(e2){ res.writeHead(404); return res.end('Not found'); }
            res.writeHead(200,Object.assign({'Content-Type':MIME['.html']},noCache)); res.end(d2);
          });
        }
        res.writeHead(404); return res.end('Not found');
      }
      const ext=path.extname(full);
      const headers = ext==='.woff2'||ext==='.woff' ? { 'Cache-Control':'public, max-age=604800' } : noCache;
      res.writeHead(200,Object.assign({'Content-Type':MIME[ext]||'application/octet-stream'},headers)); res.end(data);
    });
  }catch(e){ sendJSON(res,500,{error:String(e&&e.message||e)}); }
});

const LOCK = path.join(ROOT, '.spectoflow', '.dashboard.lock');
function writeLock(){ try{ fs.mkdirSync(path.dirname(LOCK),{recursive:true}); fs.writeFileSync(LOCK, JSON.stringify({ pid:process.pid, port:PORT, url:`http://localhost:${PORT}`, startedAt:new Date().toISOString() })+'\n'); }catch{} }
function clearLock(){ try{ const l=JSON.parse(fs.readFileSync(LOCK,'utf8')); if(l.pid===process.pid) fs.unlinkSync(LOCK); }catch{} }
process.on('exit', clearLock);
['SIGINT','SIGTERM'].forEach((s)=> process.on(s, ()=>{ clearLock(); process.exit(0); }));
server.listen(PORT,()=>{ writeLock(); console.log(`spectoflow · hub → http://localhost:${PORT}`); console.log(`project root: ${ROOT}`); });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/hub-server.test.js`
Expected: all 6 tests pass, 0 failures.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `node --test test/*.test.js`
Expected: the previous full-suite pass count plus these 6 new tests; the only tolerated failure is the
pre-existing documented `cli-update.test.js` flake (re-run it alone to confirm if it appears, per this
plan's Global Constraints) — investigate anything else before committing.

- [ ] **Step 6: Commit**

```bash
git add lib/hub-server.js test/hub-server.test.js
git commit -m "$(cat <<'EOF'
add lib/hub-server.js — proves handlers.js can be loaded dynamically per project

Second half of sub-project 2 toward the multi-project hub. A new, never-vendored
entry point that serves exactly one project (env-var driven, same SPECTOFLOW_ROOT/
SPECTOFLOW_PORT convention as templates/dashboard/server.js) but loads that
project's route logic dynamically, by absolute path, from its own vendored
handlers.js — the exact mechanism the real multi-project hub (sub-project 3) will
extend to load N different projects' handlers.js at once. Also proves the
"frontend is unavoidably global" design call: it serves templates/dashboard/public
resolved from its own location, not the project's vendored copy.

Not yet wired into `spectoflow dashboard` (CLI integration is sub-project 4); the
existing dashboard-spawning test suite is untouched (test-suite migration is
sub-project 5) — both deliberately out of scope here, per
docs/multi-project-hub-design.md's sub-project decomposition.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```
