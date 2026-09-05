'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-dinit-'));
const run = (h, args, opts = {}) => execFileSync('node', [BIN, ...args], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: h }, ...opts });

test('dashboard init creates the default workspace and reports where it is', () => {
  const h = home();
  const out = run(h, ['dashboard', 'init']);
  assert.match(out, /workspace/i);
  assert.ok(fs.existsSync(path.join(h, 'dashboard', 'dashboard.json')));
});

test('dashboard init --path --port --name writes them and points the global config at the path', () => {
  const h = home();
  const target = path.join(h, 'team-hub');
  run(h, ['dashboard', 'init', `--path=${target}`, '--port=4555', '--name=Team']);
  const s = JSON.parse(fs.readFileSync(path.join(target, 'dashboard.json'), 'utf8'));
  assert.strictEqual(s.port, 4555); assert.strictEqual(s.name, 'Team');
  assert.strictEqual(run(h, ['config', 'get', 'dashboard.path']).trim(), target);
});

test('spectoflow dashboard with no TTY and no dashboard.url stores the local default without prompting', () => {
  const h = home();
  // `status` exercises resolveDashboardUrl() without starting a server.
  run(h, ['dashboard', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(run(h, ['config', 'get', 'dashboard.url']).trim(), 'http://localhost:4319');
});

test('spectoflow dashboard --url=<remote> stores it and explains remote dashboards are not managed yet', () => {
  const h = home();
  const out = run(h, ['dashboard', 'status', '--url=https://dashboard.example.com'], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /later release|not managed yet|coming/i);
  assert.strictEqual(run(h, ['config', 'get', 'dashboard.url']).trim(), 'https://dashboard.example.com');
});

test('dashboard login is reserved: exits 0 with the same message', () => {
  const r = spawnSync('node', [BIN, 'dashboard', 'login'], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: home() } });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /later release|coming/i);
});
