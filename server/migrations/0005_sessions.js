'use strict';
exports.up = (knex) => knex.schema.createTable('sessions', (t) => {
  t.string('id', 20).primary();
  t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
  t.string('token_hash', 64).notNullable().unique();
  t.string('user_agent', 300).nullable();
  t.string('ip', 64).nullable();
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('last_seen_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('revoked_at').nullable();
});
exports.down = (knex) => knex.schema.dropTableIfExists('sessions');
