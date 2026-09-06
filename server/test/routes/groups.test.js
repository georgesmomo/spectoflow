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
  const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'a-real-password-123' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const authedFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });
  const userId = (await r.json()).userId;
  const m = await db.createMachine('laptop', userId); await m.ready;
  const project = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
  await db.setPublished(project.id, true); // listPublishedProjectsForUser (GET /api/hub/projects) only returns published projects
  await db.addProjectMember(project.id, userId, db.SYSTEM_ROLE_IDS.OWNER);
  return { app, db, authedFetch, project };
}

test('create/list/rename/delete a group; assign a project to it and clear it', async () => {
  const { app, db, authedFetch, project } = await boot();
  try {
    const created = await (await authedFetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Clients' }) })).json();
    assert.ok(created.group.id);
    assert.strictEqual((await (await authedFetch('/api/groups')).json()).groups.length, 1);
    await authedFetch(`/api/groups/${created.group.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Client Work' }) });
    assert.strictEqual((await (await authedFetch('/api/groups')).json()).groups[0].name, 'Client Work');
    const assign = await authedFetch(`/api/projects/${project.id}/group`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: created.group.id }) });
    assert.strictEqual(assign.status, 200);
    const list = await (await authedFetch('/api/hub/projects')).json();
    assert.strictEqual(list.projects[0].groupId, created.group.id);
    await authedFetch(`/api/groups/${created.group.id}`, { method: 'DELETE' });
    assert.strictEqual((await (await authedFetch('/api/groups')).json()).groups.length, 0);
    const listAfter = await (await authedFetch('/api/hub/projects')).json();
    assert.strictEqual(listAfter.projects[0].groupId, null); // cleared, project untouched
  } finally { await app.close(); await db.destroy(); }
});
