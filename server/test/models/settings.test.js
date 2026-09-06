'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('getSignupMode defaults to open; setSignupMode changes it; an invalid mode is rejected', async () => {
  const db = await fresh();
  try {
    assert.strictEqual(await db.getSignupMode(), 'open');
    await db.setSignupMode('invite_only');
    assert.strictEqual(await db.getSignupMode(), 'invite_only');
    await db.setSignupMode('disabled');
    assert.strictEqual(await db.getSignupMode(), 'disabled');
    await assert.rejects(() => db.setSignupMode('bogus'));
  } finally { await db.destroy(); }
});

test('hasPendingInvitationForEmail: true only for an unaccepted, unexpired invitation to that email', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner@example.com', 'password-123456');
    const m = await db.createMachine('m', owner.id); await m.ready;
    const project = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
    assert.strictEqual(await db.hasPendingInvitationForEmail('invitee@example.com'), false);
    const token = await db.createInvitation({ projectId: project.id, email: 'Invitee@Example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER, invitedByUserId: owner.id });
    assert.strictEqual(await db.hasPendingInvitationForEmail('invitee@example.com'), true); // case-insensitive
    const invitee = await db.createUser('invitee@example.com', 'password-123456');
    await db.acceptInvitation(token, invitee.id);
    assert.strictEqual(await db.hasPendingInvitationForEmail('invitee@example.com'), false); // consumed
  } finally { await db.destroy(); }
});
