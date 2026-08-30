'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../templates/lib/store');
const { reconcileOnBoot } = require('../templates/dashboard/orchestrator');

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-reconcile-'));
  fs.mkdirSync(path.join(d, '.spectoflow'), { recursive: true });
  return d;
}

test('reconcileOnBoot fails a stale awaiting_approval orchestration and its in-flight step', () => {
  const d = project();
  store.writeRuntime(d, {
    orchestration: {
      id: 'o1', status: 'awaiting_approval', currentStep: 1,
      steps: [
        { name: 'A', status: 'done' },
        { name: 'B', status: 'awaiting_approval' },
      ],
    },
  });

  const changed = reconcileOnBoot(d);
  assert.strictEqual(changed, true);

  const rt = store.readRuntime(d);
  assert.strictEqual(rt.orchestration.status, 'failed');
  assert.strictEqual(rt.orchestration.steps[1].status, 'failed');
  assert.strictEqual(rt.orchestration.steps[0].status, 'done');
});

test('reconcileOnBoot leaves a terminal orchestration untouched', () => {
  const d = project();
  store.writeRuntime(d, {
    orchestration: { id: 'o2', status: 'done', steps: [{ name: 'A', status: 'done' }] },
  });

  const changed = reconcileOnBoot(d);
  assert.strictEqual(changed, false);

  const rt = store.readRuntime(d);
  assert.strictEqual(rt.orchestration.status, 'done');
});

test('reconcileOnBoot is a no-op and does not throw when there is no orchestration', () => {
  const d = project();
  store.writeRuntime(d, {});

  assert.doesNotThrow(() => {
    const changed = reconcileOnBoot(d);
    assert.strictEqual(changed, false);
  });
});
