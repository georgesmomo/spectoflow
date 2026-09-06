'use strict';
/*
 * The RBAC engine's generic half: role/permission CRUD and platform-scope permission resolution.
 * Project-scope resolution (a user's effective permissions on a SPECIFIC project) is Task 12's job
 * — it needs the project_members table, which doesn't exist until then.
 */
const crypto = require('crypto');
function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }

const SYSTEM_ROLE_IDS = { PLATFORM_ADMIN: 'sys-platform-admin', OWNER: 'sys-owner', ADMIN: 'sys-admin', EDITOR: 'sys-editor', VIEWER: 'sys-viewer' };

function createRbacModel(knex) {
  async function getRole(roleId) {
    const row = await knex('roles').where({ id: roleId }).first();
    if (!row) return null;
    const perms = await knex('role_permissions').where({ role_id: roleId }).select('permission_key').orderBy('permission_key');
    return { id: row.id, scope: row.scope, ownerUserId: row.owner_user_id, name: row.name, isSystem: !!row.is_system, permissionKeys: perms.map((p) => p.permission_key) };
  }
  async function createRole({ scope, ownerUserId, name, permissionKeys }) {
    const validKeys = (await knex('permissions').where({ scope }).select('key')).map((r) => r.key);
    for (const k of permissionKeys) {
      if (!validKeys.includes(k)) throw new Error(`permission "${k}" is not in the "${scope}" scope`);
    }
    const id = randomId(8);
    await knex('roles').insert({ id, scope, owner_user_id: ownerUserId, name, is_system: false });
    if (permissionKeys.length) await knex('role_permissions').insert(permissionKeys.map((permission_key) => ({ role_id: id, permission_key })));
    return getRole(id);
  }
  async function deleteRole(roleId) {
    const row = await knex('roles').where({ id: roleId }).first();
    if (!row) return false;
    if (row.is_system) throw new Error('cannot delete a system role');
    await knex('roles').where({ id: roleId }).delete(); // role_permissions cascades
    return true;
  }
  async function listRolesByScope(scope, ownerUserId) {
    const rows = await knex('roles').where({ scope }).andWhere((qb) => qb.where({ is_system: true }).orWhere({ owner_user_id: ownerUserId })).orderBy('name');
    return Promise.all(rows.map((r) => getRole(r.id)));
  }
  async function assignPlatformRole(userId, roleId) {
    const role = await knex('roles').where({ id: roleId }).first();
    if (!role) throw new Error(`role "${roleId}" is not a platform-scope role`);
    if (role.scope !== 'platform') throw new Error(`role "${roleId}" is not a platform-scope role`);
    const exists = await knex('user_platform_roles').where({ user_id: userId, role_id: roleId }).first();
    if (!exists) await knex('user_platform_roles').insert({ user_id: userId, role_id: roleId });
  }
  async function removePlatformRole(userId, roleId) {
    await knex('user_platform_roles').where({ user_id: userId, role_id: roleId }).delete();
  }
  async function listPlatformRolesForUser(userId) {
    const rows = await knex('user_platform_roles').where({ user_id: userId }).select('role_id');
    return Promise.all(rows.map((r) => getRole(r.role_id)));
  }
  async function hasPlatformPermission(userId, permissionKey) {
    const row = await knex('user_platform_roles')
      .join('role_permissions', 'role_permissions.role_id', 'user_platform_roles.role_id')
      .where({ 'user_platform_roles.user_id': userId, 'role_permissions.permission_key': permissionKey })
      .first();
    return !!row;
  }
  async function resolveProjectPermissions(userId, projectId) {
    const membership = await knex('project_members').where({ project_id: projectId, user_id: userId }).first();
    if (!membership) return new Set();
    const perms = await knex('role_permissions').where({ role_id: membership.role_id }).select('permission_key');
    return new Set(perms.map((p) => p.permission_key));
  }
  return { SYSTEM_ROLE_IDS, getRole, createRole, deleteRole, listRolesByScope, assignPlatformRole, removePlatformRole, listPlatformRolesForUser, hasPlatformPermission, resolveProjectPermissions };
}

module.exports = { createRbacModel, SYSTEM_ROLE_IDS };
