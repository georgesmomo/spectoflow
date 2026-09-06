'use strict';
exports.up = async (knex) => {
  await knex.schema.createTable('project_members', (t) => {
    t.string('project_id', 20).notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('role_id', 20).notNullable().references('id').inTable('roles');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['project_id', 'user_id']);
  });
  await knex.schema.createTable('project_invitations', (t) => {
    t.string('id', 20).primary();
    t.string('project_id', 20).notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('email', 320).notNullable();
    t.string('role_id', 20).notNullable().references('id').inTable('roles');
    t.string('invited_by_user_id', 20).notNullable().references('id').inTable('users');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('accepted_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};
exports.down = (knex) => knex.schema.dropTableIfExists('project_invitations').then(() => knex.schema.dropTableIfExists('project_members'));
