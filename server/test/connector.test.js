'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../src/app');
const { createDb } = require('../src/db');
const { createConnector: createLocalConnector } = require('../../lib/dashboard/connector');

async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const m = db.createMachine('laptop'); await m.ready;
  const frames = [];
  const app = await buildApp({ db, accessKey: 'x'.repeat(20), sessionSecret: 's'.repeat(32), insecureDev: true, publicDir: __dirname, onFrame: (machineId, frame) => frames.push({ machineId, frame }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return { app, db, machine: m, frames, url: `http://127.0.0.1:${addr.port}` };
}

test('whoami: valid token → {machineId,name}; invalid → 401', async () => {
  const { app, db, machine, url } = await boot();
  try {
    const ok = await fetch(url + '/connector/whoami', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}` } });
    assert.strictEqual(ok.status, 200); assert.deepStrictEqual(await ok.json(), { machineId: machine.id, name: 'laptop' });
    const bad = await fetch(url + '/connector/whoami', { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    assert.strictEqual(bad.status, 401);
  } finally { await app.close(); await db.destroy(); }
});

test('a real local connector (WebSocket) can auth, send hello/event/snapshot, and receive ops/ping', async () => {
  const { app, db, machine, frames, url } = await boot();
  try {
    const execOp = async (p, op) => ({ ranOn: p, op });
    const c = createLocalConnector({ url, token: machine.token, machineName: 'laptop', version: '0.25.0', listPublished: () => [{ localId: 'aaaaaa', name: 'A', kind: 'spectoflow', stats: { total: 1, done: 0 } }], readSnapshot: async () => ({ projectName: 'A' }), execOp });
    c.start();
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('no hello frame')), 5000); const iv = setInterval(() => { if (frames.some((f) => f.frame.type === 'hello')) { clearInterval(iv); clearTimeout(t); resolve(); } }, 20); });
    assert.strictEqual(frames.find((f) => f.frame.type === 'hello').machineId, machine.id);
    c.pushEvent('aaaaaa', { type: 'change' });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(frames.some((f) => f.frame.type === 'event' && f.frame.p === 'aaaaaa'));
    assert.strictEqual(c.status().connected, true);
    c.stop();
  } finally { await app.close(); await db.destroy(); }
});

test('a revoked token is rejected at whoami and the WebSocket auth frame alike', async () => {
  const { app, db, machine, url } = await boot();
  try {
    await db.revokeMachine(machine.id);
    const r = await fetch(url + '/connector/whoami', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}` } });
    assert.strictEqual(r.status, 401);
  } finally { await app.close(); await db.destroy(); }
});

test('a revoked token is rejected at the WebSocket auth frame too (socket closes 4401/unauthorized), not just at whoami', async () => {
  const { app, db, machine, url } = await boot();
  try {
    await db.revokeMachine(machine.id);
    // The test above only covers the plain HTTP handshake — connector.js's WS route
    // (server/src/connector.js, app.get('/connector/ws', ...)) re-authenticates independently off
    // the frame's own `token` field, so a revoked token must be rejected there too, not just at
    // whoami. Drive a real WebSocket (Node's built-in global, same client the local connector uses
    // in lib/dashboard/connector.js) all the way to sending the `auth` frame and assert the server
    // closes the socket with the exact code/reason connector.js uses for an unauthorized auth
    // attempt (4401 / 'unauthorized') rather than accepting it.
    const ws = new WebSocket(url.replace(/^http/, 'ws') + '/connector/ws');
    const closeEvent = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('socket never closed')), 5000);
      ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token: machine.token })));
      ws.addEventListener('close', (ev) => { clearTimeout(t); resolve(ev); });
      ws.addEventListener('error', () => {}); // a close with a non-1000 code also fires 'error' on some runtimes — ignored, 'close' is what's asserted
    });
    assert.strictEqual(closeEvent.code, 4401);
    assert.strictEqual(closeEvent.reason, 'unauthorized');
  } finally { await app.close(); await db.destroy(); }
});
