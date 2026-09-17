'use strict';
/*
 * The delivery loop's git side (D79): one git worktree per task, so an agent works on a task without touching
 * the user's working tree, then the change is reviewed as a diff and merged, turned into a pull request, sent
 * back with feedback, or discarded. Zero dependency: `git` and `gh` are run with execFileSync — never a shell,
 * so nothing in a task id, a title or a comment is ever interpreted.
 *
 *   worktree  ~/.spectoflow/worktrees/<repo>-<hash>/<task-id>   outside the project, so no watcher, search, test
 *             runner or build sees a second copy of the code — and outside .git, where agents refuse to write
 *             (Claude Code protects .git/ — found with a real run)
 *   branch    spectoflow/<task-id>, created from the working tree's HEAD
 *
 * The project may sit in a sub-folder of the repository: the agent then works in the same sub-folder of the
 * worktree.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const globalConfig = require('./global-config');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_PATCH = 400 * 1024;
const BRANCH_PREFIX = 'spectoflow/';

class GitError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function run(cmd, args, cwd, { input, allowFail } = {}) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  } catch (e) {
    if (allowFail) return null;
    const msg = String((e.stderr || '') + (e.stdout || '')).trim() || e.message;
    throw new GitError(409, msg.split('\n').slice(-6).join('\n'));
  }
}
const git = (cwd, args, opts) => run('git', args, cwd, opts);
const gitOk = (cwd, args) => git(cwd, args, { allowFail: true });

const checkId = (id) => { if (!ID_RE.test(String(id || ''))) throw new GitError(400, `Invalid task id: ${id}`); return String(id); };
const branchOf = (id) => BRANCH_PREFIX + checkId(id);

// → { top, commonDir, rel } for a project inside a git work tree, else null.
function repoInfo(root) {
  const top = gitOk(root, ['rev-parse', '--show-toplevel']);
  if (top === null) return null;
  const common = git(root, ['rev-parse', '--git-common-dir']).trim();
  const topDir = top.trim();
  let rel = path.relative(fs.realpathSync(topDir), fs.realpathSync(root));
  if (rel.startsWith('..')) rel = '';
  return { top: topDir, commonDir: path.resolve(root, common), rel };
}
function requireRepo(root) {
  const info = repoInfo(root);
  if (!info) throw new GitError(400, 'This project is not a git repository: isolated work needs git.');
  if (!gitOk(root, ['rev-parse', '--verify', 'HEAD'])) throw new GitError(400, 'This repository has no commit yet: make a first commit, then try again.');
  return info;
}
const isRepo = (root) => !!repoInfo(root);

// One folder per repository, named so a person can tell which is which, and unique per repository.
function worktreePath(info, id) {
  const key = crypto.createHash('sha1').update(fs.realpathSync(info.commonDir)).digest('hex').slice(0, 8);
  const name = path.basename(info.top).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40) || 'repo';
  return path.join(globalConfig.homeDir(), 'worktrees', `${name}-${key}`, checkId(id));
}
const branchExists = (root, branch) => gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null;

// The worktrees git knows about for spectoflow branches → { <task-id>: path }.
function list(root) {
  const out = gitOk(root, ['worktree', 'list', '--porcelain']);
  const found = {};
  if (!out) return found;
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice(9);
    else if (line.startsWith(`branch refs/heads/${BRANCH_PREFIX}`) && current) found[line.slice(`branch refs/heads/${BRANCH_PREFIX}`.length)] = current;
  }
  return found;
}

// Create the task's worktree (or reuse the one that exists) → { branch, path, cwd, base }.
function create(root, id) {
  const info = requireRepo(root);
  const branch = branchOf(id);
  const wt = worktreePath(info, id);
  const existing = list(root)[id];
  const base = git(root, ['rev-parse', 'HEAD']).trim();
  if (existing) return { branch, path: existing, cwd: path.join(existing, info.rel), base: mergeBase(root, branch) || base, created: false };
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  if (branchExists(root, branch)) git(root, ['worktree', 'add', wt, branch]);
  else git(root, ['worktree', 'add', '-b', branch, wt, 'HEAD']);
  return { branch, path: wt, cwd: path.join(wt, info.rel), base, created: true };
}
const mergeBase = (root, branch) => { const r = gitOk(root, ['merge-base', 'HEAD', branch]); return r && r.trim(); };

// Uncommitted changes in the user's working tree (they are not in the worktree) → paths. Left out: what the
// dashboard writes itself — preferences in config.json, task status lines in the plans folder (`ignore`, paths
// relative to the project) — the agent is given its task in the prompt.
function uncommitted(root, ignore = []) {
  const out = gitOk(root, ['status', '--porcelain', '--untracked-files=normal', '--', '.']) || '';
  const info = repoInfo(root);
  const skip = ['.spectoflow/config.json', ...ignore].map((p) => path.posix.join(info && info.rel ? info.rel.split(path.sep).join('/') : '', p));
  return out.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''))
    .filter((p) => !skip.some((s) => p === s || p.startsWith(s.replace(/\/?$/, '/'))));
}

// Commit whatever the agent left uncommitted in the worktree → true when a commit was made. No hooks: the
// worktree has no installed dependencies for them to run with, and the change is reviewed before it lands.
function commitAll(wtPath, message) {
  git(wtPath, ['add', '-A']);
  if (gitOk(wtPath, ['diff', '--cached', '--quiet']) !== null) return false;
  const ident = gitOk(wtPath, ['config', 'user.email']) ? [] : ['-c', 'user.name=spectoflow', '-c', 'user.email=spectoflow@localhost'];
  git(wtPath, [...ident, 'commit', '--no-verify', '-q', '-m', message]);
  return true;
}

// What the branch changes compared to where it started → { files: [{ path, added, removed }], patch, truncated }.
function diff(root, id, base) {
  requireRepo(root);
  const branch = branchOf(id);
  if (!branchExists(root, branch)) throw new GitError(404, `No isolated work for ${id}.`);
  const from = base || mergeBase(root, branch);
  const range = [`${from}`, branch];
  const files = git(root, ['diff', '--numstat', '--no-color', ...range]).split('\n').filter(Boolean).map((l) => {
    const [a, r, ...p] = l.split('\t');
    return { path: p.join('\t'), added: a === '-' ? null : Number(a), removed: r === '-' ? null : Number(r) };
  });
  let patch = git(root, ['diff', '--no-color', '--no-ext-diff', ...range]);
  const truncated = patch.length > MAX_PATCH;
  if (truncated) patch = patch.slice(0, MAX_PATCH);
  return { branch, files, patch, truncated };
}

function removeWorktree(root, id) {
  const wt = list(root)[id];
  if (wt) git(root, ['worktree', 'remove', '--force', wt]);
  gitOk(root, ['worktree', 'prune']);
  if (wt) { try { fs.rmdirSync(path.dirname(wt)); } catch (_) {} } // the repository's folder, once empty
}

// Merge the branch into the working tree's current branch. On any failure (conflict, local changes git would
// overwrite) the merge is aborted and nothing has changed → throws with git's own explanation.
function merge(root, id, message) {
  requireRepo(root);
  const branch = branchOf(id);
  if (!branchExists(root, branch)) throw new GitError(404, `No isolated work for ${id}.`);
  const ident = gitOk(root, ['config', 'user.email']) ? [] : ['-c', 'user.name=spectoflow', '-c', 'user.email=spectoflow@localhost'];
  try {
    git(root, [...ident, 'merge', '--no-ff', '--no-verify', '-m', message || `Merge ${branch}`, branch]);
  } catch (e) {
    if (gitOk(root, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']) !== null) gitOk(root, ['merge', '--abort']);
    throw new GitError(409, `The merge could not be done, nothing was changed. Git said:\n${e.message}`);
  }
  removeWorktree(root, id);
  gitOk(root, ['branch', '-D', branch]);
  return { branch };
}

function discard(root, id) {
  requireRepo(root);
  const branch = branchOf(id);
  removeWorktree(root, id);
  gitOk(root, ['branch', '-D', branch]);
  return { branch };
}

// Can a pull request be opened from here? → { ok, reason }. `gh` installed and signed in, and a remote.
function prReady(root) {
  if (!isRepo(root)) return { ok: false, reason: 'not a git repository' };
  const remotes = (gitOk(root, ['remote']) || '').split('\n').filter(Boolean);
  if (!remotes.length) return { ok: false, reason: 'no git remote' };
  if (run('gh', ['--version'], root, { allowFail: true }) === null) return { ok: false, reason: 'gh is not installed' };
  if (run('gh', ['auth', 'status'], root, { allowFail: true }) === null) return { ok: false, reason: 'gh is not signed in (run: gh auth login)' };
  return { ok: true, remote: remotes.includes('origin') ? 'origin' : remotes[0] };
}

// Push the branch and open a pull request with `gh` → { url }. The branch stays; the worktree goes.
function openPr(root, id, { title, body } = {}) {
  const ready = prReady(root);
  if (!ready.ok) throw new GitError(400, `Can't open a pull request: ${ready.reason}.`);
  const branch = branchOf(id);
  if (!branchExists(root, branch)) throw new GitError(404, `No isolated work for ${id}.`);
  git(root, ['push', '-u', ready.remote, branch]);
  const out = run('gh', ['pr', 'create', '--head', branch, '--title', title || branch, '--body', body || ''], root);
  const url = (out.match(/https?:\/\/\S+/) || [])[0] || out.trim();
  removeWorktree(root, id);
  return { url, branch };
}

module.exports = { GitError, isRepo, repoInfo, list, create, uncommitted, commitAll, diff, merge, discard, prReady, openPr, branchOf, BRANCH_PREFIX };
