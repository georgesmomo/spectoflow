'use strict';
/*
 * C2 access control: real accounts, real per-device sessions. A session token (same shape as a
 * machine token — `spf_` + 32 random bytes) is looked up by its SHA-256 hash (server/src/db.js's
 * `sessions` model, Task 4) — there is nothing to sign and no shared secret, unlike C1's now-removed
 * single-access-key HMAC cookie. `req.user = {id, email}` is decorated onto every authenticated
 * request for downstream routes/hooks to read.
 */
const fastifyCookie = require('@fastify/cookie');
const fastifyRateLimit = require('@fastify/rate-limit');

const COOKIE = 'spf_session';
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;
const PUBLIC_EXACT = ['/healthz', '/login', '/signup'];
const PUBLIC_PREFIXES = ['/connector/', '/login-assets/'];
const isPublic = (url) => PUBLIC_EXACT.includes(url) || PUBLIC_PREFIXES.some((p) => url.startsWith(p));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function registerAuth(fastify, { db, insecureDev }) {
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyRateLimit, { global: false });

  function setSessionCookie(reply, token) {
    reply.setCookie(COOKIE, token, { httpOnly: true, secure: !insecureDev, sameSite: 'lax', path: '/', maxAge: THIRTY_DAYS_S });
  }
  function clientMeta(req) { return { userAgent: (req.headers['user-agent'] || '').slice(0, 300), ip: req.ip }; }

  fastify.get('/signup', async (_req, reply) => reply.type('text/html').send(SIGNUP_HTML));
  fastify.post('/signup', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const email = req.body && req.body.email;
    const password = req.body && req.body.password;
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) return reply.code(400).send({ error: 'A valid email is required.' });
    if (typeof password !== 'string' || password.length < 12) return reply.code(400).send({ error: 'Password must be at least 12 characters.' });
    if (await db.findUserByEmail(email)) return reply.code(409).send({ error: 'An account with that email already exists.' });
    const user = await db.createUser(email, password);
    const session = await db.createSession(user.id, clientMeta(req));
    setSessionCookie(reply, session.token);
    return { ok: true, userId: user.id };
  });

  fastify.get('/login', async (_req, reply) => reply.type('text/html').send(LOGIN_HTML));
  fastify.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const email = req.body && req.body.email;
    const password = req.body && req.body.password;
    const user = typeof email === 'string' ? await db.findUserByEmail(email) : null;
    if (!user || typeof password !== 'string' || !(await db.verifyPassword(user, password))) {
      return reply.code(401).send({ error: 'Incorrect email or password.' });
    }
    await db.touchLastLogin(user.id);
    const session = await db.createSession(user.id, clientMeta(req));
    setSessionCookie(reply, session.token);
    return { ok: true };
  });

  fastify.post('/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    const session = token && await db.findSessionByToken(token);
    if (session) await db.revokeSession(session.id);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  fastify.addHook('onRequest', async (req, reply) => {
    if (isPublic(req.raw.url)) return;
    const token = req.cookies[COOKIE];
    const session = token && await db.findSessionByToken(token);
    if (!session) return reply.code(401).send({ error: 'Sign in required.' });
    await db.touchSession(session.id);
    req.user = { id: session.userId };
  });
}

const FORM_STYLE = `body{font:14px system-ui;background:#0f1116;color:#e7e9f2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
form{background:#171922;border:1px solid #2a2e3d;border-radius:10px;padding:28px;min-width:280px}
input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;margin-top:10px}
button{width:100%;margin-top:14px;padding:9px;border-radius:6px;border:none;background:#7c5cff;color:#fff;cursor:pointer}
p.err{color:#e0607a;min-height:18px} a{color:#7c5cff}`;

const LOGIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title><style>${FORM_STYLE}</style></head><body>
<form id="f"><h1 style="margin:0 0 4px;font-size:16px">spectoflow</h1><p style="margin:0 0 6px;color:#8b93a6">Sign in.</p>
<input id="email" type="email" placeholder="Email" autocomplete="email" autofocus />
<input id="password" type="password" placeholder="Password" autocomplete="current-password" />
<p class="err" id="err"></p><button type="submit">Sign in</button>
<p style="margin:14px 0 0;font-size:12.5px"><a href="/signup">Create an account</a></p></form>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});
if(r.ok) location.href='/'; else document.getElementById('err').textContent=(await r.json()).error||'Sign-in failed.';});</script></body></html>`;

const SIGNUP_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title><style>${FORM_STYLE}</style></head><body>
<form id="f"><h1 style="margin:0 0 4px;font-size:16px">spectoflow</h1><p style="margin:0 0 6px;color:#8b93a6">Create your account.</p>
<input id="email" type="email" placeholder="Email" autocomplete="email" autofocus />
<input id="password" type="password" placeholder="Password (12+ characters)" autocomplete="new-password" />
<p class="err" id="err"></p><button type="submit">Create account</button>
<p style="margin:14px 0 0;font-size:12.5px"><a href="/login">Already have an account?</a></p></form>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
const r=await fetch('/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});
if(r.ok) location.href='/'; else document.getElementById('err').textContent=(await r.json()).error||'Could not create the account.';});</script></body></html>`;

module.exports = { registerAuth, COOKIE, isPublic };
