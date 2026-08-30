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
  fs.writeFileSync(path.join(newKit, 'AGENTS.md'), 'NEW BRAIN');
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9' });
  assert.ok(report.refreshed.includes('AGENTS.md'), 'reported refreshed');
  assert.strictEqual(read(sfp(sf, 'AGENTS.md')), 'NEW BRAIN', 'file rewritten');
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

test('--dry-run reports actions but writes nothing to disk', () => {
  const { proj, sf, newKit } = install();
  fs.writeFileSync(path.join(newKit, 'AGENTS.md'), 'NEW BRAIN');
  const before = read(sfp(sf, 'AGENTS.md'));
  const beforeVer = manifest.readManifest(sf).version;
  const report = runUpdate({ projectRoot: proj, templatesDir: newKit, version: '9.9.9', dryRun: true });
  assert.strictEqual(report.dryRun, true);
  assert.ok(report.refreshed.includes('AGENTS.md'), 'still reports the refresh it would do');
  assert.strictEqual(read(sfp(sf, 'AGENTS.md')), before, 'file untouched in dry-run');
  assert.strictEqual(manifest.readManifest(sf).version, beforeVer, 'manifest untouched in dry-run');
});
