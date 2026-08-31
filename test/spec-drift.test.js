'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyChange, coverageSignals } = require('../templates/lib/spec-drift');

test('classifyChange flags code/tests changed with no spec or plan updated', () => {
  const sig = classifyChange(['src/app.js', 'test/app.test.js']);
  assert.strictEqual(sig.length, 1);
  assert.strictEqual(sig[0].level, 'warn');
  assert.match(sig[0].msg, /no specs\/ or plans\//);
});

test('classifyChange stays quiet when a spec or plan moves with the code', () => {
  assert.deepStrictEqual(classifyChange(['src/app.js', 'plans/core.md']), []);
  assert.deepStrictEqual(classifyChange(['src/app.js', 'specs/app.md']), []);
});

test('classifyChange flags a spec change with no code/tests following', () => {
  const sig = classifyChange(['specs/app.md']);
  assert.strictEqual(sig.length, 1);
  assert.strictEqual(sig[0].level, 'info');
  assert.match(sig[0].msg, /no code\/tests followed/);
});

test('classifyChange ignores framework-only edits', () => {
  assert.deepStrictEqual(classifyChange(['.spectoflow/runtime.json', '.spectoflow/config.json']), []);
});

test('coverageSignals warns on plans-without-specs and informs on specs-without-plans', () => {
  const a = coverageSignals({ specs: [], plans: ['core.md'] });
  assert.strictEqual(a[0].level, 'warn');
  const b = coverageSignals({ specs: ['app.md'], plans: [] });
  assert.strictEqual(b[0].level, 'info');
  assert.deepStrictEqual(coverageSignals({ specs: ['a.md'], plans: ['b.md'] }), []);
});
