'use strict';
const VALID_MODES = ['open', 'invite_only', 'disabled'];
function createSettingsModel(knex) {
  async function getSignupMode() {
    const row = await knex('platform_settings').where({ id: 'singleton' }).first();
    return (row && row.signup_mode) || 'open';
  }
  async function setSignupMode(mode) {
    if (!VALID_MODES.includes(mode)) throw new Error(`invalid signup mode "${mode}" — must be one of ${VALID_MODES.join(', ')}`);
    await knex('platform_settings').where({ id: 'singleton' }).update({ signup_mode: mode });
  }
  return { getSignupMode, setSignupMode };
}
module.exports = { createSettingsModel, VALID_MODES };
