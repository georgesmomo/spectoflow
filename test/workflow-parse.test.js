'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../lib/store');

function wf(lines) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-wf-'));
  fs.mkdirSync(path.join(d, '.spectoflow'));
  fs.writeFileSync(path.join(d, '.spectoflow', 'workflow.md'), lines.join('\n'));
  return d;
}

test('readWorkflow parses cap/skill/policy annotations', () => {
  const d = wf(['- [x] Spec {cap:analysis skill:write-spec}',
                '- [x] Deploy {cap:implementation skill:deploy policy}']);
  const steps = store.readWorkflow(d);
  assert.deepStrictEqual(steps[0], { name: 'Spec', enabled: true, optional: false, cap: 'analysis', skill: 'write-spec', policy: false });
  assert.strictEqual(steps[1].policy, true);
  assert.strictEqual(steps[1].skill, 'deploy');
});

test('readWorkflow stays backward compatible for un-annotated + optional lines', () => {
  const d = wf(['- [ ] Integration tests (optional)', '- [x] Review']);
  const steps = store.readWorkflow(d);
  assert.deepStrictEqual(steps[0], { name: 'Integration tests', enabled: false, optional: true, cap: null, skill: null, policy: false });
  assert.strictEqual(steps[1].name, 'Review');
});
