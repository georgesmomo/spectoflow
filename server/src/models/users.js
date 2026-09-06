'use strict';
/*
 * User accounts. Passwords are hashed with argon2id (current OWASP-recommended default) — never
 * SHA-256, unlike the SPF_-token hashing used elsewhere in this schema (machines/sessions/
 * verification tokens), since those are high-entropy random secrets, not human-chosen passwords.
 */
const crypto = require('crypto');
const argon2 = require('argon2');

function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
const PUBLIC_COLUMNS = ['id', 'email', 'email_verified_at', 'created_at', 'last_login_at'];

function createUsersModel(knex) {
  async function createUser(email, password) {
    const id = randomId(8);
    const password_hash = await argon2.hash(password, { type: argon2.argon2id });
    await knex('users').insert({ id, email: String(email).toLowerCase(), password_hash });
    return findUserById(id);
  }
  async function findUserByEmail(email) {
    const row = await knex('users').where({ email: String(email).toLowerCase() }).first();
    return row || null;
  }
  async function findUserById(id) {
    const row = await knex('users').where({ id }).first();
    return row || null;
  }
  async function verifyPassword(user, password) {
    return argon2.verify(user.password_hash, password);
  }
  async function updatePassword(userId, password) {
    const password_hash = await argon2.hash(password, { type: argon2.argon2id });
    await knex('users').where({ id: userId }).update({ password_hash });
  }
  async function markEmailVerified(userId) {
    await knex('users').where({ id: userId }).update({ email_verified_at: knex.fn.now() });
  }
  async function touchLastLogin(userId) {
    await knex('users').where({ id: userId }).update({ last_login_at: knex.fn.now() });
  }
  async function countUsers() {
    const r = await knex('users').count({ n: 'id' }).first();
    return Number(r.n);
  }
  async function listUsers() {
    return knex('users').select(PUBLIC_COLUMNS).orderBy('created_at', 'asc');
  }
  return {
    createUser: async (...a) => { const u = await createUser(...a); const { password_hash, ...pub } = u; return pub; },
    findUserByEmail, findUserById, verifyPassword, updatePassword, markEmailVerified, touchLastLogin,
    countUsers, listUsers,
  };
}

module.exports = { createUsersModel };
