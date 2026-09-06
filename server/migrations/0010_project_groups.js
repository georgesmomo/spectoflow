'use strict';
exports.up = async (knex) => {
  await knex.schema.createTable('project_groups', (t) => {
    t.string('id', 20).primary();
    t.string('owner_user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 100).notNullable();
  });
  await knex.schema.alterTable('projects', (t) => {
    t.string('group_id', 20).nullable().references('id').inTable('project_groups').onDelete('SET NULL');
  });
};
exports.down = async (knex) => {
  await knex.schema.alterTable('projects', (t) => t.dropColumn('group_id'));
  await knex.schema.dropTableIfExists('project_groups');
};
