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

function reqJSON(port, method, p, bodyObj) {
  return new Promise((resolve) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); });
    if (data) r.write(data); r.end();
  });
}

test('POST /api/settings changes autonomy mode + language in config.json', async () => {
  const d = project();
  const port = 4970 + Math.floor(Math.random() * 100);
  const srv = await startServer(d, port);
  try {
    const res = await reqJSON(port, 'POST', '/api/settings', { mode: 'manual', language: 'fr' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.config.mode, 'manual');
    assert.strictEqual(res.body.config.language, 'fr');
    const proj = await get(port, '/api/project');
    assert.strictEqual(proj.body.config.mode, 'manual');
    assert.strictEqual(proj.body.config.language, 'fr');
    // an invalid mode is ignored, not applied
    const res2 = await reqJSON(port, 'POST', '/api/settings', { mode: 'bogus' });
    assert.strictEqual(res2.body.config.mode, 'manual');
  } finally { srv.kill(); }
});

test('attention points: add, edit, resolve, promote → task, delete', async () => {
  const d = project();
  const port = 4640 + Math.floor(Math.random() * 100);
  const srv = await startServer(d, port);
  try {
    // add
    const add = await reqJSON(port, 'POST', '/api/attention', { text: 'watch the token refresh path' });
    assert.strictEqual(add.status, 200);
    const id = add.body.item.id;
    assert.strictEqual(add.body.item.source, 'user');
    assert.strictEqual(add.body.item.status, 'open');
    // empty note rejected
    const bad = await reqJSON(port, 'POST', '/api/attention', { text: '   ' });
    assert.strictEqual(bad.status, 400);
    // edit
    const patch = await reqJSON(port, 'PATCH', '/api/attention/' + id, { text: 'watch token refresh + expiry' });
    assert.strictEqual(patch.body.item.text, 'watch token refresh + expiry');
    // promote → creates a task in a plan file and resolves the note
    const prom = await reqJSON(port, 'POST', '/api/attention/' + id + '/promote', {});
    assert.strictEqual(prom.status, 200);
    assert.match(prom.body.task.id, /^T-\d+$/);
    // task.file is a basename (matches readPlans' convention) — resolve it under the project's plans dir
    const planText = fs.readFileSync(path.join(d, 'plans', prom.body.task.file), 'utf8');
    assert.ok(planText.includes(prom.body.task.id), 'plan file got the promoted task');
    const proj = await get(port, '/api/project');
    const it = (proj.body.runtime.attention || []).find((x) => x.id === id);
    assert.strictEqual(it.status, 'resolved');
    assert.strictEqual(it.promotedTo, prom.body.task.id);
    // delete
    const del = await reqJSON(port, 'DELETE', '/api/attention/' + id, null);
    assert.strictEqual(del.status, 200);
    const proj2 = await get(port, '/api/project');
    assert.ok(!(proj2.body.runtime.attention || []).some((x) => x.id === id), 'note removed');
  } finally { srv.kill(); }
});

test('POST /api/task creates a manual task without any agent involved', async () => {
  const d = project();
  const port = 4760 + Math.floor(Math.random() * 100);
  const srv = await startServer(d, port);
  try {
    // empty title rejected
    const bad = await reqJSON(port, 'POST', '/api/task', { title: '  ' });
    assert.strictEqual(bad.status, 400);

    // a fresh project has no plans yet — creates plans/inbox.md under a default "Backlog" phase
    const first = await reqJSON(port, 'POST', '/api/task', { title: 'Wire up the billing webhook' });
    assert.strictEqual(first.status, 200);
    assert.match(first.body.task.id, /^T-\d+$/);
    assert.strictEqual(first.body.task.file, 'inbox.md');
    const text1 = fs.readFileSync(path.join(d, 'plans', 'inbox.md'), 'utf8');
    assert.match(text1, /^## Backlog$/m);
    assert.ok(text1.includes(`${first.body.task.id} Wire up the billing webhook`));

    // a second task with an explicit phase/owner/level, and ids keep incrementing
    const second = await reqJSON(port, 'POST', '/api/task', { title: 'Add rate limiting', phase: 'Hardening', owner: 'georges', level: 'major' });
    assert.strictEqual(second.status, 200);
    assert.notStrictEqual(second.body.task.id, first.body.task.id);
    const text2 = fs.readFileSync(path.join(d, 'plans', 'inbox.md'), 'utf8');
    assert.match(text2, /^## Hardening$/m);
    assert.ok(text2.includes(`${second.body.task.id} Add rate limiting @georges ~major`));

    // shows up in the project snapshot like any other task
    const proj = await get(port, '/api/project');
    const ids = (proj.body.plans || []).flatMap((pl) => pl.phases.flatMap((ph) => ph.tasks.map((t) => t.id)));
    assert.ok(ids.includes(first.body.task.id) && ids.includes(second.body.task.id));
  } finally { srv.kill(); }
});

test('File Explorer API: tree, read, write, mkdir, and path-traversal / .git guards', async () => {
  const d = project();
  const port = 4800 + Math.floor(Math.random() * 100);
  const srv = await startServer(d, port);
  try {
    // tree includes real project files, not the framework's own .git-style noise
    const t = await get(port, '/api/files/tree');
    assert.strictEqual(t.status, 200);
    assert.ok(Array.isArray(t.body.tree));
    assert.ok(t.body.tree.some((e) => e.name === '.spectoflow' && e.type === 'dir'));

    // write creates a new file (nested dirs included), read gets it back
    const w = await reqJSON(port, 'POST', '/api/files/write', { path: 'notes/todo.md', content: '- [ ] one\n' });
    assert.strictEqual(w.status, 200);
    const r = await get(port, '/api/files/read?' + new URLSearchParams({ path: 'notes/todo.md' }));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.content, '- [ ] one\n');

    // mkdir creates an empty folder
    const m = await reqJSON(port, 'POST', '/api/files/mkdir', { path: 'empty-folder' });
    assert.strictEqual(m.status, 200);
    assert.ok(fs.statSync(path.join(d, 'empty-folder')).isDirectory());

    // path traversal is rejected, nothing written outside the project
    const bad = await reqJSON(port, 'POST', '/api/files/write', { path: '../escape.txt', content: 'x' });
    assert.strictEqual(bad.status, 400);
    assert.ok(!fs.existsSync(path.join(path.dirname(d), 'escape.txt')));

    // .git is off-limits for writes
    fs.mkdirSync(path.join(d, '.git'));
    const gitWrite = await reqJSON(port, 'POST', '/api/files/write', { path: '.git/config', content: 'x' });
    assert.strictEqual(gitWrite.status, 400);
    assert.ok(!fs.existsSync(path.join(d, '.git', 'config')));
  } finally { srv.kill(); }
});

test('SPA fallback: an extensionless route serves index.html', async () => {
  const d = project();
  const port = 4740 + Math.floor(Math.random() * 100);
  const srv = await startServer(d, port);
  try {
    const html = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/backlog' }, (res) => {
        let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
    });
    assert.strictEqual(html.status, 200);
    assert.ok(/<title>spectoflow/.test(html.body), 'serves the SPA shell for a client route');
  } finally { srv.kill(); }
});

// Regression: /api/workflow/toggle stripped "(optional)" from the END of the line before checking
// for a trailing {cap:... skill:...} annotation (added later, D29) -- since every step in the
// DEFAULT workflow.md template carries one of these annotations, toggling was broken for every
// single step of every single project, not just an edge case. No test ever exercised this endpoint
// before this was found by hand-testing the hub against a real project.
test('POST /api/workflow/toggle enables a step whose line has a trailing {cap:...} annotation', async () => {
  const d = project();
  const port = 4780 + Math.floor(Math.random() * 100);
  const srv = await startServer(d, port);
  try {
    const wf = path.join(d, '.spectoflow', 'workflow.md');
    const before = fs.readFileSync(wf, 'utf8');
    assert.match(before, /- \[ \] Integration tests \(optional\) \{cap:testing skill:write-e2e-tests\}/,
      'the default template really does carry a trailing annotation on this optional step');
    const res = await reqJSON(port, 'POST', '/api/workflow/toggle', { name: 'Integration tests' });
    assert.strictEqual(res.status, 200);
    const after = fs.readFileSync(wf, 'utf8');
    assert.match(after, /- \[x\] Integration tests \(optional\) \{cap:testing skill:write-e2e-tests\}/i,
      'the step is now enabled -- the annotation must not block the (optional) strip');
  } finally { srv.kill(); }
});

test('POST /api/workflow/toggle also works on a non-optional step with a trailing annotation', async () => {
  const d = project();
  const port = 4790 + Math.floor(Math.random() * 100);
  const srv = await startServer(d, port);
  try {
    const wf = path.join(d, '.spectoflow', 'workflow.md');
    assert.match(fs.readFileSync(wf, 'utf8'), /- \[x\] Brainstorm \{cap:intake skill:brainstorm\}/);
    const res = await reqJSON(port, 'POST', '/api/workflow/toggle', { name: 'Brainstorm' });
    assert.strictEqual(res.status, 200);
    assert.match(fs.readFileSync(wf, 'utf8'), /- \[ \] Brainstorm \{cap:intake skill:brainstorm\}/,
      'toggling a step with an annotation but no "(optional)" marker must also work');
  } finally { srv.kill(); }
});
