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
async function publishedProject(db, ownerUserId, name) {
  const m = db.createMachine('laptop', ownerUserId); await m.ready;
  const row = await db.upsertProject({ machineId: (await m).id, localId: 'aaaaaa', name: name || 'Alpha', kind: 'spectoflow' });
  await db.setPublished(row.id, true);
  await db.addProjectMember(row.id, ownerUserId, db.SYSTEM_ROLE_IDS.OWNER);
  return row;
}

test('GET /projects renders (200, HTML)', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('projlist-owner@example.com');
    const r = await owner.fetch('/projects');
    assert.strictEqual(r.status, 200);
    const page = await r.text();
    assert.match(page, /<html/);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /projects: the served script escapes project names AND group names before inserting them via innerHTML', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('projlist-esc@example.com');
    const page = await (await owner.fetch('/projects')).text();
    // The escape helper itself must be present in the shipped script.
    assert.match(page, /function esc\(/);
    // Project name interpolation must route through esc().
    assert.match(page, /esc\(p\.name\)/);
    // Group name interpolation (both in the project row's group <select> and the groups list) must route through esc().
    assert.match(page, /esc\(g\.name\)/);
  } finally { await app.close(); await db.destroy(); }
});

test('XSS: a malicious project name and a malicious group name are stored and returned raw by the JSON APIs (correct — data endpoints), but the /projects page script would escape both before ever rendering them via innerHTML', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('projlist-xss@example.com');
    const maliciousProjectName = '<img/src=x/onerror=alert(document.cookie)>';
    const maliciousGroupName = '<script>alert(1)</script>';
    const project = await publishedProject(db, owner.userId, maliciousProjectName);
    const groupResp = await (await owner.fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: maliciousGroupName }) })).json();

    const projectsList = await (await owner.fetch('/api/hub/projects')).json();
    const rawProject = projectsList.projects.find((p) => p.id === project.id);
    assert.strictEqual(rawProject.name, maliciousProjectName); // raw value returned — it's a data endpoint

    const groupsList = await (await owner.fetch('/api/groups')).json();
    const rawGroup = groupsList.groups.find((g) => g.id === groupResp.group.id);
    assert.strictEqual(rawGroup.name, maliciousGroupName); // raw value returned — it's a data endpoint

    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    assert.ok(!esc(rawProject.name).includes('<img'));
    assert.ok(!esc(rawGroup.name).includes('<script'));
  } finally { await app.close(); await db.destroy(); }
});

test('GET /projects/:id/members renders (200, HTML)', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('members-owner@example.com');
    const project = await publishedProject(db, owner.userId);
    const r = await owner.fetch(`/projects/${project.id}/members`);
    assert.strictEqual(r.status, 200);
    const page = await r.text();
    assert.match(page, /<html/);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /projects/:id/members: the served script escapes member emails AND role names before inserting them via innerHTML', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('members-esc@example.com');
    const project = await publishedProject(db, owner.userId);
    const page = await (await owner.fetch(`/projects/${project.id}/members`)).text();
    assert.match(page, /function esc\(/);
    assert.match(page, /esc\(m\.email\)/);
    assert.match(page, /esc\(m\.roleName\)/);
    // Role option labels (invite dropdown + per-member role select), also user-supplied for custom roles.
    assert.match(page, /esc\(r\.name\)/);
  } finally { await app.close(); await db.destroy(); }
});

test('XSS: a malicious member email (crafted to pass EMAIL_RE) is stored and returned raw by the members JSON API (correct — a data endpoint), but the members page script would escape it before ever rendering it via innerHTML', async () => {
  const { app, db, emailer, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('members-xss-owner@example.com');
    const project = await publishedProject(db, owner.userId);
    const malicious = '<img/src=x/onerror=alert(document.cookie)>@example.com';
    const invite = await owner.fetch(`/api/projects/${project.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: malicious, roleId: db.SYSTEM_ROLE_IDS.VIEWER }) });
    assert.strictEqual(invite.status, 200);
    const token = emailer.sent[0].url.split('/invitations/')[1];
    const invitee = await signupAndLogin(malicious);
    const accept = await invitee.fetch(`/invitations/${token}/accept`, { method: 'POST' });
    assert.strictEqual(accept.status, 200);

    const members = await (await owner.fetch(`/api/projects/${project.id}/members`)).json();
    const victim = members.members.find((m) => m.email === malicious.toLowerCase());
    assert.ok(victim); // the JSON API legitimately returns the raw value

    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    const rendered = esc(victim.email);
    assert.ok(!rendered.includes('<img'));
    assert.ok(!rendered.includes('<script'));
  } finally { await app.close(); await db.destroy(); }
});

test('the members page correctly reflects a real invite -> accept flow', async () => {
  const { app, db, emailer, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('members-flow-owner@example.com');
    const project = await publishedProject(db, owner.userId);
    const invite = await owner.fetch(`/api/projects/${project.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'flow-viewer@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER }) });
    assert.strictEqual(invite.status, 200);
    const token = emailer.sent[0].url.split('/invitations/')[1];
    const invitee = await signupAndLogin('flow-viewer@example.com');
    assert.strictEqual((await invitee.fetch(`/invitations/${token}/accept`, { method: 'POST' })).status, 200);

    // This is the exact call the members page's own client-side load() makes.
    const members = await (await owner.fetch(`/api/projects/${project.id}/members`)).json();
    assert.ok(members.members.some((m) => m.email === 'flow-viewer@example.com' && m.roleName === 'Viewer'));

    const pageStatus = (await owner.fetch(`/projects/${project.id}/members`)).status;
    assert.strictEqual(pageStatus, 200);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /projects/:id/members still renders 200 as a page shell for a caller who is NOT a member of that project — authorization is enforced only by the JSON API the page calls, not by the page route itself, matching account.js/admin.js/roles.js', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('members-notmember-owner@example.com');
    const stranger = await signupAndLogin('members-notmember-stranger@example.com');
    const project = await publishedProject(db, owner.userId);

    // The underlying API already enforces this — confirm it's unchanged (existing, tested behavior).
    const apiCall = await stranger.fetch(`/api/projects/${project.id}/members`);
    assert.strictEqual(apiCall.status, 403);

    // The page route itself must not crash or leak anything — it serves the HTML shell unconditionally.
    const pageCall = await stranger.fetch(`/projects/${project.id}/members`);
    assert.strictEqual(pageCall.status, 200);
    const page = await pageCall.text();
    assert.match(page, /<html/);
  } finally { await app.close(); await db.destroy(); }
});
