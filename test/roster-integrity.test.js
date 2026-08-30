// test/roster-integrity.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TPL = path.resolve(__dirname, '..', 'templates');
// Read the kit templates directly (they ARE an installed project's .spectoflow layout).
function agents() {
  return fs.readdirSync(path.join(TPL, 'agents')).filter(f => f.endsWith('.md')).map(f => {
    const text = fs.readFileSync(path.join(TPL, 'agents', f), 'utf8');
    const g = (k) => (text.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1];
    const uses = (g('uses') || '[]').replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
    return { file: f, capability: g('capability'), uses };
  });
}
const skillExists = (slug) => fs.existsSync(path.join(TPL, 'skills', slug, 'SKILL.md'));
function palette() {
  const m = fs.readFileSync(path.join(TPL, 'capabilities.md'), 'utf8').match(/Palette:\s*(.+)/);
  return m ? m[1].split('·').map(s => s.replace(/[^a-z]/gi, '').trim()).filter(Boolean) : [];
}
function workflowSteps() {
  const steps = [];
  fs.readFileSync(path.join(TPL, 'workflow.md'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*- \[[ xX]\]\s+(.*?)\s*$/); if (!m) return;
    const ann = m[1].match(/\{([^}]*)\}/);
    steps.push({
      cap: (ann && (ann[1].match(/cap:(\S+)/) || [])[1]) || null,
      skill: (ann && (ann[1].match(/skill:(\S+)/) || [])[1]) || null,
    });
  });
  return steps;
}

test('every agent capability is in the capabilities palette', () => {
  const pal = palette();
  for (const a of agents()) if (a.capability) assert.ok(pal.includes(a.capability), `${a.file}: capability "${a.capability}" not in palette [${pal}]`);
});
test('every skill an agent uses exists on disk', () => {
  for (const a of agents()) for (const u of a.uses) assert.ok(skillExists(u), `${a.file}: uses missing skill "${u}"`);
});
test('every workflow step resolves to an existing agent + skill', () => {
  const ag = agents();
  for (const s of workflowSteps()) {
    if (!s.cap) continue; // un-annotated legacy line
    assert.ok(ag.some(a => a.capability === s.cap), `workflow step cap "${s.cap}" has no agent`);
    if (s.skill) assert.ok(skillExists(s.skill), `workflow step skill "${s.skill}" missing`);
  }
});
test('no capability is shared by two agents without a priority tie-break', () => {
  const byCap = {};
  for (const a of agents()) if (a.capability) (byCap[a.capability] = byCap[a.capability] || []).push(a.file);
  for (const [cap, files] of Object.entries(byCap)) if (files.length > 1)
    for (const f of files)
      assert.match(fs.readFileSync(path.join(TPL, 'agents', f), 'utf8'), /^priority:\s*\d+/m,
        `capability "${cap}" shared by ${files} but ${f} has no priority`);
});
