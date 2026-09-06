'use strict';
exports.up = async (knex) => {
  await knex.schema.alterTable('machines', (t) => {
    t.string('owner_user_id', 20).nullable().references('id').inTable('users').onDelete('CASCADE');
  });
  // No real data to backfill (confirmed with the user during brainstorming — nothing real is
  // deployed yet); the column stays nullable at the DB level for driver portability (some support
  // adding a NOT NULL column with no default more readily than others), but application code (Step 3
  // below) always supplies one — every future row is fully owned.
};
exports.down = (knex) => knex.schema.alterTable('machines', (t) => t.dropColumn('owner_user_id'));
