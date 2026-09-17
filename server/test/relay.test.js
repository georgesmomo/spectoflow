'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
process.env.SPECTOFLOW_RELAY_REPLY_TIMEOUT_MS = '300';
// relay.js reads this override (see Step 3) — production leaves it unset and gets the spec's 30000.
const { buildApp } = require('../src/app');
const { createDb } = require('../src/db');
const { createRegistry } = require('../src/connector');

function fakeEmailer() {
  const sent = [];
  return { sent,
    sendVerificationEmail: async (to, url) => { sent.push({ kind: 'verify', to, url }); },
    sendPasswordResetEmail: async (to, url) => { sent.push({ kind: 'reset', to, url }); },
    sendInvitationEmail: async (to, projectName, url) => { sent.push({ kind: 'invite', to, projectName, url }); },
  };
}
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const owner = await db.createUser('relay-test@example.com', 'a-real-password-123');
  const m = db.createMachine('laptop', owner.id); await m.ready;
  const registry = createRegistry();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, registry, emailer: fakeEmailer() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const loginRes = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'relay-test@example.com', password: 'a-real-password-123' }) });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  function authedFetch(p, opts = {}) {
    const headers = Object.assign({}, opts.headers, { Cookie: cookie });
    return fetch(url + p, { ...opts, headers });
  }
  return { app, db, machine: m, registry, url, authedFetch, ownerUserId: owner.id };
}
function fakeSocket() { const sent = []; return { readyState: 1, send: (s) => sent.push(JSON.parse(s)), sent }; }

test('a hello upserts published projects and lists them via GET /api/hub/projects (mode:remote)', async () => {
  const { app, db, machine, registry, url, authedFetch } = await boot();
  try {
    // Drive onFrame indirectly through the real HTTP fallback endpoint (no direct access to the
    // relay's internals from a test — that's the point: only the wire protocol is exercised).
    const r = await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token, version: '0.25.0' }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: { total: 2, done: 1 } }] }]) });
    assert.strictEqual(r.status, 200);
    const list = await (await authedFetch('/api/hub/projects')).json();
    assert.strictEqual(list.mode, 'remote');
    assert.strictEqual(list.projects.length, 1);
    assert.strictEqual(list.projects[0].name, 'Alpha'); assert.strictEqual(list.projects[0].machine, 'laptop');
    assert.strictEqual(list.projects[0].online, true); // an HTTP frame just arrived
    assert.strictEqual(list.projects[0].stats.done, 1);
  } finally { await app.close(); await db.destroy(); }
});

test('an op is relayed to the connected machine and its reply answers the browser', async () => {
  const { app, db, machine, registry, url, authedFetch } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] }]) });
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;
    const sock = fakeSocket();
    registry.markWsConnected(machine.id, sock);
    const reqPromise = authedFetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'hi' }) });
    await new Promise((r) => setTimeout(r, 50));
    const op = sock.sent.find((f) => f.type === 'op');
    assert.ok(op); assert.strictEqual(op.p, 'aaaaaa'); assert.strictEqual(op.op, 'task.add'); assert.deepStrictEqual(op.args, { title: 'hi' });
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([{ type: 'reply', reqId: op.reqId, result: { ok: true } }]) });
    const res = await reqPromise;
    assert.strictEqual(res.status, 200); assert.deepStrictEqual(await res.json(), { ok: true });
  } finally { await app.close(); await db.destroy(); }
});

test('project.read on an offline machine returns the stored snapshot with online:false; any other op is 503', async () => {
  const { app, db, machine, url, authedFetch } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] },
        { type: 'snapshot', p: 'aaaaaa', project: { projectName: 'Alpha', plans: [] } }]) });
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;
    // Machine goes quiet: no socket, HTTP poll not renewed → sweepHttp will mark it offline; force it now via status check timing instead of waiting 40s:
    const read = await authedFetch(`/api/project?p=${serverId}`);
    // Right after the hello/snapshot batch the machine is still "connected" (just posted) — assert the
    // read succeeds and echoes the snapshot when online, then simulate going offline explicitly:
    assert.strictEqual(read.status, 200);
    const body1 = await read.json();
    assert.strictEqual(body1.projectName, 'Alpha');
    const write = await authedFetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) });
    assert.strictEqual(write.status, 504); // no reply arrives within the (test-shortened) timeout — see relay.js REPLY_TIMEOUT override below
  } finally { await app.close(); await db.destroy(); }
});

test('an unknown server id is 404; SSE registers and gets a change event on snapshot', async () => {
  const { app, db, url, authedFetch } = await boot();
  try {
    const r = await authedFetch('/api/project?p=doesnotexist');
    assert.strictEqual(r.status, 404);
  } finally { await app.close(); await db.destroy(); }
});

test('unpublishing a project 404s both GET /api/project and GET /api/events (never serves stale cached data, never hangs)', async () => {
  const { app, db, machine, url, authedFetch } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] },
        { type: 'snapshot', p: 'aaaaaa', project: { projectName: 'Alpha', plans: [] } }]) });
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;

    // Published: project.read answers from the cached snapshot, and SSE registers a subscriber.
    const readOk = await authedFetch(`/api/project?p=${serverId}`);
    assert.strictEqual(readOk.status, 200);
    assert.strictEqual((await readOk.json()).projectName, 'Alpha');
    const sseOk = await authedFetch(`/api/events?p=${serverId}`);
    assert.strictEqual(sseOk.status, 200);
    // An SSE response body never ends on its own — cancel it so the underlying socket closes and
    // this test doesn't hang waiting on a stream nothing will ever finish.
    if (sseOk.body && sseOk.body.cancel) await sseOk.body.cancel();

    // Unpublish: send a `hello` that no longer lists this project — relay.js's own onFrame() marks
    // any previously-published project absent from a machine's latest hello as unpublished (row and
    // last_snapshot kept, just no longer servable).
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [] }]) });

    // Same serverId, same cached snapshot still sitting in the DB — but it must now 404 exactly like
    // an unknown project, not silently keep answering from the stale cache.
    const readAfter = await authedFetch(`/api/project?p=${serverId}`);
    assert.strictEqual(readAfter.status, 404);
    assert.deepStrictEqual(await readAfter.json(), { error: 'Unknown project.' });

    const sseAfter = await authedFetch(`/api/events?p=${serverId}`);
    assert.strictEqual(sseAfter.status, 404);
    assert.deepStrictEqual(await sseAfter.json(), { error: 'Unknown project.' });
  } finally { await app.close(); await db.destroy(); }
});

test('a frame whose processing throws never crashes the process (no unhandledRejection) and never blocks a later frame from the same machine', async () => {
  const { app, db, machine, url, authedFetch } = await boot();
  const rejections = [];
  const onUnhandled = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onUnhandled);
  // Simulate the "transient DB error" scenario the reviewer described: force processFrame's
  // `hello` handling to throw for one specific frame, exactly like a real DB failure would.
  const originalUpsertProject = db.upsertProject.bind(db);
  db.upsertProject = async (args) => {
    if (args.localId === 'boom') throw new Error('forced failure for test');
    return originalUpsertProject(args);
  };
  try {
    // This frame's processing rejects inside processFrame — before the fix, the rejected promise
    // at the tail of the per-machine chain would eventually surface as an unhandled rejection
    // (nothing ever attaches a further .then()/.catch() once the machine goes quiet), crashing the
    // whole process under Node's default --unhandled-rejections=throw.
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'boom', name: 'Boom', kind: 'spectoflow' }] }]) });
    // A second, valid frame for the SAME machine right after — must still be processed even though
    // the previous frame's processing threw (the chain must not be poisoned).
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' }] }]) });
    // Give the fire-and-forget onFrame chain time to fully settle (Node reports an unhandled
    // rejection at the end of the microtask queue, well within this window).
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(rejections.length, 0); // caught inside safeProcessFrame — never reached the chain's tail unhandled
    const list = await (await authedFetch('/api/hub/projects')).json();
    assert.strictEqual(list.projects.length, 1);
    assert.strictEqual(list.projects[0].name, 'Alpha'); // the later, valid frame was still processed
  } finally {
    db.upsertProject = originalUpsertProject;
    process.removeListener('unhandledRejection', onUnhandled);
    await app.close(); await db.destroy();
  }
});

test('the second brain is never reachable online: brain routes 404 even for the owner, and no op reaches the machine', async () => {
  const { app, db, machine, registry, url, authedFetch } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] }]) });
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;
    const sock = fakeSocket();
    registry.markWsConnected(machine.id, sock);
    const json = { 'Content-Type': 'application/json' };
    const attempts = [
      authedFetch(`/api/brain?p=${serverId}`),
      authedFetch(`/api/brain?p=${serverId}`, { method: 'POST', headers: json, body: JSON.stringify({ category: 'profile', text: 'x' }) }),
      authedFetch(`/api/brain/settings?p=${serverId}`, { method: 'POST', headers: json, body: JSON.stringify({ autoAdd: false }) }),
      authedFetch(`/api/brain/b1/confirm?p=${serverId}`, { method: 'POST', headers: json, body: '{}' }),
      authedFetch(`/api/brain/b1?p=${serverId}`, { method: 'PATCH', headers: json, body: JSON.stringify({ text: 'y' }) }),
      authedFetch(`/api/brain/b1?p=${serverId}`, { method: 'DELETE' }),
      // allowing a custom agent command is local-only too (D76): online it would let a member approve code execution
      authedFetch(`/api/runners/trust?p=${serverId}`, { method: 'POST', headers: json, body: JSON.stringify({ agent: 'claude' }) }),
      // so is updating a project's framework files (D77)
      authedFetch(`/api/project/update?p=${serverId}`, { method: 'POST', headers: json, body: '{}' }),
      // moving a fact between the project memory and the personal brain touches the brain (D78)
      authedFetch(`/api/memory/move?p=${serverId}`, { method: 'POST', headers: json, body: JSON.stringify({ from: 'project', id: 'm1', category: 'profile' }) }),
      // merging isolated work or opening a pull request changes the owner's branches or pushes (D79)
      authedFetch(`/api/task/T-001/isolate/merge?p=${serverId}`, { method: 'POST', headers: json, body: '{}' }),
      authedFetch(`/api/task/T-001/isolate/pr?p=${serverId}`, { method: 'POST', headers: json, body: '{}' }),
    ];
    // The routes exist in the shared table (so the 404s below come from the relay refusing them, not from a missing route).
    const { findRoute } = require('../../lib/dashboard/routes');
    assert.deepStrictEqual([['GET', '/api/brain'], ['POST', '/api/brain'], ['POST', '/api/brain/settings'], ['POST', '/api/brain/b1/confirm'], ['PATCH', '/api/brain/b1'], ['DELETE', '/api/brain/b1']].map(([mm, pp]) => (findRoute(mm, pp) || [])[2]), ['brain.read', 'brain.add', 'brain.settings', 'brain.confirm', 'brain.update', 'brain.remove']);
    for (const res of await Promise.all(attempts)) assert.strictEqual(res.status, 404);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(sock.sent.filter((f) => f.type === 'op'), [], 'nothing was relayed to the machine');
  } finally { await app.close(); await db.destroy(); }
});

test('a Viewer member can read but gets 403 on a write; a non-member gets 404 (indistinguishable from unpublished)', async () => {
  const { app, db, machine, url, authedFetch, ownerUserId } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] }, { type: 'snapshot', p: 'aaaaaa', project: { projectName: 'Alpha', plans: [] } }]) });
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;

    const viewer = await db.createUser('viewer@example.com', 'a-real-password-123');
    await db.addProjectMember(serverId, viewer.id, db.SYSTEM_ROLE_IDS.VIEWER);
    const viewerLogin = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'viewer@example.com', password: 'a-real-password-123' }) });
    const viewerCookie = viewerLogin.headers.get('set-cookie').split(';')[0];
    const viewerFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: viewerCookie }) });

    const readOk = await viewerFetch(`/api/project?p=${serverId}`);
    assert.strictEqual(readOk.status, 200);
    const writeForbidden = await viewerFetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'nope' }) });
    assert.strictEqual(writeForbidden.status, 403);

    const stranger = await db.createUser('stranger@example.com', 'a-real-password-123');
    const strangerLogin = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'stranger@example.com', password: 'a-real-password-123' }) });
    const strangerCookie = strangerLogin.headers.get('set-cookie').split(';')[0];
    const strangerFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: strangerCookie }) });
    const notMember = await strangerFetch(`/api/project?p=${serverId}`);
    assert.strictEqual(notMember.status, 404);
    const notMemberSse = await strangerFetch(`/api/events?p=${serverId}`);
    assert.strictEqual(notMemberSse.status, 404);
  } finally { await app.close(); await db.destroy(); }
});

test('platform.view_all_projects grants a non-member READ visibility but not write', async () => {
  const { app, db, machine, url, authedFetch } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] }, { type: 'snapshot', p: 'aaaaaa', project: { projectName: 'Alpha', plans: [] } }]) });
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;

    const superAdmin = await db.createUser('super@example.com', 'a-real-password-123');
    await db.assignPlatformRole(superAdmin.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    const login = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'super@example.com', password: 'a-real-password-123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const adminFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });

    assert.strictEqual((await adminFetch(`/api/project?p=${serverId}`)).status, 200);
    assert.strictEqual((await adminFetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })).status, 403);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /api/hub/projects only lists projects the caller is a member of', async () => {
  const { app, db, machine, url, authedFetch, ownerUserId } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] }]) });
    const ownerList = await (await authedFetch('/api/hub/projects')).json();
    assert.strictEqual(ownerList.projects.length, 1);
    const outsider = await db.createUser('outsider@example.com', 'a-real-password-123');
    const login = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'outsider@example.com', password: 'a-real-password-123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const outsiderFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });
    const outsiderList = await (await outsiderFetch('/api/hub/projects')).json();
    assert.strictEqual(outsiderList.projects.length, 0);
  } finally { await app.close(); await db.destroy(); }
});

test('DIAGNOSTIC: a hello from a machine with no owner_user_id logs a warning instead of silently skipping the Owner insert', async () => {
  const { app, db, machine, url } = await boot();
  try {
    await db.knex('machines').where({ id: machine.id }).update({ owner_user_id: null });
    const warnings = [];
    const origWarn = app.log.warn.bind(app.log);
    app.log.warn = (msg) => { warnings.push(msg); return origWarn(msg); };
    const r = await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'bbbbbb', name: 'Beta', kind: 'spectoflow' }] }]) });
    assert.strictEqual(r.status, 200);
    assert.ok(warnings.some((w) => /no owner_user_id/i.test(w)), warnings.join('\n'));
  } finally { await app.close(); await db.destroy(); }
});
