'use strict';
exports.up = (knex) => knex.schema.createTable('projects', (t) => {
  t.string('id', 20).primary();
  t.string('machine_id', 20).notNullable().references('id').inTable('machines').onDelete('CASCADE');
  t.string('local_id', 12).notNullable();
  t.string('name', 200).notNullable();
  t.string('kind', 40).notNullable().defaultTo('spectoflow');
  t.boolean('published').notNullable().defaultTo(false);
  t.text('last_snapshot', 'longtext');
  t.timestamp('snapshot_at').nullable();
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.unique(['machine_id', 'local_id']);
});
exports.down = (knex) => knex.schema.dropTableIfExists('projects');
