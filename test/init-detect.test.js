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
  const proj = runInit(['--agent=gemini'], { ...process.env, PATH: bindir() });
  assert.strictEqual(cfg(proj).agent, 'gemini');
  assert.ok(fs.existsSync(path.join(proj, 'GEMINI.md')), 'GEMINI.md shim');
  assert.ok(cfg(proj).runners.gemini, 'gemini runner seeded');
});

test('auto-detection picks the detected agent as active (no --agent given)', () => {
  const proj = runInit([], { ...process.env, PATH: bindir('gemini') }); // only gemini on PATH
  assert.strictEqual(cfg(proj).agent, 'gemini');
  assert.ok(fs.existsSync(path.join(proj, 'GEMINI.md')));
});

test('nothing detected falls back to claude + codex', () => {
  const proj = runInit([], { ...process.env, PATH: bindir() }); // empty PATH, no agent dirs
  assert.strictEqual(cfg(proj).agent, 'claude');
  assert.ok(fs.existsSync(path.join(proj, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(proj, 'AGENTS.md')));
});
