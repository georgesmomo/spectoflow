'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { startFakeRelay } = require('./helpers/fake-relay');
const workspace = require('../lib/workspace');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-remote-'));
// A real (non-blocking) child spawn, awaited — never spawnSync: several of these tests spawn the
// CLI while a fake relay server listens in *this same process*; spawnSync would freeze this
// process's event loop until the child exits, so the relay could never answer the child's request
// (a self-deadlock broken only by the child's own fetch timeout). Async spawn keeps this process's
// event loop free to service the relay while we await the child's exit.
const run = (h, args, opts = {}) => new Promise((resolve) => {
  const child = spawn('node', [BIN, ...args], { env: { ...process.env, SPECTOFLOW_HOME: h }, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});
const remoteFile = (h) => path.join(h, 'dashboard', 'remote.json');

test('login validates the token against /connector/whoami, writes remote.json (0600) and dashboard.url, never echoes the token', async () => {
  const relay = await startFakeRelay(); const h = home();
  try {
    const r = await run(h, ['dashboard', 'login', `--url=${relay.url}/`, `--token=${relay.token}`, '--name=my-laptop']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /logged in/i);
    assert.ok(!r.stdout.includes(relay.token));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(remoteFile(h), 'utf8')), { url: relay.url, token: relay.token, machineName: 'my-laptop', transport: 'ws' });
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(remoteFile(h)).mode & 0o777, 0o600);
    assert.strictEqual((await run(h, ['config', 'get', 'dashboard.url'])).stdout.trim(), relay.url);
  } finally { await relay.close(); }
});

test('login: a rejected token exits 1 and writes nothing; --name defaults to the hostname; --transport=http is stored', async () => {
  const relay = await startFakeRelay(); const h = home();
  try {
    const bad = await run(h, ['dashboard', 'login', `--url=${relay.url}`, '--token=spf_wrong']);
    assert.strictEqual(bad.status, 1); assert.match(bad.stdout, /rejected/i); assert.ok(!fs.existsSync(remoteFile(h)));
    const ok = await run(h, ['dashboard', 'login', `--url=${relay.url}`, `--token=${relay.token}`, '--transport=http']);
    assert.strictEqual(ok.status, 0, ok.stdout);
    const w = JSON.parse(fs.readFileSync(remoteFile(h), 'utf8'));
    assert.strictEqual(w.transport, 'http'); assert.strictEqual(w.machineName, os.hostname());
    const weird = await run(h, ['dashboard', 'login', `--url=${relay.url}`, `--token=${relay.token}`, '--transport=carrier-pigeon']);
    assert.strictEqual(weird.status, 1); assert.match(weird.stdout, /ws or http/);
  } finally { await relay.close(); }
});

test('login without --url/--token prints usage and exits 1; an unreachable server is a clean error', async () => {
  const h = home();
  const r = await run(h, ['dashboard', 'login']);
  assert.strictEqual(r.status, 1); assert.match(r.stdout, /Usage: spectoflow dashboard login/);
  const down = await run(h, ['dashboard', 'login', '--url=http://127.0.0.1:9', '--token=spf_x']);
  assert.strictEqual(down.status, 1); assert.match(down.stdout, /could not reach/i); assert.ok(!/at .*\.js:\d+/.test(down.stderr), 'no stack trace');
});

test('logout removes remote.json and resets dashboard.url to the local default', async () => {
  const relay = await startFakeRelay(); const h = home();
  try {
    await run(h, ['dashboard', 'login', `--url=${relay.url}`, `--token=${relay.token}`]);
    const r = await run(h, ['dashboard', 'logout']);
    assert.strictEqual(r.status, 0); assert.match(r.stdout, /logged out/i);
    assert.ok(!fs.existsSync(remoteFile(h)));
    assert.strictEqual((await run(h, ['config', 'get', 'dashboard.url'])).stdout.trim(), 'http://localhost:4319');
    assert.match((await run(h, ['dashboard', 'logout'])).stdout, /not logged in/i);
  } finally { await relay.close(); }
});

test('publish/unpublish flip the flag in meta.json — by cwd, and by --id', async () => {
  const h = home(); const base = path.join(h, 'dashboard');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-pub-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const entry = workspace.registerProject(d, base);
  let r = await run(h, ['dashboard', 'publish'], { cwd: d });
  assert.strictEqual(r.status, 0, r.stdout); assert.match(r.stdout, /published/); assert.match(r.stdout, /not logged in/i);
  assert.strictEqual(workspace.isPublished(entry.id, base), true);
  r = await run(h, ['dashboard', 'unpublish', `--id=${entry.id}`]);
  assert.strictEqual(r.status, 0); assert.strictEqual(workspace.isPublished(entry.id, base), false);
  r = await run(h, ['dashboard', 'publish', '--id=zzzzzz']);
  assert.strictEqual(r.status, 1); assert.match(r.stdout, /no project registered/i);
  const stranger = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-unreg-'));
  r = await run(h, ['dashboard', 'publish'], { cwd: stranger });
  assert.strictEqual(r.status, 1); assert.match(r.stdout, /spectoflow dashboard/);
});

test('status prints the online line once logged in (hub not running here)', async () => {
  const relay = await startFakeRelay(); const h = home();
  try {
    await run(h, ['dashboard', 'login', `--url=${relay.url}`, `--token=${relay.token}`]);
    const r = await run(h, ['dashboard', 'status']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /hub not running/);
    assert.match(r.stdout, new RegExp('online → ' + relay.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(!r.stdout.includes('later release'));
  } finally { await relay.close(); }
});
