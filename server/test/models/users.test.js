'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('createUser hashes the password (argon2id) and never returns it; findUserByEmail/findUserById round-trip', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('Alice@Example.com', 'correct horse battery staple');
    assert.ok(u.id);
    assert.strictEqual(u.email, 'alice@example.com'); // lowercased
    assert.strictEqual(u.password_hash, undefined);
    assert.strictEqual(u.email_verified_at, null);
    assert.strictEqual(u.last_login_at, null);
    const byEmail = await db.findUserByEmail('ALICE@EXAMPLE.COM'); // lookup is case-insensitive too
    assert.strictEqual(byEmail.id, u.id);
    assert.ok(byEmail.password_hash && byEmail.password_hash.startsWith('$argon2id$'));
    const byId = await db.findUserById(u.id);
    assert.strictEqual(byId.email, 'alice@example.com');
    assert.strictEqual(await db.findUserByEmail('nobody@example.com'), null);
    assert.strictEqual(await db.findUserById('nope'), null);
  } finally { await db.destroy(); }
});

test('a duplicate email (case-insensitive) is rejected', async () => {
  const db = await fresh();
  try {
    await db.createUser('bob@example.com', 'password123456');
    await assert.rejects(() => db.createUser('Bob@Example.com', 'different-password'));
  } finally { await db.destroy(); }
});

test('verifyPassword: correct password true, wrong password false', async () => {
  const db = await fresh();
  try {
    await db.createUser('carol@example.com', 'the-real-password');
    const user = await db.findUserByEmail('carol@example.com');
    assert.strictEqual(await db.verifyPassword(user, 'the-real-password'), true);
    assert.strictEqual(await db.verifyPassword(user, 'wrong'), false);
  } finally { await db.destroy(); }
});

test('updatePassword replaces the hash; markEmailVerified/touchLastLogin set their timestamps', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('dave@example.com', 'original-password');
    await db.updatePassword(u.id, 'new-password');
    const afterUpdate = await db.findUserByEmail('dave@example.com');
    assert.strictEqual(await db.verifyPassword(afterUpdate, 'original-password'), false);
    assert.strictEqual(await db.verifyPassword(afterUpdate, 'new-password'), true);
    assert.strictEqual((await db.findUserById(u.id)).email_verified_at, null);
    await db.markEmailVerified(u.id);
    assert.ok((await db.findUserById(u.id)).email_verified_at);
    assert.strictEqual((await db.findUserById(u.id)).last_login_at, null);
    await db.touchLastLogin(u.id);
    assert.ok((await db.findUserById(u.id)).last_login_at);
  } finally { await db.destroy(); }
});

test('countUsers / listUsers never leak password_hash', async () => {
  const db = await fresh();
  try {
    assert.strictEqual(await db.countUsers(), 0);
    await db.createUser('eve@example.com', 'password-one');
    await db.createUser('frank@example.com', 'password-two');
    assert.strictEqual(await db.countUsers(), 2);
    const rows = await db.listUsers();
    assert.strictEqual(rows.length, 2);
    for (const r of rows) assert.strictEqual(r.password_hash, undefined);
  } finally { await db.destroy(); }
});
