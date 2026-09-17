'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { allowRunners } = require('./helpers/allow-runners');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The second brain is per user, not per project: every op here works on this process's own home.
process.env.SPECTOFLOW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ops-brain-'));
process.env.HOME = process.env.SPECTOFLOW_HOME;
const { ops, OpError } = require('../lib/dashboard/ops');
const { findRoute } = require('../lib/dashboard/routes');

const local = () => { const events = []; return { emit: (e) => events.push(e), events }; };
const remote = () => ({ emit: () => {}, remote: true });
const ROOT = '/irrelevant-the-brain-is-not-a-projects';

test('brain ops: add, read, update, confirm, remove, settings — against ~/.spectoflow/brain.md', async () => {
  const added = await ops['brain.add'](ROOT, { category: 'profile', text: 'Scrum master' }, local());
  assert.strictEqual(added.entry.by, 'user');
  let r = await ops['brain.read'](ROOT, {}, local());
  assert.deepStrictEqual(r.entries.map((e) => e.text), ['Scrum master']);
  assert.strictEqual(r.path, path.join(process.env.SPECTOFLOW_HOME, 'brain.md'));
  assert.ok(Array.isArray(r.agents));
  assert.strictEqual(r.autoAdd, true);

  await ops['brain.update'](ROOT, { id: added.entry.id, patch: { text: 'Scrum master and developer' } }, local());
  assert.strictEqual((await ops['brain.settings'](ROOT, { autoAdd: false }, local())).autoAdd, false);
  require('../lib/brain').learn({ category: 'avoid', text: 'Never publish without asking' });
  r = await ops['brain.read'](ROOT, {}, local());
  assert.strictEqual(r.autoAdd, false);
  assert.deepStrictEqual(r.pending.map((e) => e.text), ['Never publish without asking']);

  await ops['brain.confirm'](ROOT, { id: r.pending[0].id }, local());
  await ops['brain.remove'](ROOT, { id: added.entry.id }, local());
  r = await ops['brain.read'](ROOT, {}, local());
  assert.deepStrictEqual(r.entries.map((e) => [e.category, e.text]), [['avoid', 'Never publish without asking']]);
  assert.deepStrictEqual(r.pending, []);
  await ops['brain.settings'](ROOT, { autoAdd: true }, local());
});

test('brain ops map errors to OpError: empty text 400, unknown id 404, non-boolean setting 400', async () => {
  await assert.rejects(() => ops['brain.add'](ROOT, { category: 'profile', text: ' ' }, local()), (e) => e instanceof OpError && e.status === 400);
  await assert.rejects(() => ops['brain.remove'](ROOT, { id: 'nope' }, local()), (e) => e instanceof OpError && e.status === 404);
  await assert.rejects(() => ops['brain.settings'](ROOT, { autoAdd: 'yes' }, local()), (e) => e instanceof OpError && e.status === 400);
});

test('every brain op refuses an op that came through the online connector (ctx.remote), and writes nothing', async () => {
  const file = path.join(process.env.SPECTOFLOW_HOME, 'brain.md');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const calls = { 'brain.read': {}, 'brain.add': { category: 'profile', text: 'x' }, 'brain.update': { id: 'a', patch: { text: 'y' } }, 'brain.remove': { id: 'a' }, 'brain.confirm': { id: 'a' }, 'brain.settings': { autoAdd: false } };
  for (const [op, args] of Object.entries(calls)) {
    await assert.rejects(() => ops[op](ROOT, args, remote()), (e) => e instanceof OpError && e.status === 404, op);
  }
  assert.strictEqual(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, before);
  assert.strictEqual(require('../lib/brain').autoAdd(), true, 'the setting was not changed');
});

test('brain routes map to their ops', () => {
  const at = (m, p) => { const r = findRoute(m, p); return r && r[2]; };
  assert.strictEqual(at('GET', '/api/brain'), 'brain.read');
  assert.strictEqual(at('POST', '/api/brain'), 'brain.add');
  assert.strictEqual(at('POST', '/api/brain/settings'), 'brain.settings');
  assert.strictEqual(at('POST', '/api/brain/b123/confirm'), 'brain.confirm');
  assert.strictEqual(at('PATCH', '/api/brain/b123'), 'brain.update');
  assert.strictEqual(at('DELETE', '/api/brain/b123'), 'brain.remove');
  const u = new URL('http://x/api/brain/b123');
  assert.deepStrictEqual(findRoute('PATCH', u.pathname)[3](u, { text: 't' }, u.pathname), { id: 'b123', patch: { text: 't' } });
});

test('a run or an orchestration started by a remote caller cannot write into the second brain', async () => {
  const prevHome = process.env.SPECTOFLOW_HOME;
  process.env.SPECTOFLOW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ops-brain-run-home-'));
  try {
  const { execFileSync } = require('node:child_process');
  const BIN = path.join(__dirname, '..', 'bin', 'spectoflow.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ops-brain-run-'));
  execFileSync(process.execPath, [BIN, 'init', root, '--agent=claude'], { stdio: 'pipe', env: process.env });
  const cfgPath = path.join(root, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.runners = { claude: `node ${path.join(__dirname, 'fixtures', 'learn-agent.js').split(path.sep).join('/')}` };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n'); allowRunners(root);
  const brainFile = path.join(process.env.SPECTOFLOW_HOME, 'brain.md');
  const before = fs.existsSync(brainFile) ? fs.readFileSync(brainFile, 'utf8') : '';
  const runAndWait = (ctxRemote) => new Promise((resolve) => {
    const c = { remote: ctxRemote, emit: (e) => { if (e.type === 'run-end') resolve(); } };
    ops['run.start'](root, { prompt: 'go', agent: 'claude' }, c);
  });
  await runAndWait(true);
  assert.strictEqual(fs.existsSync(brainFile) ? fs.readFileSync(brainFile, 'utf8') : '', before, 'remote run: nothing learned');
  await runAndWait(false);
  assert.match(fs.readFileSync(brainFile, 'utf8'), /## To confirm\n- \[avoid\] Never publish without asking/, 'local run: learned, to confirm');

  const orchestrator = require('../lib/dashboard/orchestrator');
  const seen = [];
  const runStep = (args) => { seen.push(args.learn); return Promise.resolve(0); };
  await orchestrator.runOrchestration({ root, request: 'x', mode: 'autopilot', runStep, confirm: async () => ({ decision: 'approve' }), learn: false }, () => {});
  assert.ok(seen.length > 0 && seen.every((l) => l === false), 'the orchestrator hands learn:false to every step');
  } finally { process.env.SPECTOFLOW_HOME = prevHome; }
});

test('the hub marks connector ops remote, and its brain watcher only ever writes to local SSE clients', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dashboard', 'hub-server.js'), 'utf8');
  assert.match(src, /return ops\[op\]\(proj\.root, args \|\| \{\}, \{ emit: proj\.emit, remote: true \}\);/);
  const start = src.indexOf('function watchBrain');
  const watch = src.slice(start, src.indexOf('\n}\n', start) + 3);
  assert.ok(watch.includes('fs.watch'), 'sliced the whole watchBrain function');
  assert.ok(watch.includes('proj.clients') && !/connector|proj\.emit|emit\(/.test(watch), 'brain events go to local tabs only');
  const handlers = require('../lib/dashboard/handlers');
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.1.1']) assert.strictEqual(handlers.isLoopback(a), true, a);
  for (const a of ['192.168.1.20', '::ffff:192.168.1.20', '10.0.0.2', '', undefined]) assert.strictEqual(handlers.isLoopback(a), false, String(a));
});

test('handleApi only treats a request as local with a loopback socket, a local Host, and a matching Origin', async () => {
  const { createHandlers } = require('../lib/dashboard/handlers');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-handlers-'));
  fs.mkdirSync(path.join(root, '.spectoflow'), { recursive: true });
  const h = createHandlers(root);
  const call = (remoteAddress, headers) => new Promise((resolve) => {
    const req = { method: 'GET', socket: { remoteAddress }, headers, on() {} };
    const res = { writeHead(code) { this.code = code; }, end() { resolve(this.code); } };
    h.handleApi(req, res, new URL('http://x/api/brain'), () => {});
  });
  assert.strictEqual(await call('127.0.0.1', { host: 'localhost:4319' }), 200, 'the user, in a local tab');
  assert.strictEqual(await call('::1', { host: '[::1]:4319', origin: 'http://[::1]:4319' }), 200, 'same, IPv6, same-origin fetch');
  assert.strictEqual(await call('192.168.1.20', { host: 'localhost:4319' }), 404, 'another machine on the network');
  assert.strictEqual(await call('127.0.0.1', { host: 'evil.example:4319' }), 404, 'DNS rebinding: loopback socket, foreign Host');
  assert.strictEqual(await call('127.0.0.1', { host: 'my-tunnel.ngrok.app' }), 404, 'a tunnel or proxy on this machine');
  assert.strictEqual(await call('127.0.0.1', { host: 'localhost:4319', origin: 'https://evil.example' }), 404, 'cross-site request');
  assert.strictEqual(await call('127.0.0.1', { host: 'localhost:4319', origin: 'http://localhost:3000' }), 404, 'another local port');
  assert.strictEqual(await call('127.0.0.1', { host: 'localhost:4319', origin: 'null' }), 404, 'opaque origin');
});
