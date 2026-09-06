'use strict';
/*
 * C1 access control: one shared access key for the whole online dashboard (no accounts yet — C2
 * introduces users and per-user sessions). A correct key at POST /login sets a signed, stateless
 * cookie (HMAC-SHA256 over an expiry timestamp — nothing to look up, so revocation in C1 means
 * rotating SESSION_SECRET, which invalidates every cookie at once). Every route except the ones
 * listed in PUBLIC_PREFIXES requires it.
 */
const crypto = require('crypto');
const fastifyCookie = require('@fastify/cookie');
const fastifyRateLimit = require('@fastify/rate-limit');

const COOKIE = 'spf_session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_PREFIXES = ['/healthz', '/login', '/connector/'];
const isPublic = (url) => PUBLIC_PREFIXES.some((p) => url === p || url.startsWith(p));

function sign(secret, expiresAt) {
  const mac = crypto.createHmac('sha256', secret).update(String(expiresAt)).digest('base64url');
  return `${expiresAt}.${mac}`;
}
function verify(secret, value) {
  if (!value) return false;
  const [expiresAt, mac] = String(value).split('.');
  if (!expiresAt || !mac) return false;
  const expected = crypto.createHmac('sha256', secret).update(expiresAt).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(expiresAt) > Date.now();
}
function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; } // still spend the time
  return crypto.timingSafeEqual(ba, bb);
}

async function registerAuth(fastify, { accessKey, sessionSecret, insecureDev }) {
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyRateLimit, { global: false });

  fastify.get('/login', async (_req, reply) => {
    reply.type('text/html').send(LOGIN_HTML);
  });
  fastify.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const key = req.body && req.body.key;
    if (typeof key !== 'string' || !constantTimeEqual(key, accessKey)) return reply.code(401).send({ error: 'Invalid key.' });
    const expiresAt = Date.now() + THIRTY_DAYS_MS;
    reply.setCookie(COOKIE, sign(sessionSecret, expiresAt), {
      httpOnly: true, secure: !insecureDev, sameSite: 'lax', path: '/', maxAge: Math.floor(THIRTY_DAYS_MS / 1000),
    });
    return { ok: true };
  });
  fastify.addHook('onRequest', async (req, reply) => {
    if (isPublic(req.raw.url)) return;
    const cookie = req.cookies[COOKIE];
    if (!verify(sessionSecret, cookie)) return reply.code(401).send({ error: 'Sign in required.' });
  });
}

const LOGIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title>
<style>body{font:14px system-ui;background:#0f1116;color:#e7e9f2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
form{background:#171922;border:1px solid #2a2e3d;border-radius:10px;padding:28px;min-width:280px}
input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;margin-top:10px}
button{width:100%;margin-top:14px;padding:9px;border-radius:6px;border:none;background:#7c5cff;color:#fff;cursor:pointer}
p.err{color:#e0607a;min-height:18px}</style></head><body>
<form id="f"><h1 style="margin:0 0 4px;font-size:16px">spectoflow</h1><p style="margin:0 0 6px;color:#8b93a6">Enter the access key.</p>
<input id="key" type="password" autocomplete="current-password" autofocus /><p class="err" id="err"></p><button type="submit">Sign in</button></form>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:document.getElementById('key').value})});
if(r.ok) location.href='/'; else document.getElementById('err').textContent='Incorrect key.';});</script></body></html>`;

module.exports = { registerAuth, COOKIE, isPublic };
