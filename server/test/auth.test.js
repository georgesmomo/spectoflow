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
  // baseUrl is required whenever insecureDev is false (see server/src/auth.js's resolveBaseUrl) —
  // this default keeps every existing test working without passing it explicitly; the SECURITY test
  // below overrides it to prove links are built from it, never from a spoofed Host header.
  const a = await buildApp({ db, insecureDev: false, baseUrl: 'http://127.0.0.1:3000', publicDir: __dirname, emailer, ...opts });
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

test('signup respects the platform signup mode: disabled blocks everyone, invite_only requires a pending invitation for that email', async () => {
  const { app: a, db } = await app({ publicDir: undefined });
  try {
    await db.setSignupMode('disabled');
    assert.strictEqual((await signup(a, 'x1@example.com')).statusCode, 403);
    await db.setSignupMode('invite_only');
    assert.strictEqual((await signup(a, 'x2@example.com')).statusCode, 403); // no invitation exists for this email
    // Create a real pending invitation for x3@example.com via the model directly (routes.sharing's
    // own HTTP invite flow is tested in test/routes/sharing.test.js — this test only needs the
    // signup-side gate, not the full invite-creation path).
    const someoneElse = await db.createUser('inviter@example.com', 'password-123456');
    const m = await db.createMachine('m', someoneElse.id); await m.ready;
    const project = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
    await db.createInvitation({ projectId: project.id, email: 'x3@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER, invitedByUserId: someoneElse.id });
    assert.strictEqual((await signup(a, 'x3@example.com')).statusCode, 200);
    await db.setSignupMode('open');
    assert.strictEqual((await signup(a, 'x4@example.com')).statusCode, 200); // open mode needs no invitation
  } finally { await a.close(); await db.destroy(); }
});

test('the very first account ever created automatically becomes Platform Admin; the second does not', async () => {
  const { app: a, db } = await app({ publicDir: undefined });
  try {
    const first = await signup(a, 'first@example.com');
    const firstUser = await db.findUserByEmail('first@example.com');
    assert.strictEqual(await db.hasPlatformPermission(firstUser.id, 'platform.manage_signup'), true);
    await signup(a, 'second@example.com');
    const secondUser = await db.findUserByEmail('second@example.com');
    assert.strictEqual(await db.hasPlatformPermission(secondUser.id, 'platform.manage_signup'), false);
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

test('password reset: request never reveals whether the email exists; confirm updates the password and revokes every session', async () => {
  const { app: a, db, emailer } = await app({ publicDir: undefined });
  try {
    const rSignup = await signup(a);
    const oldCookie = rSignup.cookies.find((c) => c.name === 'spf_session').value;
    const reqUnknown = await a.inject({ method: 'POST', url: '/password-reset/request', payload: { email: 'nobody@example.com' } });
    assert.strictEqual(reqUnknown.statusCode, 200);
    assert.strictEqual(emailer.sent.filter((m) => m.kind === 'reset').length, 0); // nothing actually sent for an unknown email
    const reqKnown = await a.inject({ method: 'POST', url: '/password-reset/request', payload: { email: 'alice@example.com' } });
    assert.strictEqual(reqKnown.statusCode, 200);
    const resetEmails = emailer.sent.filter((m) => m.kind === 'reset');
    assert.strictEqual(resetEmails.length, 1);
    const token = resetEmails[0].url.split('/password-reset/')[1];
    const page = await a.inject({ method: 'GET', url: `/password-reset/${token}` });
    assert.strictEqual(page.statusCode, 200);
    const badPassword = await a.inject({ method: 'POST', url: '/password-reset/confirm', payload: { token, newPassword: 'short' } });
    assert.strictEqual(badPassword.statusCode, 400);
    const confirm = await a.inject({ method: 'POST', url: '/password-reset/confirm', payload: { token, newPassword: 'a-brand-new-password-1' } });
    assert.strictEqual(confirm.statusCode, 200);
    const stillOld = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: oldCookie } });
    assert.strictEqual(stillOld.statusCode, 401); // old session revoked by the reset
    const login = await a.inject({ method: 'POST', url: '/login', payload: { email: 'alice@example.com', password: 'a-brand-new-password-1' } });
    assert.strictEqual(login.statusCode, 200);
    const again = await a.inject({ method: 'POST', url: '/password-reset/confirm', payload: { token, newPassword: 'yet-another-password-2' } });
    assert.strictEqual(again.statusCode, 400); // single-use
  } finally { await a.close(); await db.destroy(); }
});

test('GET /password-reset/:token rejects a malformed token (reflected-XSS payload) with 400 instead of rendering it', async () => {
  const { app: a, db } = await app({ publicDir: undefined });
  try {
    const payload = '</script><script>alert(1)</script>';
    const r = await a.inject({ method: 'GET', url: `/password-reset/${encodeURIComponent(payload)}` });
    assert.strictEqual(r.statusCode, 400);
    assert.ok(!r.body.includes(payload)); // never reflected into the response
  } finally { await a.close(); await db.destroy(); }
});

test('SECURITY: in non-insecureDev mode, the signup verification link is built from baseUrl, never from a spoofed Host header (account-takeover regression)', async () => {
  const { app: a, db, emailer } = await app({ baseUrl: 'https://dashboard.example.com' });
  try {
    const r = await a.inject({
      method: 'POST', url: '/signup',
      headers: { host: 'evil.example' },
      payload: { email: 'victim@example.com', password: 'a-real-password-123' },
    });
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.strictEqual(emailer.sent.length, 1);
    assert.strictEqual(emailer.sent[0].kind, 'verify');
    assert.ok(emailer.sent[0].url.startsWith('https://dashboard.example.com/verify-email/'), emailer.sent[0].url);
    assert.ok(!emailer.sent[0].url.includes('evil.example'));
  } finally { await a.close(); await db.destroy(); }
});
