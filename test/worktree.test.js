'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { allowRunners } = require('./helpers/allow-runners');
const { ops, OpError } = require('../lib/dashboard/ops');
const { findRoute } = require('../lib/dashboard/routes');
const store = require('../lib/store');
const worktree = require('../lib/worktree');
const isolation = require('../lib/dashboard/isolation');

const AGENT = path.join(__dirname, 'fixtures', 'edit-agent.js').split(path.sep).join('/');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

// A git repository holding a spectoflow project (optionally in a sub-folder), with one committed plan.
function repo({ sub = '' } = {}) {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stf-wt-')));
  const root = path.join(top, sub);
  fs.mkdirSync(path.join(root, '.spectoflow'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spectoflow', 'config.json'), JSON.stringify({ agent: 'claude', runners: { claude: `node ${AGENT}` } }) + '\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.spectoflow/runtime.json\n');
  fs.writeFileSync(path.join(root, 'plans', 'plan.md'), '# Plan\n\n## Build\n- [ ] T-001 Add the feature\n- [ ] T-002 Another one\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'hello\n');
  git(top, 'init', '-q', '-b', 'main');
  git(top, 'config', 'user.email', 'dev@example.com'); git(top, 'config', 'user.name', 'Dev');
  git(top, 'add', '-A'); git(top, 'commit', '-q', '-m', 'init');
  allowRunners(root);
  return { top, root };
}
const status = (root, id) => store.readPlans(root)[0].phases[0].tasks.find((t) => t.id === id).status;
const state = (root, id) => (store.readRuntime(root).worktrees || {})[id];
const local = () => ({ emit: () => {} });
const remote = () => ({ emit: () => {}, remote: true });
// Start isolated work and resolve once the run is over and the change committed.
function startAndWait(root, id, feedback) {
  return new Promise((resolve, reject) => {
    const ctx = { emit: (e) => { if (e.type === 'change' && state(root, id) && state(root, id).status !== 'running') resolve(state(root, id)); } };
    const op = feedback ? ops['worktree.feedback'](root, { id, text: feedback }, ctx) : ops['worktree.start'](root, { id }, ctx);
    op.catch(reject);
  });
}

test('start: the agent works in its own worktree — the working tree is untouched, the change is on the branch', async () => {
  const { top, root } = repo();
  const s = await startAndWait(root, 'T-001');
  assert.strictEqual(s.status, 'ready');
  assert.strictEqual(s.branch, 'spectoflow/T-001');
  assert.ok(!fs.existsSync(path.join(root, 'feature.txt')), 'nothing written in the working tree');
  assert.strictEqual(status(root, 'T-001'), 'to_validate');
  const wt = worktree.list(root)['T-001'];
  assert.ok(wt.startsWith(path.join(fs.realpathSync(process.env.SPECTOFLOW_HOME), 'worktrees') + path.sep) || wt.startsWith(path.join(process.env.SPECTOFLOW_HOME, 'worktrees') + path.sep), wt);
  assert.ok(!wt.startsWith(top + path.sep), 'outside the project, and outside .git where agents refuse to write');
  assert.strictEqual(git(wt, 'status', '--porcelain'), '', 'what the agent left was committed');
  assert.match(git(top, 'log', '-1', '--format=%s', 'spectoflow/T-001'), /^T-001: Add the feature$/);

  const d = await ops['worktree.diff'](root, { id: 'T-001' }, local());
  assert.deepStrictEqual(d.files, [{ path: 'feature.txt', added: 1, removed: 0 }]);
  assert.match(d.patch, /\+feature v1/);
  assert.strictEqual(d.running, false);
  assert.strictEqual(typeof d.pr.ok, 'boolean');

  const msgs = store.readRuntime(root).messages.filter((m) => m.runId === s.runId);
  assert.ok(msgs.some((m) => m.text === 'edited feature.txt'), 'the run is visible like any other');
  assert.strictEqual(s.output, 'Changed feature.txt.', "the agent's plain output is kept, sentinel lines left out");
});

test('feedback: added to the task, the agent runs again in the same worktree; merge brings it in and cleans up', async () => {
  const { top, root } = repo();
  await startAndWait(root, 'T-001');
  const s = await startAndWait(root, 'T-001', 'Please add a reviewed line');
  assert.strictEqual(s.status, 'ready');
  assert.ok(store.readPlans(root)[0].phases[0].tasks[0].comments.some((c) => /Please add a reviewed line/.test(c)));
  const d = await ops['worktree.diff'](root, { id: 'T-001' }, local());
  assert.match(d.patch, /\+reviewed/);

  const wtDir = worktree.list(root)['T-001'];
  const r = await ops['worktree.merge'](root, { id: 'T-001' }, local());
  assert.ok(!fs.existsSync(path.dirname(wtDir)), 'no empty folder left behind');
  assert.strictEqual(r.branch, 'spectoflow/T-001');
  assert.strictEqual(fs.readFileSync(path.join(root, 'feature.txt'), 'utf8'), 'feature v1\nreviewed\n');
  assert.strictEqual(status(root, 'T-001'), 'done');
  assert.strictEqual(state(root, 'T-001'), undefined);
  assert.deepStrictEqual(worktree.list(root), {});
  assert.strictEqual(git(top, 'branch', '--list', 'spectoflow/*'), '');
  assert.match(git(top, 'log', '-1', '--format=%s'), /^Merge spectoflow\/T-001: T-001 Add the feature$/);
});

test('merge: a conflict is aborted — the working tree is left exactly as it was, the work is kept', async () => {
  const { top, root } = repo();
  await startAndWait(root, 'T-001');
  fs.writeFileSync(path.join(root, 'feature.txt'), 'mine\n');
  git(top, 'add', '-A'); git(top, 'commit', '-q', '-m', 'conflicting');
  const head = git(top, 'rev-parse', 'HEAD');
  await assert.rejects(() => ops['worktree.merge'](root, { id: 'T-001' }, local()), (e) => e instanceof OpError && e.status === 409 && /nothing was changed/.test(e.message));
  assert.strictEqual(git(top, 'rev-parse', 'HEAD'), head);
  assert.strictEqual(fs.readFileSync(path.join(root, 'feature.txt'), 'utf8'), 'mine\n');
  assert.ok(!fs.existsSync(path.join(top, '.git', 'MERGE_HEAD')));
  assert.ok(worktree.list(root)['T-001'], 'the worktree is still there to send feedback');
});

test('discard: worktree and branch removed, the task goes back to to do', async () => {
  const { top, root } = repo();
  await startAndWait(root, 'T-001');
  await ops['worktree.discard'](root, { id: 'T-001' }, local());
  assert.deepStrictEqual(worktree.list(root), {});
  assert.strictEqual(git(top, 'branch', '--list', 'spectoflow/*'), '');
  assert.strictEqual(status(root, 'T-001'), 'todo');
  assert.strictEqual(state(root, 'T-001'), undefined);
  assert.ok(!fs.existsSync(path.join(root, 'feature.txt')));
});

test('a failing run is marked failed but its change is kept for review; uncommitted work in the tree is reported', async () => {
  const { root } = repo();
  fs.writeFileSync(path.join(root, 'README.md'), 'changed, not committed\n');
  const cfgPath = path.join(root, '.spectoflow', 'config.json');
  const plan = path.join(root, 'plans', 'plan.md');
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('T-002 Another one', 'T-002 Another one that will fail'));
  const s = await startAndWait(root, 'T-002');
  assert.strictEqual(s.status, 'failed');
  assert.strictEqual(s.uncommitted, 1, 'README.md — not the plan, whose status lines the dashboard writes itself');
  assert.deepStrictEqual((await ops['worktree.diff'](root, { id: 'T-002' }, local())).files.map((f) => f.path), ['feature.txt']);
  assert.ok(fs.existsSync(cfgPath));
});

test('a project in a sub-folder of the repository: the agent works in the same sub-folder of the worktree', async () => {
  const { top, root } = repo({ sub: 'apps/web' });
  await startAndWait(root, 'T-001');
  const d = await ops['worktree.diff'](root, { id: 'T-001' }, local());
  assert.deepStrictEqual(d.files.map((f) => f.path), ['apps/web/feature.txt']);
  await ops['worktree.merge'](root, { id: 'T-001' }, local());
  assert.ok(fs.existsSync(path.join(top, 'apps', 'web', 'feature.txt')));
});

test('refusals: not a git repo, unknown task, already running, remote merge / pull request', async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-wt-nogit-'));
  fs.mkdirSync(path.join(plain, '.spectoflow')); fs.mkdirSync(path.join(plain, 'plans'));
  fs.writeFileSync(path.join(plain, '.spectoflow', 'config.json'), '{}');
  fs.writeFileSync(path.join(plain, 'plans', 'p.md'), '- [ ] T-001 x\n');
  await assert.rejects(() => ops['worktree.start'](plain, { id: 'T-001' }, local()), (e) => e.status === 400 && /not a git repository/.test(e.message));
  assert.strictEqual((await ops['project.read'](plain, {}, local())).git, false);

  const { root } = repo();
  assert.strictEqual((await ops['project.read'](root, {}, local())).git, true);
  await assert.rejects(() => ops['worktree.start'](root, { id: 'T-999' }, local()), (e) => e.status === 404);
  await assert.rejects(() => ops['worktree.start'](root, { id: '../evil' }, local()), (e) => e.status === 404 || e.status === 400);
  await startAndWait(root, 'T-001');
  for (const op of ['worktree.merge', 'worktree.pr']) {
    await assert.rejects(() => ops[op](root, { id: 'T-001' }, remote()), (e) => e instanceof OpError && e.status === 404, op);
  }
  assert.strictEqual((await ops['worktree.diff'](root, { id: 'T-001' }, remote())).pr.ok, false);
  assert.ok(worktree.list(root)['T-001'], 'nothing merged or removed');
  assert.throws(() => worktree.branchOf('a b'), /Invalid task id/);
});

test('stop: only that task\'s agent is stopped; discarding while it runs is refused; boot marks it stopped', async () => {
  const { root } = repo();
  const cfgPath = path.join(root, '.spectoflow', 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ agent: 'claude', runners: { claude: `node ${path.join(__dirname, 'fixtures', 'slow-agent.js').split(path.sep).join('/')}` } }));
  allowRunners(root);
  const done = new Promise((resolve) => {
    const ctx = { emit: (e) => { if (e.type === 'change' && state(root, 'T-001') && state(root, 'T-001').status === 'stopped') resolve(); } };
    ops['worktree.start'](root, { id: 'T-001' }, ctx);
  });
  await assert.rejects(() => ops['worktree.start'](root, { id: 'T-001' }, local()), (e) => e.status === 409);
  await assert.rejects(() => ops['worktree.discard'](root, { id: 'T-001' }, local()), (e) => e.status === 409);
  assert.strictEqual((await ops['run.stop'](root, {}, local())).stopped, 0, 'the chat Stop does not stop isolated work');
  assert.strictEqual((await ops['worktree.stop'](root, { id: 'T-001' }, local())).stopped, 1);
  await done;

  const rt = store.readRuntime(root); rt.worktrees['T-001'].status = 'running'; rt.worktrees['T-GONE'] = { status: 'ready', branch: 'spectoflow/T-GONE' }; store.writeRuntime(root, rt);
  isolation.reconcileOnBoot(root);
  assert.strictEqual(state(root, 'T-001').status, 'stopped');
  assert.strictEqual(state(root, 'T-GONE'), undefined);
});

test('worktree routes map to their ops; the relay never lists merge or pr', () => {
  const at = (m, p) => { const r = findRoute(m, p); return r && r[2]; };
  assert.strictEqual(at('POST', '/api/task/T-1/isolate'), 'worktree.start');
  assert.strictEqual(at('POST', '/api/task/T-1/isolate/feedback'), 'worktree.feedback');
  assert.strictEqual(at('GET', '/api/task/T-1/isolate/diff'), 'worktree.diff');
  assert.strictEqual(at('POST', '/api/task/T-1/isolate/stop'), 'worktree.stop');
  assert.strictEqual(at('POST', '/api/task/T-1/isolate/discard'), 'worktree.discard');
  assert.strictEqual(at('POST', '/api/task/T-1/isolate/merge'), 'worktree.merge');
  assert.strictEqual(at('POST', '/api/task/T-1/isolate/pr'), 'worktree.pr');
  const relay = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'relay.js'), 'utf8');
  for (const op of ['worktree.start', 'worktree.feedback', 'worktree.diff', 'worktree.stop', 'worktree.discard']) assert.ok(relay.includes(`'${op}':`), op);
  assert.ok(!relay.includes("'worktree.merge':") && !relay.includes("'worktree.pr':"));
});

test('the prompt names the task, the branch and the rules, and carries the review feedback', () => {
  const p = isolation.promptFor('T-7', { title: 'Do it', comments: ['@me: use tabs', 'PR: https://x'] }, 'plan.md', 'spectoflow/T-7', 'rename it');
  assert.match(p, /Work on task T-7: Do it/);
  assert.match(p, /branch spectoflow\/T-7/);
  assert.match(p, /Don't push/);
  assert.match(p, /- @me: use tabs/);
  assert.ok(!p.includes('PR: https://x'));
  assert.match(p, /rename it/);
  assert.match(p, /go-ahead/);
});
