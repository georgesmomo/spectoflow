'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const store = require('../templates/lib/store');
const { runOrchestration } = require('../templates/dashboard/orchestrator');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-loop-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  return d;
}
const okStep = () => Promise.resolve(0);          // every step succeeds
const approve = () => Promise.resolve({ decision: 'approve' });

test('autopilot runs every enabled step in order and finishes done', async () => {
  const d = project();
  const calls = [];
  const runStep = ({ step }) => { calls.push(step.name); return Promise.resolve(0); };
  const o = await runOrchestration({ root: d, request: 'add login', mode: 'autopilot', runStep, confirm: approve }, () => {});
  assert.strictEqual(o.status, 'done');
  // enabled default steps, in order (optional integration/e2e are disabled)
  assert.deepStrictEqual(calls, ['Brainstorm', 'Analysis', 'Spec', 'Plan', 'Develop', 'Unit tests', 'Review']);
  assert.ok(o.steps.every((s) => s.status === 'done'));
});

test('autopilot does not call confirm for ordinary steps', async () => {
  const d = project();
  let confirms = 0;
  const confirm = () => { confirms++; return Promise.resolve({ decision: 'approve' }); };
  await runOrchestration({ root: d, request: 'x', mode: 'autopilot', runStep: okStep, confirm }, () => {});
  assert.strictEqual(confirms, 0);
});

test('the orchestration state is persisted to runtime.orchestration', async () => {
  const d = project();
  await runOrchestration({ root: d, request: 'add login', mode: 'autopilot', runStep: okStep, confirm: approve }, () => {});
  const o = store.readRuntime(d).orchestration;
  assert.strictEqual(o.status, 'done');
  assert.strictEqual(o.request, 'add login');
});
