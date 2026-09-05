'use strict';
/*
 * The dashboard's operations — one pure function per action, (root, args, ctx) → result, with no
 * HTTP in sight. handlers.js maps HTTP routes onto this table; the online dashboard (sub-project C)
 * will map WebSocket messages onto the very same table. ctx.emit broadcasts SSE events to every
 * client of this project; ops call it themselves after a successful mutation so any caller gets
 * the same live behaviour. Errors are OpError(status, message) — the transport turns status into
 * its own vocabulary (HTTP status code today).
 */
const fs = require('fs');
const path = require('path');
const store = require('../store');
const files = require('./files');
const { startRun } = require('./runner');
const { runSummarize } = require('./summarize');
const orchestrator = require('./orchestrator');
const adapters = require('../adapters');
const detect = require('../detect');

const PKG_VERSION = require('../../package.json').version;

class OpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new OpError(400, msg); };
const notFound = (msg) => { throw new OpError(404, msg); };
const text = (v, msg) => { if (!v || !String(v).trim()) bad(msg); return String(v).trim(); };

function frameworkVersion(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.spectoflow', '.manifest.json'), 'utf8')).version || PKG_VERSION; } catch { return PKG_VERSION; }
}
function findPlanFileForTask(root, id) {
  for (const pl of store.readPlans(root)) for (const ph of pl.phases) if (ph.tasks.find((t) => t.id === id)) return pl.file;
  return null;
}
function readAgentFile(root, rel) {
  const base = path.join(root, '.spectoflow');
  const aDir = path.join(base, 'agents'), sDir = path.join(base, 'skills');
  const abs = path.resolve(base, rel || '');
  const okDir = abs.startsWith(aDir + path.sep) || abs.startsWith(sDir + path.sep);
  if (!okDir || !abs.endsWith('.md') || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) bad('not an agent/skill file');
  let real; try { real = fs.realpathSync(abs); } catch { real = null; }
  const realA = (() => { try { return fs.realpathSync(aDir); } catch { return aDir; } })();
  const realS = (() => { try { return fs.realpathSync(sDir); } catch { return sDir; } })();
  const okReal = real && (real.startsWith(realA + path.sep) || real.startsWith(realS + path.sep));
  if (!okReal || !real.endsWith('.md') || fs.statSync(real).isDirectory()) bad('not an agent/skill file');
  return { content: fs.readFileSync(real, 'utf8') };
}
function writeConfig(root, patch, detectOpts) {
  const cp = path.join(root, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
  if (patch.mode && ['autopilot', 'semi', 'manual'].includes(patch.mode)) cfg.mode = patch.mode;
  if (typeof patch.language === 'string' && patch.language.trim()) cfg.language = patch.language.trim();
  if (typeof patch.design === 'string' && /^[a-z0-9-]{1,40}$/.test(patch.design)) cfg.design = patch.design;
  if (typeof patch.agent === 'string' && patch.agent.trim()) {
    const id = patch.agent.trim();
    const known = adapters.knownAgents().find((a) => a.id === id);
    // Never activate an agent whose CLI isn't actually there — it would just fail silently later.
    if (!detect.isAgentInstalled(id, root, detectOpts)) bad(`${known ? known.label : id} isn't installed here (its command wasn't found on PATH). Install it, then try again.`);
    cfg.agent = id;
    if (known && known.runner) { cfg.runners = cfg.runners || {}; if (!cfg.runners[id]) cfg.runners[id] = known.runner; }
  }
  fs.writeFileSync(cp, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}
const filesResult = (r) => { if (r.error) bad(r.error); return r; };
const changed = (ctx, result) => { ctx.emit({ type: 'change' }); return result; };

const ops = {
  'project.read': async (root) => {
    const p = store.readProject(root);
    p.version = frameworkVersion(root);
    p.projectName = path.basename(root);
    p.knownAgents = adapters.knownAgents().map((a) => ({ id: a.id, label: a.label, headless: a.headless, docsUrl: a.docsUrl }));
    p.installedAgents = detect.installedAgents(root);
    return p;
  },
  'agentfile.read': async (root, { path: rel }) => readAgentFile(root, rel),

  'files.tree': async (root) => ({ tree: files.tree(root) }),
  'files.read': async (root, { path: rel }) => filesResult(files.readFile(root, rel || '')),
  'files.write': async (root, { path: rel, content }, ctx) => changed(ctx, filesResult(files.writeFile(root, rel, content))),
  'files.mkdir': async (root, { path: rel }, ctx) => changed(ctx, filesResult(files.mkdir(root, rel))),

  'task.add': async (root, { title, phase, file, owner, level }, ctx) => {
    const t = store.addTask(root, { title: text(title, 'A title is required.'), phase, file, owner, level });
    return changed(ctx, { task: t });
  },
  'task.update': async (root, { id, patch }, ctx) => {
    const file = findPlanFileForTask(root, id); if (!file) notFound(`Task ${id} not found.`);
    store.updateTaskLine(root, file, id, patch || {});
    return changed(ctx, { ok: true });
  },
  'task.comment': async (root, { id, text: body, action }, ctx) => {
    const msg = text(body, 'Empty comment.');
    const file = findPlanFileForTask(root, id); if (!file) notFound(`Task ${id} not found.`);
    store.addTaskComment(root, file, id, msg, 'me');
    if (action === 'analyze') store.updateTaskLine(root, file, id, { status: 'to_analyze' });
    return changed(ctx, { ok: true });
  },
  'workflow.toggle': async (root, { name }, ctx) => {
    const wf = path.join(root, '.spectoflow', 'workflow.md');
    const lines = fs.readFileSync(wf, 'utf8').split('\n');
    // Strip the trailing {cap:... skill:... policy} annotation BEFORE "(optional)" — the same order as
    // store.readWorkflow(), which is what the client's step names come from (D60).
    const stepName = (rest) => { const ann = rest.match(/\{([^}]*)\}\s*$/); if (ann) rest = rest.slice(0, ann.index).trim(); return rest.replace(/\s*\(optional\)\s*$/i, '').trim(); };
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*- \[)( |x|X)(\]\s+)(.*)$/);
      if (m && stepName(m[4]) === name) lines[i] = m[1] + (m[2].trim() ? ' ' : 'x') + m[3] + m[4];
    }
    fs.writeFileSync(wf, lines.join('\n'));
    return changed(ctx, { ok: true });
  },

  'run.start': async (root, { prompt, agent }, ctx) => {
    text(prompt, 'Empty request.');
    const r = startRun(root, { prompt, agent }, ctx.emit);
    if (r.error) bad(r.error);
    return { runId: r.runId };
  },
  'chat.summarize': async (root, { agent }, ctx) => {
    const r = runSummarize(root, { agent }, ctx.emit);
    if (r.error) bad(r.error);
    return { ok: true };
  },
  'chat.clear': async (root, _args, ctx) => {
    const rt = store.readRuntime(root); rt.messages = []; store.writeRuntime(root, rt);
    return changed(ctx, { ok: true });
  },
  'orchestrate.start': async (root, { request }, ctx) => {
    const req = text(request, 'Empty request.');
    const active = store.readRuntime(root).orchestration;
    if (active && ['running', 'awaiting_approval'].includes(active.status)) throw new OpError(409, 'An orchestration is already active.');
    const mode = store.readConfig(root).mode || 'semi';
    orchestrator.runOrchestration({ root, request: req, mode, runStep: orchestrator.defaultRunStep, confirm: orchestrator.defaultConfirm }, ctx.emit)
      .catch((e) => ctx.emit({ type: 'message', message: { role: 'orchestrator', kind: 'status', text: 'orchestration error: ' + e.message } }));
    const o = store.readRuntime(root).orchestration;
    return { orchestrationId: o && o.id };
  },
  'orchestrate.approve': async (_root, { decision, note }) => {
    if (!orchestrator.submitDecision(decision, note)) throw new OpError(409, 'No pending approval.');
    return { ok: true };
  },

  'settings.save': async (root, patch, ctx) => changed(ctx, { config: writeConfig(root, patch || {}, ctx.env ? { env: ctx.env } : undefined) }),

  'attention.add': async (root, { text: body }, ctx) => {
    const msg = text(body, 'Empty note.');
    const rt = store.readRuntime(root); rt.attention = rt.attention || [];
    const item = { id: 'att' + Date.now().toString(36), at: new Date().toISOString(), by: 'me', source: 'user', status: 'open', text: msg };
    rt.attention.unshift(item); store.writeRuntime(root, rt);
    return changed(ctx, { item });
  },
  'attention.promote': async (root, { id }, ctx) => {
    const rt = store.readRuntime(root); const it = (rt.attention || []).find((x) => x.id === id);
    if (!it) notFound('Note not found.');
    const t = store.addTask(root, { phase: 'Attention', title: it.text, owner: 'user' });
    it.status = 'resolved'; it.promotedTo = t.id; store.writeRuntime(root, rt);
    return changed(ctx, { task: t });
  },
  'attention.update': async (root, { id, patch }, ctx) => {
    const rt = store.readRuntime(root); const it = (rt.attention || []).find((x) => x.id === id);
    if (!it) notFound('Note not found.');
    const p = patch || {};
    if (typeof p.text === 'string' && p.text.trim()) it.text = p.text.trim();
    if (p.status && ['open', 'resolved'].includes(p.status)) it.status = p.status;
    store.writeRuntime(root, rt);
    return changed(ctx, { item: it });
  },
  'attention.remove': async (root, { id }, ctx) => {
    const rt = store.readRuntime(root); rt.attention = (rt.attention || []).filter((x) => x.id !== id); store.writeRuntime(root, rt);
    return changed(ctx, { ok: true });
  },
};

module.exports = { ops, OpError };
