'use strict';
// Configurable / auto-detected plans+specs directory: a project that keeps its plans in `plan/`
// (singular) instead of `plans/` should still be found — see CLAUDE.md feature 1.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('../templates/lib/store');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-dirs-'));
}

test('resolvePlansDir defaults to "plans" when nothing exists on disk', () => {
  const d = project();
  assert.strictEqual(store.resolvePlansDir(d, {}), 'plans');
});

test('resolvePlansDir falls back to the singular "plan" folder when only that exists', () => {
  const d = project();
  fs.mkdirSync(path.join(d, 'plan'));
  assert.strictEqual(store.resolvePlansDir(d, {}), 'plan');
});

test('resolvePlansDir prefers "plans" over "plan" when both exist', () => {
  const d = project();
  fs.mkdirSync(path.join(d, 'plan'));
  fs.mkdirSync(path.join(d, 'plans'));
  assert.strictEqual(store.resolvePlansDir(d, {}), 'plans');
});

test('resolvePlansDir honors an explicit config.plansDir override that exists', () => {
  const d = project();
  fs.mkdirSync(path.join(d, 'plan'));
  fs.mkdirSync(path.join(d, 'my-tasks'));
  assert.strictEqual(store.resolvePlansDir(d, { plansDir: 'my-tasks' }), 'my-tasks');
});

test('resolvePlansDir ignores a config.plansDir override that does not exist on disk', () => {
  const d = project();
  fs.mkdirSync(path.join(d, 'plan'));
  assert.strictEqual(store.resolvePlansDir(d, { plansDir: 'nope' }), 'plan');
});

test('resolveSpecsDir mirrors resolvePlansDir: override > singular fallback > default', () => {
  const d = project();
  assert.strictEqual(store.resolveSpecsDir(d, {}), 'specs');
  fs.mkdirSync(path.join(d, 'spec'));
  assert.strictEqual(store.resolveSpecsDir(d, {}), 'spec');
  fs.mkdirSync(path.join(d, 'my-specs'));
  assert.strictEqual(store.resolveSpecsDir(d, { specsDir: 'my-specs' }), 'my-specs');
});

test('readPlans reads from the singular "plan" folder when "plans" does not exist', () => {
  const d = project();
  fs.mkdirSync(path.join(d, '.spectoflow'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spectoflow', 'config.json'), JSON.stringify({ mode: 'semi' }));
  fs.mkdirSync(path.join(d, 'plan'));
  fs.writeFileSync(path.join(d, 'plan', 'a.md'), ['## Phase', '- [ ] T-001 Do the thing'].join('\n'));
  const plans = store.readPlans(d);
  assert.strictEqual(plans.length, 1);
  assert.strictEqual(plans[0].phases[0].tasks[0].id, 'T-001');
});

test('readSpecs reads from the singular "spec" folder when "specs" does not exist', () => {
  const d = project();
  fs.mkdirSync(path.join(d, '.spectoflow'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spectoflow', 'config.json'), JSON.stringify({ mode: 'semi' }));
  fs.mkdirSync(path.join(d, 'spec'));
  fs.writeFileSync(path.join(d, 'spec', 'overview.md'), '# Overview');
  assert.deepStrictEqual(store.readSpecs(d), ['overview.md']);
});

test('readPlans honors an explicit plansDir override in config.json', () => {
  const d = project();
  fs.mkdirSync(path.join(d, '.spectoflow'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spectoflow', 'config.json'), JSON.stringify({ plansDir: 'tasks' }));
  fs.mkdirSync(path.join(d, 'tasks'));
  fs.writeFileSync(path.join(d, 'tasks', 'a.md'), ['## Phase', '- [ ] T-001 Do the thing'].join('\n'));
  const plans = store.readPlans(d);
  assert.strictEqual(plans.length, 1);
  assert.strictEqual(plans[0].file, 'a.md');
});

test('init on a project that already has a singular "plan/" folder reuses it instead of forcing "plans/"', () => {
  const d = project();
  fs.mkdirSync(path.join(d, 'plan'));
  fs.writeFileSync(path.join(d, 'plan', 'a.md'), ['## Phase', '- [ ] Do the thing'].join('\n'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  assert.ok(!fs.existsSync(path.join(d, 'plans')), 'no plans/ folder forced into existence');
  assert.ok(fs.existsSync(path.join(d, 'plan')), 'plan/ folder kept');
  // normalizePlans should have stamped a stable id onto the task living in plan/a.md
  const text = fs.readFileSync(path.join(d, 'plan', 'a.md'), 'utf8');
  assert.match(text, /- \[ \] T-\d{3} Do the thing/);
});
