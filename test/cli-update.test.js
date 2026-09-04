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

test('update --dry-run leaves the manifest untouched', () => {
  const proj = install();
  const sf = path.join(proj, '.spectoflow');
  fs.writeFileSync(path.join(sf, 'AGENTS.md'), 'DRIFTED'); // force a would-be action
  const before = JSON.stringify(manifest.readManifest(sf));
  const out = run(proj, ['update', '--dry-run']);
  assert.match(out, /dry-run/i);
  assert.strictEqual(JSON.stringify(manifest.readManifest(sf)), before, 'manifest unchanged');
});
