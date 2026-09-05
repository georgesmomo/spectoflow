'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const files = require('../lib/dashboard/files');

function proj() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-files-'));
}

test('tree() lists files and folders, sorted (dirs first), excluding .git and node_modules', () => {
  const d = proj();
  fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(d, 'node_modules'));
  fs.mkdirSync(path.join(d, 'specs'));
  fs.writeFileSync(path.join(d, 'specs', 'a.md'), '# A\n');
  fs.writeFileSync(path.join(d, 'README.md'), '# hi\n');

  const t = files.tree(d);
  const names = t.map((e) => e.name);
  assert.ok(!names.includes('.git'), '.git excluded');
  assert.ok(!names.includes('node_modules'), 'node_modules excluded');
  assert.deepStrictEqual(names, ['specs', 'README.md'], 'directories sort before files');
  const specsNode = t.find((e) => e.name === 'specs');
  assert.strictEqual(specsNode.type, 'dir');
  assert.strictEqual(specsNode.children[0].path, 'specs/a.md');
});

test('readFile() returns content for a text file and rejects folders / missing paths', () => {
  const d = proj();
  fs.writeFileSync(path.join(d, 'x.md'), '# hello\n');
  fs.mkdirSync(path.join(d, 'sub'));

  const ok = files.readFile(d, 'x.md');
  assert.strictEqual(ok.content, '# hello\n');

  const dir = files.readFile(d, 'sub');
  assert.match(dir.error, /folder/);

  const missing = files.readFile(d, 'nope.md');
  assert.match(missing.error, /not found/i);
});

test('readFile() detects binary content and refuses to return it as text', () => {
  const d = proj();
  fs.writeFileSync(path.join(d, 'blob.bin'), Buffer.from([0x50, 0x4b, 0x00, 0x03, 0x04]));
  const r = files.readFile(d, 'blob.bin');
  assert.strictEqual(r.binary, true);
  assert.strictEqual(r.content, undefined);
});

test('readFile() rejects a file over the size cap', () => {
  const d = proj();
  fs.writeFileSync(path.join(d, 'big.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 97));
  const r = files.readFile(d, 'big.txt');
  assert.match(r.error, /too large/i);
});

test('readFile()/writeFile() reject path traversal outside the project root', () => {
  const d = proj();
  const outside = files.readFile(d, '../../etc/passwd');
  assert.match(outside.error, /invalid path/i);
  const w = files.writeFile(d, '../evil.txt', 'x');
  assert.match(w.error, /invalid path/i);
  assert.ok(!fs.existsSync(path.join(path.dirname(d), 'evil.txt')));
});

test('writeFile() creates a new file (with nested dirs) and overwrites an existing one', () => {
  const d = proj();
  const created = files.writeFile(d, 'notes/todo.md', '- [ ] one\n');
  assert.strictEqual(created.ok, true);
  assert.strictEqual(fs.readFileSync(path.join(d, 'notes', 'todo.md'), 'utf8'), '- [ ] one\n');

  const overwritten = files.writeFile(d, 'notes/todo.md', '- [x] one\n');
  assert.strictEqual(overwritten.ok, true);
  assert.strictEqual(fs.readFileSync(path.join(d, 'notes', 'todo.md'), 'utf8'), '- [x] one\n');
});

test('writeFile()/mkdir() refuse anything under .git', () => {
  const d = proj();
  fs.mkdirSync(path.join(d, '.git'));
  const w = files.writeFile(d, '.git/config', '[core]\n');
  assert.match(w.error, /\.git/);
  assert.ok(!fs.existsSync(path.join(d, '.git', 'config')));
  const m = files.mkdir(d, '.git/hooks');
  assert.match(m.error, /\.git/);
});

test('mkdir() creates nested directories', () => {
  const d = proj();
  const r = files.mkdir(d, 'a/b/c');
  assert.strictEqual(r.ok, true);
  assert.ok(fs.statSync(path.join(d, 'a', 'b', 'c')).isDirectory());
});

// Regression: SPECTOFLOW_ROOT can arrive with a mixed separator (a Windows base path joined with a
// forward-slash suffix, e.g. from a shell env var) — safePath() must normalize `root` itself before
// comparing it against path.resolve()'s always-normalized output, or every legitimate child path
// gets rejected as "invalid" even though it's genuinely inside the project.
test('a project root with mixed path separators still resolves legitimate children', () => {
  const d = proj();
  fs.writeFileSync(path.join(d, 'README.md'), '# hi\n');
  const mixedRoot = d.replace(path.sep, '/'); // swap just the first separator to mimic the real bug
  if (mixedRoot === d) return; // nothing to prove on a platform where this can't happen
  const r = files.readFile(mixedRoot, 'README.md');
  assert.strictEqual(r.content, '# hi\n');
});
