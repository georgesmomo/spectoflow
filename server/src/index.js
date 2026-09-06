'use strict';
/*
 * Boot: migrate the database, listen. `--insecure-dev` (or INSECURE_DEV=1) binds 127.0.0.1 only
 * and skips marking the session cookie Secure — for local development against SQLite, never for
 * anything reachable from outside this machine.
 */
const { createDb } = require('./db');
const { buildApp } = require('./app');
const { createEmailer } = require('./email');

async function main() {
  const insecureDev = process.argv.includes('--insecure-dev') || process.env.INSECURE_DEV === '1';
  if (insecureDev) console.error('! --insecure-dev: the session cookie is not marked Secure, binding 127.0.0.1 only. Never use this on a reachable host.');

  const port = Number(process.env.PORT) || 3000;
  // BASE_URL is the only source of truth for links this server ever emails out (verification,
  // password reset, project invitations) — never derived from a request's Host header, which an
  // attacker fully controls (see server/src/auth.js and server/src/routes/sharing.js). Under
  // --insecure-dev with no BASE_URL set, fall back to the loopback address this process itself
  // binds to, for local development only.
  const rawBaseUrl = process.env.BASE_URL;
  const baseUrl = rawBaseUrl ? rawBaseUrl.replace(/\/+$/, '') : (insecureDev ? `http://127.0.0.1:${port}` : null);
  if (!baseUrl) {
    console.error('BASE_URL must be set (e.g. https://dashboard.example.com) — or pass --insecure-dev for local development only.');
    process.exit(1);
  }

  const db = await createDb(process.env.DATABASE_URL);
  await db.migrate();
  const emailer = createEmailer({
    smtpHost: process.env.SMTP_HOST, smtpPort: process.env.SMTP_PORT,
    smtpUser: process.env.SMTP_USER, smtpPass: process.env.SMTP_PASS,
    smtpFrom: process.env.SMTP_FROM, insecureDev,
  });
  const app = await buildApp({ db, insecureDev, trustProxy: process.env.TRUST_PROXY === '1', emailer, baseUrl });
  const host = insecureDev ? '127.0.0.1' : '0.0.0.0';
  await app.listen({ port, host });
  console.log(`spectoflow server → http://${host}:${port}${insecureDev ? ' (insecure-dev)' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
