'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { allowRunners } = require('./helpers/allow-runners');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { ops, OpError } = require('../lib/dashboard/ops');
const manifest = require('../lib/manifest');

const BIN = path.join(__dirname, '..', 'bin', 'spectoflow.js');
const VERSION = require('../package.json').version;
const ctx = (remote) => ({ emit: () => {}, remote });

test('an older hub is restarted on the installed version by `spectoflow dashboard` (D77)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-drift-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-drift-proj-'));
  const port = String(46000 + Math.floor(Math.random() * 3000));
  const env = { ...process.env, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: port, NO_COLOR: '1' };
  execFileSync(process.execPath, [BIN, 'init', proj, '--agent=claude'], { stdio: 'pipe', env });
  const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: proj, env, encoding: 'utf8', timeout: 30000 });
  const lockFile = path.join(home, 'dashboard', 'hub.lock');
  try {
    assert.match(cli('dashboard').stdout, /hub started/);
    const first = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.strictEqual(first.version, VERSION, 'the lock records the hub version');
    assert.match(cli('dashboard').stdout, /hub already running/, 'same version: joined, not restarted');

    fs.writeFileSync(lockFile, JSON.stringify({ ...first, version: '0.1.0' }));
    const out = cli('dashboard').stdout;
    assert.match(out, /running hub is spectoflow v0\.1\.0 — restarting it on v/);
    assert.match(out, /hub started/);
    const second = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.strictEqual(second.version, VERSION);
    assert.notStrictEqual(second.pid, first.pid, 'a new hub process');
  } finally { cli('dashboard', 'stop'); }
});

test('project.read tells the dashboard both versions; project.update brings an older project up, locally only', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-drift-upd-'));
  execFileSync(process.execPath, [BIN, 'init', proj, '--agent=claude'], { stdio: 'pipe', env: process.env });
  const sf = path.join(proj, '.spectoflow');
  const m = manifest.readManifest(sf); m.version = '0.20.0'; manifest.writeManifest(sf, m);
  const before = await ops['project.read'](proj, {}, ctx());
  assert.deepStrictEqual([before.version, before.kitVersion], ['0.20.0', VERSION]);
  await assert.rejects(() => ops['project.update'](proj, {}, ctx(true)), (e) => e instanceof OpError && e.status === 404);
  assert.strictEqual(manifest.readManifest(sf).version, '0.20.0', 'remote call changed nothing');
  const r = await ops['project.update'](proj, {}, ctx());
  assert.deepStrictEqual([r.fromVersion, r.toVersion], ['0.20.0', VERSION]);
  assert.strictEqual((await ops['project.read'](proj, {}, ctx())).version, VERSION);
  assert.ok(typeof allowRunners === 'function');
});
