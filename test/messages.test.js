'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../lib/store');

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-msg-'));
  fs.mkdirSync(path.join(d, '.spectoflow'));
  return d;
}

test('parseAgentLine parses a spectoflow sentinel into role/kind/text', () => {
  const m = store.parseAgentLine('::spectoflow role=developer kind=status msg=finished T-023');
  assert.deepStrictEqual(m, { role: 'developer', kind: 'status', text: 'finished T-023' });
});

test('parseAgentLine defaults kind to message and role to agent when absent', () => {
  assert.deepStrictEqual(store.parseAgentLine('::spectoflow msg=hello there'),
    { role: 'agent', kind: 'message', text: 'hello there' });
});

test('parseAgentLine returns null for an ordinary output line', () => {
  assert.strictEqual(store.parseAgentLine('just some build output'), null);
});

test('appendMessage stamps id + at and persists to runtime.messages', () => {
  const d = project();
  const a = store.appendMessage(d, { role: 'user', text: 'add login' });
  assert.ok(a.id && a.at, 'stamped id + at');
  assert.strictEqual(a.role, 'user');
  assert.strictEqual(a.kind, 'message', 'kind defaults to message');
  store.appendMessage(d, { role: 'developer', kind: 'status', text: 'done' });
  const rt = store.readRuntime(d);
  assert.strictEqual(rt.messages.length, 2);
  assert.strictEqual(rt.messages[1].kind, 'status');
});
