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
const { runMeetingGenerate, todayLocal } = require('./meeting');
const orchestrator = require('./orchestrator');
const adapters = require('../adapters');
const detect = require('../detect');
const brain = require('../brain');
const brainSetup = require('../brain-setup');
const globalConfig = require('../global-config');
const workflowDetect = require('../workflow-detect');

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
// The 6 Kanban column ids, mirroring app.js's STATUS keys exactly (order doesn't matter here — the
// client always re-derives display order from its own STATUS object). Kept as the one server-side
// source of truth for "what's a real column id" — never trust the client's array blindly.
const KANBAN_STATUSES = ['todo', 'in_progress', 'to_validate', 'to_analyze', 'done', 'blocked'];
// The 13 native nav tab ids (Sous-projet C: Task 1 built the mechanism with the original 11; Task 2
// registered 'notes'; Task 3 registers 'meeting' — the Daily meeting tab — into it), mirroring
// app.js's ROUTES array exactly — the one server-side source of truth for "what's a real native tab
// id".
const NATIVE_TABS = ['board', 'chat', 'requests', 'attention', 'backlog', 'workflow', 'team', 'files', 'notes', 'meeting', 'info', 'docs', 'brain', 'personalize'];
function writeConfig(root, patch, detectOpts) {
  const cp = path.join(root, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
  if (patch.mode && ['autopilot', 'semi', 'manual'].includes(patch.mode)) cfg.mode = patch.mode;
  if (typeof patch.language === 'string' && patch.language.trim()) cfg.language = patch.language.trim();
  if (typeof patch.design === 'string' && /^[a-z0-9-]{1,40}$/.test(patch.design)) cfg.design = patch.design;
  if (typeof patch.theme === 'string' && ['light', 'dark'].includes(patch.theme)) cfg.theme = patch.theme;
  if (typeof patch.boardView === 'string' && ['list', 'kanban'].includes(patch.boardView)) cfg.boardView = patch.boardView;
  if (typeof patch.sideHidden === 'boolean') cfg.sideHidden = patch.sideHidden;
  if (Array.isArray(patch.expandedPhases)) cfg.expandedPhases = patch.expandedPhases.filter((v) => typeof v === 'string');
  if (typeof patch.activeTab === 'string' && patch.activeTab.trim()) cfg.activeTab = patch.activeTab.trim();
  if (typeof patch.chatOpen === 'boolean') cfg.chatOpen = patch.chatOpen;
  if (typeof patch.workflowAutoEnable === 'boolean') cfg.workflowAutoEnable = patch.workflowAutoEnable;
  // kanbanColumns: reject the whole patch (leave the current value untouched) rather than silently
  // filtering out bad entries — an invalid/unknown status id here means the client sent something it
  // shouldn't have, and a real product-safety rule (never persist zero visible columns) applies too.
  if (Array.isArray(patch.kanbanColumns)) {
    const allKnown = patch.kanbanColumns.every((v) => typeof v === 'string' && KANBAN_STATUSES.includes(v));
    const uniq = [...new Set(patch.kanbanColumns)];
    if (allKnown && uniq.length) cfg.kanbanColumns = uniq;
  }
  if (patch.kanbanPageSize === 10 || patch.kanbanPageSize === 20) cfg.kanbanPageSize = patch.kanbanPageSize;
  // navTabs: same "reject the whole patch" philosophy as kanbanColumns above — plus a stricter safety
  // rule than Kanban's "can't disable the last column": the stored list must always be a COMPLETE
  // reordering/enable-state of the full native tab set (every known id exactly once, never a partial
  // filter), and 'personalize' must always stay enabled — it's the only place the user can ever turn
  // a tab back on, so letting it be disabled would permanently lock them out (short of hand-editing
  // config.json on disk).
  if (patch.navTabs !== undefined) {
    const arr = patch.navTabs;
    const valid = Array.isArray(arr)
      && arr.every((v) => v && typeof v === 'object' && typeof v.id === 'string' && typeof v.enabled === 'boolean')
      && arr.length === NATIVE_TABS.length
      && new Set(arr.map((v) => v.id)).size === NATIVE_TABS.length
      && arr.every((v) => NATIVE_TABS.includes(v.id));
    const personalizeOk = valid && arr.find((v) => v.id === 'personalize').enabled === true;
    if (personalizeOk) cfg.navTabs = arr.map((v) => ({ id: v.id, enabled: v.enabled }));
  }
  // commands: the dashboard's slash-command macros. Same "reject the whole patch" safety as
  // kanbanColumns/navTabs above — if it isn't an array, or ANY entry is structurally malformed (a
  // trigger that fails the format, or an empty instruction), the stored list is left untouched rather
  // than partially applied. A valid array (including an empty one) replaces it: triggers are deduped
  // case-insensitively (first wins), description/instruction are trimmed and clamped, enabled coerced.
  if (patch.commands !== undefined) {
    const arr = patch.commands;
    // The format regex has no /i flag (the client is expected to normalize to lowercase before
    // sending), but it is tested against the lowercased trigger here rather than the raw one: this
    // still enforces the exact charset/length rule while letting an occasional mixed-case trigger
    // (e.g. a client that didn't normalize) validate and dedupe correctly instead of taking down the
    // whole patch over casing alone. The stored trigger is always the canonical lowercase form.
    const okShape = Array.isArray(arr) && arr.every((c) => c && typeof c === 'object'
      && typeof c.trigger === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(c.trigger.toLowerCase())
      && typeof c.instruction === 'string' && c.instruction.trim().length > 0);
    if (okShape) {
      const seen = new Set(); const out = [];
      for (const c of arr) {
        const lc = c.trigger.toLowerCase();
        if (seen.has(lc)) continue;
        seen.add(lc);
        out.push({
          trigger: lc,
          description: (typeof c.description === 'string' ? c.description.trim() : '').slice(0, 120),
          instruction: c.instruction.trim().slice(0, 4000),
          enabled: c.enabled !== false,
        });
      }
      cfg.commands = out;
    }
  }
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

// The second brain is the user's own and lives outside every project: never reachable through the
// online relay. relay.js already refuses these ops (absent from its OP_PERMISSIONS); ctx.remote — set
// for ops arriving through the connector, or from another machine on the network — is the second lock. No emit here: the hub
// watches ~/.spectoflow/brain.md and tells local tabs only, whoever wrote it (page, MCP, run line).
function brainOp(ctx, fn) {
  if (ctx && ctx.remote) throw new OpError(404, 'Unknown operation.');
  try { return fn(); } catch (e) { if (e.status && !(e instanceof OpError)) throw new OpError(e.status, e.message); throw e; }
}

const ops = {
  'project.read': async (root) => {
    const p = store.readProject(root);
    p.version = frameworkVersion(root);
    p.projectName = path.basename(root);
    p.knownAgents = adapters.knownAgents().map((a) => ({ id: a.id, label: a.label, headless: a.headless, docsUrl: a.docsUrl }));
    p.installedAgents = detect.installedAgents(root);
    // Daily meeting (Sous-projet C, Task 3): the SERVER's own local date — see meeting.js's
    // todayLocal() header comment for why this, not the browser's date, is the one source of truth
    // for which .spectoflow/meetings/<date>.md "today" resolves to.
    p.todayDate = todayLocal();
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

  // Re-analysis (D75): what would fit the project now, and applying the steps the user picked. Apply
  // recomputes the suggestion server-side and writes only those of the listed names it still contains.
  'workflow.suggest': async (root) => {
    const s = workflowDetect.suggest(root, { projectType: store.readConfig(root).projectType });
    return { ...s, reasons: workflowDetect.REASONS };
  },
  'workflow.apply': async (root, { names }, ctx) => {
    if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) bad('names must be a list of step names.');
    const s = workflowDetect.suggest(root);
    const picked = s.changes.filter((c) => names.includes(c.name));
    const written = workflowDetect.applySteps(root, Object.fromEntries(picked.map((c) => [c.name, c.to])));
    return written.length ? changed(ctx, { changed: written }) : { changed: written };
  },

  'run.start': async (root, { prompt, agent, display }, ctx) => {
    text(prompt, 'Empty request.');
    const r = startRun(root, { prompt, agent, display, learn: !ctx.remote }, ctx.emit);
    if (r.error) bad(r.error);
    return { runId: r.runId };
  },
  'chat.summarize': async (root, { agent }, ctx) => {
    const r = runSummarize(root, { agent }, ctx.emit);
    if (r.error) bad(r.error);
    return { ok: true };
  },
  'meeting.generate': async (root, { agent, date }, ctx) => {
    const r = runMeetingGenerate(root, { agent, date }, ctx.emit);
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
    orchestrator.runOrchestration({ root, request: req, mode, runStep: orchestrator.defaultRunStep, confirm: orchestrator.defaultConfirm, learn: !ctx.remote }, ctx.emit)
      .catch((e) => ctx.emit({ type: 'message', message: { role: 'orchestrator', kind: 'status', text: 'orchestration error: ' + e.message } }));
    const o = store.readRuntime(root).orchestration;
    return { orchestrationId: o && o.id };
  },
  'orchestrate.approve': async (root, { decision, note }) => {
    if (!orchestrator.submitDecision(decision, note, root)) throw new OpError(409, 'No pending approval.');
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
  'brain.read': async (_root, _args, ctx) => brainOp(ctx, () => ({ ...brain.read(), path: brain.brainPath(), agents: brainSetup.status() })),
  'brain.add': async (_root, { category, text: body }, ctx) => brainOp(ctx, () => brain.add({ category, text: body, by: 'user' })),
  'brain.update': async (_root, { id, patch }, ctx) => brainOp(ctx, () => ({ entry: brain.update(id, patch || {}) })),
  'brain.remove': async (_root, { id }, ctx) => brainOp(ctx, () => brain.remove(id)),
  'brain.confirm': async (_root, { id }, ctx) => brainOp(ctx, () => ({ entry: brain.confirm(id) })),
  'brain.settings': async (_root, { autoAdd }, ctx) => brainOp(ctx, () => {
    if (typeof autoAdd !== 'boolean') bad('autoAdd must be true or false.');
    return { autoAdd: globalConfig.set('brain.autoAdd', autoAdd) };
  }),

  'attention.remove': async (root, { id }, ctx) => {
    const rt = store.readRuntime(root); rt.attention = (rt.attention || []).filter((x) => x.id !== id); store.writeRuntime(root, rt);
    return changed(ctx, { ok: true });
  },
};

module.exports = { ops, OpError };
