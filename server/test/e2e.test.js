'use strict';
/*
 * Real end-to-end proof of sub-project C1 (online dashboard connector): spawn the actual local hub
 * process, drive it through the real CLI (`login`, `publish`), and confirm a browser-facing request
 * against a real (in-process) server instance genuinely reaches and mutates the real project's
 * markdown files — over BOTH transports (WebSocket and HTTP fallback) — plus offline degradation and
 * reconnection. No fakes anywhere in this file: the connector, the relay, the CLI and the hub are all
 * the genuine modules; only the database is sqlite::memory: and the ports are ephemeral.
 *
 * Three adaptations versus a naive reading of this sub-project's other tests, all mechanical and
 * matching an established pattern elsewhere in this same sub-project (see server/test/relay.test.js
 * and test/cli-remote.test.js):
 *   1. Every /api/* and /api/hub/* route on the SERVER sits behind the session-cookie auth
 *      (server/src/auth.js) regardless of `insecureDev` (that flag only relaxes the cookie's `secure`
 *      attribute for non-HTTPS local testing, never the auth check itself) — so this test signs up
 *      (which also logs in) via POST /signup once per scenario and threads the cookie through every
 *      subsequent server request, exactly like relay.test.js's `authedFetch`. Plain, unauthenticated
 *      fetches are only ever made against the *local hub* (lib/dashboard/hub-server.js), which has no
 *      login of its own.
 *   2. `spectoflow dashboard publish` resolves the project by looking it up in the registry
 *      (`registry.findByPath(cwd)`) — a project must already be registered before it can be published.
 *      Normally `spectoflow dashboard` does this registration as a side effect, but this test drives
 *      the hub directly (for full control over its port/lifecycle) rather than through that command,
 *      so it registers the project explicitly via `workspace.registerProject`, exactly as
 *      test/cli-remote.test.js's "publish/unpublish flip the flag… by cwd" test already does.
 *   3. `dashboard login`/`dashboard publish` are driven via an async, non-blocking `spawn()` +
 *      awaited exit — never `execFileSync` — because the server they talk to (`url`, from
 *      `bootServer()`) runs IN THIS SAME PROCESS. A synchronous child-process call blocks this
 *      process's own event loop until the child exits, which would freeze the very Fastify server the
 *      child is trying to reach — a self-deadlock broken only by the child's own fetch timeout. This
 *      is the exact hazard test/cli-remote.test.js's own `run()` helper documents and avoids; `init`
 *      alone stays `execFileSync` below since it never talks to a server, only scaffolds local files.
 *
 * Timing note (HTTP transport only): the connector's HTTP-poll registry marks a machine offline via a
 * periodic sweep with a fixed 40-second staleness window (server/src/connector.js — not configurable,
 * and out of this task's scope to change), refreshed by the machine's own poll loop roughly every
 * <=25s regardless of activity — so after killing the hub, the server can take up to ~45s to notice a
 * silent HTTP-transport machine (WebSocket notices near-instantly on socket close). This is real,
 * expected latency, not flakiness — the http scenario below budgets for it explicitly.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createDb } = require('../src/db');
const { buildApp } = require('../src/app');
const workspace = require('../../lib/workspace');

const KIT = path.resolve(__dirname, '..', '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const HUB = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');
async function bootServer() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, insecureDev: true, publicDir: path.join(KIT, 'lib', 'dashboard', 'public') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  // Every /api/* route sits behind the real session-cookie auth (server/src/auth.js) — sign up a
  // real, fresh test account (also logs it in, per Task 5's /signup) and thread the cookie through
  // every subsequent request, matching server/test/relay.test.js's own `authedFetch` pattern.
  const signupRes = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'e2e-test@example.com', password: 'a-real-password-123' }) });
  const cookie = signupRes.headers.get('set-cookie').split(';')[0];
  const authedFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });
  return { app, db, url, authedFetch };
}
function createToken(db, name) { const m = db.createMachine(name); return m.ready.then(() => m); }
// Async, non-blocking CLI invocation — see file header point 3. Never execFileSync for a command
// that talks to the in-process server: that would freeze this process's own event loop (and so the
// Fastify server itself) until the child exits.
function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN, ...args], { stdio: 'pipe', ...opts });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => (status === 0 ? resolve({ status, stdout, stderr }) : reject(new Error(`${args.join(' ')} exited ${status}\n${stdout}${stderr}`))));
  });
}
function startHub(home, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [HUB], { env: { ...process.env, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(srv); });
  });
}
const hubPort = () => 5500 + Math.floor(Math.random() * 200);

async function runOneScenario(transport) {
  const { app, db, url, authedFetch } = await bootServer();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `stf-e2e-${transport}-`));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `stf-e2e-proj-${transport}-`));
  execFileSync('node', [BIN, 'init', projectDir], { stdio: 'pipe' });
  const machine = await createToken(db, `e2e-${transport}`);
  const P = hubPort();
  let hub = null;
  try {
    // 1) login + publish, entirely through the real CLI, against the real running server.
    const env = { ...process.env, SPECTOFLOW_HOME: home };
    await run(['dashboard', 'login', `--url=${url}`, `--token=${machine.token}`, `--transport=${transport}`, '--name=e2e-box'], { env });
    // `dashboard publish` resolves the project via the registry — register it explicitly (this test
    // drives the hub directly rather than through `spectoflow dashboard`, which would normally do
    // this registration itself), matching test/cli-remote.test.js's established pattern.
    const localEntry = workspace.registerProject(projectDir, path.join(home, 'dashboard'));
    await run(['dashboard', 'publish'], { env, cwd: projectDir });

    // 2) start the real local hub; it reads remote.json and connects.
    hub = await startHub(home, P);
    let listed = null;
    for (let i = 0; i < 100 && !listed; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const rows = (await (await authedFetch('/api/hub/projects')).json()).projects;
      if (rows.length) listed = rows[0];
    }
    assert.ok(listed, 'the project appears on the server within 10s');
    assert.strictEqual(listed.online, true);
    const serverId = listed.id;

    // 3) drive it from "a second browser tab": read, then write, then re-read and see the write.
    const before = await (await authedFetch(`/api/project?p=${serverId}`)).json();
    assert.notStrictEqual(before.online, false);
    const add = await authedFetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `via ${transport}` }) });
    assert.strictEqual(add.status, 200, await add.text());
    let sawIt = false;
    for (let i = 0; i < 50 && !sawIt; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const after = await (await authedFetch(`/api/project?p=${serverId}`)).json();
      sawIt = JSON.stringify(after.plans).includes(`via ${transport}`);
    }
    assert.ok(sawIt, 'the remote write is visible reading the project back through the server');
    // also visible locally — same process, same file, no dual state (the local hub has no login of
    // its own, so this is a plain fetch; localEntry.id is the id this same project was registered
    // under in this hub's own registry, captured above rather than re-derived over HTTP):
    const localBoard = await (await fetch(`http://localhost:${P}/api/project?p=${localEntry.id}`)).json();
    assert.ok(JSON.stringify(localBoard.plans).includes(`via ${transport}`));

    // 4) kill the hub: a write 503s, a read falls back to the last snapshot with online:false.
    hub.kill();
    // WebSocket notices a dropped socket almost instantly; the HTTP long-poll transport only goes
    // offline once the connector's periodic sweep finds no poll activity for 40s (see file header) —
    // budget accordingly instead of racing a fixed, transport-blind timeout.
    const offlineBudgetMs = transport === 'http' ? 70000 : 10000;
    let wentOffline = false;
    for (let waited = 0; waited < offlineBudgetMs && !wentOffline; waited += 250) {
      await new Promise((r) => setTimeout(r, 250));
      const rows = (await (await authedFetch('/api/hub/projects')).json()).projects;
      wentOffline = rows.length && rows[0].online === false;
    }
    assert.ok(wentOffline, 'the server notices the machine went away');
    const offlineWrite = await authedFetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'nope' }) });
    assert.strictEqual(offlineWrite.status, 503);
    const offlineRead = await (await authedFetch(`/api/project?p=${serverId}`)).json();
    assert.strictEqual(offlineRead.online, false);
    assert.ok(JSON.stringify(offlineRead.plans).includes(`via ${transport}`), 'offline read still shows the last known state');

    // 5) restart the hub: back online.
    hub = await startHub(home, hubPort());
    let backOnline = false;
    for (let i = 0; i < 100 && !backOnline; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const rows = (await (await authedFetch('/api/hub/projects')).json()).projects;
      backOnline = rows.length && rows[0].online === true;
    }
    assert.ok(backOnline, 'reconnects and is visible online again after a restart');
  } finally {
    if (hub) hub.kill();
    workspace.clearRemote(path.join(home, 'dashboard'));
    await app.close(); await db.destroy();
  }
}

test('end-to-end over WebSocket: login, publish, real hub connects, remote read/write, offline degrade, reconnect', { timeout: 60000 }, () => runOneScenario('ws'));
test('end-to-end over HTTP long-poll: the same scenario with --transport=http', { timeout: 150000 }, () => runOneScenario('http'));
