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
  return { app, db, signupAndLogin };
}

test('GET /api/roles?scope=project lists the 4 system roles plus only the caller\'s own custom roles', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('alice@example.com');
    const bob = await signupAndLogin('bob@example.com');
    await alice.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'Reviewer', permissionKeys: ['project.read'] }) });
    const aliceList = await (await alice.fetch('/api/roles?scope=project')).json();
    const bobList = await (await bob.fetch('/api/roles?scope=project')).json();
    assert.strictEqual(aliceList.roles.length, 5); // 4 system + Reviewer
    assert.strictEqual(bobList.roles.length, 4); // 4 system only, not alice's Reviewer
    assert.ok(aliceList.roles.some((r) => r.name === 'Reviewer'));
  } finally { await app.close(); await db.destroy(); }
});

test('POST /api/roles rejects a permission from the wrong scope with 400', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('alice2@example.com');
    const r = await alice.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'Bad', permissionKeys: ['platform.manage_users'] }) });
    assert.strictEqual(r.status, 400);
  } finally { await app.close(); await db.destroy(); }
});

test('creating a platform-scope custom role requires platform.manage_roles; a project-scope one never does', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const first = await signupAndLogin('first@example.com'); // bootstrap admin, has platform.manage_roles
    const second = await signupAndLogin('second@example.com'); // ordinary account
    const ok = await first.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'platform', name: 'Support', permissionKeys: ['platform.view_all_projects'] }) });
    assert.strictEqual(ok.status, 200);
    const denied = await second.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'platform', name: 'Bad', permissionKeys: ['platform.view_all_projects'] }) });
    assert.strictEqual(denied.status, 403);
    const projectOk = await second.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'MyRole', permissionKeys: ['project.read'] }) });
    assert.strictEqual(projectOk.status, 200); // no special permission needed for a project-scope custom role
  } finally { await app.close(); await db.destroy(); }
});

test('DELETE /api/roles/:id: 403 for a system role, 403 for someone else\'s role, 200 for your own', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('alice3@example.com');
    const bob = await signupAndLogin('bob3@example.com');
    const created = await (await alice.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'Mine', permissionKeys: ['project.read'] }) })).json();
    assert.strictEqual((await bob.fetch(`/api/roles/${created.role.id}`, { method: 'DELETE' })).status, 403);
    assert.strictEqual((await alice.fetch(`/api/roles/${db.SYSTEM_ROLE_IDS.VIEWER}`, { method: 'DELETE' })).status, 403);
    assert.strictEqual((await alice.fetch(`/api/roles/${created.role.id}`, { method: 'DELETE' })).status, 200);
  } finally { await app.close(); await db.destroy(); }
});
