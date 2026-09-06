'use strict';
exports.up = (knex) => knex.schema.createTable('users', (t) => {
  t.string('id', 20).primary();
  t.string('email', 320).notNullable().unique();
  t.string('password_hash', 200).notNullable();
  t.timestamp('email_verified_at').nullable();
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('last_login_at').nullable();
});
exports.down = (knex) => knex.schema.dropTableIfExists('users');
