'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('../lib/store');
const { startRun } = require('../lib/dashboard/runner');

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
// Run one agent to completion with an optional display text for the chat bubble.
function runOnceWithDisplay(proj, prompt, display) {
  return new Promise((resolve) => {
    const events = [];
    const emit = (e) => { events.push(e); if (e.type === 'run-end') resolve(events); };
    const r = startRun(proj, { prompt, agent: 'claude', display }, emit);
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
  const { resolveRunnerCommand } = require('../lib/dashboard/runner');
  const cfg = { runners: { claude: 'node custom-claude.js' } };
  assert.strictEqual(resolveRunnerCommand('/irrelevant', cfg, 'claude'), 'node custom-claude.js');
});

test('resolveRunnerCommand falls back to the registry default for a known, headless, installed agent with no configured runner', () => {
  const { resolveRunnerCommand } = require('../lib/dashboard/runner');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-resolve-'));
  fs.mkdirSync(path.join(proj, '.opencode')); // dir signal → "installed" without touching real PATH
  const cfg = { runners: {} };
  assert.strictEqual(resolveRunnerCommand(proj, cfg, 'opencode'), 'opencode run --quiet');
});

test('resolveRunnerCommand returns null for a known agent that is not actually installed', () => {
  const { resolveRunnerCommand } = require('../lib/dashboard/runner');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-resolve-'));
  const cfg = { runners: {} };
  // Isolated PATH: the machine running this suite may genuinely have opencode installed for real,
  // which would make this test flaky if it fell through to the real process.env.PATH.
  const opts = { env: { PATH: fs.mkdtempSync(path.join(os.tmpdir(), 'stf-empty-')) }, platform: 'linux' };
  assert.strictEqual(resolveRunnerCommand(proj, cfg, 'opencode', opts), null);
});

test('resolveRunnerCommand returns null for a non-headless agent (kimi) even if installed', () => {
  const { resolveRunnerCommand } = require('../lib/dashboard/runner');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-resolve-'));
  const cfg = { runners: {} };
  const bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-kimi-'));
  fs.writeFileSync(path.join(bindir, 'kimi'), '');
  const opts = { env: { PATH: bindir }, platform: 'linux' };
  assert.strictEqual(resolveRunnerCommand(proj, cfg, 'kimi', opts), null, 'kimi has no runner regardless of install status');
});

test('display, when given, is what the user bubble shows (the agent still gets the full prompt)', async () => {
  const proj = installWithStub();
  await runOnceWithDisplay(proj, 'FULL EXPANDED INSTRUCTION', '/rapport_jour focus bugs');
  const msgs = store.readRuntime(proj).messages;
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[0].text, '/rapport_jour focus bugs');
  assert.ok(!msgs.some((m) => m.role === 'user' && m.text === 'FULL EXPANDED INSTRUCTION'),
    'the long expanded prompt is never shown as the user bubble');
});

test('without display, the user bubble is the prompt (unchanged behavior)', async () => {
  const proj = installWithStub();
  await runOnceWithDisplay(proj, 'add login', undefined);
  assert.strictEqual(store.readRuntime(proj).messages[0].text, 'add login');
});

test('parseLearnLine reads category and msg; anything else is not a learn line', () => {
  const { parseLearnLine } = require('../lib/dashboard/runner');
  assert.deepStrictEqual(parseLearnLine('  ::spectoflow learn category=profile msg=Scrum master and dev  '), { category: 'profile', text: 'Scrum master and dev' });
  assert.deepStrictEqual(parseLearnLine('::spectoflow learn msg=no category=here'), { category: undefined, text: 'no category=here' }, 'category is only read before msg=');
  assert.strictEqual(parseLearnLine('::spectoflow learn category=profile msg=   '), null);
  assert.strictEqual(parseLearnLine('::spectoflow attention msg=x'), null);
});

test('a `::spectoflow learn` line lands in "To confirm" (whatever brain.autoAdd says), never in the chat log, never as raw output', async () => {
  const prevHome = process.env.SPECTOFLOW_HOME;
  process.env.SPECTOFLOW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-runner-brain-'));
  try {
    const proj = installWithStub();
    const cfgPath = path.join(proj, '.spectoflow', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.runners = { claude: `node ${path.join(KIT, 'test', 'fixtures', 'learn-agent.js').split(path.sep).join('/')}` };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    assert.strictEqual(require('../lib/brain').autoAdd(), true, 'autoAdd is on');
    const events = await runOnce(proj, 'go');
    const text = fs.readFileSync(path.join(process.env.SPECTOFLOW_HOME, 'brain.md'), 'utf8');
    assert.match(text, /## To confirm\n- \[avoid\] Never publish without asking <!-- id:\S+ by:agent/);
    const raw = events.filter((e) => e.type === 'run-line').map((e) => e.chunk).join('');
    assert.ok(!raw.includes('::spectoflow learn') && !raw.includes('Never publish'), 'not streamed raw');
    const log = JSON.stringify(store.readRuntime(proj).messages);
    assert.ok(!log.includes('Never publish') && !/second brain/i.test(log), 'the fact never reaches the chat log (it is part of project.read → the relay snapshot)');
    assert.ok(!JSON.stringify(events).includes('Never publish'), 'nor any emitted event (they are teed to the connector)');
  } finally {
    if (prevHome === undefined) delete process.env.SPECTOFLOW_HOME; else process.env.SPECTOFLOW_HOME = prevHome;
  }
});

test('a run started with learn:false (a remote caller) never writes into the second brain', async () => {
  const prevHome = process.env.SPECTOFLOW_HOME;
  process.env.SPECTOFLOW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-runner-brain-'));
  try {
    const proj = installWithStub();
    const cfgPath = path.join(proj, '.spectoflow', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.runners = { claude: `node ${path.join(KIT, 'test', 'fixtures', 'learn-agent.js').split(path.sep).join('/')}` };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    const events = await new Promise((resolve) => {
      const ev = []; startRun(proj, { prompt: 'go', agent: 'claude', learn: false }, (e) => { ev.push(e); if (e.type === 'run-end') resolve(ev); });
    });
    assert.ok(!fs.existsSync(path.join(process.env.SPECTOFLOW_HOME, 'brain.md')), 'nothing written');
    assert.ok(!JSON.stringify(events).includes('Never publish'), 'and the line is still not echoed');
  } finally {
    if (prevHome === undefined) delete process.env.SPECTOFLOW_HOME; else process.env.SPECTOFLOW_HOME = prevHome;
  }
});
