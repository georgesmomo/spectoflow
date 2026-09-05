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
