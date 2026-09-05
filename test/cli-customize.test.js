'use strict';
// End-to-end tests for `spectoflow skill/agent/dashboard create` — the CLI mirror of the dashboard's
// Settings → Customize UI. Spawns the real CLI (like runner.test.js) against a stub agent runner and
// asserts on the exact prompt it logs, mirroring lib/dashboard/public/app.js's CZ_KINDS.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const store = require('../lib/store');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const FIXTURE = path.join(KIT, 'test', 'fixtures', 'chat-agent.js').split(path.sep).join('/');

function installWithStub(extraRunners) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-customize-'));
  execFileSync('node', [BIN, 'init', proj], { stdio: 'pipe' });
  const cfgPath = path.join(proj, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.agent = 'claude';
  cfg.runners = Object.assign({ claude: `node ${FIXTURE}` }, extraRunners || {});
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  return proj;
}
function run(proj, args) {
  return spawnSync('node', [BIN, ...args], { cwd: proj, encoding: 'utf8' });
}
function loggedPrompt(proj) {
  const msgs = store.readRuntime(proj).messages || [];
  const user = msgs.find((m) => m.role === 'user');
  return user && user.text;
}

test('skill create "<description>" logs the exact dashboard-UI "add" prompt', () => {
  const proj = installWithStub();
  const r = run(proj, ['skill', 'create', 'reviews', 'PRs', 'for', 'accessibility']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(loggedPrompt(proj), 'Create a new skill: reviews PRs for accessibility');
});

test('skill create --auto logs the exact dashboard-UI "auto" prompt', () => {
  const proj = installWithStub();
  const r = run(proj, ['skill', 'create', '--auto']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(loggedPrompt(proj), 'Propose skill candidates for this project (Auto customize)');
});

test('agent create "<description>" logs the exact dashboard-UI "add" prompt', () => {
  const proj = installWithStub();
  const r = run(proj, ['agent', 'create', 'owns', 'accessibility', 'review']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(loggedPrompt(proj), 'Create a new agent: owns accessibility review');
});

test('agent create --auto logs the exact dashboard-UI "auto" prompt', () => {
  const proj = installWithStub();
  const r = run(proj, ['agent', 'create', '--auto']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(loggedPrompt(proj), 'Propose agent candidates for this project (Auto customize)');
});

test('dashboard create "<description>" logs the exact dashboard-UI "add" prompt', () => {
  const proj = installWithStub();
  const r = run(proj, ['dashboard', 'create', 'a', 'KPI', 'overview']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(loggedPrompt(proj), 'Add a custom dashboard: a KPI overview');
});

test('dashboard create --auto logs the exact dashboard-UI "auto" prompt', () => {
  const proj = installWithStub();
  const r = run(proj, ['dashboard', 'create', '--auto']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(loggedPrompt(proj), 'Propose dashboard candidates for this project (Auto customize)');
});

test('a quoted multi-word description works the same as unquoted words', () => {
  const proj = installWithStub();
  const r = run(proj, ['skill', 'create', 'a single quoted description']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(loggedPrompt(proj), 'Create a new skill: a single quoted description');
});

test('--agent=name overrides the configured runner', () => {
  const proj = installWithStub({ codex: `node ${FIXTURE}` });
  const r = run(proj, ['skill', 'create', 'x', '--agent=codex']);
  assert.strictEqual(r.status, 0, r.stderr);
  const msgs = store.readRuntime(proj).messages;
  assert.strictEqual(msgs[0].agent, 'codex');
});

test('no description and no --auto prints usage and does not start a run', () => {
  const proj = installWithStub();
  const r = run(proj, ['skill', 'create']);
  assert.match(r.stdout, /Usage: spectoflow skill create/);
  const msgs = store.readRuntime(proj).messages || [];
  assert.strictEqual(msgs.length, 0);
});

test('a bare "skill" with no subcommand prints usage instead of erroring', () => {
  const proj = installWithStub();
  const r = run(proj, ['skill']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Usage: spectoflow skill create/);
});

test('running outside a spectoflow project prints a clear message and exits cleanly', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-noproj-'));
  const r = run(bare, ['skill', 'create', 'x']);
  assert.match(r.stdout, /No spectoflow project here\. Run: spectoflow init/);
});

test('the CLI exits with the agent run\'s own exit code', () => {
  // Inline `-e` script, not a fixture file: any .js file under test/ is auto-discovered and run by
  // `node --test` itself (see package.json's `test` script), which would misread a fixture that
  // calls process.exit(1) at module load as a failing test file, not agent-run output to assert on.
  const proj = installWithStub();
  const cfgPath = path.join(proj, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.runners.claude = 'node -e process.exit(1)';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const r = run(proj, ['skill', 'create', 'x']);
  assert.strictEqual(r.status, 1);
});
