'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveStep } = require('../templates/dashboard/orchestrator');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-res-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  return d;
}

test('resolveStep maps a capability to its agent and finds the skill file', () => {
  const d = project();
  const r = resolveStep(d, { name: 'Spec', cap: 'analysis', skill: 'write-spec' });
  assert.strictEqual(r.agent, 'business-analyst');
  assert.strictEqual(r.skill, 'write-spec');
});

test('resolveStep allows a step with no skill (e.g. Develop)', () => {
  const d = project();
  const r = resolveStep(d, { name: 'Develop', cap: 'implementation', skill: null });
  assert.strictEqual(r.agent, 'developer');
  assert.strictEqual(r.skill, null);
});

test('resolveStep errors when the capability has no agent', () => {
  const d = project();
  const r = resolveStep(d, { name: 'X', cap: 'nonexistent', skill: null });
  assert.match(r.error, /no agent/i);
});

test('resolveStep errors when the skill file is missing', () => {
  const d = project();
  const r = resolveStep(d, { name: 'X', cap: 'analysis', skill: 'ghost-skill' });
  assert.match(r.error, /skill/i);
});
