'use strict';
/*
 * Boot: validate configuration, migrate the database, listen. `--insecure-dev` (or
 * INSECURE_DEV=1) skips the access-key requirement and binds 127.0.0.1 only — for local
 * development against SQLite, never for anything reachable from outside this machine.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createDb } = require('./db');
const { buildApp } = require('./app');

async function main() {
  const insecureDev = process.argv.includes('--insecure-dev') || process.env.INSECURE_DEV === '1';
  const accessKey = process.env.SPECTOFLOW_ACCESS_KEY || '';
  if (!insecureDev && accessKey.length < 16) {
    console.error('SPECTOFLOW_ACCESS_KEY must be set (16+ characters) — or pass --insecure-dev for local development only (binds 127.0.0.1, no key required).');
    process.exit(1);
  }
  if (insecureDev) console.error('! --insecure-dev: no access key required, binding 127.0.0.1 only. Never use this on a reachable host.');

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  let sessionSecret = process.env.SESSION_SECRET;
  const secretFile = path.join(dataDir, 'session-secret');
  if (!sessionSecret) {
    sessionSecret = fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : crypto.randomBytes(32).toString('base64url');
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, sessionSecret, { mode: 0o600 });
  }

  const db = await createDb(process.env.DATABASE_URL);
  await db.migrate();
  const app = await buildApp({ db, accessKey: insecureDev ? 'x'.repeat(20) : accessKey, sessionSecret, insecureDev, trustProxy: process.env.TRUST_PROXY === '1' });
  const port = Number(process.env.PORT) || 3000;
  const host = insecureDev ? '127.0.0.1' : '0.0.0.0';
  await app.listen({ port, host });
  console.log(`spectoflow server → http://${host}:${port}${insecureDev ? ' (insecure-dev)' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
