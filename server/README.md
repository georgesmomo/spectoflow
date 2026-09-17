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
BASE_URL=http://localhost:3000 DATABASE_URL=sqlite:./data/spectoflow.db PORT=3000 node src/index.js
```

Real accounts, not a shared key: open `http://localhost:3000/signup` (or `POST /signup`) and create
the first account — it automatically becomes Platform Admin. Sign in at `/login`.

Then create a machine token for the computer running your spectoflow project, either from the
**Account page** (`/account`, once signed in — "Create token" under Machine tokens) or from the
command line (requires the account to already exist — created via `/signup` first):

```bash
DATABASE_URL=sqlite:./data/spectoflow.db node cli.js token create --name="my laptop" --owner-email="you@example.com"
# copy the printed spf_... token
```

Then, from a spectoflow project on that same machine:

```bash
spectoflow dashboard login --url=http://localhost:3000 --token=spf_... --name="my laptop"
spectoflow dashboard publish
```

For a quick local check with no real domain and no email sending at all: `node src/index.js
--insecure-dev` (binds 127.0.0.1 only, `BASE_URL` defaults to `http://127.0.0.1:<PORT>`, emails are
logged to the console instead of sent — never use this on a reachable host).

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
| `BASE_URL` | *(required unless `--insecure-dev`)* | The public origin this server is reached at (e.g. `https://dashboard.example.com`, no trailing slash) — used to build every link this server emails out (email verification, password reset, project invitations). Never derived from a request's `Host` header, which an attacker controls. |
| `PORT` | `3000` | HTTP port |
| `TRUST_PROXY` | unset | set `1` behind a TLS-terminating reverse proxy |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | unset | outbound mail (verification/reset/invitation emails); with `--insecure-dev` and no `SMTP_HOST`, emails are logged to the console instead of sent |

There is no `SPECTOFLOW_ACCESS_KEY` or `SESSION_SECRET` — those belonged to C1's original
single-shared-key auth, since replaced entirely by real per-user accounts and per-device sessions
(C2). A session is just a random token looked up by its hash in the database; nothing is signed and
there is no shared secret to rotate or lose.

## Reverse proxy (Caddy example, for TLS)

```
dashboard.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains and renews the certificate automatically; the server itself always speaks plain HTTP.
Set `BASE_URL=https://dashboard.example.com` and `TRUST_PROXY=1` alongside it.

## Accounts and machine tokens

Accounts are real: create one at `/signup` (or `POST /signup`), sign in at `/login`. The very first
account ever created on a fresh database automatically becomes Platform Admin (`/admin` — signup
mode, every account, promote/demote). Signup mode (`open` / `invite_only` / `disabled`) is managed
there too.

Every machine (a computer running `spectoflow dashboard`) needs its own token, tied to the account
that owns it — created either from the account owner's own **Account page** (`/account`) or from the
command line, which requires that account to already exist:

```bash
node cli.js token create --name="a machine" --owner-email="you@example.com"   # prints the token once
node cli.js token list
node cli.js token revoke <machine-id>
```

Project sharing (inviting other accounts onto a project, with roles/permissions) is done from the
dashboard itself once a project is published, or via `/api/projects/:id/invite`; see
`../docs/online-dashboard-accounts-design.md`.

**Give write access only to people you trust.** A member who can write to a project can launch agents on the
owner's machine. What they can't do: edit the files that make tools run commands on their own (`config.json`,
hooks, MCP and editor configs — refused online), allow a custom agent command (local only), or touch the owner's
second brain.

## Deployment

Two guides, depending on what your host gives you:

- **[`docs/deploy-vps.md`](docs/deploy-vps.md)** — Docker + Caddy on a VPS, with automatic HTTPS via
  Let's Encrypt. The recommended path when you control the whole machine.
- **[`docs/deploy-cpanel.md`](docs/deploy-cpanel.md)** — no Docker, for shared hosts like cPanel/
  o2switch that offer a native Node.js App feature instead of container access.

Cross-account project sharing and roles landed in C2 (see
`../docs/online-dashboard-accounts-design.md`).
