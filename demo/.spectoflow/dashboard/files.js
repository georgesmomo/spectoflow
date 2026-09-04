'use strict';
/*
 * File Explorer backend — browse, read, write and create files/folders anywhere under the project
 * root. Kept separate from server.js (own module, like runner.js/summarize.js), since it owns a
 * distinct concern: safe filesystem access scoped to the whole project, not just plans/specs/agents.
 *
 * Trust model matches the rest of this local dashboard (POST /api/run already spawns an arbitrary
 * configured agent command): this is a single-user localhost dev tool, not a hosted multi-tenant
 * service. The guard here exists to stop a path like "../../etc/passwd" from a buggy or malicious
 * client, not to sandbox an untrusted operator.
 */
const fs = require('fs');
const path = require('path');

const DENY_DIRS = new Set(['.git', 'node_modules']);
const MAX_READ_BYTES = 2 * 1024 * 1024;

// Resolves `rel` against `root`, rejecting anything that normalizes outside it (path traversal).
// `root` itself is normalized first — ROOT can arrive with mixed separators (e.g. from an env var
// built by joining a Windows base path with a forward-slash suffix), and comparing an un-normalized
// root against path.resolve()'s always-normalized output would reject even legitimate children.
function safePath(root, rel) {
  const rootAbs = path.resolve(root);
  const cleaned = String(rel || '').replace(/^[/\\]+/, '');
  const abs = path.resolve(rootAbs, cleaned);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}

// Symlink guard: an existing path must REALLY resolve under root, not just syntactically.
// A path that doesn't exist yet (e.g. a file about to be created) is trusted as-is — nothing to
// resolve through.
function realUnderRoot(root, abs) {
  let real;
  try { real = fs.realpathSync(abs); } catch { return abs; }
  const realRoot = (() => { try { return fs.realpathSync(root); } catch { return root; } })();
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  return real;
}

function isUnderGit(rel) {
  const n = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return n === '.git' || n.startsWith('.git/');
}

function buildTree(dir, relBase) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory()) ? a.name.localeCompare(b.name) : (a.isDirectory() ? -1 : 1));
  const out = [];
  for (const e of entries) {
    if (DENY_DIRS.has(e.name)) continue;
    const rel = relBase ? relBase + '/' + e.name : e.name;
    if (e.isDirectory()) out.push({ name: e.name, path: rel, type: 'dir', children: buildTree(path.join(dir, e.name), rel) });
    else out.push({ name: e.name, path: rel, type: 'file' });
  }
  return out;
}

// A NUL byte anywhere in the first chunk means "binary" — cheap and reliable enough for a local
// preview tool (the same heuristic git and most editors use).
function isProbablyText(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

function tree(root) {
  return buildTree(root, '');
}

function readFile(root, rel) {
  const abs = safePath(root, rel);
  if (!abs) return { error: 'Invalid path.' };
  const real = realUnderRoot(root, abs);
  if (!real) return { error: 'Invalid path.' };
  let stat;
  try { stat = fs.statSync(real); } catch { return { error: 'Not found.' }; }
  if (stat.isDirectory()) return { error: 'That is a folder.' };
  if (stat.size > MAX_READ_BYTES) return { error: 'File too large to open here (>2MB).' };
  const buf = fs.readFileSync(real);
  if (!isProbablyText(buf)) return { binary: true, size: stat.size };
  return { content: buf.toString('utf8') };
}

function writeFile(root, rel, content) {
  if (typeof content !== 'string') return { error: 'Missing content.' };
  if (isUnderGit(rel)) return { error: 'Writes under .git are blocked.' };
  const abs = safePath(root, rel);
  if (!abs) return { error: 'Invalid path.' };
  const parentDir = path.dirname(abs);
  if (fs.existsSync(parentDir) && !realUnderRoot(root, parentDir)) return { error: 'Invalid path.' };
  fs.mkdirSync(parentDir, { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return { ok: true };
}

function mkdir(root, rel) {
  if (isUnderGit(rel)) return { error: 'Cannot create folders under .git.' };
  const abs = safePath(root, rel);
  if (!abs) return { error: 'Invalid path.' };
  const parentDir = path.dirname(abs);
  if (fs.existsSync(parentDir) && !realUnderRoot(root, parentDir)) return { error: 'Invalid path.' };
  fs.mkdirSync(abs, { recursive: true });
  return { ok: true };
}

module.exports = { tree, readFile, writeFile, mkdir };
