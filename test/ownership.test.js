'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ownership = require('../lib/ownership');

const TEMPLATES = path.resolve(__dirname, '..', 'templates');

test('listFrameworkFiles includes the brain, agents and skills, but not the dashboard (D64)', () => {
  const files = ownership.listFrameworkFiles(TEMPLATES);
  assert.ok(files.includes('lib/spec-drift.js'), 'the in-project drift tool');
  assert.ok(files.includes('package.json'), 'the type:commonjs pin (D62)');
  assert.ok(!files.some((f) => f.startsWith('dashboard/')), 'the dashboard no longer ships into projects (D64)');
  assert.ok(!files.includes('lib/store.js'), 'the storage engine lives in the package now');
  assert.ok(files.includes('AGENTS.md'), 'brain');
  assert.ok(files.includes('capabilities.md'), 'capabilities');
  assert.ok(files.includes('policy.md'), 'policy');
  assert.ok(files.some((f) => f.startsWith('agents/')), 'default agents');
  assert.ok(files.some((f) => f.startsWith('skills/')), 'default skills');
});

test('listFrameworkFiles excludes user-owned config.json and workflow.md', () => {
  const files = ownership.listFrameworkFiles(TEMPLATES);
  assert.ok(!files.includes('config.json'), 'config.json is user-owned');
  assert.ok(!files.includes('workflow.md'), 'workflow.md is user-owned');
});

test('listFrameworkFiles returns relative POSIX paths, sorted, no duplicates', () => {
  const files = ownership.listFrameworkFiles(TEMPLATES);
  assert.deepStrictEqual(files, [...new Set(files)], 'no duplicates');
  assert.deepStrictEqual(files, [...files].sort(), 'sorted');
  assert.ok(files.every((f) => !f.includes('\\') && !path.isAbsolute(f)), 'relative posix');
});
