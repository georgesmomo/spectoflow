'use strict';
exports.up = async (knex) => {
  await knex.schema.createTable('platform_settings', (t) => {
    t.string('id', 20).primary();
    t.string('signup_mode', 20).notNullable().defaultTo('open');
  });
  await knex('platform_settings').insert({ id: 'singleton', signup_mode: 'open' });
};
exports.down = (knex) => knex.schema.dropTableIfExists('platform_settings');
