'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { stats, STATUSES } = require('../templates/dashboard/public/stats');

const project = {
  plans: [{
    file: 'login.md',
    phases: [
      { title: 'Phase 1', tasks: [
        { id: 'T-001', title: 'a', status: 'done' },
        { id: 'T-002', title: 'b', status: 'in_progress' },
        { id: 'T-003', title: 'c', status: 'to_validate' } ] },
      { title: 'Phase 2', tasks: [
        { id: 'T-004', title: 'd', status: 'to_analyze' },
        { id: 'T-005', title: 'e', status: 'done' } ] },
    ],
  }],
  runtime: { agents: [{ tool: 'claude', status: 'running' }, { tool: 'codex', status: 'done' }],
             orchestration: { status: 'running', currentStep: 1 } },
};

test('stats aggregates totals, pct and byStatus', () => {
  const s = stats(project);
  assert.strictEqual(s.total, 5);
  assert.strictEqual(s.done, 2);
  assert.strictEqual(s.pct, 40);
  assert.strictEqual(s.byStatus.to_validate, 1);
  assert.strictEqual(s.byStatus.done, 2);
  assert.deepStrictEqual(STATUSES, ['todo','in_progress','to_validate','to_analyze','done','blocked']);
});
test('stats computes per-phase progress', () => {
  const s = stats(project);
  assert.strictEqual(s.phases.length, 2);
  assert.deepStrictEqual(s.phases[0], { title: 'Phase 1', file: 'login.md', done: 1, total: 3, pct: 33 });
  assert.strictEqual(s.phases[1].pct, 50);
});
test('stats lists to_validate + to_analyze under toAsk', () => {
  const s = stats(project);
  assert.deepStrictEqual(s.toAsk.map((t) => t.id).sort(), ['T-003', 'T-004']);
});
test('stats reports running agents + last run + orchestration', () => {
  const s = stats(project);
  assert.strictEqual(s.running.agents, 1);
  assert.deepStrictEqual(s.running.lastRun, { tool: 'codex', status: 'done' });
  assert.strictEqual(s.running.orchestration.status, 'running');
});
test('stats is safe on an empty project', () => {
  const s = stats({});
  assert.strictEqual(s.total, 0); assert.strictEqual(s.pct, 0);
  assert.deepStrictEqual(s.toAsk, []); assert.strictEqual(s.running.agents, 0);
});
