'use strict';
exports.up = async (knex) => {
  await knex.schema.createTable('email_verification_tokens', (t) => {
    t.string('id', 20).primary();
    t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
  });
  await knex.schema.createTable('password_reset_tokens', (t) => {
    t.string('id', 20).primary();
    t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
  });
};
exports.down = (knex) => knex.schema.dropTableIfExists('password_reset_tokens').then(() => knex.schema.dropTableIfExists('email_verification_tokens'));
