'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');

// Every invocation gets its own SPECTOFLOW_HOME so these tests never touch the real developer
// machine's ~/.spectoflow/projects.json (same isolation convention as SPECTOFLOW_ROOT elsewhere).
function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-registry-home-'));
}
function run(home, args) {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SPECTOFLOW_HOME: home },
  });
}

test('projects list prints a friendly message when nothing is registered yet', () => {
  const home = freshHome();
  const out = run(home, ['projects']);
  assert.match(out, /no projects registered/i);
});

test('projects list shows a registered project\'s id, name and path', () => {
  const home = freshHome();
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-registry-proj-'));
  const registry = require('../lib/registry');
  const entry = registry.addProject(proj, home);
  const out = run(home, ['projects', 'list']);
  assert.ok(out.includes(entry.id));
  assert.ok(out.includes(entry.name));
  assert.ok(out.includes(proj) || out.includes(path.resolve(proj)));
});

test('projects (no subcommand) behaves the same as projects list', () => {
  const home = freshHome();
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-registry-proj2-'));
  const registry = require('../lib/registry');
  const entry = registry.addProject(proj, home);
  const out = run(home, ['projects']);
  assert.ok(out.includes(entry.id));
});

test('projects remove <id> removes a known entry', () => {
  const home = freshHome();
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-registry-proj3-'));
  const registry = require('../lib/registry');
  const entry = registry.addProject(proj, home);
  const out = run(home, ['projects', 'remove', entry.id]);
  assert.match(out, /removed/i);
  assert.strictEqual(registry.readRegistry(home).projects.length, 0);
});

test('projects remove <unknown-id> reports it was not found, without throwing', () => {
  const home = freshHome();
  const out = run(home, ['projects', 'remove', 'ffffff']);
  assert.match(out, /no project/i);
});

test('projects remove with no id prints usage instead of crashing', () => {
  const home = freshHome();
  const out = run(home, ['projects', 'remove']);
  assert.match(out, /usage/i);
});

test('projects -h shows per-command help instead of running the command', () => {
  const home = freshHome();
  const out = run(home, ['projects', '-h']);
  assert.match(out, /spectoflow projects/i);
  assert.match(out, /registered/i);
});
