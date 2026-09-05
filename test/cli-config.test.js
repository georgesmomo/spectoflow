'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-config-'));
const run = (h, args) => execFileSync('node', [BIN, ...args], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: h } });

test('config lists every key with its value and source', () => {
  const out = run(home(), ['config']);
  assert.match(out, /dashboard\.url\s+http:\/\/localhost:4319\s+\(default\)/);
  assert.match(out, /defaults\.agent/);
});

test('config set then config get round-trips, and init picks the default up', () => {
  const h = home();
  run(h, ['config', 'set', 'defaults.language', 'fr']);
  assert.strictEqual(run(h, ['config', 'get', 'defaults.language']).trim(), 'fr');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-config-proj-'));
  run(h, ['init', proj]);
  const cfg = JSON.parse(fs.readFileSync(path.join(proj, '.spectoflow', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.language, 'fr');
});

test('config set with a bad value fails with exit code 1 and names the valid choices', () => {
  const r = spawnSync('node', [BIN, 'config', 'set', 'defaults.mode', 'turbo'], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: home() } });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout + r.stderr, /autopilot, semi, manual/);
});
