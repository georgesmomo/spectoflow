'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../lib/manifest');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-manifest-'));
}

test('sha256 matches the reference digest of a buffer', () => {
  const buf = Buffer.from('hello spectoflow');
  const ref = crypto.createHash('sha256').update(buf).digest('hex');
  assert.strictEqual(manifest.sha256(buf), ref);
});

test('hashFileMap hashes each listed file relative to a base dir', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'a.md'), 'AAA');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'b.js'), 'BBB');
  const map = manifest.hashFileMap(dir, ['a.md', 'sub/b.js']);
  assert.strictEqual(map['a.md'], manifest.sha256(Buffer.from('AAA')));
  assert.strictEqual(map['sub/b.js'], manifest.sha256(Buffer.from('BBB')));
});

test('writeManifest then readManifest round-trips version and files', () => {
  const dir = tmpdir();
  const data = { version: '0.5.0', files: { 'AGENTS.md': 'deadbeef' } };
  manifest.writeManifest(dir, data);
  assert.ok(fs.existsSync(path.join(dir, '.manifest.json')), 'manifest file written');
  assert.deepStrictEqual(manifest.readManifest(dir), data);
});

test('readManifest returns null when no manifest exists (legacy install)', () => {
  assert.strictEqual(manifest.readManifest(tmpdir()), null);
});
