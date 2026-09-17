'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.SPECTOFLOW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-pmem-home-'));
const brain = require('../lib/brain');
const pm = require('../lib/project-memory');
const { ops, OpError } = require('../lib/dashboard/ops');
const { findRoute } = require('../lib/dashboard/routes');
const { runUpdate } = require('../lib/update');

const BIN = path.join(__dirname, '..', 'bin', 'spectoflow.js');
const local = () => { const events = []; return { emit: (e) => events.push(e), events }; };
const remote = () => ({ emit: () => {}, remote: true });
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-pmem-'));
  fs.mkdirSync(path.join(root, '.spectoflow'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spectoflow', 'config.json'), '{"mode":"semi"}\n');
  return root;
}
const setAuto = (root, v) => {
  const f = path.join(root, '.spectoflow', 'config.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), memoryAutoAdd: v }) + '\n');
};

test('the factory keeps each memory to its own categories, headings, title and file', () => {
  assert.deepStrictEqual(pm.CATEGORIES, ['conventions', 'pitfalls', 'glossary', 'constraints']);
  assert.deepStrictEqual(brain.CATEGORIES, ['profile', 'preferences', 'workflow', 'avoid']);
  const root = project(), f = pm.fileFor(root);
  assert.strictEqual(f, path.join(root, '.spectoflow', 'memory.md'));
  assert.deepStrictEqual(pm.read(f), { entries: [], pending: [], autoAdd: true });
  assert.ok(!fs.existsSync(f), 'reading never creates the file');
  pm.add({ category: 'pitfalls', text: 'The staging API rejects requests without X-Tenant' }, f);
  pm.add({ category: 'profile', text: 'Falls back to conventions' }, f);
  assert.strictEqual(fs.readFileSync(f, 'utf8').replace(/ <!--.*?-->/g, ''),
    '# Project memory\n\n## Conventions\n- Falls back to conventions\n\n## Pitfalls\n- The staging API rejects requests without X-Tenant\n\n## Glossary\n\n## Constraints\n');
  assert.ok(/<!-- id:m\w+ by:user at:\d{4}-\d{2}-\d{2} -->/.test(fs.readFileSync(f, 'utf8')), 'project ids start with m');
  assert.ok(!fs.existsSync(brain.brainPath()), 'the personal brain was not touched');
});

test('a hand-written memory.md round-trips byte for byte, and gets stable ids', () => {
  const root = project(), f = pm.fileFor(root);
  const text = '# Project memory\n\nKeep it short.\n\n## Glossary\n- "Commande" = an order\n\n## Deploy notes\n- not a category, kept as is\n';
  fs.writeFileSync(f, text);
  assert.strictEqual(pm.serialize(pm.parse(text)), text);
  const [e] = pm.read(f).entries;
  assert.deepStrictEqual([e.category, e.text, e.by], ['glossary', '"Commande" = an order', 'user']);
  assert.strictEqual(pm.read(f).entries[0].id, e.id);
  pm.add({ category: 'constraints', text: 'Personal data stays in the EU' }, f);
  assert.ok(fs.readFileSync(f, 'utf8').startsWith('# Project memory\n\nKeep it short.\n\n## Glossary\n- "Commande" = an order\n\n## Deploy notes\n- not a category, kept as is\n'));
});

test('memoryAutoAdd (per project, default true) decides whether what the agent learns waits in To confirm', () => {
  const root = project(), f = pm.fileFor(root);
  assert.strictEqual(pm.learn({ category: 'conventions', text: 'Run tests with --runInBand' }, f).entry.status, 'confirmed');
  setAuto(root, false);
  assert.strictEqual(pm.read(f).autoAdd, false);
  const e = pm.learn({ category: 'pitfalls', text: 'Docker needs 6 GB' }, f).entry;
  assert.strictEqual(e.status, 'pending');
  assert.match(fs.readFileSync(f, 'utf8'), /## To confirm\n- \[pitfalls\] Docker needs 6 GB <!-- id:\S+ by:agent/);
  pm.confirm(e.id, f);
  assert.deepStrictEqual(pm.read(f).entries.map((x) => x.category), ['conventions', 'pitfalls']);
});

test('memory ops: read, add, update, confirm, remove — each emits a change; errors map to OpError', async () => {
  const root = project();
  const ctx = local();
  const { entry } = await ops['memory.add'](root, { category: 'glossary', text: 'Devis = quote' }, ctx);
  assert.strictEqual(entry.by, 'user');
  await ops['memory.update'](root, { id: entry.id, patch: { text: 'Devis = a quote' } }, ctx);
  setAuto(root, false);
  pm.learn({ category: 'constraints', text: 'No US hosting' }, pm.fileFor(root));
  let r = await ops['memory.read'](root, {}, local());
  assert.strictEqual(r.path, '.spectoflow/memory.md');
  assert.strictEqual(r.autoAdd, false);
  await ops['memory.confirm'](root, { id: r.pending[0].id }, ctx);
  await ops['memory.remove'](root, { id: entry.id }, ctx);
  r = await ops['memory.read'](root, {}, local());
  assert.deepStrictEqual(r.entries.map((e) => [e.category, e.text]), [['constraints', 'No US hosting']]);
  assert.strictEqual(ctx.events.filter((e) => e.type === 'change').length, 4);
  await assert.rejects(() => ops['memory.add'](root, { category: 'glossary', text: ' ' }, local()), (e) => e instanceof OpError && e.status === 400);
  await assert.rejects(() => ops['memory.remove'](root, { id: 'nope' }, local()), (e) => e instanceof OpError && e.status === 404);
});

test('the project memory is the project\'s: its ops work for a remote caller too', async () => {
  const root = project();
  const { entry } = await ops['memory.add'](root, { category: 'conventions', text: 'Tabs, not spaces' }, remote());
  assert.strictEqual((await ops['memory.read'](root, {}, remote())).entries[0].id, entry.id);
});

test('settings.save accepts memoryAutoAdd as a boolean only', async () => {
  const root = project();
  await ops['settings.save'](root, { memoryAutoAdd: false }, local());
  assert.strictEqual(pm.read(pm.fileFor(root)).autoAdd, false);
  await ops['settings.save'](root, { memoryAutoAdd: 'yes' }, local());
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.spectoflow', 'config.json'), 'utf8')).memoryAutoAdd, false);
});

test('memory.move: an entry goes from one memory to the other under the chosen category, both ways', async () => {
  const root = project(), f = pm.fileFor(root);
  const wrong = brain.learn({ category: 'preferences', text: 'The project uses PostgreSQL 16' }).entry;
  const moved = await ops['memory.move'](root, { from: 'user', id: wrong.id, category: 'constraints' }, local());
  assert.strictEqual(moved.entry.category, 'constraints');
  assert.strictEqual(moved.entry.by, 'agent', 'who wrote it is kept');
  assert.ok(!brain.read().entries.some((e) => e.text === 'The project uses PostgreSQL 16'), 'removed from the brain');
  assert.deepStrictEqual(pm.read(f).entries.map((e) => e.text), ['The project uses PostgreSQL 16']);

  const personal = pm.add({ category: 'conventions', text: 'I prefer short answers' }, f).entry;
  await ops['memory.move'](root, { from: 'project', id: personal.id, category: 'workflow' }, local());
  assert.ok(brain.read().entries.some((e) => e.category === 'workflow' && e.text === 'I prefer short answers'));
  assert.ok(!pm.read(f).entries.some((e) => e.text === 'I prefer short answers'));

  await assert.rejects(() => ops['memory.move'](root, { from: 'project', id: 'nope', category: 'workflow' }, local()), (e) => e.status === 404);
  const keep = pm.add({ category: 'glossary', text: 'SKU = stock unit' }, f).entry;
  await assert.rejects(() => ops['memory.move'](root, { from: 'project', id: keep.id, category: 'glossary' }, local()), (e) => e.status === 400, 'glossary is not a brain category');
  await assert.rejects(() => ops['memory.move'](root, { from: 'elsewhere', id: keep.id, category: 'profile' }, local()), (e) => e.status === 400);
  assert.ok(pm.read(f).entries.some((e) => e.id === keep.id), 'a refused move loses nothing');
});

test('memory.move is refused for a remote caller: it touches the personal brain', async () => {
  const root = project(), f = pm.fileFor(root);
  const e = pm.add({ category: 'conventions', text: 'x' }, f).entry;
  const brainBefore = fs.existsSync(brain.brainPath()) ? fs.readFileSync(brain.brainPath(), 'utf8') : null;
  await assert.rejects(() => ops['memory.move'](root, { from: 'project', id: e.id, category: 'profile' }, remote()), (err) => err instanceof OpError && err.status === 404);
  assert.ok(pm.read(f).entries.some((x) => x.id === e.id));
  assert.strictEqual(fs.existsSync(brain.brainPath()) ? fs.readFileSync(brain.brainPath(), 'utf8') : null, brainBefore);
});

test('memory routes map to their ops; the relay lists memory.* but never memory.move', () => {
  const at = (m, p) => { const r = findRoute(m, p); return r && r[2]; };
  assert.strictEqual(at('GET', '/api/memory'), 'memory.read');
  assert.strictEqual(at('POST', '/api/memory'), 'memory.add');
  assert.strictEqual(at('POST', '/api/memory/move'), 'memory.move');
  assert.strictEqual(at('POST', '/api/memory/m1/confirm'), 'memory.confirm');
  assert.strictEqual(at('PATCH', '/api/memory/m1'), 'memory.update');
  assert.strictEqual(at('DELETE', '/api/memory/m1'), 'memory.remove');
  const relay = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'relay.js'), 'utf8');
  for (const op of ['memory.read', 'memory.add', 'memory.update', 'memory.remove', 'memory.confirm']) assert.ok(relay.includes(`'${op}':`), op);
  assert.ok(!relay.includes("'memory.move':"), 'memory.move stays local');
});

test('spectoflow init ships no memory.md, and update never touches one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-pmem-upd-'));
  execFileSync(process.execPath, [BIN, 'init', root], { stdio: 'pipe', env: process.env });
  const f = pm.fileFor(root);
  assert.ok(!fs.existsSync(f));
  const text = '# Project memory\n\n## Pitfalls\n- hand written\n';
  fs.writeFileSync(f, text);
  const report = runUpdate({ projectRoot: root, templatesDir: path.join(__dirname, '..', 'templates'), version: '9.9.9', force: true });
  assert.strictEqual(fs.readFileSync(f, 'utf8'), text);
  assert.ok(![...report.refreshed, ...report.created, ...report.forced, ...report.removed, ...report.newSidecar].some((p) => p.includes('memory.md')));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.spectoflow', 'config.json'), 'utf8')).memoryAutoAdd, true, 'a new project says it explicitly');
});

test('the agent is told where each fact goes: SPECTOFLOW.md, the root entry files, the MCP tool', () => {
  const brainMd = fs.readFileSync(path.join(__dirname, '..', 'templates', 'SPECTOFLOW.md'), 'utf8');
  assert.match(brainMd, /## Project memory/);
  assert.match(brainMd, /memoryAutoAdd/);
  const adapters = fs.readFileSync(path.join(__dirname, '..', 'lib', 'adapters.js'), 'utf8');
  assert.strictEqual((adapters.match(/\*\*Project memory\.\*\*/g) || []).length, 3);
  const { TOOLS } = require('../lib/mcp-server');
  assert.match(TOOLS.find((t) => t.name === 'brain_learn').description, /\.spectoflow\/memory\.md/);
});
