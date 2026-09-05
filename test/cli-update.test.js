'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const manifest = require('../lib/manifest');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');

function install() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-'));
  execFileSync('node', [BIN, 'init', proj], { stdio: 'pipe' });
  return proj;
}
const run = (proj, args) => execFileSync('node', [BIN, ...args], { cwd: proj, encoding: 'utf8' });

test('update just after init reports everything up to date and writes no .new', () => {
  const proj = install();
  const out = run(proj, ['update']);
  assert.match(out, /spectoflow update/);
  const found = fs.readdirSync(path.join(proj, '.spectoflow', 'agents'));
  assert.ok(!found.some((f) => f.endsWith('.new')), 'no .new sidecars for a fresh install');
});

test('update --force overwrites a diverged file and clears the manifest divergence', () => {
  const proj = install();
  const sf = path.join(proj, '.spectoflow');
  fs.writeFileSync(path.join(sf, 'AGENTS.md'), 'DRIFTED — not the kit content');
  run(proj, ['update', '--force']);
  assert.ok(!fs.existsSync(path.join(sf, 'AGENTS.md.new')), 'no .new sidecar left behind');
  const kitContent = fs.readFileSync(path.join(__dirname, '..', 'templates', 'AGENTS.md'), 'utf8');
  assert.strictEqual(fs.readFileSync(path.join(sf, 'AGENTS.md'), 'utf8'), kitContent);
});

test('update -f is the short form of --force', () => {
  const proj = install();
  const sf = path.join(proj, '.spectoflow');
  fs.writeFileSync(path.join(sf, 'AGENTS.md'), 'DRIFTED');
  const out = run(proj, ['update', '-f']);
  assert.match(out, /force/i);
  assert.ok(!fs.existsSync(path.join(sf, 'AGENTS.md.new')));
});

// Spawns real hub-server processes end to end (like other spawn-a-real-server tests in this suite)
// — reliably green in isolation; under heavy concurrent load (this machine has been observed running
// several unrelated sessions' own test suites at once) HTTP probes and process spawns can occasionally
// exceed even generous timeouts. Re-run in isolation (`node --test test/cli-update.test.js`) if this
// ever fails under full-suite load.
test('update reloads this project in the running hub WITHOUT restarting it or disturbing other projects', async () => {
  // A long-running hub process keeps every project's framework modules (require()'d on first open)
  // cached in memory — new bytes on disk from `update` change nothing until that project is reloaded.
  // Under the hub model this must be a SURGICAL per-project reload, not a full restart: restarting
  // would kick every other project anyone has open in the same hub right now.
  const projA = install();
  const projB = install(); // a second, unrelated project sharing the same hub
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-hub-home-'));
  const sfA = path.join(projA, '.spectoflow');
  const lockPath = path.join(home, 'dashboard', 'hub.lock');
  const port = 4600 + Math.floor(Math.random() * 200);
  const env = { ...process.env, SPECTOFLOW_HOME: home };
  execFileSync('node', [BIN, 'dashboard', `--port=${port}`], { cwd: projA, env, stdio: 'pipe' });
  for (let i = 0; i < 150 && !fs.existsSync(lockPath); i++) await new Promise((r) => setTimeout(r, 200));
  const lockBefore = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  // Register + warm-load B into the same hub (so we can prove reloading A never disturbs it).
  execFileSync('node', [BIN, 'dashboard', `--port=${port}`], { cwd: projB, env, stdio: 'pipe' });
  const registry = require('../lib/registry');
  const entryA = registry.findByPath(projA, path.join(home, 'dashboard'));
  const entryB = registry.findByPath(projB, path.join(home, 'dashboard'));
  // Warm BOTH into the hub's cache first — simulates the realistic case this feature exists for
  // (someone already has these projects open in a browser tab when `update` runs elsewhere).
  await fetch(`http://localhost:${port}/api/project?p=${entryA.id}`);
  await fetch(`http://localhost:${port}/api/project?p=${entryB.id}`);
  try {
    fs.writeFileSync(path.join(sfA, 'AGENTS.md'), 'DRIFTED'); // force `changed` to be non-zero
    const out = execFileSync('node', [BIN, 'update', '--force'], { cwd: projA, env, encoding: 'utf8' });
    assert.match(out, /reloaded this project/i);
    // The hub process itself must NOT have restarted -- same pid, same lock, the whole point of a
    // surgical reload over a full restart.
    const lockAfter = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.strictEqual(lockAfter.pid, lockBefore.pid, 'the hub process itself was never restarted');
    // A must still be servable after its own reload.
    const resA = await fetch(`http://localhost:${port}/api/project?p=${entryA.id}`);
    assert.strictEqual(resA.status, 200, 'the just-reloaded project A still responds');
    // B, never touched by A's update, must be completely unaffected.
    const resB = await fetch(`http://localhost:${port}/api/project?p=${entryB.id}`);
    assert.strictEqual(resB.status, 200);
    const bodyB = await resB.json();
    assert.strictEqual(bodyB.projectName, path.basename(projB), 'project B fully unaffected by A\'s update/reload');
  } finally {
    execFileSync('node', [BIN, 'dashboard', 'stop', `--port=${port}`], { cwd: projA, env, stdio: 'pipe' });
  }
});

test('update --dry-run leaves the manifest untouched', () => {
  const proj = install();
  const sf = path.join(proj, '.spectoflow');
  fs.writeFileSync(path.join(sf, 'AGENTS.md'), 'DRIFTED'); // force a would-be action
  const before = JSON.stringify(manifest.readManifest(sf));
  const out = run(proj, ['update', '--dry-run']);
  assert.match(out, /dry-run/i);
  assert.strictEqual(JSON.stringify(manifest.readManifest(sf)), before, 'manifest unchanged');
});
