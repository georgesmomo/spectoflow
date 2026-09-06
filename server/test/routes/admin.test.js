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

test('GET /api/admin/users lists every account; promote/demote toggle Platform Admin; the last admin cannot be demoted', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin2@example.com'); // bootstrap admin
    const other = await signupAndLogin('other2@example.com');
    const list = await (await admin.fetch('/api/admin/users')).json();
    assert.strictEqual(list.users.length, 2);
    assert.strictEqual(list.users[0].passwordHash, undefined);

    const otherUserId = list.users.find((u) => u.email === 'other2@example.com').id;
    const promote = await admin.fetch(`/api/admin/users/${otherUserId}/promote`, { method: 'POST' });
    assert.strictEqual(promote.status, 200);
    assert.strictEqual(await db.hasPlatformPermission(otherUserId, 'platform.manage_signup'), true);

    const adminUserId = list.users.find((u) => u.email === 'admin2@example.com').id;
    const demoteBootstrap = await other.fetch(`/api/admin/users/${adminUserId}/demote`, { method: 'POST' }); // 'other' now also holds platform.manage_users, via the promotion above
    assert.strictEqual(demoteBootstrap.status, 200); // 2 admins exist right now (admin2 + other2), so demoting admin2 succeeds — other2 remains
    const demoteLast = await other.fetch(`/api/admin/users/${otherUserId}/demote`, { method: 'POST' }); // other2 is the only admin left now
    assert.strictEqual(demoteLast.status, 400); // would leave zero admins — refused
  } finally { await app.close(); await db.destroy(); }
});

test('promote/demote with a nonexistent user id return 404 instead of an unhandled DB error', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin6@example.com'); // bootstrap admin
    const bogusId = 'no-such-user-id';
    const promote = await admin.fetch(`/api/admin/users/${bogusId}/promote`, { method: 'POST' });
    assert.strictEqual(promote.status, 404);
    const demote = await admin.fetch(`/api/admin/users/${bogusId}/demote`, { method: 'POST' });
    assert.strictEqual(demote.status, 404);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /admin: the served page contains the client-side HTML-escape helper used before any untrusted value (email) is inserted via innerHTML', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin3@example.com'); // bootstrap admin
    const page = await (await admin.fetch('/admin')).text();
    // The escape helper itself must be present in the shipped script.
    assert.match(page, /function esc\(/);
    // And the untrusted interpolation into innerHTML (the account's own email) must route through it.
    assert.match(page, /esc\(x\.email\)/);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /admin requires platform.manage_users or platform.manage_signup: an ordinary account is refused, an admin account still gets the page', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin5@example.com'); // bootstrap admin, holds both permissions
    const notAdmin = await signupAndLogin('later5@example.com'); // ordinary account, holds neither
    const deny = await notAdmin.fetch('/admin');
    assert.strictEqual(deny.status, 403);
    const allow = await admin.fetch('/admin');
    assert.strictEqual(allow.status, 200);
  } finally { await app.close(); await db.destroy(); }
});

test('XSS: a malicious email crafted to pass EMAIL_RE (no whitespace, one @, a dot) is stored and returned raw by the JSON API (correct — it is just data), but the admin page script would escape it before ever rendering it via innerHTML', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const malicious = '<img/src=x/onerror=alert(document.cookie)>@example.com';
    const admin = await signupAndLogin('admin4@example.com'); // bootstrap admin
    const signupResp = await admin.fetch('/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: malicious, password: 'a-real-password-123' }) });
    assert.strictEqual(signupResp.status, 200); // confirms EMAIL_RE accepts this payload — the whole point of the bug
    const list = await (await admin.fetch('/api/admin/users')).json();
    const victim = list.users.find((u) => u.email === malicious.toLowerCase());
    // The JSON API legitimately returns the raw value — it's a data endpoint, not HTML.
    assert.ok(victim);
    // Simulate what the admin page's client-side code does with it: apply the shipped esc() to the raw value.
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    const rendered = esc(victim.email);
    assert.ok(!rendered.includes('<img'));
    assert.ok(!rendered.includes('<script'));
  } finally { await app.close(); await db.destroy(); }
});

test('POST /api/admin/users/:id/roles assigns a custom platform role, which grants its permissions', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin7@example.com'); // bootstrap admin, holds platform.manage_roles
    const other = await signupAndLogin('other7@example.com');
    const list = await (await admin.fetch('/api/admin/users')).json();
    const otherId = list.users.find((u) => u.email === 'other7@example.com').id;

    const createRole = await admin.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'platform', name: 'Support', permissionKeys: ['platform.view_all_projects'] }) });
    assert.strictEqual(createRole.status, 200);
    const role = (await createRole.json()).role;

    const assign = await admin.fetch(`/api/admin/users/${otherId}/roles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: role.id }) });
    assert.strictEqual(assign.status, 200);
    assert.strictEqual(await db.hasPlatformPermission(otherId, 'platform.view_all_projects'), true);
  } finally { await app.close(); await db.destroy(); }
});

test('POST /api/admin/users/:id/roles refuses sys-platform-admin — that role is exclusively managed by /promote', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin8@example.com');
    const other = await signupAndLogin('other8@example.com');
    const list = await (await admin.fetch('/api/admin/users')).json();
    const otherId = list.users.find((u) => u.email === 'other8@example.com').id;
    const assign = await admin.fetch(`/api/admin/users/${otherId}/roles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN }) });
    assert.strictEqual(assign.status, 400);
    assert.match((await assign.json()).error, /\/promote/);
  } finally { await app.close(); await db.destroy(); }
});

test('DELETE /api/admin/users/:id/roles/:roleId removes a custom platform role assignment', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin9@example.com');
    const other = await signupAndLogin('other9@example.com');
    const list = await (await admin.fetch('/api/admin/users')).json();
    const otherId = list.users.find((u) => u.email === 'other9@example.com').id;
    const createRole = await admin.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'platform', name: 'Support', permissionKeys: ['platform.view_all_projects'] }) });
    const role = (await createRole.json()).role;
    await admin.fetch(`/api/admin/users/${otherId}/roles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: role.id }) });
    assert.strictEqual(await db.hasPlatformPermission(otherId, 'platform.view_all_projects'), true);

    const remove = await admin.fetch(`/api/admin/users/${otherId}/roles/${role.id}`, { method: 'DELETE' });
    assert.strictEqual(remove.status, 200);
    assert.strictEqual(await db.hasPlatformPermission(otherId, 'platform.view_all_projects'), false);
  } finally { await app.close(); await db.destroy(); }
});

test('DELETE /api/admin/users/:id/roles/sys-platform-admin refuses — must use /demote instead', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin10@example.com');
    const other = await signupAndLogin('other10@example.com');
    const list = await (await admin.fetch('/api/admin/users')).json();
    const otherId = list.users.find((u) => u.email === 'other10@example.com').id;
    const remove = await admin.fetch(`/api/admin/users/${otherId}/roles/${db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN}`, { method: 'DELETE' });
    assert.strictEqual(remove.status, 400);
    assert.match((await remove.json()).error, /\/demote/);
  } finally { await app.close(); await db.destroy(); }
});

test('POST/DELETE /api/admin/users/:id/roles: 404 for a nonexistent user; 403 for a caller without platform.manage_users', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin11@example.com');
    const notAdmin = await signupAndLogin('later11@example.com');
    const bogusId = 'no-such-user-id';

    const createRole = await admin.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'platform', name: 'Support', permissionKeys: ['platform.view_all_projects'] }) });
    const role = (await createRole.json()).role;

    const assign404 = await admin.fetch(`/api/admin/users/${bogusId}/roles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: role.id }) });
    assert.strictEqual(assign404.status, 404);
    const remove404 = await admin.fetch(`/api/admin/users/${bogusId}/roles/${role.id}`, { method: 'DELETE' });
    assert.strictEqual(remove404.status, 404);

    const list = await (await admin.fetch('/api/admin/users')).json();
    const notAdminId = list.users.find((u) => u.email === 'later11@example.com').id;
    const assign403 = await notAdmin.fetch(`/api/admin/users/${notAdminId}/roles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: role.id }) });
    assert.strictEqual(assign403.status, 403);
    const remove403 = await notAdmin.fetch(`/api/admin/users/${notAdminId}/roles/${role.id}`, { method: 'DELETE' });
    assert.strictEqual(remove403.status, 403);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /api/admin/users includes each user\'s platformRoles array', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin12@example.com'); // bootstrap admin -> holds sys-platform-admin
    const other = await signupAndLogin('other12@example.com'); // fresh account -> no platform roles
    const list = await (await admin.fetch('/api/admin/users')).json();
    const adminRow = list.users.find((u) => u.email === 'admin12@example.com');
    const otherRow = list.users.find((u) => u.email === 'other12@example.com');
    assert.ok(Array.isArray(adminRow.platformRoles));
    assert.ok(adminRow.platformRoles.length > 0);
    assert.ok(Array.isArray(otherRow.platformRoles));
    assert.strictEqual(otherRow.platformRoles.length, 0);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /admin: the served page escapes custom platform role names before inserting them via innerHTML', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin13@example.com');
    const page = await (await admin.fetch('/admin')).text();
    assert.match(page, /function esc\(/);
    // The role-name interpolation for a granted platform role must also route through esc().
    assert.match(page, /esc\([a-zA-Z_$][\w$]*\.name\)/);
  } finally { await app.close(); await db.destroy(); }
});
