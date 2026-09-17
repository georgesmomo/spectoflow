'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const NODE = process.execPath;

function tmp(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
function bindir(...bins) {
  const d = tmp('stf-bin-');
  for (const b of bins) fs.writeFileSync(path.join(d, b), '');
  return d;
}
function runInit(args, env) {
  const dir = tmp('stf-initd-');
  execFileSync(NODE, [BIN, 'init', dir, ...args], { stdio: 'pipe', env });
  return dir;
}
const cfg = (proj) => JSON.parse(fs.readFileSync(path.join(proj, '.spectoflow', 'config.json'), 'utf8'));

test('explicit --agent= sets the active agent and writes its shim + runner', () => {
  const proj = runInit(['--agent=gemini'], { ...process.env, PATH: bindir(), SPECTOFLOW_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'stf-init-home-')) });
  assert.strictEqual(cfg(proj).agent, 'gemini');
  assert.ok(fs.existsSync(path.join(proj, 'GEMINI.md')), 'GEMINI.md shim');
  assert.ok(cfg(proj).runners.gemini, 'gemini runner seeded');
});

test('auto-detection picks the detected agent as active (no --agent given)', () => {
  const proj = runInit([], { ...process.env, PATH: bindir('gemini'), SPECTOFLOW_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'stf-init-home-')) }); // only gemini on PATH
  assert.strictEqual(cfg(proj).agent, 'gemini');
  assert.ok(fs.existsSync(path.join(proj, 'GEMINI.md')));
});

test('nothing detected falls back to claude + codex', () => {
  const proj = runInit([], { ...process.env, PATH: bindir(), SPECTOFLOW_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'stf-init-home-')) }); // empty PATH, no agent dirs
  assert.strictEqual(cfg(proj).agent, 'claude');
  assert.ok(fs.existsSync(path.join(proj, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(proj, 'AGENTS.md')));
});

test('init fits a fresh workflow to the project, sets projectType and asks the agent to review it; an existing workflow.md is untouched', () => {
  const { execFileSync } = require('node:child_process');
  const BIN = require('node:path').join(__dirname, '..', 'bin', 'spectoflow.js');
  const read = (p) => require('node:fs').readFileSync(p, 'utf8');
  const fsx = require('node:fs'), px = require('node:path'), osx = require('node:os');

  const empty = fsx.mkdtempSync(px.join(osx.tmpdir(), 'stf-init-wf-'));
  const out = execFileSync('node', [BIN, 'init', empty, '--agent=claude'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.match(out, /Workflow fitted to the project \(design phase\) — off: Develop, Unit tests, Review \(no code yet\)/);
  assert.match(read(px.join(empty, '.spectoflow', 'workflow.md')), /- \[ \] Develop[\s\S]*- \[ \] Unit tests[\s\S]*- \[ \] Review/);
  const cfg = JSON.parse(read(px.join(empty, '.spectoflow', 'config.json')));
  assert.deepStrictEqual([cfg.projectType, cfg.workflowReview, cfg.workflowAutoEnable], ['app', 'pending', false]);

  const tf = fsx.mkdtempSync(px.join(osx.tmpdir(), 'stf-init-wf-'));
  fsx.writeFileSync(px.join(tf, 'main.tf'), 'x');
  execFileSync('node', [BIN, 'init', tf, '--agent=claude'], { stdio: 'pipe' });
  assert.strictEqual(JSON.parse(read(px.join(tf, '.spectoflow', 'config.json'))).projectType, 'infra');

  const existing = fsx.mkdtempSync(px.join(osx.tmpdir(), 'stf-init-wf-'));
  fsx.mkdirSync(px.join(existing, '.spectoflow'));
  fsx.writeFileSync(px.join(existing, '.spectoflow', 'workflow.md'), '- [x] Develop {cap:implementation skill:implement}\n');
  const out2 = execFileSync('node', [BIN, 'init', existing, '--agent=claude'], { encoding: 'utf8' });
  assert.ok(!/Workflow fitted/.test(out2));
  assert.strictEqual(read(px.join(existing, '.spectoflow', 'workflow.md')), '- [x] Develop {cap:implementation skill:implement}\n');
  assert.strictEqual(JSON.parse(read(px.join(existing, '.spectoflow', 'config.json'))).workflowReview, undefined);
});
