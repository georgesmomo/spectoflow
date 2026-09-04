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
