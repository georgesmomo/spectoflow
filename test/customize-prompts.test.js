'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildCustomizePrompt } = require('../lib/customize-prompts');

test('builds the "add" prompt for each kind from a description', () => {
  assert.strictEqual(
    buildCustomizePrompt('dashboard', { description: 'a KPI overview for support tickets' }),
    'Add a custom dashboard: a KPI overview for support tickets'
  );
  assert.strictEqual(
    buildCustomizePrompt('skill', { description: 'reviews PRs for accessibility' }),
    'Create a new skill: reviews PRs for accessibility'
  );
  assert.strictEqual(
    buildCustomizePrompt('agent', { description: 'owns accessibility review' }),
    'Create a new agent: owns accessibility review'
  );
});

test('builds the "auto" prompt for each kind when auto:true, ignoring any description', () => {
  assert.strictEqual(
    buildCustomizePrompt('dashboard', { auto: true, description: 'ignored' }),
    'Propose dashboard candidates for this project (Auto customize)'
  );
  assert.strictEqual(
    buildCustomizePrompt('skill', { auto: true }),
    'Propose skill candidates for this project (Auto customize)'
  );
  assert.strictEqual(
    buildCustomizePrompt('agent', { auto: true }),
    'Propose agent candidates for this project (Auto customize)'
  );
});

test('trims whitespace-only descriptions and requires one unless auto is set', () => {
  assert.throws(() => buildCustomizePrompt('skill', {}), /description is required/);
  assert.throws(() => buildCustomizePrompt('skill', { description: '   ' }), /description is required/);
});

test('rejects an unknown kind', () => {
  assert.throws(() => buildCustomizePrompt('widget', { auto: true }), /Unknown customize kind/);
});

test('stays in sync with the dashboard UI\'s CZ_KINDS literals (app.js can\'t require this module)', () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'dashboard', 'public', 'app.js'),
    'utf8'
  );
  for (const kind of ['dashboard', 'skill', 'agent']) {
    const addPrefix = kind === 'dashboard' ? 'Add a custom dashboard: '
      : kind === 'skill' ? 'Create a new skill: '
      : 'Create a new agent: ';
    assert.ok(appJs.includes(`'${addPrefix}'`), `app.js should still contain the literal "${addPrefix}"`);
    const autoStr = `Propose ${kind} candidates for this project (Auto customize)`;
    assert.ok(appJs.includes(autoStr), `app.js should still contain the literal "${autoStr}"`);
  }
});
