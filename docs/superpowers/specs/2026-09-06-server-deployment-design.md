# server/ Deployment — Docker + VPS/cPanel Guides (Sub-Project C4)

## Context

Sub-project C4 of the "one dashboard, many projects" program (see `docs/DECISIONS.md` D65, D67, D68).
C1 shipped `server/` — a real Fastify+Knex relay/accounts application, supporting SQLite, MySQL, and
PostgreSQL, behind `TRUST_PROXY`/`BASE_URL` env vars specifically because two hosting scenarios were
promised from the start: a VPS running Docker, and cPanel/o2switch's "Setup Node.js App" feature
(which cannot run Docker at all — this is why C1 already built an HTTP long-poll fallback alongside
the native WebSocket connector, for hosts that don't pass WebSockets through). C4 is the packaging step
that makes both of those actually usable by someone who isn't the person who built the app.

`server/` today (after C2+C3, v0.3.0) is fully feature-complete for both scenarios — real accounts,
sessions, RBAC, sharing, all served over plain HTTP with no assumption about how TLS/reverse-proxying
is done. Nothing in this sub-project touches `server/`'s application code; it only adds deployment
artifacts and documentation around the existing, unchanged app.

## Goals

1. A `server/Dockerfile` building a small, correct production image of the existing app.
2. A `docker-compose.yml` orchestrating the app, a MySQL database, and a Caddy reverse proxy with
   automatic HTTPS (Let's Encrypt) — a `docker compose up -d` away from a running, TLS-terminated
   instance on a fresh VPS.
3. Migrations run automatically on container start (idempotent — already-applied migrations are
   skipped, matching every existing invocation of `node cli.js migrate` in this codebase).
4. A step-by-step VPS deployment guide assuming only Docker + Docker Compose are installed.
5. A step-by-step cPanel/o2switch deployment guide for hosts where Docker isn't available at all,
   using cPanel's native "Setup Node.js App" feature.

## Non-Goals

- No changes to `server/`'s application code, routes, models, or tests — this sub-project is packaging
  and documentation only.
- No backup/restore tooling for the MySQL volume — out of scope, a real operational concern for a
  later sub-project if ever needed.
- No bundled SMTP server — `server/`'s existing `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/
  `SMTP_FROM` env vars (already built, C2) are documented as "bring your own transactional email
  provider" (e.g. a real provider's SMTP credentials) — running a mail server (e.g. Postfix) in a
  container has real deliverability problems (SPF/DKIM/reverse-DNS, IP reputation) that are outside
  this sub-project's scope to solve.
- No CI/CD pipeline (e.g. auto-deploy on push) — purely a manual `docker compose up -d --build`
  workflow for this sub-project; automating it is a separate, later concern if wanted.
- No multi-instance/load-balanced deployment — single `server` container, matching the app's current
  design (in-memory `registry` of connected machines lives in one process; scaling to multiple
  instances would need a shared registry, out of scope here).

## Docker Image

`server/Dockerfile` — multi-stage build:

- **Build stage**: `node:22-slim` base (matching the repo's own documented Node ≥ 22 floor), `npm ci`
  (not `npm install`, for reproducible builds from the committed lockfile), copies only
  `server/package.json`/`server/package-lock.json` first (for Docker layer caching — dependencies
  only reinstall when the lockfile changes, not on every source edit) then the rest of `server/`.
- **Final stage**: `node:22-slim` again, copies only `node_modules` + application source from the
  build stage (no dev dependencies — `server/package.json` has none currently, but the multi-stage
  shape is future-proof against that changing), a non-root user (`node`, already provided by the
  official image) runs the app.
- `ENTRYPOINT` is a small shell script, `server/docker-entrypoint.sh`:
  ```sh
  #!/bin/sh
  set -e
  node cli.js migrate
  exec node src/index.js
  ```
  `set -e` means a migration failure aborts the container start (rather than silently starting the
  app against a stale/broken schema) — the correct failure mode; `node cli.js migrate` is already
  idempotent (Knex tracks applied migrations in its own table), so re-running it on every container
  restart is always safe, matching how every existing test file in this codebase already calls
  `db.migrate()` unconditionally.
- `EXPOSE 3000` (the app's own default `PORT`, matching `server/README.md`'s existing documented
  default).
- A `HEALTHCHECK` instruction hitting `GET /healthz` (already built, C1) — `curl -f http://localhost:3000/healthz || exit 1`
  on a 30s interval; this requires `curl` in the final image (a small addition to the base image, not
  a new runtime dependency of the app itself — purely a container-level operational concern).

## docker-compose.yml

Three services, one named volume, one bind-mounted `Caddyfile`:

```yaml
services:
  server:
    build: ./server
    restart: unless-stopped
    env_file: ./server/.env
    depends_on:
      mysql:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
  mysql:
    image: mysql:8
    restart: unless-stopped
    env_file: ./server/.env   # MYSQL_PASSWORD read from the same file DATABASE_URL's password lives in
    environment:
      MYSQL_DATABASE: spectoflow
      MYSQL_USER: spectoflow
      MYSQL_RANDOM_ROOT_PASSWORD: "yes"
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
    depends_on:
      - server

volumes:
  mysql-data:
  caddy-data:
```

`Caddyfile` (one file, at the repo root alongside `docker-compose.yml`):
```
{$DOMAIN} {
  reverse_proxy server:3000
}
```
`caddy`'s service definition also gets `env_file: ./server/.env`, so `$DOMAIN` resolves from the same
single file every other value in this stack comes from — one file to fill in, not several.

**`DOMAIN` and `BASE_URL` are two separate, explicitly-set values that must be kept in sync by the
operator, deliberately not derived from each other.** `BASE_URL` is read by the application itself
(`server/src/index.js`, already built in C2) and must never be inferred from a request/proxy header —
that was a real account-takeover vector this codebase already found and fixed once (D67/D68's
whole-branch review). `DOMAIN` is consumed only by Caddy, purely for obtaining the TLS certificate.
Deriving one from the other automatically (e.g. templating `BASE_URL` from `DOMAIN` inside the compose
file) would reintroduce exactly the kind of implicit, magic derivation this codebase's own hard-won
lesson argues against — two explicit values in one file, with a comment in `.env.example` telling the
operator they must match, is the correct trade-off: slightly more to fill in, zero magic.

`server/.env.example` (new, committed to the repo as a template — the real `.env` is gitignored,
matching how every other secret file in this repo is handled):
```
# --- Must match: DOMAIN is what Caddy requests a TLS cert for; BASE_URL is what the app embeds in
# every link it emails out. Point both at the same hostname or logins/invites will build broken links.
DOMAIN=CHANGE_ME.example.com
BASE_URL=https://CHANGE_ME.example.com

# MYSQL_PASSWORD sets the `spectoflow` database user's password (read by the mysql service); the
# same password must appear in DATABASE_URL's connection string below — set MYSQL_PASSWORD first,
# then copy it into DATABASE_URL.
MYSQL_PASSWORD=CHANGE_ME
DATABASE_URL=mysql://spectoflow:CHANGE_ME@mysql:3306/spectoflow

TRUST_PROXY=1
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=spectoflow <noreply@CHANGE_ME.example.com>
```

## VPS Deployment Guide (`server/docs/deploy-vps.md`)

Plain numbered steps, assuming a fresh Ubuntu/Debian VPS with a domain's DNS `A` record already
pointed at it:

1. Install Docker + Docker Compose plugin (link to Docker's own official install script — this guide
   doesn't reinvent Docker installation instructions).
2. `git clone` this repo. **Decision**: a full clone, not a partial copy — `docker-compose.yml` lives
   at the repo root and its `server` service build context is the relative path `./server`, so the
   compose file and `server/` must sit in the same directory tree relative to each other; a full clone
   is the one instruction that always gets this right, and the repo is public so there's no reason to
   avoid it.
3. `cp server/.env.example server/.env` and fill in the real values (a real password, the real
   domain, real SMTP credentials — `MYSQL_PASSWORD`/`DATABASE_URL` must match, `DOMAIN`/`BASE_URL`
   must match, per `.env.example`'s own comments above).
4. `docker compose up -d --build`.
5. Watch `docker compose logs -f server` until the app reports it's listening; confirm
   `https://<domain>/healthz` responds (proves Caddy's TLS handshake and the app's own healthcheck
   both work).
6. Open `https://<domain>/signup`, create the first account (becomes Platform Admin automatically).
7. Create a machine token from a different terminal on the machine you actually want to publish
   projects from: `spectoflow dashboard login --url=https://<domain> --token=<created via the new
   Account page, /account, once signed in>` — no `docker compose exec` needed for this step, since
   Task 16 already put machine-token creation in the web UI; the CLI (`docker compose exec server
   node cli.js token create ...`) is documented as a fallback, matching this codebase's own established
   "CLI stays a fallback" decision (D67).
8. Updating later: `git pull && docker compose up -d --build` — migrations re-run automatically and
   safely on the new container's start.

## cPanel/o2switch Deployment Guide (`server/docs/deploy-cpanel.md`)

No Docker. Uses cPanel's native "Setup Node.js App" feature (requires Node ≥ 22 to be offered by the
host — not all cPanel hosts have this yet; the guide states this prerequisite explicitly up front
rather than letting someone discover it partway through).

1. In cPanel: MySQL Databases → create a database + user, note the connection details (cPanel-hosted
   MySQL is usually only reachable as `localhost` from the same account, which is exactly the
   deployment topology this guide assumes).
2. Setup Node.js App → create an application pointed at `server/` inside the uploaded/cloned repo,
   application startup file `src/index.js`, Node version ≥ 22.
3. Set environment variables through cPanel's own UI for the app (`DATABASE_URL` pointed at the
   MySQL database from step 1, `BASE_URL` set to the real domain/subdomain cPanel assigned the app,
   `TRUST_PROXY=1` since cPanel's own reverse proxy sits in front, `SMTP_*` for real outbound email).
4. Run `npm install` via cPanel's own "Run NPM Install" button for the app (equivalent to the Docker
   build stage, done through cPanel's UI instead).
5. Run migrations once via cPanel's Terminal feature (or SSH, if the host provides it): `cd
   <app-path> && node cli.js migrate`.
6. Restart the app via cPanel's UI; visit `https://<assigned-domain>/healthz` to confirm it's up.
7. Same first-signup/token-creation steps as the VPS guide from here on (7-8 above), since the
   application itself behaves identically regardless of hosting — the only genuinely different parts
   are steps 1-6 (getting Node running at all).

## Testing

Given this sub-project has no application code, "testing" here means real, live verification rather
than `node --test`:

- Build the Docker image locally (`docker build -t spectoflow-server-test ./server`) and confirm it
  succeeds.
- Run the full `docker compose up -d` stack locally (with `DOMAIN=localhost` — Caddy will fail to get
  a real Let's Encrypt cert for `localhost`, so the guide's own real-VPS testing can't be fully
  reproduced locally; the local test instead verifies the `server`+`mysql` services alone, bypassing
  Caddy, by hitting the `server` container's exposed port directly) and confirm:
  - The `mysql` container becomes healthy, then `server` starts (via `depends_on`'s `condition:
    service_healthy`).
  - Migrations run automatically (check the container's logs for the same `✓ migrations applied`
    output `node cli.js migrate` already prints today).
  - `GET /healthz` responds 200 through the app's own exposed port.
  - A real signup + login round-trip against the MySQL-backed instance succeeds (proving `DATABASE_URL`
    for MySQL — already supported by `server/src/db.js`'s existing Knex configuration — genuinely
    works end-to-end, not just SQLite, which is the only driver this codebase's own test suite
    currently ever exercises).
- The cPanel guide cannot be live-tested (no cPanel/o2switch account available in this environment) —
  it is written from the CLI's/app's own actual documented behavior (`server/README.md`, `server/cli.js`
  --help output, the app's own env-var handling in `server/src/index.js`) rather than guessed, and
  flagged in the guide's own header as "written from the app's documented behavior; if a step doesn't
  match what your cPanel host actually shows you, the discrepancy is almost certainly in cPanel's UI
  wording, not in what the app itself needs."

## Decisions Made During Self-Review

Three real inconsistencies were found and fixed while re-reading this spec before sending it for
review, rather than left as open questions:

1. **Dropped Docker secrets for the MySQL password.** An early draft used `MYSQL_PASSWORD_FILE`
   (Docker secrets) for the database container's password while every other credential in this stack
   (including that same password, embedded in `DATABASE_URL`) sits in plain text in `server/.env`.
   Protecting one value with secrets machinery while its duplicate sits unprotected next to it is
   inconsistent and adds real complexity (a separate secrets file, swarm-adjacent tooling) for zero
   actual gain at this deployment's scale (a single self-hosted instance). Resolved: one plain
   `MYSQL_PASSWORD` value in `.env`, matching everything else.
2. **`DOMAIN` (Caddy's TLS cert target) and `BASE_URL` (the app's own emailed-link origin) are two
   separate, explicitly-set values, not derived from one another** — resolved by adding an explicit
   comment in `.env.example` telling the operator they must be kept in sync by hand, rather than
   templating one from the other (which would reintroduce the exact class of implicit-derivation bug
   this codebase's own D67/D68 whole-branch review already found and fixed once for `BASE_URL`
   specifically).
3. **Firmed up "full `git clone`" as the VPS guide's actual instruction**, rather than leaving a choice
   between cloning the whole repo and copying just `server/` — the compose file's build context is a
   relative path to `server/`, so the two must stay siblings on disk; a full clone is the single
   instruction that always satisfies that, and the repo being public removes any reason to prefer a
   partial copy.
