'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../lib/dashboard/public/commands.js');

test('BUILTIN_COMMANDS ships the five defaults, all valid', () => {
  const triggers = C.BUILTIN_COMMANDS.map((c) => c.trigger);
  assert.deepStrictEqual(triggers, ['spec', 'plan', 'revue', 'resume', 'rapport_jour']);
  for (const c of C.BUILTIN_COMMANDS) {
    assert.match(c.trigger, /^[a-z0-9][a-z0-9_-]{0,39}$/);
    assert.ok(c.instruction.trim().length > 0);
    assert.strictEqual(c.enabled, true);
  }
});

test('effectiveCommands falls back to builtins when config.commands is absent or not an array', () => {
  assert.strictEqual(C.effectiveCommands({}).length, C.BUILTIN_COMMANDS.length);
  assert.strictEqual(C.effectiveCommands({ commands: 'nope' }).length, C.BUILTIN_COMMANDS.length);
  assert.notStrictEqual(C.effectiveCommands({}), C.BUILTIN_COMMANDS, 'returns a copy, not the shared array');
});

test('effectiveCommands returns the stored array as-is when present, including empty', () => {
  const mine = [{ trigger: 'x', description: '', instruction: 'do x', enabled: true }];
  assert.deepStrictEqual(C.effectiveCommands({ commands: mine }), mine);
  assert.deepStrictEqual(C.effectiveCommands({ commands: [] }), []);
});

test('validateTrigger enforces format and case-insensitive uniqueness', () => {
  assert.strictEqual(C.validateTrigger('rapport_jour', []).ok, true);
  assert.strictEqual(C.validateTrigger('has space', []).ok, false);
  assert.strictEqual(C.validateTrigger('-bad', []).ok, false);
  assert.strictEqual(C.validateTrigger('', []).ok, false);
  assert.deepStrictEqual(C.validateTrigger('Dup', ['dup']), { ok: false, error: 'duplicateTrigger' });
});

test('matchCommands prefix-filters, is case-insensitive, and excludes disabled', () => {
  const cmds = [
    { trigger: 'spec', enabled: true }, { trigger: 'plan', enabled: true },
    { trigger: 'special', enabled: false }, { trigger: 'resume', enabled: true },
  ];
  assert.deepStrictEqual(C.matchCommands('sp', cmds).map((c) => c.trigger), ['spec']);
  assert.deepStrictEqual(C.matchCommands('', cmds).map((c) => c.trigger), ['spec', 'plan', 'resume']);
  assert.deepStrictEqual(C.matchCommands('RE', cmds).map((c) => c.trigger), ['resume']);
});

test('parseInvocation extracts trigger and tail, or returns null', () => {
  assert.deepStrictEqual(C.parseInvocation('/rapport_jour focus bugs'), { trigger: 'rapport_jour', rest: 'focus bugs' });
  assert.deepStrictEqual(C.parseInvocation('/spec'), { trigger: 'spec', rest: '' });
  assert.strictEqual(C.parseInvocation('hello world'), null);
  assert.strictEqual(C.parseInvocation('/'), null);
  assert.strictEqual(C.parseInvocation('/ leading space'), null);
});

test('expandCommand substitutes {{input}} everywhere and returns the short display', () => {
  const cmds = [{ trigger: 'tr', description: '', instruction: 'Translate to EN: {{input}} (twice: {{input}})', enabled: true }];
  const r = C.expandCommand('/tr bonjour', cmds);
  assert.strictEqual(r.prompt, 'Translate to EN: bonjour (twice: bonjour)');
  assert.strictEqual(r.display, '/tr bonjour');
});

test('expandCommand appends the tail when there is no placeholder', () => {
  const cmds = [{ trigger: 'revue', description: '', instruction: 'Review the diff.', enabled: true }];
  assert.strictEqual(C.expandCommand('/revue focus perf', cmds).prompt, 'Review the diff.\n\nfocus perf');
  assert.strictEqual(C.expandCommand('/revue', cmds).prompt, 'Review the diff.');
});

test('expandCommand returns null for unknown, disabled, or empty-instruction commands', () => {
  const cmds = [
    { trigger: 'off', instruction: 'x', enabled: false },
    { trigger: 'empty', instruction: '   ', enabled: true },
  ];
  assert.strictEqual(C.expandCommand('/nope hi', cmds), null);
  assert.strictEqual(C.expandCommand('/off hi', cmds), null);
  assert.strictEqual(C.expandCommand('/empty hi', cmds), null);
  assert.strictEqual(C.expandCommand('plain text', cmds), null);
});
