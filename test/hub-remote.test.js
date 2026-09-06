'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { startFakeRelay } = require('./helpers/fake-relay');
const workspace = require('../lib/workspace');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const HUB = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');
const J = { 'Content-Type': 'application/json' };

function setup(relay, { remote = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hubremote-'));
  const base = path.join(home, 'dashboard');
  const mk = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `stf-hr-${n}-`)); execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' }); return workspace.registerProject(d, base); };
  const a = mk('a'), b = mk('b');
  workspace.setPublished(a.id, true, base);
  if (remote) workspace.writeRemote({ url: relay.url, token: relay.token, machineName: 'hub-under-test', transport: 'ws' }, base);
  return { home, base, a, b };
}
function startHub(home, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [HUB], { env: { ...process.env, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(srv); });
  });
}
const port = () => 5400 + Math.floor(Math.random() * 100);
const api = (p, path_, init) => fetch(`http://127.0.0.1:${p}${path_}`, init);

test('hub connects at boot (auth, hello with only published projects, snapshot); publish/unpublish re-announce', async () => {
  const relay = await startFakeRelay(); const { home, a, b } = setup(relay); const P = port(); const srv = await startHub(home, P);
  try {
    const hello = await relay.waitFor('hello', { timeout: 15000 });
    assert.strictEqual(relay.frames[0].type, 'auth');
    assert.strictEqual(hello.machineName, 'hub-under-test');
    assert.deepStrictEqual(hello.projects.map((p) => p.localId), [a.id]);
    assert.strictEqual(hello.projects[0].name, a.name);
    assert.strictEqual(typeof hello.projects[0].stats.total, 'number');
    const snap = await relay.waitFor('snapshot', { timeout: 15000 });
    assert.strictEqual(snap.p, a.id); assert.strictEqual(snap.project.projectName, a.name);

    let n = relay.frames.length;
    let r = await api(P, `/api/hub/projects/${b.id}/publish`, { method: 'POST', headers: J, body: JSON.stringify({ published: true }) });
    assert.strictEqual(r.status, 200);
    const h2 = await relay.waitFor('hello', { after: n });
    assert.deepStrictEqual(h2.projects.map((p) => p.localId).sort(), [a.id, b.id].sort());
    const list = await (await api(P, '/api/hub/projects')).json();
    assert.strictEqual(list.projects.find((p) => p.id === b.id).published, true);
    assert.strictEqual(list.remote.configured, true); assert.strictEqual(list.remote.connected, true); assert.strictEqual(list.remote.transport, 'ws');

    n = relay.frames.length;
    r = await api(P, `/api/hub/projects/${b.id}/publish`, { method: 'POST', headers: J, body: JSON.stringify({ published: false }) });
    assert.strictEqual(r.status, 200);
    const h3 = await relay.waitFor('hello', { after: n });
    assert.deepStrictEqual(h3.projects.map((p) => p.localId), [a.id]);
    r = await api(P, '/api/hub/projects/zzzzzz/publish', { method: 'POST', headers: J, body: JSON.stringify({ published: true }) });
    assert.strictEqual(r.status, 404);
  } finally { srv.kill(); await relay.close(); }
});

test('a local mutation is teed as an event then a debounced snapshot; relay ops run through the same project', async () => {
  const relay = await startFakeRelay(); const { home, a, b } = setup(relay); const P = port(); const srv = await startHub(home, P);
  try {
    await relay.waitFor('snapshot', { timeout: 15000 });
    let n = relay.frames.length;
    const r = await api(P, `/api/task?p=${a.id}`, { method: 'POST', headers: J, body: JSON.stringify({ title: 'Local task' }) });
    assert.strictEqual(r.status, 200);
    const ev = await relay.waitFor('event', { after: n });
    assert.strictEqual(ev.p, a.id); assert.strictEqual(ev.event.type, 'change');
    const snap = await relay.waitFor('snapshot', { after: n });
    assert.ok(JSON.stringify(snap.project.plans).includes('Local task'));

    n = relay.frames.length;
    relay.send({ type: 'op', reqId: 42, p: a.id, op: 'task.add', args: { title: 'Remote task' } });
    const rep = await relay.waitFor('reply', { after: n });
    assert.strictEqual(rep.reqId, 42); assert.ok(!rep.error, JSON.stringify(rep.error));
    const proj = await (await api(P, `/api/project?p=${a.id}`)).json();
    assert.ok(JSON.stringify(proj.plans).includes('Remote task'), 'the op wrote through the same project');
    await relay.waitFor('event', { after: n });   // the remote op's own emit is teed back up

    n = relay.frames.length;
    relay.send({ type: 'op', reqId: 43, p: b.id, op: 'task.add', args: { title: 'nope' } });
    const rej = await relay.waitFor('reply', { after: n });
    assert.strictEqual(rej.error.status, 403);
    n = relay.frames.length;
    relay.send({ type: 'op', reqId: 44, p: a.id, op: 'does.not.exist', args: {} });
    const unk = await relay.waitFor('reply', { after: n });
    assert.strictEqual(unk.error.status, 404);
  } finally { srv.kill(); await relay.close(); }
});

test('GET /api/hub/remote reports the connection; POST /api/hub/remote/reconnect re-handshakes', async () => {
  const relay = await startFakeRelay(); const { home } = setup(relay); const P = port(); const srv = await startHub(home, P);
  try {
    await relay.waitFor('hello', { timeout: 15000 });
    const s = await (await api(P, '/api/hub/remote')).json();
    assert.deepStrictEqual({ configured: s.configured, url: s.url, connected: s.connected, transport: s.transport, machineName: s.machineName }, { configured: true, url: relay.url, connected: true, transport: 'ws', machineName: 'hub-under-test' });
    const n = relay.frames.length;
    const r = await api(P, '/api/hub/remote/reconnect', { method: 'POST' });
    assert.strictEqual(r.status, 200);
    const again = await relay.waitFor('hello', { after: n });
    assert.strictEqual(again.via, 'ws');
    assert.strictEqual(relay.frames.slice(n)[0].type, 'auth');
  } finally { srv.kill(); await relay.close(); }
});

test('without remote.json the hub runs exactly as before and /api/hub/remote says configured:false', async () => {
  const relay = await startFakeRelay(); const { home, a } = setup(relay, { remote: false }); const P = port(); const srv = await startHub(home, P);
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(relay.frames.length, 0);
    const s = await (await api(P, '/api/hub/remote')).json();
    assert.strictEqual(s.configured, false); assert.strictEqual(s.connected, false);
    const list = await (await api(P, '/api/hub/projects')).json();
    assert.strictEqual(list.remote.configured, false);
    assert.strictEqual(list.projects.find((p) => p.id === a.id).published, true);
  } finally { srv.kill(); await relay.close(); }
});
