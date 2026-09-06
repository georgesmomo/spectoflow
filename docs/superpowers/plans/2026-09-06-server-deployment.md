# server/ Deployment (Sub-Project C4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the already-complete, unmodified `server/` app for the two hosting scenarios
promised since C1 — a Docker-based VPS deployment with automatic HTTPS, and a Docker-less
cPanel/o2switch deployment using its native "Setup Node.js App" feature — with real, live-verified
artifacts and step-by-step guides.

**Architecture:** Zero changes to `server/`'s application code. Five new files (Dockerfile,
docker-entrypoint.sh, docker-compose.yml, Caddyfile, server/.env.example) plus two new markdown guides
(server/docs/deploy-vps.md, server/docs/deploy-cpanel.md). Migrations run automatically and safely on
every container start (`node cli.js migrate` is already idempotent). "Testing" here is real,
live verification (build the image, run the real compose stack, hit real endpoints) rather than
`node --test`, since there is no application code to unit-test.

**Tech Stack:** Docker, Docker Compose, Caddy 2 (automatic HTTPS), MySQL 8 (the existing app's own
documented default deployment target).

**Spec:** `docs/superpowers/specs/2026-09-06-server-deployment-design.md` (binding authority — exact
Dockerfile stages, exact compose services/env vars, exact `.env.example` contents including the
`MYSQL_PASSWORD`/`DATABASE_URL` and `DOMAIN`/`BASE_URL` must-match pairs, exact guide steps).

## Global Constraints

- **No changes to any file under `server/src/`, `server/migrations/`, `server/test/`, or
  `server/cli.js`** — this entire plan is additive packaging/documentation only.
- **Node ≥ 22** in every Docker stage (matching `server/package.json`'s own `engines.node`).
- **Migrations are idempotent and run automatically on every container start** — never a manual,
  separate step for Docker deployments (already decided in the spec).
- **`DOMAIN` (Caddy's TLS target) and `BASE_URL` (the app's own emailed-link origin) are two
  separate, explicitly-set values in `server/.env`, never derived from one another** — an explanatory
  comment in `.env.example` is required, not optional, per the spec's own self-review decision.
- **No Docker secrets** — `MYSQL_PASSWORD` is a plain value in `server/.env`, matching every other
  credential in that same file (the spec's own self-review decision — avoids protecting one value
  while its duplicate, embedded in `DATABASE_URL`, sits unprotected next to it).
- **`server/` has two native npm dependencies — `argon2` and `better-sqlite3`** (see
  `server/package.json`) — both ship prebuilt binaries for the common `linux/amd64`/`linux/arm64`
  targets via their own npm postinstall scripts, so `npm ci` should not need to compile from source on
  a standard Docker Linux base image; Task 1 explicitly verifies this by building the real image (if a
  build ever fails on a native-compile step, the fix is adding `python3 make g++` to the build stage —
  documented in Task 1 as the fallback, not silently assumed to be unnecessary).
- **The real MySQL-backed round trip in Task 3 is the only place in this entire codebase that ever
  exercises the `mysql2` Knex driver** — every existing automated test in `server/test/` uses
  `sqlite::memory:` exclusively. Task 3's live verification is not a formality; it is the first real
  proof `DATABASE_URL=mysql://...` genuinely works end-to-end.

---

### Task 1: Docker image — Dockerfile + docker-entrypoint.sh

**Files:**
- Create: `server/Dockerfile`
- Create: `server/docker-entrypoint.sh`
- Create: `server/.dockerignore`

**Interfaces:**
- Consumes: `server/package.json`'s existing `engines.node` (`>=22`), `server/cli.js`'s existing
  `migrate` subcommand, `server/src/index.js`'s existing `PORT` env var (default 3000) and its
  existing `GET /healthz` route (built in C1).
- Produces: a buildable Docker image tagged locally as `spectoflow-server` for Task 2/3 to run;
  `docker-entrypoint.sh`'s contract (`migrate then exec the app`) is what Task 2's compose file and
  Task 3's live verification both depend on.

- [ ] **Step 1: Write `server/.dockerignore`**

```
node_modules
data
.env
test
```

(Keeps the build context small and guarantees a stale local `node_modules`, any local `data/` sqlite
cruft, and a real `.env` with secrets in it never accidentally get baked into the image.)

- [ ] **Step 2: Write `server/docker-entrypoint.sh`**

```sh
#!/bin/sh
set -e
node cli.js migrate
exec node src/index.js
```

(`set -e` means a migration failure aborts the container start rather than silently running the app
against a broken schema; `node cli.js migrate` is already idempotent — see `server/cli.js:16`, `if
(cmd === 'migrate') { await db.migrate(); ... }`, which calls Knex's own `migrate.latest()` under the
hood and is safe to run on every restart. `exec` replaces the shell process with the Node process so
the app receives signals like `SIGTERM` directly, rather than the shell swallowing them — needed for
`docker compose stop`/`down` to shut the app down cleanly instead of waiting out a timeout and getting
force-killed.)

- [ ] **Step 3: Write `server/Dockerfile`**

```dockerfile
# ---- deps stage: install dependencies from the committed lockfile only ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- final stage: copy only what's needed to run, nothing from the deps stage's build cache ----
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json cli.js knexfile.js ./
COPY migrations ./migrations
COPY src ./src
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/healthz || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
```

(Two stages: the `deps` stage runs `npm ci` — a clean, reproducible install from the committed
`package-lock.json`, not `npm install` — and is cached by Docker as long as `package.json`/
`package-lock.json` don't change, so editing application source doesn't force a slow reinstall on
every rebuild. The final stage copies only the installed `node_modules` plus the exact application
files the app needs to run — `cli.js` for the entrypoint's migrate step, `knexfile.js` for the DB
connection config, `migrations/` and `src/`  — never `test/` or `README.md`, which the app doesn't
need at runtime. `curl` is installed in the final stage purely so `HEALTHCHECK` can call it; `node:22-
slim` doesn't include it by default. `USER node` runs the app as the official image's built-in
non-root user, not root. The official Node image's `WORKDIR /app` combined with `node` user requires
no extra `chown` here since `COPY` in a fresh `WORKDIR` is owned by root by default and readable by
`node` — if Step 5 below hits a permission error reading a copied file, add
`RUN chown -R node:node /app` right before `USER node` as the fix, don't skip past a real permission
error silently.)

- [ ] **Step 4: Build the image**

Run: `cd server && docker build -t spectoflow-server .`
Expected: build succeeds, ending in `naming to docker.io/library/spectoflow-server`. If it fails during
`RUN npm ci` with a compilation error mentioning `argon2` or `better-sqlite3` (a native-module
build failure — should not happen on a standard `linux/amd64` Docker host, since both packages ship
prebuilt binaries for that platform, but confirm rather than assume), add
`RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*`
as a new line at the top of the `deps` stage (before `RUN npm ci`), then rebuild.

- [ ] **Step 5: Run the image standalone to confirm the entrypoint's migrate-then-start sequence works**

Run: `docker run --rm -e DATABASE_URL="sqlite:/tmp/smoke.db" -e INSECURE_DEV=1 -p 3901:3000 spectoflow-server`
(SQLite here is just for this one standalone smoke check of the entrypoint script itself — Task 3 is
the real MySQL verification against the full compose stack.)
Expected: console output shows migration success (no visible line is printed by `cli.js migrate` for
success beyond what's already in `server/cli.js:16` — confirm no error is thrown instead) followed by
`spectoflow server → http://127.0.0.1:3000 (insecure-dev)` (note: `INSECURE_DEV=1` makes the app bind
to `127.0.0.1` — inside a container, this is fine since Docker's own `-p 3901:3000` port mapping still
reaches it, because `127.0.0.1` inside the container is the container's own loopback, and the process
listening on it is reachable via the container's actual network namespace, which the port mapping
targets directly). Then, from another terminal: `curl http://localhost:3901/healthz` → `{"ok":true}`.
Stop the container with Ctrl+C once confirmed.

- [ ] **Step 6: Commit**

```bash
cd server && git add Dockerfile docker-entrypoint.sh .dockerignore
git commit -m "feat(server): Docker image — multi-stage build, migrate-then-start entrypoint, healthcheck"
```

---

### Task 2: docker-compose.yml + Caddyfile + server/.env.example

**Files:**
- Create: `docker-compose.yml` (repo root)
- Create: `Caddyfile` (repo root)
- Create: `server/.env.example`
- Modify: `server/.gitignore` (add `.env` — the real file must never be committed)

**Interfaces:**
- Consumes: Task 1's built image (via `build: ./server` in the compose file — Compose builds it
  itself, no manual `docker build` needed once this task lands), `server/src/index.js`'s existing env
  vars (`PORT`, `BASE_URL`, `DATABASE_URL`, `TRUST_PROXY`, `SMTP_*`), `server/src/app.js`'s existing
  `GET /healthz` route.
- Produces: the full 3-service stack (`server`, `mysql`, `caddy`) Task 3's live verification runs
  against; `server/.env.example`'s exact variable names, which the VPS guide (Task 4) tells the
  operator to copy and fill in.

- [ ] **Step 1: Add `.env` to `server/.gitignore`**

Find:
```
node_modules/
data/
```
Replace with:
```
node_modules/
data/
.env
```

- [ ] **Step 2: Write `server/.env.example`**

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

# Outbound mail — a real transactional email provider's SMTP credentials (verification, password
# reset, and invitation emails all go through this). Leave blank only for a throwaway test instance;
# with none of these set and TRUST_PROXY=1 (i.e. not --insecure-dev), the app will error on first send
# rather than silently drop the email — see server/src/email.js.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=spectoflow <noreply@CHANGE_ME.example.com>
```

- [ ] **Step 3: Write `Caddyfile`** (repo root)

```
{$DOMAIN} {
	reverse_proxy server:3000
}
```

- [ ] **Step 4: Write `docker-compose.yml`** (repo root)

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
    env_file: ./server/.env
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
    env_file: ./server/.env
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

(`server`'s `depends_on: mysql: condition: service_healthy` means Compose won't even start the
`server` container until MySQL's own healthcheck passes — avoiding a race where the app's entrypoint
tries to migrate against a database that isn't accepting connections yet. `mysql`'s
`MYSQL_PASSWORD` is read automatically by the official `mysql:8` image from the environment — note
this is NOT listed under this service's own `environment:` block, only reached via `env_file:
./server/.env`, exactly as `.env.example`'s own comment describes: one password, one file, read by
two different services.)

- [ ] **Step 5: Create a real local `.env` for verification** (not committed — this is scratch setup
  for Task 3, not part of this task's own deliverable)

```bash
cp server/.env.example server/.env
```
Edit the copied `server/.env`: set `DOMAIN=localhost`, `BASE_URL=http://localhost:3000` (Caddy can't
get a real Let's Encrypt cert for `localhost` — Task 3's own verification bypasses Caddy and hits the
`server` container directly, exactly as the spec's Testing section describes), set `MYSQL_PASSWORD` to
any real value (e.g. `local-test-password-123`) and copy the identical value into `DATABASE_URL`
(`mysql://spectoflow:local-test-password-123@mysql:3306/spectoflow`). Leave `SMTP_*` blank (harmless
for this local test — no real invite/verification emails are sent in Task 3's verification steps).

- [ ] **Step 6: Confirm the compose file itself is syntactically valid before Task 3 runs it for real**

Run: `docker compose config`
Expected: prints the fully-resolved compose configuration with no error (this only validates YAML/
variable-substitution syntax — it does NOT build or start anything yet, that's Task 3).

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml Caddyfile server/.env.example server/.gitignore
git commit -m "feat(server): docker-compose stack — server + MySQL + Caddy with automatic HTTPS"
```
(Do NOT `git add server/.env` — it's gitignored per Step 1 and must never be committed; if `git
status` shows it as untracked-but-ignored, that's correct and expected.)

---

### Task 3: Real local verification against MySQL

**Files:**
- None created or modified — this task is pure verification, using the artifacts Tasks 1-2 already
  produced. If verification surfaces a real defect in either Task's files, fix it in the file that has
  the bug and note the fix in this task's own commit (see Step 6).

**Interfaces:**
- Consumes: Task 1's image build, Task 2's `docker-compose.yml`/`server/.env` (the real local file
  created in Task 2 Step 5).
- Produces: nothing new — a passing verification is this task's entire deliverable, the same way a
  green test suite is a deliverable in every other sub-project's tasks.

- [ ] **Step 1: Bring up the real stack**

Run: `docker compose up -d --build`
Expected: all 3 containers start; `docker compose ps` shows `mysql` and `server` as `healthy` within
about a minute (MySQL's own first-boot initialization takes a few seconds; `server`'s healthcheck
won't go green until `mysql`'s does, per Task 2's `depends_on: condition: service_healthy`). `caddy`
shows as running but will likely log TLS errors trying to get a cert for `localhost` — expected and
harmless for this test, since verification bypasses Caddy entirely (see Step 2).

- [ ] **Step 2: Confirm migrations ran automatically**

Run: `docker compose logs server | grep -i migrat`
Expected: no error; the entrypoint's `node cli.js migrate` step ran before the app started (if the
`server` container is healthy per Step 1, this already implicitly succeeded, since a migration
failure would have made the entrypoint exit non-zero via its `set -e`, which would show as the
container repeatedly restarting rather than becoming healthy — confirm no restart-loop occurred:
`docker compose ps` should show `server`'s `STATUS` as `Up ... (healthy)`, not a low, climbing restart
count).

- [ ] **Step 3: Confirm the healthcheck endpoint is reachable directly (bypassing Caddy)**

Compose doesn't publish `server`'s port to the host by default (only `caddy`'s 80/443 are published,
matching the real production topology) — for this local verification only, run `curl` from *inside*
the `server` container itself via `docker compose exec`, which needs no host port mapping and no
container IP lookup:
Run: `docker compose exec server curl -f http://localhost:3000/healthz`
Expected: `{"ok":true}`.

- [ ] **Step 4: Confirm a real signup + login round-trip works against the MySQL-backed instance**

```bash
docker compose exec server node -e "
fetch('http://localhost:3000/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'verify@example.com', password: 'a-real-password-123' }) })
  .then(r => r.json()).then(j => console.log('signup:', JSON.stringify(j)));
"
```
Expected: `signup: {"ok":true,"userId":"..."}` — a real id, proving `db.createUser` genuinely wrote a
row through the `mysql2` Knex driver (never exercised by this codebase's own `node --test` suite,
which only ever uses `sqlite::memory:`). Then:
```bash
docker compose exec server node -e "
fetch('http://localhost:3000/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'verify@example.com', password: 'a-real-password-123' }) })
  .then(r => r.json()).then(j => console.log('login:', JSON.stringify(j)));
"
```
Expected: `login: {"ok":true}` — confirms `db.verifyPassword`'s argon2id round trip works from inside
the actual container image (not just on the host machine that built it — proving the native `argon2`
binary that ended up in the image is the right one for the container's own platform).

- [ ] **Step 5: Confirm data survives a container restart** (proves the named `mysql-data` volume is
  genuinely persistent, not an artifact of the container merely staying up)

Run: `docker compose restart server mysql` then re-run Step 4's login check (same email/password) —
Expected: `login: {"ok":true}` again, proving the user row survived the restart.

- [ ] **Step 6: Tear down**

Run: `docker compose down` (keeps the named volumes; add `-v` only if you intentionally want to
discard the test data — for this verification, plain `down` is correct, so a second run of this task
later doesn't have to recreate everything from scratch). Remove the local scratch `server/.env` file
created in Task 2 Step 5 if you don't intend to keep developing against this local stack:
`rm server/.env` (safe — it's gitignored and was never committed).

- [ ] **Step 7: Commit** (only if Steps 1-5 surfaced and required a fix to a Task 1/2 file — e.g. the
  native-module fallback from Task 1 Step 4, or a compose syntax issue; if verification passed
  cleanly with zero changes, there is nothing to commit for this task, which is expected and fine —
  say so explicitly in your report rather than fabricating a commit)

```bash
git add <whatever file the fix touched>
git commit -m "fix(server): <describe the real issue Task 3's live verification found>"
```

---

### Task 4: VPS deployment guide

**Files:**
- Create: `server/docs/deploy-vps.md`

**Interfaces:**
- Consumes: Task 1's Dockerfile, Task 2's `docker-compose.yml`/`Caddyfile`/`.env.example`, Task 3's
  confirmed-working verification steps (this guide documents the same commands Task 3 already proved
  work, for a real operator rather than this plan's own implementer).
- Produces: nothing further downstream — a guide, not code.

- [ ] **Step 1: Write `server/docs/deploy-vps.md`**

```markdown
# Deploying to a VPS (Docker)

Assumes a fresh Ubuntu or Debian VPS with a domain's DNS `A` record already pointed at its IP address.

## 1. Install Docker

Follow Docker's own official install instructions for your distribution:
https://docs.docker.com/engine/install/ — this includes the Docker Compose plugin (`docker compose`,
no separate install needed on a recent Docker install).

## 2. Clone this repository

```bash
git clone https://github.com/georgesmomo/spectoflow.git
cd spectoflow
```

A full clone, not just the `server/` folder — `docker-compose.yml` (at the repo root) builds the
`server` service from the relative path `./server`, so the compose file and `server/` need to stay
siblings on disk exactly as they are in this repository.

## 3. Configure your environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and fill in every `CHANGE_ME` value:
- `DOMAIN` and `BASE_URL` — your real domain (e.g. `dashboard.example.com` / `https://dashboard.example.com`).
  **These two must point at the same hostname** — the file's own comment explains why.
- `MYSQL_PASSWORD` — a real, random password. Copy the exact same value into `DATABASE_URL`'s
  connection string (replacing the `CHANGE_ME` right after `spectoflow:`).
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` — credentials from a real transactional
  email provider (e.g. Postmark, SES, Mailgun, SendGrid). Every account signup, password reset, and
  project invitation this server ever sends goes through these.

## 4. Start everything

```bash
docker compose up -d --build
```

This builds the application image, starts MySQL (creating its database on first boot), waits for
MySQL to report healthy, then starts the app (which runs its own database migrations automatically
before serving traffic), then starts Caddy, which requests a free TLS certificate from Let's Encrypt
for your domain automatically.

## 5. Confirm it's up

```bash
docker compose logs -f server
```

Watch for `spectoflow server → http://0.0.0.0:3000`, then Ctrl+C out of the logs. Visit
`https://<your-domain>/healthz` in a browser or via `curl` — you should see `{"ok":true}`. This
confirms Caddy's TLS handshake succeeded and the application itself is responding.

## 6. Create the first account

Visit `https://<your-domain>/signup` and create an account — the very first account ever created on
a fresh instance automatically becomes Platform Admin.

## 7. Connect a machine

From the computer you actually want to publish spectoflow projects from (not necessarily the VPS
itself): sign in at `https://<your-domain>/login`, go to `/account`, and use "Create token" under
Machine tokens — this is the same flow documented in the main project README. Then, on that machine:

```bash
spectoflow dashboard login --url=https://<your-domain> --token=<the token just created>
spectoflow dashboard publish   # from inside the project you want to make visible online
```

(The CLI (`docker compose exec server node cli.js token create --name="..." --owner-email="..."`) is
also available as a fallback if you'd rather not use the web UI for this — the account must already
exist via `/signup` first, since machine tokens are always owned by a real account.)

## Updating later

```bash
git pull
docker compose up -d --build
```

Migrations re-run automatically and safely on the new container's start — there is no separate
migration step to remember.

## Troubleshooting

- **Caddy can't get a certificate**: confirm your domain's DNS `A` record actually points at this
  VPS's IP address, and that ports 80 and 443 are open in any firewall/security-group in front of the
  VPS (Let's Encrypt's automatic verification needs port 80 reachable from the public internet, even
  though the final site is served over 443).
- **`server` container keeps restarting**: `docker compose logs server` — a `BASE_URL must be set`
  error means `server/.env` wasn't filled in before `docker compose up`; a migration error means
  `DATABASE_URL`'s password doesn't match `MYSQL_PASSWORD` (both must be identical, see step 3 above).
```

- [ ] **Step 2: Read the guide back once, straight through, as if you'd never seen this project before**

Confirm every command in it is copy-pasteable exactly as written (no unresolved placeholders left in
a command block — `CHANGE_ME`-style values only ever appear inside prose describing what to edit in
`server/.env`, never inside a `bash` code block a reader would run verbatim). Fix anything that isn't.

- [ ] **Step 3: Commit**

```bash
git add server/docs/deploy-vps.md
git commit -m "docs(server): VPS deployment guide (Docker + Caddy)"
```

---

### Task 5: cPanel/o2switch deployment guide

**Files:**
- Create: `server/docs/deploy-cpanel.md`

**Interfaces:**
- Consumes: `server/README.md`'s existing documented env vars and CLI usage (read it in full before
  writing this task — do not restate anything from it incorrectly), `server/cli.js`'s existing
  `migrate` and `token create --name= --owner-email=` commands, `server/src/index.js`'s existing env
  var handling (`PORT`, `BASE_URL`, `DATABASE_URL`, `TRUST_PROXY`, `SMTP_*`).
- Produces: nothing further downstream — a guide, not code.

This guide **cannot be live-tested** (no cPanel/o2switch account exists in this environment) — write
it strictly from the application's own real, already-verified behavior (its actual env-var handling,
its actual CLI commands, both read directly from source, never guessed), and say so explicitly in the
guide's own header, exactly as the spec requires.

- [ ] **Step 1: Write `server/docs/deploy-cpanel.md`**

```markdown
# Deploying to cPanel / o2switch (no Docker)

> This guide is written from spectoflow-server's own documented behavior (`server/README.md`, its
> CLI's `--help` output, and its actual environment-variable handling in `server/src/index.js`) rather
> than tested against a live cPanel account. cPanel's own UI wording varies between hosts and cPanel
> versions — if a step below doesn't match what your host actually shows you, the discrepancy is
> almost certainly in cPanel's interface, not in what this application itself needs. The prerequisite
> in Step 0 is the one thing worth confirming with your host directly before starting.

## 0. Prerequisite: confirm your host offers Node.js ≥ 22

Not every cPanel host has this yet. Check under cPanel's "Setup Node.js App" section for the list of
available Node.js versions before proceeding — if only an older version is offered, contact your host
or choose a different one; there is no way to make this application run on an older Node version.

## 1. Create a MySQL database

In cPanel: **MySQL Databases** → create a new database, then create a new database user and add it to
that database with full privileges. Note down: the database name, username, and password cPanel shows
you (cPanel typically prefixes both the database and user names with your cPanel account's own
username — e.g. `youraccount_spectoflow` — copy the exact names cPanel actually created, not just what
you typed).

## 2. Upload the code

Get a copy of the `server/` folder from this repository onto your hosting account (via cPanel's File
Manager upload+extract, or `git clone` if your host's Terminal feature has git available) — anywhere
under your account's own file space works; note the full path, you'll need it in the next step.

## 3. Set up the Node.js application

In cPanel: **Setup Node.js App** → create a new application:
- **Node.js version**: ≥ 22 (per Step 0)
- **Application root**: the path to the `server/` folder from Step 2
- **Application URL**: the domain or subdomain you want this reachable at
- **Application startup file**: `src/index.js`

## 4. Set environment variables

Still inside the Node.js App's own settings screen, add these environment variables (cPanel provides
a form for this — no `.env` file needed here, unlike the Docker path):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `mysql://<db-user>:<db-password>@localhost/<db-name>` using the exact names cPanel created in Step 1 (cPanel-hosted MySQL is normally only reachable as `localhost` from your own account, not a remote host) |
| `BASE_URL` | `https://<your-domain>` — the same domain from Step 3's Application URL |
| `TRUST_PROXY` | `1` (cPanel's own web server sits in front of your Node app as a reverse proxy) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | credentials from a real transactional email provider — every verification/reset/invitation email goes through these |

Do **not** set `PORT` — cPanel's Node.js App feature assigns and manages the port itself.

## 5. Install dependencies

Back on the Node.js App's main screen, use the **"Run NPM Install"** button cPanel provides — this is
the equivalent of `npm ci` on the Docker path, done through cPanel's own UI instead.

## 6. Run database migrations once

Using cPanel's **Terminal** feature (or SSH, if your host provides it):

```bash
cd <application root from Step 3>
node cli.js migrate
```

Expected output: `✓ migrations applied`. This is a one-time step for a fresh database — running it
again later (e.g. after an update) is always safe, since migrations are idempotent, but it does need
to be run manually here (unlike the Docker path, where it happens automatically on every restart —
cPanel's Node.js App feature has no equivalent "run this before starting" hook).

## 7. Start (or restart) the application

Back on the Node.js App's main screen, click **Restart**. Visit `https://<your-domain>/healthz` — you
should see `{"ok":true}`.

## 8. Create the first account, then connect a machine

Same as the Docker path: visit `https://<your-domain>/signup` (the first account ever created becomes
Platform Admin automatically), then use the **Account page** (`/account`, once signed in) to create a
machine token, then from the machine you want to publish projects from:

```bash
spectoflow dashboard login --url=https://<your-domain> --token=<the token just created>
spectoflow dashboard publish
```

## Updating later

Re-upload the changed files (Step 2), re-run "Run NPM Install" if dependencies changed (Step 5),
re-run `node cli.js migrate` via Terminal (Step 6 — always safe, even if nothing changed), then
Restart the app (Step 7).
```

- [ ] **Step 2: Cross-check every command and env var name against the real source**

Re-read `server/README.md`, `server/cli.js`, and `server/src/index.js` one more time side-by-side
with the guide you just wrote. Confirm: every env var name is spelled exactly as the app reads it
(`process.env.X` in `src/index.js`/`src/email.js`), the `migrate` command's exact invocation matches
`server/cli.js`, and nothing in the guide describes a flag or behavior the app doesn't actually have.
Fix anything that doesn't match — this guide's whole credibility rests on this cross-check since it
can't be live-tested.

- [ ] **Step 3: Commit**

```bash
git add server/docs/deploy-cpanel.md
git commit -m "docs(server): cPanel/o2switch deployment guide (no Docker)"
```

---

## Self-Review

**1. Spec coverage:** Goal 1 (Dockerfile) → Task 1. Goal 2 (docker-compose with Caddy) → Task 2.
Goal 3 (automatic migrations) → Task 1's entrypoint, confirmed live in Task 3 Step 2. Goal 4 (VPS
guide) → Task 4. Goal 5 (cPanel guide) → Task 5. The spec's three self-review decisions (no Docker
secrets, `DOMAIN`/`BASE_URL` kept separate with an explanatory comment, full git clone) are each
reflected verbatim in Task 2 Step 4's compose file, Task 2 Step 2's `.env.example` comment, and Task
4's guide Step 2, respectively.

**2. Placeholder scan:** No TBD/TODO in any step; every code block (Dockerfile, entrypoint, compose,
Caddyfile, `.env.example`, both guides in full) is complete, real content — not a description of what
one should contain. The one deliberate exception is `.env.example`'s own `CHANGE_ME` placeholders,
which are the intended, documented contract of an example file a real operator fills in — not a plan
placeholder.

**3. Type/interface consistency:** `DATABASE_URL`'s scheme (`mysql://spectoflow:<password>@mysql:3306/
spectoflow`) in Task 2's `.env.example` uses the Docker Compose service name `mysql` as the hostname
(not `localhost` or `127.0.0.1`) — consistent with Compose's own internal DNS, where each service is
reachable by its service name from any other service in the same compose file; this differs
deliberately from Task 5's cPanel guide, which uses `localhost` (cPanel-hosted MySQL genuinely is only
reachable as `localhost` there, a different real topology, not an inconsistency). `MYSQL_PASSWORD`
(read by the `mysql` service directly from `server/.env` via `env_file:`) and the password embedded in
`DATABASE_URL` (read by the `server` service from the same file) are the same value by the operator's
own action, per Task 2 Step 2's comment and Task 4's guide Step 3 — traced consistently across both
tasks, no drift between what one task documents and what the other expects.
