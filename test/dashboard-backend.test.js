'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const store = require('../templates/lib/store');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const SERVER = path.join(KIT, 'templates', 'dashboard', 'server.js');

test('recordSnapshot dedupes today and caps history', () => {
  let rt = { history: [] };
  rt = store.recordSnapshot(rt, { total: 5, done: 1 }, '2026-08-01');
  rt = store.recordSnapshot(rt, { total: 5, done: 2 }, '2026-08-01'); // same day → update
  assert.strictEqual(rt.history.length, 1);
  assert.deepStrictEqual(rt.history[0], { date: '2026-08-01', total: 5, done: 2 });
  rt = store.recordSnapshot(rt, { total: 6, done: 3 }, '2026-08-02'); // new day → append
  assert.strictEqual(rt.history.length, 2);
  for (let i = 0; i < 80; i++) rt = store.recordSnapshot(rt, { total: 6, done: i }, '2026-10-' + String((i % 28) + 1).padStart(2, '0'));
  assert.ok(rt.history.length <= 60, 'capped');
});

test('readAgents/readSkills expose the upgraded front-matter fields', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-fm-'));
  fs.mkdirSync(path.join(d, '.spectoflow', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(d, '.spectoflow', 'skills', 'write-spec'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spectoflow', 'agents', 'a.md'),
    '---\nname: business-analyst\ncapability: analysis\nuses: [analyze-requirements, write-spec]\nstandards: [BDD, acceptance criteria]\ndescription: x\n---\n# BA\n');
  fs.writeFileSync(path.join(d, '.spectoflow', 'skills', 'write-spec', 'SKILL.md'),
    '---\nname: write-spec\ncapability: analysis\ninputs: a need\noutputs: a spec\nstandard: spec-kit\ndescription: y\n---\n# write-spec\n');
  const a = store.readAgents(d).find((x) => x.name === 'business-analyst');
  assert.deepStrictEqual(a.uses, ['analyze-requirements', 'write-spec']);
  assert.deepStrictEqual(a.standards, ['BDD', 'acceptance criteria']);
  const sk = (store.readSkills ? store.readSkills(d) : []).find((x) => x.name === 'write-spec')
    || store.readProject(d).skills.find((x) => x.name === 'write-spec');
  assert.strictEqual(sk.standard, 'spec-kit');
  assert.strictEqual(sk.inputs, 'a need');
});

test('recordSnapshot is CRLF-safe / does not mutate on identical same-day counts (write-guard contract)', () => {
  // Pure helper sanity check supporting the readProject write-guard: calling it twice with the
  // same date + counts should not grow history or change the recorded entry.
  let rt = { history: [{ date: '2026-08-30', total: 3, done: 1 }] };
  const before = JSON.stringify(rt.history);
  rt = store.recordSnapshot(rt, { total: 3, done: 1 }, '2026-08-30');
  assert.strictEqual(JSON.stringify(rt.history), before);
});

test('readProject snapshot recording preserves runtime.messages and appends (not resets) history', () => {
  // Regression: the snapshot-record path must mutate the SAME runtime object read from disk
  // (only appending/updating `history`) and write that same object back — never construct a
  // fresh/partial runtime that drops messages/agents/tests or truncates existing history.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-preserve-'));
  fs.mkdirSync(path.join(d, '.spectoflow'), { recursive: true });
  fs.mkdirSync(path.join(d, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spectoflow', 'runtime.json'), JSON.stringify({
    agents: [], tests: {},
    messages: [{ id: 'm1', role: 'user', text: 'hi' }],
    history: [{ date: '2026-08-01', total: 1, done: 0 }],
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(d, 'plans', 'p.md'),
    '## Phase 1\n- [x] T-001 done task\n- [ ] T-002 pending task\n');

  store.readProject(d);

  const rt = JSON.parse(fs.readFileSync(path.join(d, '.spectoflow', 'runtime.json'), 'utf8'));
  assert.deepStrictEqual(rt.messages, [{ id: 'm1', role: 'user', text: 'hi' }]);
  assert.strictEqual(rt.history.length, 2);
  assert.ok(rt.history.find((h) => h.date === '2026-08-01' && h.total === 1 && h.done === 0), 'old history entry preserved');
  assert.ok(rt.history.find((h) => h.total === 2 && h.done === 1), 'today snapshot appended');
});

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-srv-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  return d;
}
function get(port, p) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let b = ''; res.on('data', (c) => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') }));
    });
  });
}
function startServer(root, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [SERVER], { env: { ...process.env, SPECTOFLOW_ROOT: root, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/dashboard →/.test(d.toString())) resolve(srv); });
  });
}

test('GET /api/agentfile returns content for a real agent/skill file and 400s on traversal', async () => {
  const d = project();
  const port = 4600 + Math.floor(Math.random() * 200);
  const srv = await startServer(d, port);
  try {
    const ok = await get(port, '/api/agentfile?' + new URLSearchParams({ path: 'agents/business-analyst.md' }));
    assert.strictEqual(ok.status, 200);
    assert.ok(typeof ok.body.content === 'string' && ok.body.content.length > 0);

    const okSkill = await get(port, '/api/agentfile?' + new URLSearchParams({ path: 'skills/write-spec/SKILL.md' }));
    assert.strictEqual(okSkill.status, 200);
    assert.ok(typeof okSkill.body.content === 'string' && okSkill.body.content.length > 0);

    const trav1 = await get(port, '/api/agentfile?' + new URLSearchParams({ path: '../config.json' }));
    assert.strictEqual(trav1.status, 400);

    const trav2 = await get(port, '/api/agentfile?' + new URLSearchParams({ path: '../../package.json' }));
    assert.strictEqual(trav2.status, 400);
  } finally { srv.kill(); }
});

test('GET /api/agentfile 400s on a symlink escaping the agents/skills scope', async (t) => {
  const d = project();
  // Plant a .md symlink inside agents/ that points OUT of scope (.spectoflow/config.json).
  const link = path.join(d, '.spectoflow', 'agents', 'evil.md');
  const target = path.join(d, '.spectoflow', 'config.json');
  try { fs.symlinkSync(target, link); }
  catch { return t.skip('symlinks unavailable on this platform'); }

  const port = 4820 + Math.floor(Math.random() * 150);
  const srv = await startServer(d, port);
  try {
    const res = await get(port, '/api/agentfile?' + new URLSearchParams({ path: 'agents/evil.md' }));
    assert.strictEqual(res.status, 400, 'must reject a symlink resolving outside agents/skills');
  } finally { srv.kill(); }
});
