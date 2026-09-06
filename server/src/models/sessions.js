'use strict';
const crypto = require('crypto');
function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function toPublic(row) { return { id: row.id, userId: row.user_id, userAgent: row.user_agent, ip: row.ip, createdAt: row.created_at, lastSeenAt: row.last_seen_at }; }

function createSessionsModel(knex) {
  async function createSession(userId, { userAgent, ip } = {}) {
    const id = randomId(8);
    const token = 'spf_' + randomId(32);
    await knex('sessions').insert({ id, user_id: userId, token_hash: hashToken(token), user_agent: userAgent || null, ip: ip || null });
    return { ...toPublic(await knex('sessions').where({ id }).first()), token };
  }
  async function findSessionByToken(token) {
    const row = await knex('sessions').where({ token_hash: hashToken(token) }).whereNull('revoked_at').first();
    return row ? toPublic(row) : null;
  }
  async function touchSession(id) {
    await knex('sessions').where({ id }).update({ last_seen_at: knex.fn.now() });
  }
  async function revokeSession(id) {
    const n = await knex('sessions').where({ id }).whereNull('revoked_at').update({ revoked_at: knex.fn.now() });
    return n > 0;
  }
  async function revokeAllSessionsForUser(userId) {
    return knex('sessions').where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: knex.fn.now() });
  }
  async function listSessionsForUser(userId) {
    const rows = await knex('sessions').where({ user_id: userId }).whereNull('revoked_at').orderBy('last_seen_at', 'desc');
    return rows.map(toPublic);
  }
  return { createSession, findSessionByToken, touchSession, revokeSession, revokeAllSessionsForUser, listSessionsForUser };
}

module.exports = { createSessionsModel };
