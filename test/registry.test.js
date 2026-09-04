'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../lib/registry');

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-registry-'));
}
function tmpProject(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-proj-' + name + '-'));
}

test('readRegistry returns an empty project list when no file exists yet', () => {
  const base = tmpBase();
  assert.deepStrictEqual(registry.readRegistry(base), { projects: [] });
});

test('readRegistry returns an empty project list when the file is corrupt', () => {
  const base = tmpBase();
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(registry.registryPath(base), '{not json');
  assert.deepStrictEqual(registry.readRegistry(base), { projects: [] });
});

test('addProject creates a new entry with a 6-hex-char id and the folder basename as name', () => {
  const base = tmpBase();
  const proj = tmpProject('a');
  const entry = registry.addProject(proj, base);
  assert.match(entry.id, /^[0-9a-f]{6}$/);
  assert.strictEqual(entry.name, path.basename(proj));
  assert.strictEqual(path.resolve(entry.path), path.resolve(proj));
  assert.ok(entry.lastOpened);
  assert.strictEqual(registry.readRegistry(base).projects.length, 1);
});

test('addProject called again for the same path does not duplicate — updates lastOpened, keeps the id', async () => {
  const base = tmpBase();
  const proj = tmpProject('b');
  const first = registry.addProject(proj, base);
  await new Promise((r) => setTimeout(r, 5)); // force a different ISO timestamp
  const second = registry.addProject(proj, base);
  assert.strictEqual(second.id, first.id);
  assert.notStrictEqual(second.lastOpened, first.lastOpened);
  assert.strictEqual(registry.readRegistry(base).projects.length, 1);
});

test('addProject for a different path creates a distinct entry', () => {
  const base = tmpBase();
  const a = registry.addProject(tmpProject('c1'), base);
  const b = registry.addProject(tmpProject('c2'), base);
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(registry.readRegistry(base).projects.length, 2);
});

test('genId regenerates on collision instead of returning a duplicate', () => {
  let call = 0;
  const randomFn = (n) => { call++; return Buffer.from(call === 1 ? 'aaaaaa' : 'bbbbbb', 'hex'); };
  const id = registry.genId(['aaaaaa'], randomFn);
  assert.strictEqual(id, 'bbbbbb');
  assert.strictEqual(call, 2);
});

test('removeProject removes a known entry and is a harmless no-op for an unknown id', () => {
  const base = tmpBase();
  const entry = registry.addProject(tmpProject('d'), base);
  assert.strictEqual(registry.removeProject('doesnotexist', base), false);
  assert.strictEqual(registry.readRegistry(base).projects.length, 1);
  assert.strictEqual(registry.removeProject(entry.id, base), true);
  assert.strictEqual(registry.readRegistry(base).projects.length, 0);
});

test('touchProject updates lastOpened for a known id, no-ops for an unknown one', async () => {
  const base = tmpBase();
  const entry = registry.addProject(tmpProject('e'), base);
  const before = entry.lastOpened;
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(registry.touchProject('nope', base), false);
  assert.strictEqual(registry.touchProject(entry.id, base), true);
  const after = registry.readRegistry(base).projects[0].lastOpened;
  assert.notStrictEqual(after, before);
});

test('findByPath finds a registered project by normalized path, null when not registered', () => {
  const base = tmpBase();
  const proj = tmpProject('f');
  registry.addProject(proj, base);
  assert.ok(registry.findByPath(proj, base));
  assert.strictEqual(registry.findByPath(tmpProject('g'), base), null);
});

test('listProjects returns entries newest-lastOpened-first', async () => {
  const base = tmpBase();
  const a = registry.addProject(tmpProject('h1'), base);
  await new Promise((r) => setTimeout(r, 5));
  const b = registry.addProject(tmpProject('h2'), base);
  const list = registry.listProjects(base);
  assert.strictEqual(list[0].id, b.id);
  assert.strictEqual(list[1].id, a.id);
});

test('registryPath resolves under the given baseDir', () => {
  const base = tmpBase();
  assert.strictEqual(registry.registryPath(base), path.join(base, 'projects.json'));
});
