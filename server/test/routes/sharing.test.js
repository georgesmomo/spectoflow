'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../../src/app');
const { createDb } = require('../../src/db');

function fakeEmailer() { const sent = []; return { sent, sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendInvitationEmail: async (to, projectName, url) => { sent.push({ to, projectName, url }); } }; }

async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const emailer = fakeEmailer();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, emailer });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function signupAndLogin(email) {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return { userId: (await r.json()).userId, fetch: (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) }) };
  }
  return { app, db, emailer, url, signupAndLogin };
}
async function publishedProject(db, ownerUserId) {
  const m = db.createMachine('laptop', ownerUserId); await m.ready;
  const row = await db.upsertProject({ machineId: (await m).id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
  await db.setPublished(row.id, true);
  await db.addProjectMember(row.id, ownerUserId, db.SYSTEM_ROLE_IDS.OWNER);
  return row;
}

test('owner invites a viewer by email; the invitee signs up, accepts, and shows up in the members list', async () => {
  const { app, db, emailer, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('owner@example.com');
    const project = await publishedProject(db, owner.userId);
    const invite = await owner.fetch(`/api/projects/${project.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'viewer@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER }) });
    assert.strictEqual(invite.status, 200);
    assert.strictEqual(emailer.sent.length, 1);
    const token = emailer.sent[0].url.split('/invitations/')[1];
    const invitee = await signupAndLogin('viewer@example.com');
    const accept = await invitee.fetch(`/invitations/${token}/accept`, { method: 'POST' });
    assert.strictEqual(accept.status, 200);
    const members = await (await owner.fetch(`/api/projects/${project.id}/members`)).json();
    assert.strictEqual(members.members.length, 2);
    assert.ok(members.members.some((m) => m.email === 'viewer@example.com' && m.roleName === 'Viewer'));
  } finally { await app.close(); await db.destroy(); }
});

test('a non-member cannot invite (403), list members (403), or remove/change anyone (403)', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('owner2@example.com');
    const project = await publishedProject(db, owner.userId);
    const stranger = await signupAndLogin('stranger@example.com');
    assert.strictEqual((await stranger.fetch(`/api/projects/${project.id}/members`)).status, 403);
    assert.strictEqual((await stranger.fetch(`/api/projects/${project.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER }) })).status, 403);
  } finally { await app.close(); await db.destroy(); }
});

test('the Owner\'s own membership cannot be removed or changed via the API, even by themself', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('owner3@example.com');
    const project = await publishedProject(db, owner.userId);
    const remove = await owner.fetch(`/api/projects/${project.id}/members/${owner.userId}`, { method: 'DELETE' });
    assert.strictEqual(remove.status, 403);
    const change = await owner.fetch(`/api/projects/${project.id}/members/${owner.userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: db.SYSTEM_ROLE_IDS.EDITOR }) });
    assert.strictEqual(change.status, 403);
  } finally { await app.close(); await db.destroy(); }
});

test('sys-owner cannot be assigned via invite or role-change — only relay.js\'s auto-insert can create it', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('owner6@example.com');
    const project = await publishedProject(db, owner.userId);
    const invite = await owner.fetch(`/api/projects/${project.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'second-owner@example.com', roleId: db.SYSTEM_ROLE_IDS.OWNER }) });
    assert.strictEqual(invite.status, 400);
    const editor = await signupAndLogin('editor6@example.com');
    await db.addProjectMember(project.id, editor.userId, db.SYSTEM_ROLE_IDS.EDITOR);
    const change = await owner.fetch(`/api/projects/${project.id}/members/${editor.userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: db.SYSTEM_ROLE_IDS.OWNER }) });
    assert.strictEqual(change.status, 400);
    // still just Editor — the role-change never went through
    assert.deepStrictEqual(await db.findMembership(project.id, editor.userId), { roleId: db.SYSTEM_ROLE_IDS.EDITOR });
  } finally { await app.close(); await db.destroy(); }
});

// --- Required proactive security fixes (established pattern from Tasks 9/10) ---

test('GET /invitations/:token rejects a malformed token (reflected-XSS payload) with 400 instead of rendering it', async () => {
  const { app, db } = await boot();
  try {
    const payload = "spf_</script><script>alert(1)</script>";
    const r = await app.inject({ method: 'GET', url: `/invitations/${encodeURIComponent(payload)}` });
    assert.strictEqual(r.statusCode, 400);
    assert.ok(!r.body.includes(payload)); // never reflected into the response
  } finally { await app.close(); await db.destroy(); }
});

test('POST /api/projects/:id/invite is rate-limited: the 11th attempt within the window is 429', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('owner7@example.com');
    const project = await publishedProject(db, owner.userId);
    let last;
    for (let i = 0; i < 11; i++) {
      last = await owner.fetch(`/api/projects/${project.id}/invite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `invitee${i}@example.com`, roleId: db.SYSTEM_ROLE_IDS.VIEWER }),
      });
    }
    assert.strictEqual(last.status, 429);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /invitations/:token HTML-escapes a project name containing a script tag', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('owner4@example.com');
    const project = await publishedProject(db, owner.userId);
    await db.knex('projects').where({ id: project.id }).update({ name: '<script>alert(1)</script>' });
    const token = await db.createInvitation({ projectId: project.id, email: 'invitee4@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER, invitedByUserId: owner.userId });
    const r = await app.inject({ method: 'GET', url: `/invitations/${token}` });
    assert.strictEqual(r.statusCode, 200);
    assert.ok(!r.body.includes('<script>alert(1)</script>')); // raw tag never present
    assert.ok(r.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;')); // escaped text is present
  } finally { await app.close(); await db.destroy(); }
});
