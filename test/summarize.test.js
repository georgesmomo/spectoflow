'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('../lib/store');
const { runSummarize, formatLog } = require('../lib/dashboard/summarize');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const SUMMARY_FIXTURE = path.join(KIT, 'test', 'fixtures', 'summary-agent.js').split(path.sep).join('/');

function installWithStub() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-summarize-'));
  execFileSync('node', [BIN, 'init', proj], { stdio: 'pipe' });
  const cfgPath = path.join(proj, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.agent = 'claude';
  cfg.runners = { claude: `node ${SUMMARY_FIXTURE}` };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  return proj;
}
function seedMessages(proj, entries) {
  const rt = store.readRuntime(proj);
  rt.messages = entries.map((e, i) => ({ id: 'm' + i, at: new Date().toISOString(), kind: 'message', ...e }));
  store.writeRuntime(proj, rt);
}
function waitForClose(r) {
  return new Promise((resolve) => { r.child.on('close', resolve); });
}

test('formatLog renders "role: text" lines, most recent last, capped to a limit', () => {
  const msgs = [{ role: 'user', text: 'a' }, { role: 'claude', text: 'b' }, { role: 'user', text: 'c' }];
  assert.strictEqual(formatLog(msgs, 2), 'claude: b\nuser: c');
  assert.strictEqual(formatLog(msgs, 40), 'user: a\nclaude: b\nuser: c');
});

test('replaces the log with a single new message of kind "summary" — never leaves the old messages behind', async () => {
  const proj = installWithStub();
  seedMessages(proj, [{ role: 'user', text: 'add login' }, { role: 'developer', text: 'finished T-001' }]);
  const r = runSummarize(proj, { agent: 'claude' }, () => {});
  assert.ok(!r.error, r.error);
  await waitForClose(r);
  const msgs = store.readRuntime(proj).messages;
  assert.strictEqual(msgs.length, 1, 'the old messages are gone — a digest that leaves them condenses nothing');
  assert.strictEqual(msgs[0].kind, 'summary');
  assert.match(msgs[0].text, /Added login form/);
  assert.strictEqual(msgs[0].role, 'claude');
});

test('a message that arrives while the agent is summarizing is not silently lost', async () => {
  const proj = installWithStub();
  seedMessages(proj, [{ role: 'user', text: 'add login' }]);
  const r = runSummarize(proj, { agent: 'claude' }, () => {});
  // Simulate a message logged by a concurrent action after runSummarize snapshotted the log but
  // before its child process closed — the fresh read-modify-write in the close handler must not
  // clobber it back out.
  const rt = store.readRuntime(proj);
  rt.messages.push({ id: 'concurrent', at: new Date().toISOString(), kind: 'message', role: 'user', text: 'meanwhile' });
  store.writeRuntime(proj, rt);
  await waitForClose(r);
  const msgs = store.readRuntime(proj).messages;
  assert.ok(msgs.some((m) => m.id === 'concurrent'), 'the concurrent message survived');
  assert.ok(msgs.some((m) => m.kind === 'summary'), 'the summary is still there too');
});

test('emits the summary message and a change event', async () => {
  const proj = installWithStub();
  seedMessages(proj, [{ role: 'user', text: 'add login' }]);
  const events = [];
  const r = runSummarize(proj, { agent: 'claude' }, (e) => events.push(e));
  await waitForClose(r);
  assert.ok(events.some((e) => e.type === 'message' && e.message.kind === 'summary'));
  assert.ok(events.some((e) => e.type === 'change'));
});

test('emits run-start immediately and a matching run-end when the child closes — drives the client\'s "agent running" indicator', async () => {
  const proj = installWithStub();
  seedMessages(proj, [{ role: 'user', text: 'add login' }]);
  const events = [];
  const r = runSummarize(proj, { agent: 'claude' }, (e) => events.push(e));
  // run-start fires synchronously, before the child has even closed
  assert.ok(events.some((e) => e.type === 'run-start' && e.run && e.run.id));
  const runId = events.find((e) => e.type === 'run-start').run.id;
  await waitForClose(r);
  assert.ok(events.some((e) => e.type === 'run-end' && e.runId === runId && e.code === 0));
  // run-end must land before the summary message, so the client never shows "running" past the result
  const endIdx = events.findIndex((e) => e.type === 'run-end');
  const msgIdx = events.findIndex((e) => e.type === 'message');
  assert.ok(endIdx < msgIdx);
});

test('does not emit run-start when there is nothing to summarize (returns before ever spawning)', () => {
  const proj = installWithStub();
  const events = [];
  runSummarize(proj, { agent: 'claude' }, (e) => events.push(e));
  assert.strictEqual(events.length, 0);
});

test('errors when there is nothing to summarize yet', () => {
  const proj = installWithStub();
  const r = runSummarize(proj, { agent: 'claude' }, () => {});
  assert.match(r.error, /Nothing to summarize/);
});

test('errors when no runner is configured for the requested agent', () => {
  const proj = installWithStub();
  seedMessages(proj, [{ role: 'user', text: 'x' }]);
  const r = runSummarize(proj, { agent: 'nope' }, () => {});
  assert.match(r.error, /No runner configured/);
});
