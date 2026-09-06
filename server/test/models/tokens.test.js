'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('email verification token: create, consume once (returns the userId), a second consume fails', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('a@example.com', 'password-123456');
    const token = await db.createEmailVerificationToken(u.id);
    assert.match(token, /^spf_/);
    assert.strictEqual(await db.consumeEmailVerificationToken(token), u.id);
    assert.strictEqual(await db.consumeEmailVerificationToken(token), null); // single-use
    assert.strictEqual(await db.consumeEmailVerificationToken('spf_bogus'), null);
  } finally { await db.destroy(); }
});

test('password reset token: same single-use shape, independent of email-verification tokens', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('b@example.com', 'password-123456');
    const evToken = await db.createEmailVerificationToken(u.id);
    const prToken = await db.createPasswordResetToken(u.id);
    assert.notStrictEqual(evToken, prToken);
    assert.strictEqual(await db.consumePasswordResetToken(evToken), null); // wrong table entirely
    assert.strictEqual(await db.consumePasswordResetToken(prToken), u.id);
    assert.strictEqual(await db.consumePasswordResetToken(prToken), null);
    assert.strictEqual(await db.consumeEmailVerificationToken(evToken), u.id); // untouched by the above
  } finally { await db.destroy(); }
});

test('an expired token is never consumable', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('c@example.com', 'password-123456');
    const token = await db.createEmailVerificationToken(u.id);
    // Force it into the past directly, since createEmailVerificationToken's real expiry is 24h out.
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await db.knex('email_verification_tokens').where({ token_hash: tokenHash }).update({ expires_at: new Date(Date.now() - 1000) });
    assert.strictEqual(await db.consumeEmailVerificationToken(token), null);
  } finally { await db.destroy(); }
});
