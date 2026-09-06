'use strict';
/*
 * A single generic single-use-token implementation, parameterized by table name, reused for both
 * email_verification_tokens and password_reset_tokens (identical shape: id/user_id/token_hash/
 * expires_at/used_at) — DRY without merging two semantically distinct tables into one.
 */
const crypto = require('crypto');
function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function makeTokenPair(knex, tableName, ttlMs) {
  async function create(userId) {
    const id = randomId(8);
    const token = 'spf_' + randomId(32);
    const expiresAt = new Date(Date.now() + ttlMs);
    await knex(tableName).insert({ id, user_id: userId, token_hash: hashToken(token), expires_at: expiresAt });
    return token;
  }
  async function consume(rawToken) {
    const row = await knex(tableName).where({ token_hash: hashToken(rawToken) }).whereNull('used_at').first();
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    await knex(tableName).where({ id: row.id }).update({ used_at: knex.fn.now() });
    return row.user_id;
  }
  return { create, consume };
}

function createTokensModel(knex) {
  const HOUR = 60 * 60 * 1000;
  const emailVerification = makeTokenPair(knex, 'email_verification_tokens', 24 * HOUR);
  const passwordReset = makeTokenPair(knex, 'password_reset_tokens', HOUR);
  return {
    createEmailVerificationToken: emailVerification.create,
    consumeEmailVerificationToken: emailVerification.consume,
    createPasswordResetToken: passwordReset.create,
    consumePasswordResetToken: passwordReset.consume,
  };
}

module.exports = { createTokensModel };
