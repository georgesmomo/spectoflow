'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../../src/app');
const { createDb } = require('../../src/db');

function fakeEmailer() { return { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendInvitationEmail: async () => {} }; }
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, emailer: fakeEmailer() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function signupAndLogin(email) {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return { userId: (await r.json()).userId, fetch: (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) }) };
  }
  return { app, db, url, signupAndLogin };
}

test('GET/POST /api/admin/signup-mode: the bootstrap admin (first account) can read and change it; a later, non-admin account gets 403', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin@example.com'); // first account -> auto Platform Admin
    const notAdmin = await signupAndLogin('later@example.com');
    const read = await admin.fetch('/api/admin/signup-mode');
    assert.strictEqual(read.status, 200);
    assert.strictEqual((await read.json()).mode, 'open');
    const deny = await notAdmin.fetch('/api/admin/signup-mode');
    assert.strictEqual(deny.status, 403);
    const set = await admin.fetch('/api/admin/signup-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'invite_only' }) });
    assert.strictEqual(set.status, 200);
    assert.strictEqual(await db.getSignupMode(), 'invite_only');
    const denySet = await notAdmin.fetch('/api/admin/signup-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'open' }) });
    assert.strictEqual(denySet.status, 403);
    const bad = await admin.fetch('/api/admin/signup-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'bogus' }) });
    assert.strictEqual(bad.status, 400);
  } finally { await app.close(); await db.destroy(); }
});
