'use strict';
exports.up = (knex) => knex.schema.createTable('machines', (t) => {
  t.string('id', 20).primary();
  t.string('name', 100).notNullable();
  t.string('token_hash', 64).notNullable().unique();
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('last_seen').nullable();
  t.timestamp('revoked_at').nullable();
});
exports.down = (knex) => knex.schema.dropTableIfExists('machines');
