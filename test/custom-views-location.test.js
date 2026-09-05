'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const store = require('../lib/store');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
const VIEW = (id) => JSON.stringify({ id, title: 'View ' + id, icon: 'info', blocks: [{ type: 'markdown', text: 'hello' }] });
function project() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-views-')); execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' }); return d; }

test('init ships an empty .spectoflow/dashboards/ folder', () => {
  const root = project();
  assert.ok(fs.existsSync(path.join(root, '.spectoflow', 'dashboards')));
  assert.ok(!fs.existsSync(path.join(root, '.spectoflow', 'dashboard')), 'no vendored dashboard any more');
});

test('readCustomDashboards reads the new folder, then the legacy one, first id wins', () => {
  const root = project();
  fs.writeFileSync(path.join(root, '.spectoflow', 'dashboards', 'a.json'), VIEW('a'));
  fs.mkdirSync(path.join(root, '.spectoflow', 'dashboard', 'custom'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spectoflow', 'dashboard', 'custom', 'b.json'), VIEW('b'));
  fs.writeFileSync(path.join(root, '.spectoflow', 'dashboard', 'custom', 'a.json'), JSON.stringify({ ...JSON.parse(VIEW('a')), title: 'LEGACY a' }));
  const views = store.readCustomDashboards(root);
  assert.deepStrictEqual(views.map((v) => v.id), ['a', 'b']);
  assert.strictEqual(views[0].title, 'View a', 'the new location wins over the legacy copy');
});

test('spectoflow dashboard validate <file> exits 0 on a valid spec and 1 with errors on an invalid one', () => {
  const root = project();
  const good = path.join(root, 'good.json'); fs.writeFileSync(good, VIEW('ok'));
  const bad = path.join(root, 'bad.json'); fs.writeFileSync(bad, JSON.stringify({ id: 'x', blocks: [{ type: 'nope' }] }));
  const g = spawnSync('node', [BIN, 'dashboard', 'validate', good], { encoding: 'utf8' });
  assert.strictEqual(g.status, 0); assert.match(g.stdout, /valid/i);
  const b = spawnSync('node', [BIN, 'dashboard', 'validate', bad], { encoding: 'utf8' });
  assert.strictEqual(b.status, 1); assert.match(b.stdout + b.stderr, /invalid|error/i);
});
