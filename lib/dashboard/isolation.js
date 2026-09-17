'use strict';
/*
 * The delivery loop (D79, docs/delivery-loop-design.md): a task worked on in isolation. One path, riding on the
 * task's existing status:
 *
 *   start     → git worktree + branch spectoflow/<id>, the agent runs there         task: in progress
 *   run ends  → what it left uncommitted is committed on the branch                 task: to validate
 *   diff      → files and patch, for review in the task drawer
 *   feedback  → the comment is added to the task, the agent runs again, same worktree
 *   merge     → merged into the working tree's branch, worktree and branch removed  task: done
 *   pr        → branch pushed, pull request opened with gh, worktree removed         (link added to the task)
 *   discard   → worktree and branch removed — the rollback                          task: to do
 *
 * State lives in runtime.json → worktrees[<id>] = { branch, base, status, runId, startedAt, endedAt,
 * uncommitted, prUrl }; git itself stays the source of truth (boot drops an entry whose branch is gone).
 */
const store = require('../store');
const worktree = require('../worktree');
const { startRun, stopRuns, isRunning } = require('./runner');

const group = (id) => `task:${id}`;
const OUTPUT_TAIL = 4000;
// What the agent said last (its plain output, sentinel lines left out) — shown in the drawer, so a run that
// changed nothing still says why (a question, a refusal, an error).
function tailOutput(child) {
  let text = '';
  const keep = (d) => { text = (text + d.toString()).slice(-OUTPUT_TAIL * 2); };
  if (child.stdout) child.stdout.on('data', keep);
  return () => text.split('\n').filter((l) => !/^::spectoflow\s/.test(l.trim())).join('\n').trim().slice(-OUTPUT_TAIL);
}
const fail = (status, message) => { throw new worktree.GitError(status, message); };

function findTask(root, id) {
  for (const pl of store.readPlans(root)) for (const ph of pl.phases) {
    const task = ph.tasks.find((t) => t.id === id);
    if (task) return { task, file: pl.file };
  }
  return fail(404, `Task ${id} not found.`);
}
function readState(root) { return store.readRuntime(root).worktrees || {}; }
function setState(root, id, patch) {
  const rt = store.readRuntime(root);
  rt.worktrees = rt.worktrees || {};
  if (patch === null) delete rt.worktrees[id];
  else rt.worktrees[id] = { ...(rt.worktrees[id] || {}), ...patch };
  store.writeRuntime(root, rt);
  return rt.worktrees[id] || null;
}
const setStatus = (root, file, id, status) => { try { store.updateTaskLine(root, file, id, { status }); } catch (_) {} };

function promptFor(id, task, file, branch, feedback) {
  const lines = [
    `Work on task ${id}: ${task.title} (from plans/${file}).`,
    `You are in an isolated git worktree of this project, on branch ${branch}. The user reviews the diff before anything reaches their own working tree.`,
    "Don't edit this task's line or its status in plans/ — the dashboard tracks it. Don't push, don't switch or create branches.",
    'The user started this work from the dashboard: that is their go-ahead to do this task now. If it needs a workflow step that is disabled, enable it in .spectoflow/workflow.md and say so — the change shows in the diff they review.',
  ];
  const notes = (task.comments || []).filter((c) => !/^PR: /.test(c));
  if (notes.length) lines.push(`Notes on the task:\n${notes.map((c) => `- ${c}`).join('\n')}`);
  if (feedback) lines.push(`Review feedback on your previous change — address it:\n${feedback}`);
  lines.push('When done, summarize what you changed.');
  return lines.join('\n\n');
}

// Start (or restart, with feedback) the agent on a task in its worktree.
function start(root, { id, feedback }, emit, { remote } = {}) {
  const { task, file } = findTask(root, id);
  if (isRunning(root, group(id))) fail(409, `An agent is already working on ${id}.`);
  const made = worktree.create(root, id);
  const prev = readState(root)[id] || null;
  const was = prev || {};
  // Marked running before the agent starts: startRun's own events must never show the previous run's result.
  setState(root, id, {
    branch: made.branch, base: was.base || made.base, status: 'running', runId: null,
    startedAt: new Date().toISOString(), endedAt: null, error: null, output: null, prUrl: was.prUrl || null,
    uncommitted: made.created ? worktree.uncommitted(root, [store.resolvePlansDir(root, store.readConfig(root))]).length : (was.uncommitted || 0),
  });
  const run = startRun(root, {
    prompt: promptFor(id, task, file, made.branch, feedback),
    display: `⎇ ${id} — ${feedback ? 'feedback: ' + feedback : task.title}`,
    task: id, cwd: made.cwd, learn: !remote,
  }, emit);
  if (run.error) {
    setState(root, id, prev);
    if (made.created) { try { worktree.discard(root, id); } catch (_) {} }
    fail(400, run.error);
  }
  setState(root, id, { runId: run.runId });
  setStatus(root, file, id, 'in_progress');
  const output = run.child ? tailOutput(run.child) : () => '';
  const finish = (code, signal) => {
    let error = null;
    try { worktree.commitAll(made.path, `${id}: ${task.title}`); } catch (e) { error = e.message; }
    const status = signal ? 'stopped' : code === 0 && !error ? 'ready' : 'failed';
    setState(root, id, { status, endedAt: new Date().toISOString(), error, output: output() || null });
    setStatus(root, file, id, 'to_validate');
    emit({ type: 'change' });
  };
  if (run.child) run.child.on('close', finish); else finish(1, null);
  emit({ type: 'change' });
  return { runId: run.runId, branch: made.branch, uncommitted: readState(root)[id].uncommitted };
}

function requireIdle(root, id) {
  if (isRunning(root, group(id))) fail(409, `An agent is still working on ${id}: stop it first.`);
}
// Anything left uncommitted in the worktree (a stopped run, a crash, a hand edit) is part of the change.
function commitLeftovers(root, id, title) {
  const wt = worktree.list(root)[id];
  if (wt) worktree.commitAll(wt, `${id}: ${title}`);
}

function diff(root, { id }, { remote } = {}) {
  const { task } = findTask(root, id);
  const state = readState(root)[id] || {};
  if (!isRunning(root, group(id))) commitLeftovers(root, id, task.title);
  const d = worktree.diff(root, id, state.base);
  return { ...d, running: isRunning(root, group(id)), pr: remote ? { ok: false, reason: 'local dashboard only' } : prReadyCached(root) };
}

function merge(root, { id }) {
  const { task, file } = findTask(root, id);
  requireIdle(root, id);
  commitLeftovers(root, id, task.title);
  const r = worktree.merge(root, id, `Merge ${worktree.branchOf(id)}: ${id} ${task.title}`);
  setState(root, id, null);
  setStatus(root, file, id, 'done');
  return r;
}

function openPr(root, { id }) {
  const { task, file } = findTask(root, id);
  requireIdle(root, id);
  commitLeftovers(root, id, task.title);
  const r = worktree.openPr(root, id, { title: `${id}: ${task.title}`, body: `Task ${id} from \`plans/${file}\`, worked on with spectoflow.` });
  setState(root, id, { status: 'pr', prUrl: r.url });
  try { store.addTaskComment(root, file, id, `PR: ${r.url}`); } catch (_) {}
  return r;
}

function discard(root, { id }) {
  const { file } = findTask(root, id);
  requireIdle(root, id);
  const r = worktree.discard(root, id);
  setState(root, id, null);
  setStatus(root, file, id, 'todo');
  return r;
}

const stop = (root, { id }) => ({ stopped: stopRuns(root, group(id)) });

// After a restart nothing runs: a 'running' entry was interrupted; an entry whose branch is gone is dropped.
function reconcileOnBoot(root) {
  const state = readState(root);
  const ids = Object.keys(state);
  if (!ids.length) return;
  const rt = store.readRuntime(root);
  for (const id of ids) {
    const exists = worktree.isRepo(root) && worktree.list(root)[id] !== undefined;
    const branchKept = exists || state[id].status === 'pr';
    if (!branchKept) { delete rt.worktrees[id]; continue; }
    if (state[id].status === 'running') rt.worktrees[id] = { ...state[id], status: 'stopped', endedAt: new Date().toISOString() };
  }
  store.writeRuntime(root, rt);
}

// `gh auth status` is slow-ish: remember the answer for a minute per project.
const prCache = new Map();
function prReadyCached(root) {
  const hit = prCache.get(root);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  const value = worktree.prReady(root);
  prCache.set(root, { at: Date.now(), value });
  return value;
}

module.exports = { start, diff, merge, openPr, discard, stop, reconcileOnBoot, promptFor };
