'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('../lib/store');
const { runOrchestration } = require('../lib/dashboard/orchestrator');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function project() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-rez-')); execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' }); return d; }
const approve = () => Promise.resolve({ decision: 'approve' });

test('a failing step stops the run and leaves later steps pending', async () => {
  const d = project();
  const failOnPlan = ({ step }) => Promise.resolve(step.name === 'Plan' ? 1 : 0);
  const o = await runOrchestration({ root: d, request: 'x', mode: 'autopilot', runStep: failOnPlan, confirm: approve }, () => {});
  assert.strictEqual(o.status, 'failed');
  const plan = o.steps.find((s) => s.name === 'Plan');
  assert.strictEqual(plan.status, 'failed');
  assert.ok(o.steps.slice(o.steps.indexOf(plan) + 1).every((s) => s.status === 'pending'));
});

test('resume continues from the persisted currentStep', async () => {
  const d = project();
  // first run fails on Plan (index 3)
  await runOrchestration({ root: d, request: 'x', mode: 'autopilot', runStep: ({ step }) => Promise.resolve(step.name === 'Plan' ? 1 : 0), confirm: approve }, () => {});
  // resume with a runStep that now succeeds; it must NOT re-run the done steps before Plan
  const ran = [];
  await runOrchestration({ root: d, resume: true, runStep: ({ step }) => { ran.push(step.name); return Promise.resolve(0); }, confirm: approve }, () => {});
  assert.ok(!ran.includes('Brainstorm'), 'done steps are not re-run');
  assert.strictEqual(ran[0], 'Plan', 'resumes at the failed step');
  assert.strictEqual(store.readRuntime(d).orchestration.status, 'done');
});
