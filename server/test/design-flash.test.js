'use strict';
// Online-relay counterpart of the local hub's first-paint theme-flash fix (D66 follow-up): GET
// /p/:id/* must stamp the served index.html's <html data-design="..."> with the project's own
// config.design (read from the DB-cached last_snapshot, the same one project.read itself answers
// from — see relay.js) before the file reaches the browser, exactly like lib/dashboard/hub-server.js
// does for the local hub (test/hub-server.test.js).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { buildApp } = require('../src/app');
const { createDb } = require('../src/db');
const { createRegistry } = require('../src/connector');

const REAL_PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'lib', 'dashboard', 'public');

function fakeEmailer() {
  return { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendInvitationEmail: async () => {} };
}
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const owner = await db.createUser('design-flash-test@example.com', 'a-real-password-123');
  const m = db.createMachine('laptop', owner.id); await m.ready;
  const registry = createRegistry();
  const app = await buildApp({ db, insecureDev: true, publicDir: REAL_PUBLIC_DIR, registry, emailer: fakeEmailer() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const loginRes = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'design-flash-test@example.com', password: 'a-real-password-123' }) });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  function authedFetch(p, opts = {}) { return fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) }); }
  return { app, db, machine: m, url, authedFetch };
}
async function announceWithSnapshot(url, machine, config) {
  await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { type: 'auth', token: machine.token },
      { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] },
      { type: 'snapshot', p: 'aaaaaa', project: { projectName: 'Alpha', plans: [], config } },
    ]) });
}

test('GET /p/:id/board stamps <html data-design> from the project\'s cached snapshot config.design', async () => {
  const { app, db, machine, url, authedFetch } = await boot();
  try {
    await announceWithSnapshot(url, machine, { design: 'orbit' });
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;
    const res = await authedFetch(`/p/${serverId}/board`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /<html[^>]*\bdata-design="orbit"/);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /p/:id/board defaults <html data-design> to "console" when the cached snapshot has no design yet', async () => {
  const { app, db, machine, url, authedFetch } = await boot();
  try {
    await announceWithSnapshot(url, machine, {});
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;
    const res = await authedFetch(`/p/${serverId}/board`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /<html[^>]*\bdata-design="console"/);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /p/:id/board for an id with no cached snapshot at all still serves the shell, defaulted to "console"', async () => {
  const { app, db, url, authedFetch } = await boot();
  try {
    const res = await authedFetch('/p/doesnotexist/board');
    assert.strictEqual(res.status, 200); // the SPA shell itself is served regardless — /api/project?p=... is what 404s
    const html = await res.text();
    assert.match(html, /<html[^>]*\bdata-design="console"/);
  } finally { await app.close(); await db.destroy(); }
});
