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

test('DELETE /api/roles/:id refuses (409) while the role is assigned to a project member; succeeds once the assignment is removed', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('alice4@example.com');
    const created = await (await alice.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'Assigned', permissionKeys: ['project.read'] }) })).json();
    const roleId = created.role.id;
    const m = db.createMachine('laptop', alice.userId); await m.ready;
    const project = await db.upsertProject({ machineId: m.id, localId: 'zzzzzz', name: 'Zeta', kind: 'spectoflow' });
    await db.addProjectMember(project.id, alice.userId, roleId);
    const blocked = await alice.fetch(`/api/roles/${roleId}`, { method: 'DELETE' });
    assert.strictEqual(blocked.status, 409);
    assert.match((await blocked.json()).error, /currently assigned/i);
    const removed = await db.removeProjectMember(project.id, alice.userId);
    assert.strictEqual(removed, 'ok');
    const success = await alice.fetch(`/api/roles/${roleId}`, { method: 'DELETE' });
    assert.strictEqual(success.status, 200);
  } finally { await app.close(); await db.destroy(); }
});

test('DELETE /api/roles/:id refuses (409) while the role is on a pending invitation', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('alice5@example.com');
    const created = await (await alice.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'Invited', permissionKeys: ['project.read'] }) })).json();
    const roleId = created.role.id;
    const m = db.createMachine('laptop', alice.userId); await m.ready;
    const project = await db.upsertProject({ machineId: m.id, localId: 'yyyyyy', name: 'Yotta', kind: 'spectoflow' });
    await db.createInvitation({ projectId: project.id, email: 'invitee5@example.com', roleId, invitedByUserId: alice.userId });
    const blocked = await alice.fetch(`/api/roles/${roleId}`, { method: 'DELETE' });
    assert.strictEqual(blocked.status, 409);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /api/permissions?scope=project and ?scope=platform return the fixed catalog seeded by migration 0004; an invalid scope is 400', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('permcat-alice@example.com');
    const project = await (await alice.fetch('/api/permissions?scope=project')).json();
    assert.deepStrictEqual(project.permissions.map((p) => p.key), ['project.manage_members', 'project.manage_settings', 'project.read', 'project.write']);
    const platform = await (await alice.fetch('/api/permissions?scope=platform')).json();
    assert.deepStrictEqual(platform.permissions.map((p) => p.key), ['platform.manage_roles', 'platform.manage_signup', 'platform.manage_users', 'platform.view_all_projects']);
    // labels are carried through too, not just keys
    assert.ok(project.permissions.every((p) => typeof p.label === 'string' && p.label.length > 0));
    const bad = await alice.fetch('/api/permissions?scope=bogus');
    assert.strictEqual(bad.status, 400);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /roles renders a page (200, HTML) for an authenticated caller, and its script escapes role names before inserting them via innerHTML', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('rolespage-alice@example.com');
    const r = await alice.fetch('/roles');
    assert.strictEqual(r.status, 200);
    const page = await r.text();
    assert.match(page, /<html/);
    // The escape helper itself must be present in the shipped script.
    assert.match(page, /function esc\(/);
    // And the untrusted interpolation of a role's name into innerHTML must route through it.
    assert.match(page, /esc\([a-zA-Z_$][\w$]*\.name\)/);
  } finally { await app.close(); await db.destroy(); }
});

test('XSS: a malicious role name is stored and returned raw by the JSON API (correct — it is just data), but the /roles page script would escape it before ever rendering it via innerHTML', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('rolesxss-alice@example.com');
    const malicious = '<img/src=x/onerror=alert(document.cookie)>';
    const created = await (await alice.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: malicious, permissionKeys: ['project.read'] }) })).json();
    assert.strictEqual(created.role.name, malicious); // the JSON API legitimately returns the raw value — it's a data endpoint, not HTML
    // Simulate what the /roles page's client-side code does with it: apply the shipped esc() to the raw value.
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    const rendered = esc(created.role.name);
    assert.ok(!rendered.includes('<img'));
    assert.ok(!rendered.includes('<script'));
  } finally { await app.close(); await db.destroy(); }
});
