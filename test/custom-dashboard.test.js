'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { validateSpec, BLOCK_TYPES, BIND_ROOTS, ICON_KEYS } = require('../templates/lib/custom-dashboard');

test('accepts a well-formed spec with a markdown block', () => {
  const r = validateSpec({ id: 'architecture', title: 'Architecture', blocks: [{ type: 'markdown', content: 'hello' }] });
  assert.strictEqual(r.valid, true);
  assert.deepStrictEqual(r.errors, []);
});

test('accepts a live-bound kpi-row block whose bind path starts from an allowed root', () => {
  const r = validateSpec({ id: 'progress', title: 'Progress', blocks: [{ type: 'kpi-row', items: [{ label: 'Done', bind: 'byStatus.done' }] }] });
  assert.strictEqual(r.valid, true);
});

test('accepts every real root SpectoStats.stats(P) exposes', () => {
  for (const root of ['pct', 'done', 'total', 'byStatus', 'phases', 'toAsk', 'running', 'statuses']) {
    assert.ok(BIND_ROOTS.has(root), `BIND_ROOTS is missing "${root}"`);
  }
});

test('rejects a bind path with a root outside the allow-list', () => {
  const r = validateSpec({ id: 'x', title: 'X', blocks: [{ type: 'kpi-row', items: [{ label: 'Y', bind: 'runtime.secret' }] }] });
  assert.strictEqual(r.valid, false);
  assert.match(r.errors.join(' '), /unbound bind path/);
});

test('rejects an unknown block type', () => {
  const r = validateSpec({ id: 'x', title: 'X', blocks: [{ type: 'iframe', src: 'evil.example' }] });
  assert.strictEqual(r.valid, false);
  assert.match(r.errors.join(' '), /not a known block type/);
});

test('rejects a missing/invalid id', () => {
  assert.strictEqual(validateSpec({ title: 'X', blocks: [{ type: 'list', items: ['a'] }] }).valid, false);
  assert.strictEqual(validateSpec({ id: 'Not-Kebab!', title: 'X', blocks: [{ type: 'list', items: ['a'] }] }).valid, false);
});

test('rejects a missing title', () => {
  const r = validateSpec({ id: 'x', blocks: [{ type: 'list', items: ['a'] }] });
  assert.strictEqual(r.valid, false);
  assert.match(r.errors.join(' '), /title is required/);
});

test('rejects an empty or missing blocks array', () => {
  assert.strictEqual(validateSpec({ id: 'x', title: 'X', blocks: [] }).valid, false);
  assert.strictEqual(validateSpec({ id: 'x', title: 'X' }).valid, false);
});

test('rejects an icon outside the curated set', () => {
  const r = validateSpec({ id: 'x', title: 'X', icon: 'rocket-emoji', blocks: [{ type: 'list', items: ['a'] }] });
  assert.strictEqual(r.valid, false);
  assert.match(r.errors.join(' '), /icon/);
});

test('accepts an icon from the curated set', () => {
  const r = validateSpec({ id: 'x', title: 'X', icon: 'workflow', blocks: [{ type: 'list', items: ['a'] }] });
  assert.strictEqual(r.valid, true);
});

test('never throws on garbage input', () => {
  for (const bad of [null, undefined, 42, 'a string', [], () => {}]) {
    assert.doesNotThrow(() => validateSpec(bad));
    assert.strictEqual(validateSpec(bad).valid, false);
  }
});

test('exports a non-empty block type and bind-root vocabulary', () => {
  assert.ok(BLOCK_TYPES.size > 0);
  assert.ok(BIND_ROOTS.size > 0);
  assert.ok(ICON_KEYS.size > 0);
});
