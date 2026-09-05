'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ws-'));
  const prev = process.env.SPECTOFLOW_HOME; process.env.SPECTOFLOW_HOME = home;
  for (const m of ['../lib/global-config', '../lib/registry', '../lib/workspace']) delete require.cache[require.resolve(m)];
  try { return fn(require('../lib/workspace'), require('../lib/registry'), require('../lib/global-config'), home); }
  finally { if (prev === undefined) delete process.env.SPECTOFLOW_HOME; else process.env.SPECTOFLOW_HOME = prev; }
}

test('init() creates the default workspace with dashboard.json, projects.json and projects/', () => withHome((ws, _r, gc, home) => {
  const r = ws.init({});
  assert.strictEqual(r.dir, path.join(home, 'dashboard'));
  assert.strictEqual(r.created, true);
  for (const f of ['dashboard.json', 'projects.json', 'projects']) assert.ok(fs.existsSync(path.join(r.dir, f)), f);
  assert.deepStrictEqual(ws.settings(), { name: 'dashboard', port: 4319, design: 'console' });
  assert.strictEqual(gc.get('dashboard.path').value, r.dir);
}));

test('init() is idempotent and only updates fields explicitly passed', () => withHome((ws) => {
  ws.init({ port: 5000 });
  const again = ws.init({ name: 'Team' });
  assert.strictEqual(again.created, false);
  assert.deepStrictEqual(ws.settings(), { name: 'Team', port: 5000, design: 'console' });
}));

test('init({path}) moves the workspace and carries the registry over when the new one is empty', () => withHome((ws, registry, gc, home) => {
  ws.init({});
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ws-proj-'));
  ws.registerProject(proj);
  const elsewhere = path.join(home, 'elsewhere');
  const r = ws.init({ path: elsewhere });
  assert.strictEqual(r.registryCarried, true);
  assert.strictEqual(gc.get('dashboard.path').value, elsewhere);
  assert.strictEqual(registry.listProjects().length, 1, 'the registry is now read from the new workspace');
  assert.ok(fs.existsSync(path.join(home, 'dashboard', 'projects.json')), 'the old workspace is left untouched');
}));

test('registerProject() writes projects/<id>/meta.json and stamps kind:spectoflow on the entry', () => withHome((ws) => {
  ws.init({});
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ws-proj2-'));
  const e = ws.registerProject(proj);
  assert.strictEqual(e.kind, 'spectoflow');
  const meta = JSON.parse(fs.readFileSync(path.join(ws.projectDir(e.id), 'meta.json'), 'utf8'));
  assert.strictEqual(meta.kind, 'spectoflow');
  assert.ok(meta.addedAt);
}));

test('migrateLegacyHome() moves a pre-0.24 projects.json and hub.lock into the workspace, once', () => withHome((ws, registry, _gc, home) => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'projects.json'), JSON.stringify({ projects: [{ id: 'abc123', path: home, name: 'x', lastOpened: '2026-01-01T00:00:00.000Z' }] }));
  fs.writeFileSync(path.join(home, 'hub.lock'), '{"pid":1,"port":1}');
  const r = ws.migrateLegacyHome();
  assert.deepStrictEqual(r, { movedRegistry: true, movedLock: true });
  assert.ok(!fs.existsSync(path.join(home, 'projects.json')));
  assert.strictEqual(registry.listProjects()[0].id, 'abc123');
  assert.deepStrictEqual(ws.migrateLegacyHome(), { movedRegistry: false, movedLock: false });
}));

test('readLock() falls back to a legacy <home>/hub.lock so an old running hub is still found', () => withHome((ws, _r, _gc, home) => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'hub.lock'), '{"pid":42,"port":4319}');
  assert.deepStrictEqual(ws.readLock(), { pid: 42, port: 4319 });
}));
