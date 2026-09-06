'use strict';
// The permission catalog and the 5 system roles are fixed, code-defined reference data — seeded
// directly in this migration (runs once per database) rather than at app boot, so there is no
// idempotency check to get wrong and no risk of the seed silently drifting from what code expects.
const PERMISSIONS = [
  { key: 'platform.manage_signup', scope: 'platform', label: 'Change the signup mode' },
  { key: 'platform.manage_users', scope: 'platform', label: 'Manage any account' },
  { key: 'platform.manage_roles', scope: 'platform', label: 'Create/edit platform-scope custom roles' },
  { key: 'platform.view_all_projects', scope: 'platform', label: 'View every project on the instance' },
  { key: 'project.read', scope: 'project', label: 'View a project (board, tasks, files)' },
  { key: 'project.write', scope: 'project', label: 'Edit tasks, run agents, write files, chat' },
  { key: 'project.manage_settings', scope: 'project', label: 'Change agent/mode/language/design config' },
  { key: 'project.manage_members', scope: 'project', label: 'Invite/remove members, change their role' },
];
// role id -> [permission keys]. Owner and Admin deliberately hold the identical permission set — see
// docs/online-dashboard-accounts-design.md §2: what distinguishes Owner is protected membership
// status (enforced in application code, Task 12), not a broader permission list.
const SYSTEM_ROLES = [
  { id: 'sys-platform-admin', scope: 'platform', name: 'Platform Admin', perms: ['platform.manage_signup', 'platform.manage_users', 'platform.manage_roles', 'platform.view_all_projects'] },
  { id: 'sys-owner', scope: 'project', name: 'Owner', perms: ['project.read', 'project.write', 'project.manage_settings', 'project.manage_members'] },
  { id: 'sys-admin', scope: 'project', name: 'Admin', perms: ['project.read', 'project.write', 'project.manage_settings', 'project.manage_members'] },
  { id: 'sys-editor', scope: 'project', name: 'Editor', perms: ['project.read', 'project.write'] },
  { id: 'sys-viewer', scope: 'project', name: 'Viewer', perms: ['project.read'] },
];

exports.up = async (knex) => {
  await knex.schema.createTable('permissions', (t) => {
    t.string('key', 60).primary();
    t.string('scope', 20).notNullable();
    t.string('label', 200).notNullable();
  });
  await knex.schema.createTable('roles', (t) => {
    t.string('id', 20).primary();
    t.string('scope', 20).notNullable();
    t.string('owner_user_id', 20).nullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.boolean('is_system').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('role_permissions', (t) => {
    t.string('role_id', 20).notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.string('permission_key', 60).notNullable().references('key').inTable('permissions').onDelete('CASCADE');
    t.primary(['role_id', 'permission_key']);
  });
  await knex.schema.createTable('user_platform_roles', (t) => {
    t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('role_id', 20).notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.primary(['user_id', 'role_id']);
  });
  await knex('permissions').insert(PERMISSIONS);
  for (const r of SYSTEM_ROLES) {
    await knex('roles').insert({ id: r.id, scope: r.scope, owner_user_id: null, name: r.name, is_system: true });
    await knex('role_permissions').insert(r.perms.map((permission_key) => ({ role_id: r.id, permission_key })));
  }
};
exports.down = (knex) => knex.schema
  .dropTableIfExists('user_platform_roles')
  .then(() => knex.schema.dropTableIfExists('role_permissions'))
  .then(() => knex.schema.dropTableIfExists('roles'))
  .then(() => knex.schema.dropTableIfExists('permissions'));
