'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const adapters = require('../lib/adapters');
const detect = require('../lib/detect');

function bindir(...bins) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-roster-'));
  for (const b of bins) fs.writeFileSync(path.join(d, b), '');
  return d;
}

test('knownAgents() is REGISTRY flattened to the dashboard shape, same order, every field present', () => {
  const known = adapters.knownAgents();
  assert.strictEqual(known.length, adapters.REGISTRY.length);
  adapters.REGISTRY.forEach((a, i) => {
    const k = known[i];
    assert.deepStrictEqual(k, { id: a.id, label: a.label, bin: a.detect.bin, dirs: a.detect.dirs || [], runner: a.runner, headless: a.headless, docsUrl: a.docsUrl });
    assert.match(k.docsUrl || '', /^https:\/\//, `${a.id} has a docs URL`);
    assert.strictEqual(typeof k.headless, 'boolean', `${a.id} declares headless explicitly`);
  });
});

test('isAgentInstalled: true when the bin is on PATH, false for an unknown id', () => {
  const bin = bindir('claude');
  const opts = { env: { PATH: bin }, platform: 'linux' };
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-roster-proj-'));
  assert.strictEqual(detect.isAgentInstalled('claude', proj, opts), true);
  assert.strictEqual(detect.isAgentInstalled('codex', proj, opts), false);
  assert.strictEqual(detect.isAgentInstalled('not-an-agent', proj, opts), false);
});

test('isAgentInstalled: true when the project has the agent\'s config dir even with an empty PATH', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-roster-proj2-'));
  fs.mkdirSync(path.join(proj, '.codex'));
  assert.strictEqual(detect.isAgentInstalled('codex', proj, { env: { PATH: '' }, platform: 'linux' }), true);
});

test('installedAgents lists installed ids in REGISTRY order', () => {
  const bin = bindir('codex', 'claude');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-roster-proj3-'));
  const ids = detect.installedAgents(proj, { env: { PATH: bin }, platform: 'linux' });
  assert.deepStrictEqual(ids, ['claude', 'codex']);
});
