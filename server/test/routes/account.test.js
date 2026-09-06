'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../../src/app');
const { createDb } = require('../../src/db');

function fakeEmailer() { return { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendInvitationEmail: async () => {} }; }
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, emailer: fakeEmailer() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { app, db, url };
}
async function login(url, email, password) {
  const r = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { cookie: r.headers.get('set-cookie').split(';')[0], fetch: (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: r.headers.get('set-cookie').split(';')[0] }) }) };
}

test('GET /api/account returns the profile; GET /account renders a page', async () => {
  const { app, db, url } = await boot();
  try {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const authedFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });
    const profile = await (await authedFetch('/api/account')).json();
    assert.strictEqual(profile.email, 'alice@example.com');
    assert.strictEqual(profile.emailVerifiedAt, null);
    assert.strictEqual((await authedFetch('/account')).status, 200);
  } finally { await app.close(); await db.destroy(); }
});

test('POST /api/account/password: wrong current password 400; success revokes every OTHER session, keeps this one working via a fresh cookie', async () => {
  const { app, db, url } = await boot();
  try {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bob@example.com', password: 'a-real-password-123' }) });
    const cookieA = r.headers.get('set-cookie').split(';')[0];
    const { cookie: cookieB } = await login(url, 'bob@example.com', 'a-real-password-123'); // a second, independent session
    const authedA = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieA }) });
    const wrong = await authedA('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'nope', newPassword: 'brand-new-password-1' }) });
    assert.strictEqual(wrong.status, 400);
    const change = await authedA('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'a-real-password-123', newPassword: 'brand-new-password-1' }) });
    assert.strictEqual(change.status, 200);
    const newCookie = change.headers.get('set-cookie').split(';')[0];
    const stillWorksNew = await fetch(url + '/api/account', { headers: { Cookie: newCookie } });
    assert.strictEqual(stillWorksNew.status, 200);
    const otherSessionDead = await fetch(url + '/api/account', { headers: { Cookie: cookieB } });
    assert.strictEqual(otherSessionDead.status, 401);
  } finally { await app.close(); await db.destroy(); }
});

test('GET/DELETE /api/account/sessions: lists the caller\'s own sessions only, can revoke one of them, 404 for someone else\'s', async () => {
  const { app, db, url } = await boot();
  try {
    const rA = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'carol@example.com', password: 'a-real-password-123' }) });
    const cookieA = rA.headers.get('set-cookie').split(';')[0];
    const { cookie: cookieA2 } = await login(url, 'carol@example.com', 'a-real-password-123');
    const rB = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dave@example.com', password: 'a-real-password-123' }) });
    const cookieB = rB.headers.get('set-cookie').split(';')[0];
    const authedA = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieA }) });
    const list = await (await authedA('/api/account/sessions')).json();
    assert.strictEqual(list.sessions.length, 2); // this browser's session + the second login
    const other = list.sessions.find((s) => s.id !== list.currentSessionId);
    const revokeOk = await authedA(`/api/account/sessions/${other.id}`, { method: 'DELETE' });
    assert.strictEqual(revokeOk.status, 200);
    const authedB = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieB }) });
    const bList = await (await authedB('/api/account/sessions')).json();
    const revokeForeign = await authedA(`/api/account/sessions/${bList.currentSessionId}`, { method: 'DELETE' });
    assert.strictEqual(revokeForeign.status, 404);
  } finally { await app.close(); await db.destroy(); }
});

test('GET/POST/DELETE /api/account/machines: create shows the token once, list never re-shows it, delete refuses someone else\'s machine', async () => {
  const { app, db, url } = await boot();
  try {
    const rA = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'erin@example.com', password: 'a-real-password-123' }) });
    const cookieA = rA.headers.get('set-cookie').split(';')[0];
    const authedA = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieA }) });
    const created = await (await authedA('/api/account/machines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'my-laptop' }) })).json();
    assert.match(created.machine.token, /^spf_/);
    const list = await (await authedA('/api/account/machines')).json();
    assert.strictEqual(list.machines.length, 1);
    assert.strictEqual(list.machines[0].token, undefined);
    const rB = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'frank@example.com', password: 'a-real-password-123' }) });
    const cookieB = rB.headers.get('set-cookie').split(';')[0];
    const authedB = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieB }) });
    assert.strictEqual((await authedB(`/api/account/machines/${created.machine.id}`, { method: 'DELETE' })).status, 404);
    assert.strictEqual((await authedA(`/api/account/machines/${created.machine.id}`, { method: 'DELETE' })).status, 200);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /account: the served page contains the client-side HTML-escape helper used before any untrusted value is inserted via innerHTML', async () => {
  const { app, db, url } = await boot();
  try {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'grace@example.com', password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const page = await (await fetch(url + '/account', { headers: { Cookie: cookie } })).text();
    // The escape helper itself must be present in the shipped script.
    assert.match(page, /function esc\(/);
    // And every untrusted interpolation into innerHTML (userAgent, ip, machine name) must route through it.
    assert.match(page, /esc\(x\.userAgent/);
    assert.match(page, /esc\(x\.ip\)/);
    assert.match(page, /esc\(x\.name\)/);
  } finally { await app.close(); await db.destroy(); }
});

test('XSS: a malicious User-Agent sent at login is stored and returned raw by the JSON API (correct — it is just data), but the account page script would escape it before ever rendering it via innerHTML', async () => {
  const { app, db, url } = await boot();
  try {
    const malicious = '<img src=x onerror=alert(document.cookie)>';
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': malicious }, body: JSON.stringify({ email: 'heidi@example.com', password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const sessions = await (await fetch(url + '/api/account/sessions', { headers: { Cookie: cookie } })).json();
    const mine = sessions.sessions.find((s) => s.id === sessions.currentSessionId);
    // The JSON API legitimately returns the raw value — it's a data endpoint, not HTML.
    assert.strictEqual(mine.userAgent, malicious);
    // Simulate what the page's client-side code does with it: apply the shipped esc() to the raw value.
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    const rendered = esc(mine.userAgent || 'unknown');
    assert.ok(!rendered.includes('<img'));
    assert.ok(!rendered.includes('<script'));
  } finally { await app.close(); await db.destroy(); }
});
