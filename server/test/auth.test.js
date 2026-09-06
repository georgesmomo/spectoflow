'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../src/app');
const { createDb } = require('../src/db');

async function app(opts = {}) {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const a = await buildApp({ db, accessKey: 'x'.repeat(20), sessionSecret: 's'.repeat(32), insecureDev: false, publicDir: __dirname, ...opts });
  return { app: a, db };
}

test('/healthz is public and needs no cookie', async () => {
  const { app: a, db } = await app();
  try { const r = await a.inject({ method: 'GET', url: '/healthz' }); assert.strictEqual(r.statusCode, 200); assert.deepStrictEqual(r.json(), { ok: true }); }
  finally { await a.close(); await db.destroy(); }
});

test('every other route is 401 without the session cookie; the wrong key at /login is 401 and never sets a cookie', async () => {
  const { app: a, db } = await app();
  try {
    const r1 = await a.inject({ method: 'GET', url: '/' });
    assert.strictEqual(r1.statusCode, 401);
    const r2 = await a.inject({ method: 'POST', url: '/login', payload: { key: 'wrong-key-wrong-key' } });
    assert.strictEqual(r2.statusCode, 401);
    assert.strictEqual(r2.cookies.length, 0);
  } finally { await a.close(); await db.destroy(); }
});

test('the right key sets a signed cookie that then authorizes requests; GET /login itself is public', async () => {
  // publicDir left as the real default (lib/dashboard/public) here, not the test dir, so the
  // protected "/" route can genuinely serve hub.html — proving reply.sendFile actually works,
  // not just that the status code happens to not be 401 (regression for the decorateReply:false bug).
  const { app: a, db } = await app({ publicDir: undefined });
  try {
    const login = await a.inject({ method: 'GET', url: '/login' });
    assert.strictEqual(login.statusCode, 200);
    const r = await a.inject({ method: 'POST', url: '/login', payload: { key: 'x'.repeat(20) } });
    assert.strictEqual(r.statusCode, 200);
    const cookie = r.cookies.find((c) => c.name === 'spf_session');
    assert.ok(cookie); assert.strictEqual(cookie.httpOnly, true); assert.strictEqual(cookie.sameSite, 'Lax');
    const authed = await a.inject({ method: 'GET', url: '/healthz', cookies: { spf_session: cookie.value } });
    assert.strictEqual(authed.statusCode, 200);
    const tampered = await a.inject({ method: 'GET', url: '/healthz', cookies: { spf_session: cookie.value.slice(0, -1) + (cookie.value.slice(-1) === 'a' ? 'b' : 'a') } });
    assert.strictEqual(tampered.statusCode, 200); // healthz is public regardless — use a protected route instead:
    const protectedOk = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie.value } });
    assert.strictEqual(protectedOk.statusCode, 200); // was notStrictEqual(...,401) — too weak to catch a 500 from a broken reply.sendFile
    assert.match(protectedOk.body, /<html/i);
    const protectedTampered = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie.value.slice(0, -1) + (cookie.value.slice(-1) === 'a' ? 'b' : 'a') } });
    assert.strictEqual(protectedTampered.statusCode, 401);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /login is rate-limited: the 11th attempt within the window is 429', async () => {
  const { app: a, db } = await app();
  try {
    let last;
    for (let i = 0; i < 11; i++) last = await a.inject({ method: 'POST', url: '/login', payload: { key: 'nope' } });
    assert.strictEqual(last.statusCode, 429);
  } finally { await a.close(); await db.destroy(); }
});

test('a path merely starting with "/login" or "/healthz" is not treated as public (no auth-bypass-in-waiting)', async () => {
  const { app: a, db } = await app();
  try {
    const r1 = await a.inject({ method: 'GET', url: '/loginZZZ' });
    assert.strictEqual(r1.statusCode, 401);
    const r2 = await a.inject({ method: 'GET', url: '/login-bypass-test' });
    assert.strictEqual(r2.statusCode, 401);
    const r3 = await a.inject({ method: 'GET', url: '/healthzXYZ' });
    assert.strictEqual(r3.statusCode, 401);
  } finally { await a.close(); await db.destroy(); }
});
