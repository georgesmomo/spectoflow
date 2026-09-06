'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createConnector } = require('../lib/dashboard/connector');
const { startFakeRelay } = require('./helpers/fake-relay');

const fast = { backoffMin: 30, backoffMax: 60, dropWindow: 60000, dropLimit: 3, wsRetryEvery: 300, pollTimeout: 5000 };
const PUB = [{ localId: 'aaaaaa', name: 'alpha', kind: 'spectoflow', stats: { total: 2, done: 1 } }];
function stubs(published = PUB) {
  return {
    listPublished: () => published,
    readSnapshot: async (localId) => ({ projectName: 'snap-' + localId, plans: [] }),
    execOp: async (p, op, args) => {
      if (op === 'task.add') return { ok: true, p, title: args.title };
      const e = new Error('bad request from test'); e.status = 400; throw e;
    },
  };
}
function connector(relay, extra = {}) {
  return createConnector({ url: relay.url, token: relay.token, machineName: 'test-box', version: '0.25.0', timing: fast, ...stubs(), ...extra });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('auth is the first frame; hello lists only published projects; a snapshot follows per project', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try {
    const hello = await relay.waitFor('hello');
    assert.strictEqual(relay.frames[0].type, 'auth');
    assert.strictEqual(relay.frames[0].token, relay.token);
    assert.strictEqual(relay.frames[0].version, '0.25.0');
    assert.strictEqual(hello.machineName, 'test-box');
    assert.deepStrictEqual(hello.projects, PUB);
    const snap = await relay.waitFor('snapshot');
    assert.strictEqual(snap.p, 'aaaaaa'); assert.strictEqual(snap.project.projectName, 'snap-aaaaaa');
    assert.strictEqual(c.status().connected, true); assert.strictEqual(c.status().machineId, 'm1'); assert.strictEqual(c.status().transport, 'ws');
  } finally { c.stop(); await relay.close(); }
});

test('pushEvent mirrors a local emit as an event frame, in order', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try {
    await relay.waitFor('hello');
    c.pushEvent('aaaaaa', { type: 'change' }); c.pushEvent('aaaaaa', { type: 'message', message: { id: 1 } });
    await relay.waitFor('event');
    await sleep(50);
    const evs = relay.frames.filter((f) => f.type === 'event');
    assert.deepStrictEqual(evs.map((e) => e.event.type), ['change', 'message']);
    assert.strictEqual(evs[0].p, 'aaaaaa');
  } finally { c.stop(); await relay.close(); }
});

test('an op frame runs execOp and replies with the result, or with {status,message} on error', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try {
    await relay.waitFor('hello');
    relay.send({ type: 'op', reqId: 7, p: 'aaaaaa', op: 'task.add', args: { title: 'from online' } });
    const ok = await relay.waitFor('reply');
    assert.deepStrictEqual(ok, { type: 'reply', reqId: 7, result: { ok: true, p: 'aaaaaa', title: 'from online' }, via: 'ws' });
    const n = relay.frames.length;
    relay.send({ type: 'op', reqId: 8, p: 'aaaaaa', op: 'attention.remove', args: { id: 'x' } });
    const err = await relay.waitFor('reply', { after: n });
    assert.deepStrictEqual(err.error, { status: 400, message: 'bad request from test' });
  } finally { c.stop(); await relay.close(); }
});

test('ping is answered with pong', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try { await relay.waitFor('hello'); relay.send({ type: 'ping' }); await relay.waitFor('pong'); }
  finally { c.stop(); await relay.close(); }
});

test('a rejected token never connects and status explains it', async () => {
  const relay = await startFakeRelay(); const c = connector(relay, { token: 'spf_wrong' }); c.start();
  try {
    await relay.waitFor('auth'); await sleep(150);
    assert.strictEqual(c.status().connected, false);
    assert.match(String(c.status().lastError), /token|4401|unauthorized/i);
    assert.strictEqual(relay.frames.filter((f) => f.type === 'hello').length, 0);
  } finally { c.stop(); await relay.close(); }
});

test('after a drop the connector reconnects: auth, hello and snapshots again (still WebSocket)', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try {
    await relay.waitFor('snapshot');
    const n = relay.frames.length;
    relay.dropSockets();
    const hello2 = await relay.waitFor('hello', { after: n });
    assert.strictEqual(hello2.via, 'ws');
    assert.strictEqual(relay.frames.slice(n).find((f) => f.type === 'auth').via, 'ws');
    await relay.waitFor('snapshot', { after: n });
    assert.strictEqual(c.status().transport, 'ws');
  } finally { c.stop(); await relay.close(); }
});

test('announce() re-sends hello when the published set changes', async () => {
  const relay = await startFakeRelay(); let published = PUB;
  const c = connector(relay, { listPublished: () => published }); c.start();
  try {
    await relay.waitFor('hello');
    const n = relay.frames.length;
    published = [...PUB, { localId: 'bbbbbb', name: 'beta', kind: 'spectoflow', stats: null }];
    c.announce();
    const h = await relay.waitFor('hello', { after: n });
    assert.deepStrictEqual(h.projects.map((p) => p.localId), ['aaaaaa', 'bbbbbb']);
  } finally { c.stop(); await relay.close(); }
});
