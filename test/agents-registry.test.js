'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../templates/lib/agents-registry');
const adapters = require('../lib/adapters');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-agentsreg-'));
}
function bindir(...bins) {
  const d = tmp();
  for (const b of bins) fs.writeFileSync(path.join(d, b), '');
  return d;
}

test('KNOWN_AGENTS covers every id, bin and runner in adapters.REGISTRY (no drift)', () => {
  const known = new Map(registry.KNOWN_AGENTS.map((a) => [a.id, a]));
  for (const a of adapters.REGISTRY) {
    const k = known.get(a.id);
    assert.ok(k, `agents-registry.js is missing "${a.id}"`);
    assert.strictEqual(k.bin, a.detect.bin, `${a.id}: bin mismatch`);
    assert.strictEqual(k.runner, a.runner, `${a.id}: runner mismatch`);
    assert.deepStrictEqual(k.dirs || [], a.detect.dirs || [], `${a.id}: dirs mismatch`);
  }
  assert.strictEqual(registry.KNOWN_AGENTS.length, adapters.REGISTRY.length, 'no extra/orphaned entries either way');
});

test('every KNOWN_AGENTS entry has a label', () => {
  for (const a of registry.KNOWN_AGENTS) assert.ok(a.label && a.label.length, `${a.id} has a label`);
});

test('binOnPath finds a bin present in a PATH directory', () => {
  const d = bindir('claude');
  assert.ok(registry.binOnPath('claude', { env: { PATH: d }, platform: 'linux' }));
  assert.ok(!registry.binOnPath('codex', { env: { PATH: d }, platform: 'linux' }));
});

test('isAgentInstalled is true when the bin is on PATH', () => {
  const d = bindir('opencode');
  assert.ok(registry.isAgentInstalled('opencode', tmp(), { env: { PATH: d }, platform: 'linux' }));
});

test('isAgentInstalled is true when the project already has the agent\'s config dir', () => {
  const proj = tmp();
  fs.mkdirSync(path.join(proj, '.kiro'));
  assert.ok(registry.isAgentInstalled('kiro', proj, { env: { PATH: tmp() }, platform: 'linux' }));
});

test('isAgentInstalled is false for an unknown id or a genuinely absent agent', () => {
  const proj = tmp();
  assert.ok(!registry.isAgentInstalled('nope', proj, { env: { PATH: tmp() }, platform: 'linux' }));
  assert.ok(!registry.isAgentInstalled('claude', proj, { env: { PATH: tmp() }, platform: 'linux' }));
});

test('installedAgents returns only the ids actually found, in registry order', () => {
  const d = bindir('agy', 'claude');
  const found = registry.installedAgents(tmp(), { env: { PATH: d }, platform: 'linux' });
  assert.deepStrictEqual(found, ['claude', 'antigravity']);
});

test('installedAgents returns [] when nothing is installed', () => {
  assert.deepStrictEqual(registry.installedAgents(tmp(), { env: { PATH: tmp() }, platform: 'linux' }), []);
});
