'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }
async function projectFor(db, ownerUserId, localId = 'aaaaaa') {
  return db.upsertProject({ machineId: (await db.createMachine('m', ownerUserId)).id, localId, name: 'Alpha', kind: 'spectoflow' });
}

test('resolveProjectPermissions: empty set for a non-member; the seeded permission set for a real member', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner@example.com', 'password-123456');
    const viewer = await db.createUser('viewer@example.com', 'password-123456');
    const project = await projectFor(db, owner.id);
    assert.deepStrictEqual(await db.resolveProjectPermissions(viewer.id, project.id), new Set());
    await db.addProjectMember(project.id, viewer.id, db.SYSTEM_ROLE_IDS.VIEWER);
    assert.deepStrictEqual(await db.resolveProjectPermissions(viewer.id, project.id), new Set(['project.read']));
  } finally { await db.destroy(); }
});

test('removeProjectMember/changeMemberRole refuse to touch the Owner\'s own membership', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner2@example.com', 'password-123456');
    const project = await projectFor(db, owner.id);
    await db.addProjectMember(project.id, owner.id, db.SYSTEM_ROLE_IDS.OWNER);
    assert.strictEqual(await db.removeProjectMember(project.id, owner.id), 'protected');
    assert.strictEqual(await db.changeMemberRole(project.id, owner.id, db.SYSTEM_ROLE_IDS.ADMIN), 'protected');
    assert.deepStrictEqual(await db.resolveProjectPermissions(owner.id, project.id), new Set(['project.read', 'project.write', 'project.manage_settings', 'project.manage_members']));
    const editor = await db.createUser('editor2@example.com', 'password-123456');
    await db.addProjectMember(project.id, editor.id, db.SYSTEM_ROLE_IDS.EDITOR);
    assert.strictEqual(await db.changeMemberRole(project.id, editor.id, db.SYSTEM_ROLE_IDS.VIEWER), 'ok');
    assert.deepStrictEqual(await db.resolveProjectPermissions(editor.id, project.id), new Set(['project.read']));
    assert.strictEqual(await db.removeProjectMember(project.id, editor.id), 'ok');
    assert.strictEqual(await db.removeProjectMember(project.id, 'unknown-user'), 'not-found');
  } finally { await db.destroy(); }
});

test('getProjectOwnerUserId finds the sys-owner member; listProjectMembers includes email + role name', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner3@example.com', 'password-123456');
    const editor = await db.createUser('editor3@example.com', 'password-123456');
    const project = await projectFor(db, owner.id);
    await db.addProjectMember(project.id, owner.id, db.SYSTEM_ROLE_IDS.OWNER);
    await db.addProjectMember(project.id, editor.id, db.SYSTEM_ROLE_IDS.EDITOR);
    assert.strictEqual(await db.getProjectOwnerUserId(project.id), owner.id);
    const members = await db.listProjectMembers(project.id);
    assert.strictEqual(members.length, 2);
    const editorRow = members.find((m) => m.userId === editor.id);
    assert.strictEqual(editorRow.email, 'editor3@example.com');
    assert.strictEqual(editorRow.roleName, 'Editor');
  } finally { await db.destroy(); }
});

test('createInvitation/findInvitationByToken/acceptInvitation: single-use, joins the project on accept', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner4@example.com', 'password-123456');
    const project = await projectFor(db, owner.id);
    const token = await db.createInvitation({ projectId: project.id, email: 'invitee@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER, invitedByUserId: owner.id });
    const found = await db.findInvitationByToken(token);
    assert.strictEqual(found.projectId, project.id); assert.strictEqual(found.email, 'invitee@example.com');
    const invitee = await db.createUser('invitee@example.com', 'password-123456');
    assert.strictEqual(await db.acceptInvitation(token, invitee.id), project.id);
    assert.deepStrictEqual(await db.resolveProjectPermissions(invitee.id, project.id), new Set(['project.read']));
    assert.strictEqual(await db.findInvitationByToken(token), null); // single-use
    assert.strictEqual(await db.acceptInvitation('spf_bogus', invitee.id), null);
  } finally { await db.destroy(); }
});

test('acceptInvitation refuses a user whose account email does not match the invitation email (email-locked)', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner5@example.com', 'password-123456');
    const project = await projectFor(db, owner.id);
    const token = await db.createInvitation({ projectId: project.id, email: 'invitee5@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER, invitedByUserId: owner.id });
    const stranger = await db.createUser('stranger5@example.com', 'password-123456');
    assert.strictEqual(await db.acceptInvitation(token, stranger.id), null);
    // not silently burned: still findable/unconsumed afterward
    const found = await db.findInvitationByToken(token);
    assert.strictEqual(found.projectId, project.id);
    assert.deepStrictEqual(await db.resolveProjectPermissions(stranger.id, project.id), new Set());
    // the legitimate invitee can still accept it correctly afterward
    const invitee = await db.createUser('invitee5@example.com', 'password-123456');
    assert.strictEqual(await db.acceptInvitation(token, invitee.id), project.id);
    assert.deepStrictEqual(await db.resolveProjectPermissions(invitee.id, project.id), new Set(['project.read']));
  } finally { await db.destroy(); }
});
