'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('../templates/lib/store');
const { startRun } = require('../templates/dashboard/runner');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const FIXTURE = path.join(KIT, 'test', 'fixtures', 'chat-agent.js').split(path.sep).join('/');

function installWithStub() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-runner-'));
  execFileSync('node', [BIN, 'init', proj], { stdio: 'pipe' });
  const cfgPath = path.join(proj, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.agent = 'claude';
  cfg.runners = { claude: `node ${FIXTURE}` };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  return proj;
}
// Run one agent to completion, collecting emitted events.
function runOnce(proj, prompt) {
  return new Promise((resolve) => {
    const events = [];
    const emit = (e) => { events.push(e); if (e.type === 'run-end') resolve(events); };
    const r = startRun(proj, { prompt, agent: 'claude' }, emit);
    if (r.error) resolve([{ type: 'error', error: r.error }]);
  });
}

test('the user prompt is logged as a message before the agent runs', async () => {
  const proj = installWithStub();
  await runOnce(proj, 'add login');
  const msgs = store.readRuntime(proj).messages;
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[0].text, 'add login');
});

test('a sentinel line becomes an identified structured message', async () => {
  const proj = installWithStub();
  await runOnce(proj, 'add login');
  const msgs = store.readRuntime(proj).messages;
  const dev = msgs.find((m) => m.role === 'developer');
  assert.ok(dev, 'developer message present');
  assert.strictEqual(dev.kind, 'status');
  assert.match(dev.text, /finished T-001/);
});

test('plain output lines stream as run-line, not as chat messages', async () => {
  const proj = installWithStub();
  const events = await runOnce(proj, 'add login');
  const raw = events.filter((e) => e.type === 'run-line').map((e) => e.chunk).join('');
  assert.match(raw, /reading project files/, 'plain line streamed raw');
  assert.match(raw, /all good/);
  const msgs = store.readRuntime(proj).messages;
  assert.ok(!msgs.some((m) => /reading project files/.test(m.text)), 'plain line not a message');
});

test('a finished status message is appended when the run ends', async () => {
  const proj = installWithStub();
  await runOnce(proj, 'add login');
  const msgs = store.readRuntime(proj).messages;
  const last = msgs[msgs.length - 1];
  assert.strictEqual(last.kind, 'status');
  assert.match(last.text, /finished \(exit 0\)/);
});

test('resolveRunnerCommand prefers an explicit config.json → runners entry over the registry default', () => {
  const { resolveRunnerCommand } = require('../templates/dashboard/runner');
  const cfg = { runners: { claude: 'node custom-claude.js' } };
  assert.strictEqual(resolveRunnerCommand('/irrelevant', cfg, 'claude'), 'node custom-claude.js');
});

test('resolveRunnerCommand falls back to the registry default for a known, headless, installed agent with no configured runner', () => {
  const { resolveRunnerCommand } = require('../templates/dashboard/runner');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-resolve-'));
  fs.mkdirSync(path.join(proj, '.opencode')); // dir signal → "installed" without touching real PATH
  const cfg = { runners: {} };
  assert.strictEqual(resolveRunnerCommand(proj, cfg, 'opencode'), 'opencode run --quiet');
});

test('resolveRunnerCommand returns null for a known agent that is not actually installed', () => {
  const { resolveRunnerCommand } = require('../templates/dashboard/runner');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-resolve-'));
  const cfg = { runners: {} };
  // Isolated PATH: the machine running this suite may genuinely have opencode installed for real,
  // which would make this test flaky if it fell through to the real process.env.PATH.
  const opts = { env: { PATH: fs.mkdtempSync(path.join(os.tmpdir(), 'stf-empty-')) }, platform: 'linux' };
  assert.strictEqual(resolveRunnerCommand(proj, cfg, 'opencode', opts), null);
});

test('resolveRunnerCommand returns null for a non-headless agent (kimi) even if installed', () => {
  const { resolveRunnerCommand } = require('../templates/dashboard/runner');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-resolve-'));
  const cfg = { runners: {} };
  const bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-kimi-'));
  fs.writeFileSync(path.join(bindir, 'kimi'), '');
  const opts = { env: { PATH: bindir }, platform: 'linux' };
  assert.strictEqual(resolveRunnerCommand(proj, cfg, 'kimi', opts), null, 'kimi has no runner regardless of install status');
});
