# Online dashboard, part 1: relay server + local connector — design (sub-project C1)

**Status:** approved by user, section-by-section, 2026-09-06. Implementation via `writing-plans`.

## Program context

The "one dashboard, many projects" program (see `docs/dashboard-separation-design.md`, table at the
top) has four sub-projects: **A** dashboard separation (shipped, v0.24.0, D64), **B** smart add,
**C** online dashboard, **D** theme redesign. This document is the first slice of C. When C was
brainstormed it turned out to be four subsystems of its own; they ship in this order, each with its
own spec → plan → implementation cycle:

| | Slice | What it delivers | Depends on |
|---|---|---|---|
| **C1** | **Relay + connector** (this document) | A hosted dashboard you can log a machine into with a token; your published local projects are visible and fully driveable from it, live | A |
| D | Theme redesign | Six designs redone, zero gradients — scheduled *before* C2/C3 so their new screens are drawn on the final look; C1 has almost no new UI, so it goes first | A |
| C2 | Accounts & sessions | Sign-up/login, per-user sessions, token creation in the UI (replaces C1's admin CLI) | C1, D |
| C3 | Sharing | Members per project with rights, project groups | C2 |
| C4 | Operations | Docker image, HTTPS/reverse-proxy and cPanel guides, backups | C1 |

Decisions the user made for the whole of C, binding here:

- **The local machine stays the source of truth; the server relays.** The markdown in the repo is
  the truth and the agent runs locally — the server never owns state. A project whose machine is
  disconnected shows as *offline* (last known state, read-only).
- **The server is a full application with dependencies.** Zero-dependency is *not* a constraint for
  the hosted server. It must run on **SQLite, MySQL (default) and PostgreSQL**. The `spectoflow`
  package (the CLI, the local hub, the connector) stays zero-dependency.
- **The server code lives in `server/` in this repository**, with its own `package.json`, excluded
  from the `spectoflow` npm package, published separately (C4: Docker image and/or its own package).
  One repo so the front-end and the operations contract are shared, never synchronized.
- **Both hosting shapes must work**: a VPS with Docker, and cPanel/o2switch's "Setup Node.js App"
  (Passenger) — so the transport has an HTTP fallback from day one.
- **Node ≥ 22 for `spectoflow`** (was ≥ 18; both 18 and 20 are end-of-life). Node 22 ships a native
  WebSocket client, which keeps the connector zero-dependency.
- **Server stack:** Fastify, `@fastify/websocket` (over `ws`), Knex (queries + migrations, drivers
  `mysql2` / `better-sqlite3` / `pg`).
- **C1 access:** one access key for the web UI (no accounts yet); **only explicitly published
  projects** go online; **full parity of actions** with the local dashboard (the machine token
  already represents the machine's owner).

## Problem

Since v0.24.0 the local hub (`lib/dashboard/hub-server.js`) serves every registered project through
a pure operations layer (`lib/dashboard/ops.js`, `(root, args, ctx) → result`, HTTP-free) and a
front-end that only ever talks `/api/*?p=<id>` + `/api/events?p=<id>`. It has **no authentication
at all** — anyone reaching it can read and rewrite every project and run agents. It therefore
cannot be exposed on the internet, and nothing exists to reach a machine's projects from anywhere
else. The user's own global config already asks for a `dashboard.url` and stores a remote one, but
answers "remote dashboards come in a later release"; `spectoflow dashboard login` is a placeholder.

## Goals

1. A **hosted server** (`server/`) that serves the same dashboard UI, protected by an access key,
   never exposes an unauthenticated route, and executes nothing itself.
2. A **connector inside the local hub**: one outbound connection per machine (WebSocket, HTTP
   fallback), machine authenticated by a token, that publishes chosen projects, relays their live
   events, and executes operations sent back — through the same `ops` table the local HTTP layer
   uses, so local and online dashboards share one process and one state.
3. **Byte-identical front-end**: `lib/dashboard/public/` is served by both hubs; the only client
   change is an *offline* state and a *remote-mode* hub page (no "Add project" online).
4. **Offline read**: the server keeps the last snapshot of each published project so it can be read
   (not driven) while its machine is away.
5. `spectoflow dashboard login/logout/publish/unpublish/status` make all of this a few commands.

## Non-goals (explicitly deferred)

- Accounts, sign-up, per-user tokens created in the UI — **C2**. C1's tokens are created by an
  admin CLI on the server.
- Members, rights, groups — **C3**. In C1 the access key sees every published project of every
  connected machine (single-owner deployment).
- Docker image, full cPanel/VPS guides, backups — **C4**. C1 ships `server/README.md` with the bare
  launch sequence and one Caddy example.
- Any visual change to the designs — **D**.
- Executing anything on the server, or letting the server act on a project while its machine is
  offline (no command queue; a request to an offline project is a clear 503).
- Migrating projects between machines, or the same project published from two machines (the
  server treats (machine, local project) as the identity; publishing the same folder from two
  machines yields two online projects — acceptable and rare).

## Design

### 1. Topology — three roles, two deliverables

```
browser ──HTTP/SSE──▶ server (server/, Fastify)  ◀──WebSocket (or HTTP long-poll)── local hub (spectoflow)
                        relay + access key                                            source of truth
                        registry of machines + published projects                    + connector
                        last snapshots (DB)                                          + agents run here
```

**Local hub** — `lib/dashboard/hub-server.js` gains a connector role via a new
`lib/dashboard/connector.js`. When `~/.spectoflow/dashboard/remote.json` exists (written by
`login`), the hub opens one outbound connection to `dashboard.url`, sends `hello`, and from then on:
tees every project's `emit` to the connection (`event` frames), pushes a `snapshot` after each
`change` (debounced 500 ms), and executes incoming `op` frames with `ops[op](root, args, ctx)`. The
local HTTP dashboard is untouched: same process, same `getProject()` entries, same `emit`, so an
approval clicked locally or online resolves the same pending gate (the lesson of D64's I2 finding —
two processes would have meant two orchestrator states).

**Server** — `server/` (Fastify). Holds, in memory, the set of connected machines and their
published projects; in the database, machines (token hashes) and projects (identity + last
snapshot). Serves `lib/dashboard/public/` and implements the *same* HTTP surface the local hub
does: `GET /api/hub/projects`, `/p/<id>/...` pages, `/api/*?p=<id>` (forwarded as `op` frames),
`/api/events?p=<id>` (SSE fed by `event` frames). It never requires or runs `ops.js`.

**Browser** — `lib/dashboard/public/` unchanged except two small, flagged additions:
1. *Offline state*: `GET /api/project?p=` for a disconnected project returns the stored snapshot
   with `online: false`; `app.js` shows a banner ("<name> is offline — last seen <time>, read-only")
   and disables every mutating control (run, orchestrate, approve, task edits, workflow toggle,
   settings, files write). Local hub responses never carry `online:false`, so nothing changes
   locally.
2. *Remote-mode hub page*: `GET /api/hub/projects` returns `{ mode: 'remote', projects: [...] }`
   online; `hub.js` then hides "+ Add project", the folder browser and the remove button, and shows
   each project's machine name and online/offline dot. `mode` is absent locally — no change there.

### 2. The protocol — one connection per machine, JSON frames

Every frame is a JSON object with a `type`. Frames are identical on both transports.

**Upward (hub → server)**

| type | payload | when |
|---|---|---|
| `auth` | `{ token, version }` | first frame after the socket opens; the server closes the socket if no valid `auth` arrives within 5 s |
| `hello` | `{ machineName, projects: [{ localId, name, kind, stats }] }` — `stats` is `projectStats(root)`'s `{ total, done }`, as on the local hub page | after `auth` is acknowledged, and again whenever the published set changes |
| `event` | `{ p: localId, event }` | every object the local `emit` would send over SSE (`change`, `message`, `run-line`, `run-start`, `run-end`), verbatim |
| `snapshot` | `{ p: localId, project }` | the full `project.read` payload: at `hello` for every published project, then 500 ms after each `change` |
| `reply` | `{ reqId, result }` or `{ reqId, error: { status, message } }` | answer to an `op` |

**Downward (server → hub)**

| type | payload | when |
|---|---|---|
| `auth-ok` | `{ machineId }` | after a valid `auth` |
| `op` | `{ reqId, p: localId, op, args }` | a browser request for that project: the hub runs `ops[op](root, args, ctx)` where `ctx.emit` is the project's teed emit, then sends `reply` |
| `ping` | `{}` | every 25 s (keeps proxies from idling the connection; the hub answers `pong`) |

The `op` names are exactly `lib/dashboard/ops.js`'s keys — the server's route table is
`lib/dashboard/handlers.js`'s `ROUTES` translated to frames (same method+path matching, same `args`
extraction), so the online HTTP surface stays in lockstep with the local one by construction.

**Correlation, timeouts, offline.** `reqId` is a per-connection counter. The server waits 30 s
for a `reply`, then answers the browser 504 `"<name> did not respond in time"`. A request for a
project whose machine is not connected is answered 503 `"<name> is offline (last seen <time>)"` —
except `project.read`, which returns the stored snapshot with `online:false` (§1). SSE clients of an
offline project stay connected and receive a `{type:'change'}` when the machine comes back.

**Reconnection.** The hub reconnects with exponential backoff (1 s → 30 s cap, jitter), resends
`auth` then `hello`, and re-pushes a `snapshot` for every published project. The server marks a
machine offline the moment its socket closes; `last_seen` is updated on every frame.

**HTTP fallback.** The same frames over two endpoints, both authenticated by
`Authorization: Bearer <token>`: `POST /connector/frames` (an array of upward frames; the hub sends
batches sequentially, awaiting each response, so ordering is preserved) and `GET /connector/frames`
(long-poll, held up to 25 s, returns an array of downward frames). The server treats a machine on
HTTP as connected while a long-poll is outstanding or was answered < 40 s ago. The hub switches to
HTTP when the WebSocket upgrade fails, or the socket drops 3 times within 60 s; it retries WebSocket
every 10 min. `spectoflow dashboard login --transport=http` (also stored in `remote.json`) forces
HTTP — for tests and for hosts known not to pass WebSockets.

**Ordering.** One socket per machine gives ordered delivery; on HTTP, sequential batches do. Frames
for different projects share the connection; the server fans `event` frames out per project. An
`event`/`snapshot` for a `localId` the machine has not announced as published is dropped and
logged at debug level — never stored, never fanned out.

### 3. Authentication and security in C1

**Machine tokens.** `node server/cli.js token create --name "laptop"` inserts a `machines` row
and prints the token **once**: `spf_` + 32 random bytes (base64url). Only its SHA-256 is stored.
`token list` / `token revoke <id>`. A revoked token's connection is closed on the next frame.
The token authenticates the machine: the server maps connection → machine from the `auth` frame,
so there is no separate machine id to invent locally.

**Login on the machine.** `spectoflow dashboard login --url <https://…> --token <spf_…>
[--name <machine name>] [--transport=ws|http]`: the CLI calls `POST /connector/whoami` with the
token; on 200 it writes `~/.spectoflow/dashboard/remote.json` (`{ url, token, machineName,
transport }`, file mode 0600 on POSIX; `machineName` defaults to `os.hostname()`, `transport` to
`ws`) and sets the global `dashboard.url`. It then tells the running
hub to (re)connect (`POST /api/hub/remote/reconnect` on the local hub) or notes that the next
`spectoflow dashboard` will. `logout` deletes `remote.json` and resets `dashboard.url` to the
local default. `dashboard status` reads `GET /api/hub/remote` from the local hub →
`{ configured, url, connected, transport, lastError }` and prints it under the local line.
`spectoflow dashboard` with a remote URL no longer prints "later release": it starts/joins the local
hub as always and prints both the local board URL and the online URL.

**Web access.** The server requires `SPECTOFLOW_ACCESS_KEY` (env; 16+ chars) and refuses to start
without it unless `--insecure-dev` is passed (prints a loud warning, binds to 127.0.0.1 only).
`GET /login` is a minimal page (the dashboard's own tokens for look and feel, no gradients);
`POST /login` compares the key in constant time and sets a signed cookie `spf_session` (HMAC-SHA256
with `SESSION_SECRET`, HttpOnly, Secure unless `--insecure-dev`, SameSite=Lax, 30 days) — stateless,
no session table in C1 (C2 introduces users and a sessions table). `@fastify/rate-limit` on
`POST /login`: 10 attempts / 15 min per IP. Every other route requires the cookie except
`/healthz`, `/connector/*` (token-protected) and the static assets needed by `/login`.

**Transport security.** TLS is the reverse proxy's job (Caddy/nginx/cPanel); the server listens on
plain HTTP on `PORT` and trusts `X-Forwarded-Proto` only when `TRUST_PROXY=1`. The local hub opens
**no inbound port** for this: the connection is outbound only. Tokens never appear in URLs or logs
(`auth` frame in-band on WebSocket, `Authorization` header on HTTP).

**Parity of actions.** Every op is allowed online (user decision): the machine token is the
machine owner's credential. C3 adds per-user rights on top.

### 4. Publishing and identities

- `spectoflow dashboard publish [--id <localId>]` (defaults to the project in the current folder)
  sets `published: true` in the workspace's `projects/<id>/meta.json` (the folder A reserved for
  dashboard-side project data) and tells the local hub (`POST /api/hub/projects/:id/publish`);
  `unpublish` clears it. The local hub page gets an "Online" toggle on each project card calling
  the same endpoint. Nothing is published by default.
- The hub's `hello` lists only published projects; publishing/unpublishing re-sends `hello`.
  Unpublishing keeps the server-side row (and its last snapshot) but marks it `published: false`
  — it disappears from the online hub page; the row is reused if the project is published again.
- **Server ids.** Two machines can have the same local project id (6 hex). The server assigns its
  own stable id per (machine, localId) — a 10-char random id stored in `projects.id` — and every
  online URL uses it. The relay maps server id ↔ (machine, localId) in memory from the DB.

### 5. The server: structure, persistence, tests, scope

```
server/
  package.json        fastify, @fastify/websocket, @fastify/cookie, @fastify/rate-limit, @fastify/static,
                      knex, mysql2, better-sqlite3, pg   (dev: none beyond node --test)
  knexfile.js         DATABASE_URL → client + connection (mysql2 default; sqlite: / postgres:)
  migrations/         0001_machines.js, 0002_projects.js
  src/index.js        boot: env validation, migrations check, listen
  src/app.js          Fastify instance: static (../../lib/dashboard/public), auth hook, routes
  src/auth.js         access key, signed cookie, /login, rate limit
  src/connector.js    /connector: WebSocket route + HTTP fallback endpoints, auth frame, machine registry
  src/relay.js        server-side ROUTES → op frames, reqId/timeouts, SSE fan-out, offline snapshot
  src/db.js           knex instance, machines/projects queries
  cli.js              token create|list|revoke, migrate
  test/               node --test (SQLite): protocol, relay, auth, end-to-end with a real local hub
  README.md           launch sequence + Caddy example (C4 does the rest)
```

- **Configuration (env):** `DATABASE_URL` (default `mysql://spectoflow:spectoflow@localhost/spectoflow`;
  `sqlite:./data/spectoflow.db`; `postgres://…`), `SPECTOFLOW_ACCESS_KEY`, `SESSION_SECRET`, `PORT`
  (3000), `TRUST_PROXY`. Missing `SESSION_SECRET` → generated once and written to
  `data/session-secret` (so restarts keep sessions).
- **Tables (C1):** `machines(id, name, token_hash unique, created_at, last_seen, revoked_at)`,
  `projects(id, machine_id, local_id, name, kind, published, last_snapshot longtext/json,
  snapshot_at, created_at)`, unique `(machine_id, local_id)`. C2 adds `users`, `sessions`,
  `user_tokens`; C3 adds `memberships`, `groups`.
- **Front-end path.** The server serves `../../lib/dashboard/public/` relative to `server/src/`
  (monorepo). C4's Docker image copies both `lib/dashboard/public/` and `server/`. `server/` is
  already outside the `spectoflow` npm package's `files` list.
- **`spectoflow` side:** `lib/dashboard/connector.js` (connection, frames, transport switch),
  `lib/dashboard/hub-server.js` (tee `emit`, expose `getProject`-driven op execution to the
  connector, `/api/hub/remote*` and `/api/hub/projects/:id/publish` routes), `bin/spectoflow.js`
  (`login`, `logout`, `publish`, `unpublish`, `status` additions; `dashboard` no longer prints the
  "later release" note), `lib/workspace.js` (`remote.json` read/write, `published` in meta.json),
  `package.json` engines `>=22`, `lib/dashboard/public/{app.js,hub.js}` (the two additions in §1).

**Testing**

- `spectoflow` (zero-dep): `test/connector.test.js` runs a minimal fake server written with
  `node:http` (a hand-rolled WebSocket handshake + framing is ~80 lines; the fallback endpoints are
  plain routes) to assert: `auth` first, `hello` lists only published projects, `event` frames
  mirror local SSE, `op` executes through `ops` and replies with the right result/error status,
  reconnection re-sends `hello`, `--transport=http` uses the fallback endpoints in order.
  `test/cli-remote.test.js`: `login` writes `remote.json` (0600) + `dashboard.url`, `logout` clears
  both, `publish/unpublish` flip `meta.json`, `status` prints the remote line — all under
  `SPECTOFLOW_HOME` isolation.
- `server/test/` (SQLite): auth (no key → refuses to start; wrong key → 401 + rate limit; right key
  → cookie; every route 401 without it), token CLI (create prints once, stores a hash, revoke
  closes), relay (route → op frame mapping equals `ROUTES`; 30 s timeout → 504; offline → 503 /
  snapshot with `online:false`), and one **end-to-end**: spawn the real local hub with an isolated
  `SPECTOFLOW_HOME`, `login` + `publish` a real inited project, then through the server: list it
  online, `task.add` remotely, receive `change` over the server's SSE, kill the hub → 503 for a
  write, snapshot for a read, restart → back online. Repeated with `--transport=http`.
- **Real QA before release:** the server on this machine with SQLite, the user's real projects
  published from the real local hub, driven from a second browser tab; then the same against a
  MySQL instance.

**Version.** `spectoflow` **0.25.0** (connector, Node ≥ 22, new CLI commands) — DECISIONS entry
D65; `server/` **0.1.0**. `CLAUDE.md` "What exists" and "Run & test" updated (how to run the server
locally against SQLite).

## What C1 prepares for the rest (and deliberately does not build)

- **C2** — `machines.token_hash` becomes `user_tokens`; the signed access-key cookie becomes a
  real session row; `/login` becomes sign-in/sign-up; the token CLI moves into the UI.
- **C3** — `projects.id` (server ids) are what memberships and groups attach to; the relay's "may
  this cookie drive this project?" check is a single function that C3 replaces.
- **C4** — the server is already 12-factor (env config, plain HTTP, migrations by CLI), so a
  Dockerfile and a cPanel runbook are packaging, not design.
- **D** — no design file is touched; `/login` uses the existing tokens and no gradient.
