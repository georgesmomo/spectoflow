'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }
async function user(db, email = 'x@example.com') { return db.createUser(email, 'password-123456'); }

test('createSession returns the token once; findSessionByToken looks it up and never re-returns the token', async () => {
  const db = await fresh();
  try {
    const u = await user(db);
    const s = await db.createSession(u.id, { userAgent: 'TestAgent/1.0', ip: '127.0.0.1' });
    assert.match(s.token, /^spf_[A-Za-z0-9_-]{20,}$/);
    const found = await db.findSessionByToken(s.token);
    assert.strictEqual(found.id, s.id);
    assert.strictEqual(found.userId, u.id);
    assert.strictEqual(found.userAgent, 'TestAgent/1.0');
    assert.strictEqual(found.token, undefined);
    assert.strictEqual(await db.findSessionByToken('spf_wrong'), null);
  } finally { await db.destroy(); }
});

test('touchSession bumps last_seen_at; revokeSession makes findSessionByToken return null', async () => {
  const db = await fresh();
  try {
    const u = await user(db);
    const s = await db.createSession(u.id, { userAgent: 'A', ip: '1.2.3.4' });
    const before = (await db.findSessionByToken(s.token)).lastSeenAt;
    await new Promise((r) => setTimeout(r, 1100));
    await db.touchSession(s.id);
    const after = (await db.findSessionByToken(s.token)).lastSeenAt;
    assert.notStrictEqual(before, after);
    assert.strictEqual(await db.revokeSession(s.id), true);
    assert.strictEqual(await db.findSessionByToken(s.token), null);
    assert.strictEqual(await db.revokeSession('unknown-id'), false);
  } finally { await db.destroy(); }
});

test('revokeAllSessionsForUser revokes only that user\'s sessions; listSessionsForUser excludes revoked ones and the token itself', async () => {
  const db = await fresh();
  try {
    const alice = await user(db, 'alice@example.com');
    const bob = await user(db, 'bob@example.com');
    const s1 = await db.createSession(alice.id, { userAgent: 'A1', ip: '1.1.1.1' });
    const s2 = await db.createSession(alice.id, { userAgent: 'A2', ip: '2.2.2.2' });
    const s3 = await db.createSession(bob.id, { userAgent: 'B1', ip: '3.3.3.3' });
    assert.strictEqual(await db.revokeAllSessionsForUser(alice.id), 2);
    assert.strictEqual(await db.findSessionByToken(s1.token), null);
    assert.strictEqual(await db.findSessionByToken(s2.token), null);
    assert.ok(await db.findSessionByToken(s3.token)); // bob's session untouched
    const bobList = await db.listSessionsForUser(bob.id);
    assert.strictEqual(bobList.length, 1);
    assert.strictEqual(bobList[0].token, undefined);
    assert.strictEqual((await db.listSessionsForUser(alice.id)).length, 0);
  } finally { await db.destroy(); }
});
