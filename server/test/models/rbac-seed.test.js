'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('the permission catalog is seeded exactly (8 rows, correct scopes)', async () => {
  const db = await fresh();
  try {
    const rows = await db.knex('permissions').select('key', 'scope').orderBy('key');
    assert.strictEqual(rows.length, 8);
    const platform = rows.filter((r) => r.scope === 'platform').map((r) => r.key).sort();
    const project = rows.filter((r) => r.scope === 'project').map((r) => r.key).sort();
    assert.deepStrictEqual(platform, ['platform.manage_roles', 'platform.manage_signup', 'platform.manage_users', 'platform.view_all_projects']);
    assert.deepStrictEqual(project, ['project.manage_members', 'project.manage_settings', 'project.read', 'project.write']);
  } finally { await db.destroy(); }
});

test('the 5 system roles are seeded with the right permissions and are marked is_system', async () => {
  const db = await fresh();
  try {
    const roles = await db.knex('roles').select('id', 'scope', 'name', 'is_system', 'owner_user_id');
    assert.strictEqual(roles.length, 5);
    for (const r of roles) { assert.strictEqual(r.is_system, 1); assert.strictEqual(r.owner_user_id, null); }
    const permsOf = async (roleId) => (await db.knex('role_permissions').where({ role_id: roleId }).select('permission_key').orderBy('permission_key')).map((r) => r.permission_key);
    assert.deepStrictEqual(await permsOf('sys-platform-admin'), ['platform.manage_roles', 'platform.manage_signup', 'platform.manage_users', 'platform.view_all_projects']);
    assert.deepStrictEqual(await permsOf('sys-owner'), ['project.manage_members', 'project.manage_settings', 'project.read', 'project.write']);
    assert.deepStrictEqual(await permsOf('sys-admin'), ['project.manage_members', 'project.manage_settings', 'project.read', 'project.write']);
    assert.deepStrictEqual(await permsOf('sys-editor'), ['project.read', 'project.write']);
    assert.deepStrictEqual(await permsOf('sys-viewer'), ['project.read']);
  } finally { await db.destroy(); }
});

test('role_permissions and user_platform_roles cascade-delete when their role/user is deleted', async () => {
  const db = await fresh();
  try {
    await db.knex('users').insert({ id: 'u1', email: 'x@example.com', password_hash: 'irrelevant-for-this-test' });
    await db.knex('user_platform_roles').insert({ user_id: 'u1', role_id: 'sys-platform-admin' });
    assert.strictEqual((await db.knex('user_platform_roles').where({ user_id: 'u1' })).length, 1);
    await db.knex('users').where({ id: 'u1' }).delete();
    assert.strictEqual((await db.knex('user_platform_roles').where({ user_id: 'u1' })).length, 0);
  } finally { await db.destroy(); }
});
