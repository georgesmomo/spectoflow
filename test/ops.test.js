'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ops, OpError } = require('../lib/dashboard/ops');
const store = require('../lib/store');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function project() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ops-')); execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' }); return d; }
function ctx() { const events = []; return { emit: (e) => events.push(e), events }; }

test('project.read returns the full payload with projectName, version and the agent roster', async () => {
  const root = project();
  const p = await ops['project.read'](root, {}, ctx());
  assert.strictEqual(p.projectName, path.basename(root));
  assert.strictEqual(p.version, require('../package.json').version);
  assert.ok(Array.isArray(p.knownAgents) && p.knownAgents.length > 5);
  assert.ok(Array.isArray(p.installedAgents));
});

test('task.add creates a task and emits a change; an empty title is a 400', async () => {
  const root = project(); const c = ctx();
  const r = await ops['task.add'](root, { title: 'Write the thing' }, c);
  assert.match(r.task.id, /^T-\d+/);
  assert.deepStrictEqual(c.events, [{ type: 'change' }]);
  await assert.rejects(() => ops['task.add'](root, { title: '  ' }, ctx()), (e) => e instanceof OpError && e.status === 400);
});

test('task.update patches a task line; an unknown id is a 404', async () => {
  const root = project(); const c = ctx();
  const { task } = await ops['task.add'](root, { title: 'Patch me' }, c);
  await ops['task.update'](root, { id: task.id, patch: { status: 'in_progress' } }, c);
  const all = store.readPlans(root).flatMap((pl) => pl.phases.flatMap((ph) => ph.tasks));
  assert.strictEqual(all.find((t) => t.id === task.id).status, 'in_progress');
  await assert.rejects(() => ops['task.update'](root, { id: 'T-999', patch: {} }, c), (e) => e.status === 404);
});

test('workflow.toggle flips a step whose line carries a {cap:...} annotation (D60)', async () => {
  const root = project(); const c = ctx();
  const before = store.readWorkflow(root).find((s) => s.name === 'Brainstorm').enabled;
  await ops['workflow.toggle'](root, { name: 'Brainstorm' }, c);
  assert.strictEqual(store.readWorkflow(root).find((s) => s.name === 'Brainstorm').enabled, !before);
});

test('settings.save refuses an agent that is not installed (400) and accepts mode/language', async () => {
  const root = project(); const c = ctx();
  await assert.rejects(() => ops['settings.save'](root, { agent: 'goose' }, { ...c, env: { PATH: '' } }), (e) => e.status === 400);
  const r = await ops['settings.save'](root, { mode: 'manual', language: 'fr' }, c);
  assert.strictEqual(r.config.mode, 'manual');
  assert.strictEqual(r.config.language, 'fr');
});

test('settings.save accepts the 6 dashboard preferences (Sous-projet B) and ignores invalid values', async () => {
  const root = project(); const c = ctx();
  const r = await ops['settings.save'](root, {
    theme: 'light', boardView: 'kanban', sideHidden: true,
    expandedPhases: ['Phase 1', 2, 'Phase 2'], activeTab: 'backlog', chatOpen: true,
  }, c);
  assert.strictEqual(r.config.theme, 'light');
  assert.strictEqual(r.config.boardView, 'kanban');
  assert.strictEqual(r.config.sideHidden, true);
  assert.deepStrictEqual(r.config.expandedPhases, ['Phase 1', 'Phase 2']); // non-string entries filtered
  assert.strictEqual(r.config.activeTab, 'backlog');
  assert.strictEqual(r.config.chatOpen, true);

  const before = JSON.parse(fs.readFileSync(path.join(root, '.spectoflow', 'config.json'), 'utf8'));
  const r2 = await ops['settings.save'](root, {
    theme: 'purple', boardView: 'grid', sideHidden: 'yes',
    expandedPhases: 'not-an-array', activeTab: '   ', chatOpen: 'nope',
  }, c);
  assert.strictEqual(r2.config.theme, before.theme);
  assert.strictEqual(r2.config.boardView, before.boardView);
  assert.strictEqual(r2.config.sideHidden, before.sideHidden);
  assert.deepStrictEqual(r2.config.expandedPhases, before.expandedPhases);
  assert.strictEqual(r2.config.activeTab, before.activeTab);
  assert.strictEqual(r2.config.chatOpen, before.chatOpen);
});

test('settings.save accepts a valid kanbanColumns subset/kanbanPageSize (Sous-projet B, Task 2) and rejects invalid values', async () => {
  const root = project(); const c = ctx();
  const r = await ops['settings.save'](root, { kanbanColumns: ['todo', 'done'], kanbanPageSize: 20 }, c);
  assert.deepStrictEqual(r.config.kanbanColumns, ['todo', 'done']);
  assert.strictEqual(r.config.kanbanPageSize, 20);

  // an unknown status id anywhere in the array rejects the whole patch, not just that one entry
  const before = JSON.parse(fs.readFileSync(path.join(root, '.spectoflow', 'config.json'), 'utf8'));
  const r2 = await ops['settings.save'](root, { kanbanColumns: ['todo', 'not-a-status'] }, c);
  assert.deepStrictEqual(r2.config.kanbanColumns, before.kanbanColumns);

  // disabling every column (an empty array) is refused — never persist zero visible columns
  const r3 = await ops['settings.save'](root, { kanbanColumns: [] }, c);
  assert.deepStrictEqual(r3.config.kanbanColumns, before.kanbanColumns);

  // a non-array is ignored entirely
  const r4 = await ops['settings.save'](root, { kanbanColumns: 'todo' }, c);
  assert.deepStrictEqual(r4.config.kanbanColumns, before.kanbanColumns);

  // kanbanPageSize must be exactly 10 or 20 — no other number, no string
  const r5 = await ops['settings.save'](root, { kanbanPageSize: 15 }, c);
  assert.strictEqual(r5.config.kanbanPageSize, before.kanbanPageSize);
  const r6 = await ops['settings.save'](root, { kanbanPageSize: '10' }, c);
  assert.strictEqual(r6.config.kanbanPageSize, before.kanbanPageSize);
  const r7 = await ops['settings.save'](root, { kanbanPageSize: 10 }, c);
  assert.strictEqual(r7.config.kanbanPageSize, 10);
});

test('settings.save accepts a valid navTabs reorder/enable-state (Sous-projet C, Task 1) and rejects an invalid one', async () => {
  const root = project(); const c = ctx();
  const NATIVE = ['board', 'chat', 'requests', 'attention', 'backlog', 'workflow', 'team', 'files', 'notes', 'meeting', 'info', 'docs', 'brain', 'personalize'];
  const reordered = ['chat', 'board', 'requests', 'attention', 'backlog', 'workflow', 'team', 'files', 'notes', 'meeting', 'info', 'docs', 'brain', 'personalize']
    .map((id) => ({ id, enabled: id !== 'requests' }));
  const r = await ops['settings.save'](root, { navTabs: reordered }, c);
  assert.deepStrictEqual(r.config.navTabs, reordered);

  const before = JSON.parse(fs.readFileSync(path.join(root, '.spectoflow', 'config.json'), 'utf8'));

  // missing one id (docs) rejects the whole patch
  const missing = NATIVE.filter((id) => id !== 'docs').map((id) => ({ id, enabled: true }));
  const r2 = await ops['settings.save'](root, { navTabs: missing }, c);
  assert.deepStrictEqual(r2.config.navTabs, before.navTabs);

  // a duplicate id rejects the whole patch
  const dup = NATIVE.map((id) => ({ id: id === 'docs' ? 'board' : id, enabled: true }));
  const r3 = await ops['settings.save'](root, { navTabs: dup }, c);
  assert.deepStrictEqual(r3.config.navTabs, before.navTabs);

  // an unknown id rejects the whole patch
  const unknown = NATIVE.filter((id) => id !== 'docs').concat('bloc-note').map((id) => ({ id, enabled: true }));
  const r4 = await ops['settings.save'](root, { navTabs: unknown }, c);
  assert.deepStrictEqual(r4.config.navTabs, before.navTabs);

  // setting personalize's enabled to false rejects the whole patch — it must never be lockable out
  const lockedOut = NATIVE.map((id) => ({ id, enabled: id !== 'personalize' }));
  const r5 = await ops['settings.save'](root, { navTabs: lockedOut }, c);
  assert.deepStrictEqual(r5.config.navTabs, before.navTabs);

  // a non-array is ignored entirely
  const r6 = await ops['settings.save'](root, { navTabs: 'board' }, c);
  assert.deepStrictEqual(r6.config.navTabs, before.navTabs);
});

test('settings.save persists a valid commands array (trimmed, clamped, enabled coerced, deduped)', async () => {
  const root = project(); const c = ctx();
  const r = await ops['settings.save'](root, { commands: [
    { trigger: 'rapport_jour', description: '  daily  ', instruction: '  do it  ' },
    { trigger: 'Rapport_Jour', description: 'dupe', instruction: 'ignored' }, // case-insensitive dupe → dropped
    { trigger: 'off', description: 'x', instruction: 'y', enabled: false },
  ] }, c);
  assert.strictEqual(r.config.commands.length, 2);
  assert.deepStrictEqual(r.config.commands[0], { trigger: 'rapport_jour', description: 'daily', instruction: 'do it', enabled: true });
  assert.strictEqual(r.config.commands[1].enabled, false);
});

test('settings.save accepts an empty commands array', async () => {
  const root = project(); const c = ctx();
  const r = await ops['settings.save'](root, { commands: [] }, c);
  assert.deepStrictEqual(r.config.commands, []);
});

test('settings.save rejects the whole commands patch when structurally malformed', async () => {
  const root = project(); const c = ctx();
  const r0 = await ops['settings.save'](root, { commands: [{ trigger: 'ok', description: '', instruction: 'x' }] }, c);
  assert.strictEqual(r0.config.commands.length, 1);
  // not an array
  const r1 = await ops['settings.save'](root, { commands: 'nope' }, c);
  assert.strictEqual(r1.config.commands.length, 1);
  // bad trigger
  const r2 = await ops['settings.save'](root, { commands: [{ trigger: 'bad space', instruction: 'x' }] }, c);
  assert.strictEqual(r2.config.commands.length, 1);
  // empty instruction
  const r3 = await ops['settings.save'](root, { commands: [{ trigger: 'good', instruction: '   ' }] }, c);
  assert.strictEqual(r3.config.commands.length, 1);
});

test('settings.save clamps commands description to 120 and instruction to 4000 chars', async () => {
  const root = project(); const c = ctx();
  const r = await ops['settings.save'](root, { commands: [
    { trigger: 'big', description: 'd'.repeat(200), instruction: 'i'.repeat(5000) },
  ] }, c);
  assert.strictEqual(r.config.commands[0].description.length, 120);
  assert.strictEqual(r.config.commands[0].instruction.length, 4000);
});

test('attention.add / update / promote / remove round-trip through runtime.json', async () => {
  const root = project(); const c = ctx();
  const { item } = await ops['attention.add'](root, { text: 'look at this' }, c);
  const upd = await ops['attention.update'](root, { id: item.id, patch: { text: 'look harder' } }, c);
  assert.strictEqual(upd.item.text, 'look harder');
  const prom = await ops['attention.promote'](root, { id: item.id }, c);
  assert.match(prom.task.id, /^T-/);
  assert.strictEqual(store.readRuntime(root).attention[0].status, 'resolved');
  await ops['attention.remove'](root, { id: item.id }, c);
  assert.strictEqual(store.readRuntime(root).attention.length, 0);
  await assert.rejects(() => ops['attention.update'](root, { id: 'nope', patch: {} }, c), (e) => e.status === 404);
});

test('files.write rejects a path outside the root with a 400 and never emits', async () => {
  const root = project(); const c = ctx();
  await assert.rejects(() => ops['files.write'](root, { path: '../escape.txt', content: 'x' }, c), (e) => e.status === 400);
  assert.strictEqual(c.events.length, 0);
});

test('agentfile.read serves an agent file and 400s on traversal', async () => {
  const root = project();
  const ok = await ops['agentfile.read'](root, { path: 'agents/business-analyst.md' }, ctx());
  assert.ok(ok.content.length > 0);
  await assert.rejects(() => ops['agentfile.read'](root, { path: '../config.json' }, ctx()), (e) => e.status === 400);
});

test('chat.clear empties the message log and emits', async () => {
  const root = project(); const c = ctx();
  const rt = store.readRuntime(root); rt.messages = [{ role: 'user', text: 'hi' }]; store.writeRuntime(root, rt);
  await ops['chat.clear'](root, {}, c);
  assert.deepStrictEqual(store.readRuntime(root).messages, []);
  assert.deepStrictEqual(c.events, [{ type: 'change' }]);
});

test('every op named in the spec table exists', () => {
  for (const name of ['project.read', 'agentfile.read', 'files.tree', 'files.read', 'files.write', 'files.mkdir', 'task.add', 'task.update', 'task.comment', 'workflow.toggle', 'run.start', 'chat.summarize', 'chat.clear', 'orchestrate.start', 'orchestrate.approve', 'settings.save', 'attention.add', 'attention.promote', 'attention.update', 'attention.remove'])
    assert.strictEqual(typeof ops[name], 'function', name);
});

test('workflow.suggest lists what fits the project now; workflow.apply writes only the picked steps and emits a change', async () => {
  const root = project();
  // a fresh init of an empty folder is fitted to the design phase; code arrives afterwards
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'x');
  const s = await ops['workflow.suggest'](root, {}, ctx());
  assert.strictEqual(s.phase, 'build');
  assert.deepStrictEqual(s.changes.map((c) => [c.name, c.to, c.reason]), [['Develop', true, 'has-code'], ['Unit tests', true, 'has-code'], ['Review', true, 'has-code']]);
  assert.strictEqual(s.reasons['has-code'], 'the project has code');

  const c = ctx();
  const r = await ops['workflow.apply'](root, { names: ['Develop', 'Review', 'Not a suggested step'] }, c);
  assert.deepStrictEqual(r.changed, ['Develop', 'Review']);
  assert.deepStrictEqual(c.events, [{ type: 'change' }]);
  const steps = store.readWorkflow(root);
  assert.deepStrictEqual(['Develop', 'Unit tests', 'Review'].map((n) => steps.find((x) => x.name === n).enabled), [true, false, true]);

  const none = ctx();
  assert.deepStrictEqual((await ops['workflow.apply'](root, { names: ['Develop'] }, none)).changed, [], 'already applied');
  assert.deepStrictEqual(none.events, [], 'no change emitted');
  await assert.rejects(() => ops['workflow.apply'](root, { names: 'Develop' }, ctx()), (e) => e instanceof OpError && e.status === 400);
});

test('settings.save accepts workflowAutoEnable as a boolean only', async () => {
  const root = project();
  assert.strictEqual((await ops['settings.save'](root, { workflowAutoEnable: true }, ctx())).config.workflowAutoEnable, true);
  assert.strictEqual((await ops['settings.save'](root, { workflowAutoEnable: 'yes' }, ctx())).config.workflowAutoEnable, true, 'a non-boolean is ignored');
});
