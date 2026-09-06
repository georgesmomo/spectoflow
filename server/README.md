# spectoflow server

The relay for spectoflow's online dashboard (sub-project C1 — see
`../docs/online-dashboard-connector-design.md`). A separate application from the `spectoflow` npm
package: it has real dependencies (Fastify, Knex, a database driver), lives in this repo for a shared
front-end and protocol, and is deployed on its own.

## Requirements

- Node ≥ 22
- A database: SQLite (bundled, fine for a single-owner deployment), MySQL (the default target), or
  PostgreSQL.

## Quick start (SQLite, local)

```bash
cd server
npm install
DATABASE_URL=sqlite:./data/spectoflow.db node cli.js migrate
DATABASE_URL=sqlite:./data/spectoflow.db node cli.js token create --name="my laptop"
# copy the printed spf_... token
SPECTOFLOW_ACCESS_KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))") \
DATABASE_URL=sqlite:./data/spectoflow.db PORT=3000 node src/index.js
```

Then, from a spectoflow project on the machine that created the token:

```bash
spectoflow dashboard login --url=http://localhost:3000 --token=spf_... --name="my laptop"
spectoflow dashboard publish
```

Open `http://localhost:3000/` and sign in with `SPECTOFLOW_ACCESS_KEY`'s value.

For a quick local check without an access key at all: `node src/index.js --insecure-dev` (binds
127.0.0.1 only — never use this on a reachable host).

## MySQL (the default deployment target)

```bash
DATABASE_URL=mysql://spectoflow:password@localhost/spectoflow node cli.js migrate
```

## PostgreSQL

```bash
DATABASE_URL=postgres://spectoflow:password@localhost/spectoflow node cli.js migrate
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `mysql://spectoflow:spectoflow@localhost/spectoflow` | `mysql://…`, `postgres://…`, or `sqlite:<path>`/`sqlite::memory:` |
| `SPECTOFLOW_ACCESS_KEY` | *(required)* | 16+ characters; the shared key that unlocks the web UI |
| `SESSION_SECRET` | auto-generated to `data/session-secret` | HMAC key signing the session cookie; rotating it logs everyone out |
| `PORT` | `3000` | HTTP port |
| `TRUST_PROXY` | unset | set `1` behind a TLS-terminating reverse proxy |

## Reverse proxy (Caddy example, for TLS)

```
dashboard.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains and renews the certificate automatically; the server itself always speaks plain HTTP.

## Token management

```bash
node cli.js token create --name="a machine"   # prints the token once
node cli.js token list
node cli.js token revoke <machine-id>
```

## What this does not do yet

Accounts, per-user sessions, member rights and project groups are sub-projects C2/C3. A Docker image
and a full cPanel/o2switch (Passenger) runbook are C4 — for now, "Setup Node.js App" pointing at
`server/src/index.js` with the environment variables above, and a VPS running `node src/index.js`
under a process manager (pm2, systemd) both work.
