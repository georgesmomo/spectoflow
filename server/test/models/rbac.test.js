'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('SYSTEM_ROLE_IDS names the 5 seeded ids', async () => {
  const db = await fresh();
  try {
    assert.deepStrictEqual(db.SYSTEM_ROLE_IDS, { PLATFORM_ADMIN: 'sys-platform-admin', OWNER: 'sys-owner', ADMIN: 'sys-admin', EDITOR: 'sys-editor', VIEWER: 'sys-viewer' });
  } finally { await db.destroy(); }
});

test('createRole/getRole/deleteRole: a custom role round-trips, rejects a permission from the wrong scope, and cannot delete a system role', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner@example.com', 'password-123456');
    const role = await db.createRole({ scope: 'project', ownerUserId: owner.id, name: 'Reviewer', permissionKeys: ['project.read'] });
    assert.ok(role.id); assert.strictEqual(role.name, 'Reviewer'); assert.strictEqual(role.isSystem, false);
    assert.deepStrictEqual(role.permissionKeys, ['project.read']);
    const fetched = await db.getRole(role.id);
    assert.deepStrictEqual(fetched.permissionKeys, ['project.read']);
    await assert.rejects(() => db.createRole({ scope: 'project', ownerUserId: owner.id, name: 'Bad', permissionKeys: ['platform.manage_users'] }), /scope/i);
    assert.strictEqual(await db.deleteRole(role.id), true);
    assert.strictEqual(await db.getRole(role.id), null);
    await assert.rejects(() => db.deleteRole(db.SYSTEM_ROLE_IDS.VIEWER), /system/i);
  } finally { await db.destroy(); }
});

test('listRolesByScope returns every system role of that scope plus only the given owner\'s custom roles', async () => {
  const db = await fresh();
  try {
    const alice = await db.createUser('alice@example.com', 'password-123456');
    const bob = await db.createUser('bob@example.com', 'password-123456');
    await db.createRole({ scope: 'project', ownerUserId: alice.id, name: 'Alice Custom', permissionKeys: ['project.read'] });
    await db.createRole({ scope: 'project', ownerUserId: bob.id, name: 'Bob Custom', permissionKeys: ['project.read'] });
    const forAlice = await db.listRolesByScope('project', alice.id);
    const names = forAlice.map((r) => r.name).sort();
    assert.deepStrictEqual(names, ['Admin', 'Alice Custom', 'Editor', 'Owner', 'Viewer']);
    assert.ok(!names.includes('Bob Custom'));
  } finally { await db.destroy(); }
});

test('assignPlatformRole/removePlatformRole/listPlatformRolesForUser/hasPlatformPermission', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('admin@example.com', 'password-123456');
    assert.strictEqual(await db.hasPlatformPermission(u.id, 'platform.manage_signup'), false);
    assert.deepStrictEqual(await db.listPlatformRolesForUser(u.id), []);
    await db.assignPlatformRole(u.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    assert.strictEqual(await db.hasPlatformPermission(u.id, 'platform.manage_signup'), true);
    assert.strictEqual(await db.hasPlatformPermission(u.id, 'project.read'), false); // wrong scope entirely, never true
    assert.strictEqual((await db.listPlatformRolesForUser(u.id)).length, 1);
    await db.removePlatformRole(u.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    assert.strictEqual(await db.hasPlatformPermission(u.id, 'platform.manage_signup'), false);
  } finally { await db.destroy(); }
});
