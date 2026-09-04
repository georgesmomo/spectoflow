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

// Spawns two real dashboard server processes end to end (like orchestrate-server.test.js's own
// tests) — reliably green in isolation; under the FULL suite, this late in ~175 other tests that
// also spawn real node.exe children, this machine's HTTP probes and process spawns can occasionally
// exceed even generous timeouts under Windows resource contention. Same documented characteristic as
// orchestrate-server.test.js, not a logic bug — the feature itself is also verified by hand against a
// real project. Re-run in isolation (`node --test test/cli-update.test.js`) if this ever fails here.
test('update restarts an already-running dashboard so the update actually takes effect', async () => {
  // A long-running dashboard process keeps its framework modules (require()'d at startup) cached in
  // memory — new bytes on disk from `update` change nothing until the process restarts. This is the
  // exact bug a real user hit three times in a row (agent registry looked stale, "No agent found"
  // even though the CLI was genuinely installed) purely because nobody thought to restart.
  const proj = install();
  const sf = path.join(proj, '.spectoflow');
  const lockPath = path.join(sf, '.dashboard.lock');
  // A random port, like the other spawn-a-real-server tests in this suite — a fixed port risks
  // colliding with an orphan left behind by an earlier failed run (a detached process outlives the
  // test that started it; a later run's `dashboard stop` can't find it either, since stop reads the
  // lock from ITS OWN fresh project dir, not the orphan's).
  const port = 4600 + Math.floor(Math.random() * 200);
  execFileSync('node', [BIN, 'dashboard', `--port=${port}`], { cwd: proj, stdio: 'pipe' });
  // The CLI just fires a detached spawn and returns immediately — the server writes its own lock
  // file a moment later, once it's actually listening (observed up to ~4-5s under test-runner load).
  for (let i = 0; i < 150 && !fs.existsSync(lockPath); i++) await new Promise((r) => setTimeout(r, 200));
  const lockBefore = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  try {
    fs.writeFileSync(path.join(sf, 'AGENTS.md'), 'DRIFTED'); // force `changed` to be non-zero
    // `update` is never told the port — it must discover it from the lock file on its own.
    const out = run(proj, ['update', '--force']);
    assert.match(out, new RegExp(`restarting it on port ${port}`, 'i'));
    // Same detached-spawn timing as the initial start: `update` (and the `run()` that invoked it)
    // can return before the newly-restarted server has finished binding and written its own lock.
    let lockAfter = null;
    for (let i = 0; i < 150; i++) {
      try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (parsed.pid !== lockBefore.pid) { lockAfter = parsed; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(lockAfter, 'a new lock file appeared after the restart');
    assert.notStrictEqual(lockAfter.pid, lockBefore.pid, 'a genuinely new process is running');
    assert.strictEqual(lockAfter.port, port, 'restarted on the SAME port, not the 4319 default');
    const res = await fetch(`http://localhost:${port}/api/project`);
    assert.strictEqual(res.status, 200, 'the restarted dashboard actually responds');
  } finally {
    execFileSync('node', [BIN, 'dashboard', 'stop', `--port=${port}`], { cwd: proj, stdio: 'pipe' });
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
