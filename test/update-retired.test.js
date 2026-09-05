'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const manifest = require('../lib/manifest');
const { runUpdate } = require('../lib/update');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const TPL = path.join(KIT, 'templates');
const VERSION = require('../package.json').version;

// A project as 0.23.x left it: the current kit plus a vendored dashboard + old lib files, all
// recorded in the manifest as framework-owned, plus a custom view in the old folder.
function legacyProject({ withManifest = true, modifyOne = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-retired-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const sf = path.join(d, '.spectoflow');
  const vendored = { 'dashboard/server.js': '// old server', 'dashboard/handlers.js': '// old handlers', 'dashboard/public/app.js': '// old app', 'lib/store.js': '// old store', 'lib/agents-registry.js': '// old roster' };
  for (const [rel, body] of Object.entries(vendored)) { const fp = path.join(sf, ...rel.split('/')); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, body); }
  fs.mkdirSync(path.join(sf, 'dashboard', 'custom'), { recursive: true });
  fs.writeFileSync(path.join(sf, 'dashboard', 'custom', 'kpis.json'), '{"id":"kpis"}');
  fs.writeFileSync(path.join(sf, '.dashboard.lock'), '{"pid":1}');
  fs.appendFileSync(path.join(d, '.gitignore'), '.spectoflow/.dashboard.lock\n');
  const m = manifest.readManifest(sf);
  for (const rel of Object.keys(vendored)) m.files[rel] = manifest.sha256(fs.readFileSync(path.join(sf, ...rel.split('/'))));
  if (modifyOne) fs.writeFileSync(path.join(sf, 'dashboard', 'handlers.js'), '// I EDITED THIS');
  if (withManifest) manifest.writeManifest(sf, m); else fs.unlinkSync(path.join(sf, '.manifest.json'));
  return d;
}
const has = (d, rel) => fs.existsSync(path.join(d, '.spectoflow', ...rel.split('/')));

test('retired files that are intact are removed, their empty folders pruned, and the manifest forgets them', () => {
  const d = legacyProject();
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(r.removed.sort(), ['dashboard/handlers.js', 'dashboard/public/app.js', 'dashboard/server.js', 'lib/agents-registry.js', 'lib/store.js']);
  assert.ok(!has(d, 'dashboard'), 'dashboard/ is gone entirely');
  assert.ok(!has(d, 'lib/store.js'));
  assert.ok(has(d, 'lib/spec-drift.js'), 'still-shipped files stay');
  const m = manifest.readManifest(path.join(d, '.spectoflow'));
  assert.ok(!('dashboard/server.js' in m.files));
});

test('a retired file the user modified is kept (even with --force), reported, and stays tracked', () => {
  const d = legacyProject({ modifyOne: true });
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION, force: true });
  assert.deepStrictEqual(r.kept, ['dashboard/handlers.js']);
  assert.strictEqual(fs.readFileSync(path.join(d, '.spectoflow', 'dashboard', 'handlers.js'), 'utf8'), '// I EDITED THIS');
  assert.ok(!has(d, 'dashboard/server.js'), 'the untouched siblings still go');
  const again = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(again.kept, ['dashboard/handlers.js'], 'still warned about next time');
});

test('data migration runs first: custom views move to dashboards/, the lock and the gitignore line go', () => {
  const d = legacyProject();
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(r.migration.movedViews, ['kpis.json']);
  assert.ok(has(d, 'dashboards/kpis.json'));
  assert.ok(!has(d, '.dashboard.lock'));
  assert.strictEqual(r.migration.removedLock, true);
  assert.ok(!fs.readFileSync(path.join(d, '.gitignore'), 'utf8').includes('.dashboard.lock'));
  assert.ok(fs.readFileSync(path.join(d, '.gitignore'), 'utf8').includes('.spectoflow/runtime.json'));
});

test('a view that already exists in dashboards/ is kept there; the legacy copy is reported as a conflict, not lost', () => {
  const d = legacyProject();
  fs.writeFileSync(path.join(d, '.spectoflow', 'dashboards', 'kpis.json'), '{"id":"kpis","title":"NEW"}');
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(r.migration.conflicts, ['kpis.json']);
  assert.match(fs.readFileSync(path.join(d, '.spectoflow', 'dashboards', 'kpis.json'), 'utf8'), /NEW/);
  assert.ok(has(d, 'dashboard/custom/kpis.json'), 'the legacy file is left for the user to resolve');
  assert.ok(!has(d, 'dashboard/server.js'), 'everything else in dashboard/ still retires');
});

test('--dry-run reports removals and moves but writes nothing', () => {
  const d = legacyProject();
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION, dryRun: true });
  assert.ok(r.removed.length > 0 && r.migration.movedViews.length === 1);
  assert.ok(has(d, 'dashboard/server.js') && has(d, 'dashboard/custom/kpis.json') && !has(d, 'dashboards/kpis.json'));
});

test('a project with no manifest deletes nothing and lists the leftovers as a hint', () => {
  const d = legacyProject({ withManifest: false });
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(r.removed, []);
  assert.deepStrictEqual(r.legacyLeftovers.sort(), ['dashboard', 'lib/agents-registry.js', 'lib/store.js']);
  assert.ok(has(d, 'dashboard/server.js'));
  assert.ok(has(d, 'dashboards/kpis.json'), 'the data migration still runs — it is safe');
});
