'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const manifest = require('../lib/manifest');
const ownership = require('../lib/ownership');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const TEMPLATES = path.join(KIT, 'templates');
const VERSION = require('../package.json').version;

function runInit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-init-'));
  execFileSync('node', [BIN, 'init', dir], { stdio: 'pipe' });
  return dir;
}

test('init writes .manifest.json with the kit version', () => {
  const proj = runInit();
  const m = manifest.readManifest(path.join(proj, '.spectoflow'));
  assert.ok(m, 'manifest exists');
  assert.strictEqual(m.version, VERSION);
});

test('init records a correct hash for every framework-owned file', () => {
  const proj = runInit();
  const sf = path.join(proj, '.spectoflow');
  const m = manifest.readManifest(sf);
  for (const rel of ownership.listFrameworkFiles(TEMPLATES)) {
    const onDisk = fs.readFileSync(path.join(sf, rel.split('/').join(path.sep)));
    assert.strictEqual(m.files[rel], manifest.sha256(onDisk), `hash for ${rel}`);
  }
});

test('init does not record user-owned files in the manifest', () => {
  const proj = runInit();
  const m = manifest.readManifest(path.join(proj, '.spectoflow'));
  assert.ok(!('config.json' in m.files));
  assert.ok(!('workflow.md' in m.files));
});
