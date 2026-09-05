// test/orchestrate-gates.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runOrchestration } = require('../lib/dashboard/orchestrator');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function projectWithPolicyStep() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-gate-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  // append a policy-gated step so a policy gate is exercised
  const wf = path.join(d, '.spectoflow', 'workflow.md');
  fs.appendFileSync(wf, '\n- [x] Deploy {cap:implementation skill:write-tests policy}\n');
  return d;
}
const okStep = () => Promise.resolve(0);

test('manual mode calls confirm before every step', async () => {
  const d = projectWithPolicyStep();
  let confirms = 0;
  const confirm = () => { confirms++; return Promise.resolve({ decision: 'approve' }); };
  const o = await runOrchestration({ root: d, request: 'x', mode: 'manual', runStep: okStep, confirm }, () => {});
  assert.strictEqual(o.status, 'done');
  assert.strictEqual(confirms, o.steps.length, 'one confirm per step');
});

test('autopilot still confirms a policy-gated step', async () => {
  const d = projectWithPolicyStep();
  const confirmed = [];
  const confirm = (step) => { confirmed.push(step.name); return Promise.resolve({ decision: 'approve' }); };
  await runOrchestration({ root: d, request: 'x', mode: 'autopilot', runStep: okStep, confirm }, () => {});
  assert.deepStrictEqual(confirmed, ['Deploy'], 'only the policy step is confirmed in autopilot');
});

test('cancel at a gate stops the run as cancelled', async () => {
  const d = projectWithPolicyStep();
  const cancel = () => Promise.resolve({ decision: 'cancel' });
  const ran = [];
  const runStep = ({ step }) => { ran.push(step.name); return Promise.resolve(0); };
  const o = await runOrchestration({ root: d, request: 'x', mode: 'manual', runStep, confirm: cancel }, () => {});
  assert.strictEqual(o.status, 'cancelled');
  assert.strictEqual(ran.length, 0, 'no step runs after a cancel on the first gate');
});
