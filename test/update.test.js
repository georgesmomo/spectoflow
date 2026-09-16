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
const TEMPLATES = path.join(KIT, 'templates');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
// Install a real project, then return {proj, sf} and a fresh copy of templates to act as the "new kit".
function install() {
  const proj = tmp('stf-upd-');
  execFileSync('node', [BIN, 'init', proj], { stdio: 'pipe' });
  const newKit = tmp('stf-kit-');
  copyDir(TEMPLATES, newKit);
  return { proj, sf: path.join(proj, '.spectoflow'), newKit };
}
const read = (p) => fs.readFileSync(p, 'utf8');
const sfp = (sf, rel) => path.join(sf, rel.split('/').join(path.sep));

test('refreshes an untouched framework file when the new kit changed it', () => {
  const { proj, sf, newKit } = install();
  fs.writeFileSync(path.join(newKit, 'SPECTOFLOW.md'), 'NEW BRAIN');
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9' });
  assert.ok(report.refreshed.includes('SPECTOFLOW.md'), 'reported refreshed');
  assert.strictEqual(read(sfp(sf, 'SPECTOFLOW.md')), 'NEW BRAIN', 'file rewritten');
  assert.ok(!report.newSidecar.length, 'no .new for untouched file');
  assert.strictEqual(manifest.readManifest(sf).version, '9.9.9', 'manifest version bumped');
});

test('creates a brand-new framework file added in the new kit', () => {
  const { proj, sf, newKit } = install();
  fs.mkdirSync(path.join(newKit, 'skills', 'new-skill'), { recursive: true });
  fs.writeFileSync(path.join(newKit, 'skills', 'new-skill', 'SKILL.md'), 'HELLO');
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9' });
  assert.ok(report.created.includes('skills/new-skill/SKILL.md'));
  assert.strictEqual(read(sfp(sf, 'skills/new-skill/SKILL.md')), 'HELLO');
});

test('preserves a user-edited framework file and drops a .new sidecar', () => {
  const { proj, sf, newKit } = install();
  fs.writeFileSync(sfp(sf, 'agents/developer.md'), 'MY EDITS');       // user edited on disk
  fs.writeFileSync(path.join(newKit, 'agents', 'developer.md'), 'KIT V2'); // kit also moved on
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9' });
  assert.ok(report.newSidecar.includes('agents/developer.md'), 'reported .new');
  assert.strictEqual(read(sfp(sf, 'agents/developer.md')), 'MY EDITS', 'edit preserved');
  assert.strictEqual(read(sfp(sf, 'agents/developer.md.new')), 'KIT V2', '.new holds new template');
});

test('never touches user-owned config.json and workflow.md', () => {
  const { proj, sf, newKit } = install();
  fs.writeFileSync(sfp(sf, 'config.json'), '{"mode":"manual"}');
  fs.writeFileSync(sfp(sf, 'workflow.md'), '# my workflow');
  // change those in the kit too — update must still ignore them
  fs.writeFileSync(path.join(newKit, 'config.json'), '{"mode":"autopilot"}');
  fs.writeFileSync(path.join(newKit, 'workflow.md'), '# kit workflow');
  runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9' });
  assert.strictEqual(read(sfp(sf, 'config.json')), '{"mode":"manual"}');
  assert.strictEqual(read(sfp(sf, 'workflow.md')), '# my workflow');
  assert.ok(!fs.existsSync(sfp(sf, 'config.json.new')), 'no config .new');
});

test('legacy install (no manifest): adopts a matching file, .new for a divergent one', () => {
  const { proj, sf, newKit } = install();
  fs.rmSync(path.join(sf, manifest.MANIFEST_NAME));          // simulate pre-manifest install
  fs.writeFileSync(sfp(sf, 'policy.md'), 'OLD DIVERGENT');    // differs from kit → ambiguous
  fs.writeFileSync(path.join(newKit, 'policy.md'), 'KIT POLICY');
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9' });
  assert.ok(report.newSidecar.includes('policy.md'), 'divergent legacy → .new');
  assert.strictEqual(read(sfp(sf, 'policy.md')), 'OLD DIVERGENT', 'divergent legacy preserved');
  assert.ok(report.adopted.includes('capabilities.md'), 'matching legacy file adopted');
  assert.ok(manifest.readManifest(sf).files['capabilities.md'], 'adopted file now tracked in manifest');
});

test('force overwrites a diverged file instead of dropping a .new sidecar', () => {
  const { proj, sf, newKit } = install();
  fs.writeFileSync(sfp(sf, 'agents/developer.md'), 'MY EDITS');
  fs.writeFileSync(path.join(newKit, 'agents', 'developer.md'), 'KIT V2');
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9', force: true });
  assert.ok(report.forced.includes('agents/developer.md'), 'reported as forced');
  assert.ok(!report.newSidecar.length, 'no .new written under force');
  assert.strictEqual(read(sfp(sf, 'agents/developer.md')), 'KIT V2', 'disk now matches the kit');
  assert.ok(!fs.existsSync(sfp(sf, 'agents/developer.md.new')), 'no leftover .new file');
});

test('force still refreshes untouched files normally (reported as refreshed, not forced)', () => {
  const { proj, sf, newKit } = install();
  fs.writeFileSync(path.join(newKit, 'SPECTOFLOW.md'), 'NEW BRAIN');
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9', force: true });
  assert.ok(report.refreshed.includes('SPECTOFLOW.md'));
  assert.ok(!report.forced.includes('SPECTOFLOW.md'), 'an untouched file is a normal refresh, not a forced one');
});

test('force never touches user-owned config.json and workflow.md', () => {
  const { proj, sf, newKit } = install();
  fs.writeFileSync(sfp(sf, 'config.json'), '{"mode":"manual"}');
  fs.writeFileSync(sfp(sf, 'workflow.md'), '# my workflow');
  fs.writeFileSync(path.join(newKit, 'config.json'), '{"mode":"autopilot"}');
  fs.writeFileSync(path.join(newKit, 'workflow.md'), '# kit workflow');
  runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9', force: true });
  assert.strictEqual(read(sfp(sf, 'config.json')), '{"mode":"manual"}');
  assert.strictEqual(read(sfp(sf, 'workflow.md')), '# my workflow');
});

test('force + dry-run reports the forced overwrite but writes nothing', () => {
  const { proj, sf, newKit } = install();
  fs.writeFileSync(sfp(sf, 'agents/developer.md'), 'MY EDITS');
  fs.writeFileSync(path.join(newKit, 'agents', 'developer.md'), 'KIT V2');
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9', force: true, dryRun: true });
  assert.ok(report.forced.includes('agents/developer.md'));
  assert.strictEqual(read(sfp(sf, 'agents/developer.md')), 'MY EDITS', 'disk untouched in dry-run');
});

test('--dry-run reports actions but writes nothing to disk', () => {
  const { proj, sf, newKit } = install();
  fs.writeFileSync(path.join(newKit, 'SPECTOFLOW.md'), 'NEW BRAIN');
  const before = read(sfp(sf, 'SPECTOFLOW.md'));
  const beforeVer = manifest.readManifest(sf).version;
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9', dryRun: true });
  assert.strictEqual(report.dryRun, true);
  assert.ok(report.refreshed.includes('SPECTOFLOW.md'), 'still reports the refresh it would do');
  assert.strictEqual(read(sfp(sf, 'SPECTOFLOW.md')), before, 'file untouched in dry-run');
  assert.strictEqual(manifest.readManifest(sf).version, beforeVer, 'manifest untouched in dry-run');
});

test('update links an existing root AGENTS.md that never got the spectoflow pointer', () => {
  const { proj, newKit } = install();
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), '# Team conventions\n');
  const dry = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9', dryRun: true });
  assert.deepStrictEqual(dry.pointers.appended, ['AGENTS.md']);
  assert.strictEqual(read(path.join(proj, 'AGENTS.md')), '# Team conventions\n', 'dry-run writes nothing');
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9' });
  assert.deepStrictEqual(report.pointers.appended, ['AGENTS.md']);
  assert.match(read(path.join(proj, 'AGENTS.md')), /^# Team conventions\n\n<!-- spectoflow:start -->/);
  assert.deepStrictEqual(runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9' }).pointers, { appended: [], repointed: [] }, 'second run: nothing to do');
});

// ---- 0.28 migration: the brain `.spectoflow/AGENTS.md` became `.spectoflow/SPECTOFLOW.md` ----------
// Turn a fresh install into the pre-0.28 layout: brain file + manifest key under the old name, and
// every root pointer naming the old path.
function installLegacy() {
  const inst = install();
  const { proj, sf } = inst;
  fs.renameSync(sfp(sf, 'SPECTOFLOW.md'), sfp(sf, 'AGENTS.md'));
  const m = manifest.readManifest(sf);
  m.files['AGENTS.md'] = m.files['SPECTOFLOW.md']; delete m.files['SPECTOFLOW.md'];
  manifest.writeManifest(sf, m);
  for (const rel of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.claude/commands/spectoflow.md']) {
    const fp = path.join(proj, rel);
    if (fs.existsSync(fp)) fs.writeFileSync(fp, read(fp).split('.spectoflow/SPECTOFLOW.md').join('.spectoflow/AGENTS.md'));
  }
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), '# AGENTS.md — spectoflow\n\nRead `.spectoflow/AGENTS.md` and follow it.\n');
  return inst;
}

test('0.28 migration: an untouched brain moves to SPECTOFLOW.md — not reported as removed + created', () => {
  const { proj, sf, newKit } = installLegacy();
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '0.28.0' });
  assert.strictEqual(report.migration.renamedBrain, true);
  assert.ok(fs.existsSync(sfp(sf, 'SPECTOFLOW.md')) && !fs.existsSync(sfp(sf, 'AGENTS.md')), 'moved, old name gone');
  assert.strictEqual(read(sfp(sf, 'SPECTOFLOW.md')), read(path.join(newKit, 'SPECTOFLOW.md')));
  assert.ok(!report.created.includes('SPECTOFLOW.md') && !report.removed.includes('AGENTS.md') && !report.kept.includes('AGENTS.md'));
  const files = manifest.readManifest(sf).files;
  assert.ok(files['SPECTOFLOW.md'] && !('AGENTS.md' in files), 'manifest follows the new name');
  const again = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '0.28.0' });
  assert.strictEqual(again.migration.renamedBrain, false, 'a second run has nothing to migrate');
  assert.ok(again.unchanged.includes('SPECTOFLOW.md'));
});

test('0.28 migration: an edited brain keeps the user edits under the new name, with the kit version as .new', () => {
  const { proj, sf, newKit } = installLegacy();
  fs.writeFileSync(sfp(sf, 'AGENTS.md'), read(sfp(sf, 'AGENTS.md')) + '\n## My house rule\nAlways write tests first.\n');
  const edited = read(sfp(sf, 'AGENTS.md'));
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '0.28.0' });
  assert.strictEqual(read(sfp(sf, 'SPECTOFLOW.md')), edited, 'the edits came along, untouched');
  assert.ok(report.newSidecar.includes('SPECTOFLOW.md'));
  assert.strictEqual(read(sfp(sf, 'SPECTOFLOW.md.new')), read(path.join(newKit, 'SPECTOFLOW.md')));
  assert.ok(!fs.existsSync(sfp(sf, 'AGENTS.md')));
});

test('0.28 migration: root pointers and user-generated skills are repointed; dry-run moves and writes nothing', () => {
  const { proj, sf, newKit } = installLegacy();
  const skillDir = sfp(sf, 'skills/my-review');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'Routing lives in `.spectoflow/AGENTS.md`.\n');

  const dry = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '0.28.0', dryRun: true });
  assert.strictEqual(dry.migration.renamedBrain, true);
  assert.ok(dry.pointers.repointed.includes('AGENTS.md'));
  assert.deepStrictEqual(dry.migration.repointedUserFiles, ['skills/my-review/SKILL.md']);
  assert.ok(!dry.created.includes('SPECTOFLOW.md') && !dry.removed.includes('AGENTS.md'), 'dry-run reports the move, not a remove + create');
  assert.ok(fs.existsSync(sfp(sf, 'AGENTS.md')) && !fs.existsSync(sfp(sf, 'SPECTOFLOW.md')), 'dry-run moved nothing');
  assert.match(read(path.join(proj, 'AGENTS.md')), /\.spectoflow\/AGENTS\.md/, 'dry-run rewrote nothing');

  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '0.28.0' });
  for (const rel of ['CLAUDE.md', 'AGENTS.md', '.claude/commands/spectoflow.md']) {
    const fp = path.join(proj, rel);
    if (!fs.existsSync(fp)) continue;
    assert.ok(!read(fp).includes('.spectoflow/AGENTS.md'), `${rel} no longer names the old brain`);
    assert.match(read(fp), /\.spectoflow\/SPECTOFLOW\.md/);
  }
  assert.ok(report.pointers.repointed.includes('AGENTS.md'));
  assert.deepStrictEqual(report.pointers.appended, [], 'a repointed file gets no second pointer section');
  assert.strictEqual(read(path.join(skillDir, 'SKILL.md')), 'Routing lives in `.spectoflow/SPECTOFLOW.md`.\n');
});
