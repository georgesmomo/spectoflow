'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const adapters = require('../lib/adapters');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stf-adapt-'));

test('generate writes the gemini entry file (GEMINI.md)', () => {
  const proj = tmp();
  const written = adapters.generate(proj, ['gemini']);
  assert.ok(written.includes('GEMINI.md'));
  assert.ok(fs.existsSync(path.join(proj, 'GEMINI.md')));
  assert.match(fs.readFileSync(path.join(proj, 'GEMINI.md'), 'utf8'), /\.spectoflow\/AGENTS\.md/);
});

test('generate writes the shared AGENTS.md once for codex + cursor', () => {
  const proj = tmp();
  const written = adapters.generate(proj, ['codex', 'cursor']);
  assert.deepStrictEqual(written, ['AGENTS.md'], 'shared file written a single time');
});

test('generate writes claude shims: CLAUDE.md and the slash command', () => {
  const proj = tmp();
  const written = adapters.generate(proj, ['claude']);
  assert.ok(written.includes('CLAUDE.md'));
  assert.ok(written.includes('.claude/commands/spectoflow.md'));
});

test('defaultRunners returns a runner command per known agent', () => {
  const runners = adapters.defaultRunners(['claude', 'gemini']);
  assert.ok(runners.claude && runners.claude.startsWith('claude'));
  assert.ok(runners.gemini && runners.gemini.startsWith('gemini'));
  assert.ok(!('unknown-agent' in adapters.defaultRunners(['unknown-agent'])));
});
