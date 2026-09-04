'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('../templates/lib/store');
const { runSummarize, formatLog } = require('../templates/dashboard/summarize');

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

test('summarizes the recent log into one new message with kind "summary"', async () => {
  const proj = installWithStub();
  seedMessages(proj, [{ role: 'user', text: 'add login' }, { role: 'developer', text: 'finished T-001' }]);
  const r = runSummarize(proj, { agent: 'claude' }, () => {});
  assert.ok(!r.error, r.error);
  await waitForClose(r);
  const msgs = store.readRuntime(proj).messages;
  const summary = msgs.find((m) => m.kind === 'summary');
  assert.ok(summary, 'a summary message was appended');
  assert.match(summary.text, /Added login form/);
  assert.strictEqual(summary.role, 'claude');
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
