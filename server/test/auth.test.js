'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../src/app');
const { createDb } = require('../src/db');

function fakeEmailer() {
  const sent = [];
  return { sent,
    sendVerificationEmail: async (to, url) => { sent.push({ kind: 'verify', to, url }); },
    sendPasswordResetEmail: async (to, url) => { sent.push({ kind: 'reset', to, url }); },
    sendInvitationEmail: async (to, projectName, url) => { sent.push({ kind: 'invite', to, projectName, url }); },
  };
}
async function app(opts = {}) {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const emailer = opts.emailer || fakeEmailer();
  const a = await buildApp({ db, insecureDev: false, publicDir: __dirname, emailer, ...opts });
  return { app: a, db, emailer };
}
async function signup(a, email = 'alice@example.com', password = 'a-real-password-123') {
  return a.inject({ method: 'POST', url: '/signup', payload: { email, password } });
}

test('/healthz is public and needs no cookie', async () => {
  const { app: a, db } = await app();
  try { const r = await a.inject({ method: 'GET', url: '/healthz' }); assert.strictEqual(r.statusCode, 200); }
  finally { await a.close(); await db.destroy(); }
});

test('every other route is 401 without a session cookie; GET /login and GET /signup are public', async () => {
  const { app: a, db } = await app();
  try {
    assert.strictEqual((await a.inject({ method: 'GET', url: '/' })).statusCode, 401);
    assert.strictEqual((await a.inject({ method: 'GET', url: '/login' })).statusCode, 200);
    assert.strictEqual((await a.inject({ method: 'GET', url: '/signup' })).statusCode, 200);
    assert.strictEqual((await a.inject({ method: 'GET', url: '/loginZZZ' })).statusCode, 401); // no bypass-in-waiting, same rule as before
    assert.strictEqual((await a.inject({ method: 'GET', url: '/signupZZZ' })).statusCode, 401);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /signup creates a real account, sets a working session cookie, and rejects a duplicate email', async () => {
  const { app: a, db, emailer } = await app({ publicDir: undefined });
  try {
    const r = await signup(a);
    assert.strictEqual(r.statusCode, 200, r.body);
    const cookie = r.cookies.find((c) => c.name === 'spf_session');
    assert.ok(cookie); assert.strictEqual(cookie.httpOnly, true); assert.strictEqual(cookie.sameSite, 'Lax');
    const protectedOk = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie.value } });
    assert.strictEqual(protectedOk.statusCode, 200);
    assert.match(protectedOk.body, /<html/i);
    const dup = await signup(a);
    assert.strictEqual(dup.statusCode, 409);
    const user = await db.findUserByEmail('alice@example.com');
    assert.ok(user);
    assert.strictEqual(emailer.sent.length, 1);
    assert.strictEqual(emailer.sent[0].kind, 'verify');
    assert.strictEqual(emailer.sent[0].to, 'alice@example.com');
  } finally { await a.close(); await db.destroy(); }
});

test('POST /login: correct credentials set a cookie; wrong password/unknown email are 401 and set no cookie; a tampered cookie is 401', async () => {
  const { app: a, db } = await app();
  try {
    await signup(a);
    const wrong = await a.inject({ method: 'POST', url: '/login', payload: { email: 'alice@example.com', password: 'nope' } });
    assert.strictEqual(wrong.statusCode, 401); assert.strictEqual(wrong.cookies.length, 0);
    const unknown = await a.inject({ method: 'POST', url: '/login', payload: { email: 'nobody@example.com', password: 'whatever12345' } });
    assert.strictEqual(unknown.statusCode, 401);
    const ok = await a.inject({ method: 'POST', url: '/login', payload: { email: 'alice@example.com', password: 'a-real-password-123' } });
    assert.strictEqual(ok.statusCode, 200);
    const cookie = ok.cookies.find((c) => c.name === 'spf_session').value;
    assert.strictEqual((await a.inject({ method: 'GET', url: '/healthz' })).statusCode, 200); // public regardless
    const tampered = cookie.slice(0, -1) + (cookie.slice(-1) === 'a' ? 'b' : 'a');
    assert.strictEqual((await a.inject({ method: 'GET', url: '/', cookies: { spf_session: tampered } })).statusCode, 401);
    const user = await db.findUserByEmail('alice@example.com');
    assert.ok(user.last_login_at);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /logout revokes the session; the same cookie no longer authorizes', async () => {
  const { app: a, db } = await app({ publicDir: undefined }); // GET '/' below must serve a real hub.html
  try {
    const r = await signup(a);
    const cookie = r.cookies.find((c) => c.name === 'spf_session').value;
    const before = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie } });
    assert.strictEqual(before.statusCode, 200);
    const out = await a.inject({ method: 'POST', url: '/logout', cookies: { spf_session: cookie } });
    assert.strictEqual(out.statusCode, 200);
    const after = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie } });
    assert.strictEqual(after.statusCode, 401);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /login is rate-limited: the 11th attempt within the window is 429', async () => {
  const { app: a, db } = await app();
  try {
    let last;
    for (let i = 0; i < 11; i++) last = await a.inject({ method: 'POST', url: '/login', payload: { email: 'nobody@example.com', password: 'nope' } });
    assert.strictEqual(last.statusCode, 429);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /signup validates: missing fields 400, a too-short password 400', async () => {
  const { app: a, db } = await app();
  try {
    assert.strictEqual((await a.inject({ method: 'POST', url: '/signup', payload: { email: 'x@example.com' } })).statusCode, 400);
    assert.strictEqual((await a.inject({ method: 'POST', url: '/signup', payload: { email: 'x@example.com', password: 'short' } })).statusCode, 400);
  } finally { await a.close(); await db.destroy(); }
});

test('GET /verify-email/:token marks the account verified once, and only once', async () => {
  const { app: a, db, emailer } = await app({ publicDir: undefined });
  try {
    await signup(a);
    const link = emailer.sent[0].url;
    const token = link.split('/verify-email/')[1];
    const before = await db.findUserByEmail('alice@example.com');
    assert.strictEqual(before.email_verified_at, null);
    const r1 = await a.inject({ method: 'GET', url: `/verify-email/${token}` });
    assert.strictEqual(r1.statusCode, 200);
    assert.ok((await db.findUserByEmail('alice@example.com')).email_verified_at);
    const r2 = await a.inject({ method: 'GET', url: `/verify-email/${token}` });
    assert.strictEqual(r2.statusCode, 400); // already used
    const bogus = await a.inject({ method: 'GET', url: '/verify-email/spf_bogus' });
    assert.strictEqual(bogus.statusCode, 400);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /account/resend-verification requires a session and sends a fresh email', async () => {
  const { app: a, db, emailer } = await app();
  try {
    const anon = await a.inject({ method: 'POST', url: '/account/resend-verification' });
    assert.strictEqual(anon.statusCode, 401);
    const r = await signup(a);
    const cookie = r.cookies.find((c) => c.name === 'spf_session').value;
    assert.strictEqual(emailer.sent.length, 1);
    const resend = await a.inject({ method: 'POST', url: '/account/resend-verification', cookies: { spf_session: cookie } });
    assert.strictEqual(resend.statusCode, 200);
    assert.strictEqual(emailer.sent.length, 2);
    assert.strictEqual(emailer.sent[1].kind, 'verify');
  } finally { await a.close(); await db.destroy(); }
});

test('POST /signup still succeeds with a working session cookie when the verification email fails to send', async () => {
  const brokenEmailer = { sendVerificationEmail: async () => { throw new Error('SMTP is down'); } };
  const { app: a, db } = await app({ emailer: brokenEmailer, publicDir: undefined });
  try {
    const r = await signup(a);
    assert.strictEqual(r.statusCode, 200, r.body);
    const cookie = r.cookies.find((c) => c.name === 'spf_session');
    assert.ok(cookie);
    const protectedOk = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie.value } });
    assert.strictEqual(protectedOk.statusCode, 200);
    const user = await db.findUserByEmail('alice@example.com');
    assert.ok(user);
  } finally { await a.close(); await db.destroy(); }
});
