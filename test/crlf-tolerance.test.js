'use strict';
// The storage parsers must tolerate CRLF line endings — a Windows checkout (git autocrlf) or a
// CRLF editor produces \r\n, and `init` copies templates byte-for-byte into a project's .spectoflow.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../lib/store');

function crlfProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-crlf-'));
  const sf = path.join(d, '.spectoflow');
  fs.mkdirSync(path.join(sf, 'agents'), { recursive: true });
  const agent = ['---', 'name: business-analyst', 'title: Business Analyst',
    'capability: analysis', 'uses: [analyze-requirements]', 'description: x', '---', '# Business Analyst', ''].join('\r\n');
  fs.writeFileSync(path.join(sf, 'agents', 'business-analyst.md'), agent);
  fs.writeFileSync(path.join(sf, 'workflow.md'),
    ['# Active workflow', '', '- [x] Spec {cap:analysis skill:write-spec}', ''].join('\r\n'));
  return d;
}

test('readAgents parses front-matter capability from a CRLF file', () => {
  const d = crlfProject();
  const ba = store.readAgents(d).find((a) => a.name === 'business-analyst');
  assert.ok(ba, 'agent found');
  assert.strictEqual(ba.capability, 'analysis');
});

test('readWorkflow parses cap/skill annotations from a CRLF file', () => {
  const d = crlfProject();
  const step = store.readWorkflow(d).find((s) => s.name === 'Spec');
  assert.ok(step, 'step found');
  assert.strictEqual(step.cap, 'analysis');
  assert.strictEqual(step.skill, 'write-spec');
});
