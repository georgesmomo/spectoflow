'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const detect = require('../lib/detect');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-detect-'));
}
function bindir(...bins) {
  const d = tmp();
  for (const b of bins) fs.writeFileSync(path.join(d, b), '');
  return d;
}

test('binOnPath finds a bin present in a PATH directory', () => {
  const d = bindir('claude');
  assert.ok(detect.binOnPath('claude', { env: { PATH: d }, platform: 'linux' }));
  assert.ok(!detect.binOnPath('codex', { env: { PATH: d }, platform: 'linux' }));
});

test('binOnPath honours PATHEXT on win32', () => {
  // Fixture ext casing must match a PATHEXT entry so the test is FS-case-insensitivity-agnostic
  // (passes on both case-insensitive Windows and case-sensitive Linux CI).
  const d = bindir('gemini.CMD');
  assert.ok(detect.binOnPath('gemini', { env: { PATH: d, PATHEXT: '.CMD;.EXE' }, platform: 'win32' }));
});

test('detectAgents returns detected ids in registry priority order', () => {
  const proj = tmp();
  fs.mkdirSync(path.join(proj, '.codex')); // dir signal for codex
  const d = bindir('claude'); // PATH signal for claude
  const found = detect.detectAgents(proj, { env: { PATH: d }, platform: 'linux' });
  assert.deepStrictEqual(found, ['claude', 'codex']);
});

test('detectAgents returns [] when nothing is installed and no agent dirs exist', () => {
  const found = detect.detectAgents(tmp(), { env: { PATH: tmp() }, platform: 'linux' });
  assert.deepStrictEqual(found, []);
});
