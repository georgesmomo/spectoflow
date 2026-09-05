# Online dashboard C1 — relay server + local connector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hosted dashboard (`server/`) you log a machine into with a token; the local hub becomes an outbound connector, so explicitly published local projects are visible and fully driveable from the hosted dashboard, live, with an offline read-only fallback.

**Architecture:** The local hub (`lib/dashboard/hub-server.js`) keeps owning every project and its state; a new zero-dependency `lib/dashboard/connector.js` opens one outbound WebSocket (Node ≥ 22 native client; HTTP long-poll fallback) per machine, tees each project's `emit` upward as `event`/`snapshot` frames, and executes incoming `op` frames through the same `ops` table the local HTTP layer uses. A new Fastify application in `server/` (its own `package.json`, Knex on MySQL/SQLite/PostgreSQL) authenticates machines by hashed token, serves `lib/dashboard/public/` byte-identical behind an access-key cookie, translates the same `ROUTES` table into `op` frames with `reqId`/timeouts, fans `event` frames out over SSE, and keeps each published project's last snapshot for offline reads.

**Tech Stack:** Node ≥ 22 (native `WebSocket` client + `fetch`), `node:http`/`node:crypto` only on the `spectoflow` side; `server/`: fastify 5, @fastify/websocket, @fastify/cookie, @fastify/rate-limit, @fastify/static, knex 3, mysql2, better-sqlite3, pg; tests with `node --test` on both sides (SQLite for the server).

**Spec:** `docs/online-dashboard-connector-design.md` (binding). Foundations it builds on: `docs/dashboard-separation-design.md` (sub-project A, v0.24.0, DECISIONS D64).

## Global Constraints

- The `spectoflow` npm package (`bin/`, `lib/`, `templates/`) stays **zero runtime dependencies** — `node:*` modules and Node's global `WebSocket`/`fetch` only. `server/` is a separate application with its own `package.json`; it is already outside the root `package.json` `files` list and must stay so.
- `package.json` `engines.node` becomes `">=22"` (Task 3). CI already runs Node 22.
- Everything in English, code comments included. UI copy the user sees online is English (i18n keys for the two new dashboard strings, all 6 languages: en/fr/es/de/pt/it).
- **Zero CSS gradients** anywhere, including the `/login` page (user rule).
- Tokens are secrets: printed once by `token create`, stored only as SHA-256, never in URLs or logs. `remote.json` is written with mode `0o600`.
- The server refuses to start without `SPECTOFLOW_ACCESS_KEY` (16+ chars) unless `--insecure-dev` (127.0.0.1 only, loud warning). No route except `/healthz`, `/login`, `/connector/*` and the login page's own assets is reachable without the cookie.
- Local hub never opens an inbound port for this; the connection is outbound only. The server never `require()`s `ops.js` and never executes anything.
- Tests never touch the real `~/.spectoflow`: every spawned CLI/hub gets `SPECTOFLOW_HOME` = a fresh temp dir. Server tests use `DATABASE_URL=sqlite::memory:` (or a temp file when a child process needs the same DB).
- Root `npm test` = `node --test test/` (scoped in Task 8 so `server/test/` — which needs `server/node_modules` — only runs via `cd server && npm test`).
- Frame vocabulary and every timing constant come verbatim from the spec §2: `auth` first (5 s server-side timeout), `ping` every 25 s, reply timeout 30 s → 504, offline → 503 (except `project.read` → snapshot with `online:false`), snapshot debounce 500 ms, backoff 1 s → 30 s with jitter, HTTP fallback after upgrade failure or 3 drops in 60 s, WS retry every 10 min, long-poll held 25 s, HTTP machine "connected" while a poll is outstanding or answered < 40 s ago.
- Versions at the end: `spectoflow` **0.25.0**, `server/` **0.1.0**. DECISIONS entry **D65** is written by the controller (French), not by a task.
- Commits go directly on `main` (repo convention), one or more per task, Conventional Commits style, ending with the session's `Co-Authored-By` / `Claude-Session` trailers.

## File structure

**`spectoflow` side (zero-dep)**

| File | Responsibility |
|---|---|
| `lib/dashboard/routes.js` (new, Task 1) | The pure route table `ROUTES` + `seg`/`q`/`matches`/`findRoute` — importable without loading `ops.js`, so the server can reuse it |
| `lib/dashboard/handlers.js` (modify, Task 1) | Imports the table from `routes.js`; unchanged behaviour |
| `lib/workspace.js` (modify, Task 2) | `remote.json` read/write/clear (0600); `published` flag in `projects/<id>/meta.json`; `listPublished()` |
| `lib/dashboard/connector.js` (new, Tasks 3–4) | `createConnector(opts)`: WS transport, HTTP transport, frames, backoff, transport switching, status |
| `test/helpers/fake-relay.js` (new, Task 3) | Hand-rolled `node:http` fake server: RFC 6455 handshake + framing, `/connector/whoami`, `/connector/frames` |
| `lib/dashboard/hub-server.js` (modify, Task 5) | Tee `emit`, debounced snapshots, `execOp`, connector lifecycle, `/api/hub/remote*`, `/api/hub/projects/:id/publish` |
| `bin/spectoflow.js` (modify, Task 6) | `dashboard login/logout/publish/unpublish`, `status` remote line, no "later release" note, help |
| `lib/dashboard/public/{app.js,i18n.js,index.html,styles.css,hub.js,hub.html}` (modify, Task 7) | Offline state; remote-mode hub page; local "Online" toggle |
| `package.json` (modify, Tasks 3, 8, 12) | `engines >=22`; `test` scoped to `test/`; version 0.25.0 |

**`server/` side (own dependencies)**

| File | Responsibility |
|---|---|
| `server/package.json`, `server/knexfile.js`, `server/migrations/0001_machines.js`, `server/migrations/0002_projects.js` (Task 8) | Dependencies, `DATABASE_URL` → Knex config, schema |
| `server/src/db.js` (Task 8) | `createDb(url)`: machines/projects queries, token hashing, ids |
| `server/cli.js` (Task 8) | `migrate`, `token create|list|revoke` |
| `server/src/auth.js` (Task 9) | Access key, signed stateless cookie, `/login` page + POST, rate limit, public-route list |
| `server/src/app.js` (Task 9, modified in 10–11) | `buildApp(opts)`: Fastify instance, lenient JSON parser, static, pages, `/healthz` |
| `server/src/index.js` (Task 9) | Boot: env validation, `--insecure-dev`, session secret file, migrate, listen |
| `server/src/connector.js` (Task 10) | Machine registry (in-memory), WS route, HTTP fallback endpoints, `auth`/`hello`/`event`/`snapshot`/`reply` handling |
| `server/src/relay.js` (Task 11) | `ROUTES` → `op` frames, `reqId`/timeouts, offline snapshot, SSE fan-out, `/api/hub/projects` remote mode |
| `server/test/*.test.js` (Tasks 8–12) | db + cli, auth, connector protocol, relay, end-to-end with the real local hub |
| `server/README.md` (Task 12) | Launch sequence + Caddy example |

---

### Task 1: Extract the route table into `lib/dashboard/routes.js`

**Files:**
- Create: `lib/dashboard/routes.js`
- Modify: `lib/dashboard/handlers.js:21-46` (move `seg`, `q`, `ROUTES`, `matches` out; import them)
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: `lib/dashboard/ops.js` `ops` keys (only in the test, to assert coverage).
- Produces: `require('./routes')` → `{ ROUTES, seg, q, matches, findRoute(method, pathname) }` where `ROUTES` is the existing array of `[method, matcher, opName, args(u, body, pathname)]`, `findRoute` returns the matching entry or `undefined`. The server (Task 11) requires `lib/dashboard/routes.js` and must be able to do so **without** `ops.js` being loaded.

- [ ] **Step 1: Write the failing test**

```js
// test/routes.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROUTES_PATH = path.resolve(__dirname, '..', 'lib', 'dashboard', 'routes.js');
const OPS_PATH = path.resolve(__dirname, '..', 'lib', 'dashboard', 'ops.js');

test('routes.js loads without pulling ops.js into the require cache (the server relies on this)', () => {
  delete require.cache[ROUTES_PATH]; delete require.cache[OPS_PATH];
  const routes = require(ROUTES_PATH);
  assert.ok(Array.isArray(routes.ROUTES) && routes.ROUTES.length >= 20);
  assert.strictEqual(require.cache[OPS_PATH], undefined, 'ops.js must not be loaded by routes.js');
});

test('every route names an op that exists, and every op is reachable by exactly one route', () => {
  const { ROUTES } = require(ROUTES_PATH);
  const { ops } = require(OPS_PATH);
  const named = ROUTES.map((r) => r[2]);
  for (const op of named) assert.ok(typeof ops[op] === 'function', `op ${op} missing in ops.js`);
  for (const op of Object.keys(ops)) assert.strictEqual(named.filter((n) => n === op).length, 1, `op ${op} should have exactly one route`);
});

test('findRoute matches method + path and extracts args the same way handlers.js does', () => {
  const { findRoute, seg } = require(ROUTES_PATH);
  const u = new URL('http://x/api/task/T-007?p=abc123');
  const r = findRoute('PATCH', u.pathname);
  assert.strictEqual(r[2], 'task.update');
  assert.deepStrictEqual(r[3](u, { status: 'done' }, u.pathname), { id: 'T-007', patch: { status: 'done' } });
  assert.strictEqual(findRoute('GET', '/api/nope'), undefined);
  assert.strictEqual(seg('/api/task/T-1%202', 3), 'T-1 2');
});

test('handlers.js re-exports the very same ROUTES array', () => {
  const routes = require(ROUTES_PATH);
  const handlers = require(path.resolve(__dirname, '..', 'lib', 'dashboard', 'handlers.js'));
  assert.strictEqual(handlers.ROUTES, routes.ROUTES);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/routes.test.js`
Expected: FAIL — `Cannot find module '.../lib/dashboard/routes.js'`.

- [ ] **Step 3: Create `lib/dashboard/routes.js`**

```js
'use strict';
/*
 * The dashboard's HTTP route table — method + path → op name + args extraction — with NO reference
 * to ops.js. Two consumers share it: handlers.js (local hub, calls ops directly) and the online
 * relay server (server/src/relay.js), which turns the same rows into `op` frames sent to the machine.
 * Keeping it dependency-free is what lets the server require it without loading ops.js (which
 * would drag in the runner, the orchestrator, agent detection… none of which exist server-side).
 */
const seg = (p, i) => decodeURIComponent(p.split('/')[i] || '');
const q = (u, k) => u.searchParams.get(k) || '';
// [method, matcher, op, args(u, body, pathname)]
const ROUTES = [
  ['GET', '/api/project', 'project.read', () => ({})],
  ['GET', '/api/agentfile', 'agentfile.read', (u) => ({ path: q(u, 'path') })],
  ['GET', '/api/files/tree', 'files.tree', () => ({})],
  ['GET', '/api/files/read', 'files.read', (u) => ({ path: q(u, 'path') })],
  ['POST', '/api/files/write', 'files.write', (_u, b) => b],
  ['POST', '/api/files/mkdir', 'files.mkdir', (_u, b) => b],
  ['POST', '/api/task', 'task.add', (_u, b) => b],
  ['PATCH', /^\/api\/task\/[^/]+$/, 'task.update', (_u, b, p) => ({ id: seg(p, 3), patch: b })],
  ['POST', /^\/api\/task\/[^/]+\/comment$/, 'task.comment', (_u, b, p) => ({ id: seg(p, 3), text: b.text, action: b.action })],
  ['POST', '/api/workflow/toggle', 'workflow.toggle', (_u, b) => b],
  ['POST', '/api/run', 'run.start', (_u, b) => b],
  ['POST', '/api/chat/summarize', 'chat.summarize', (_u, b) => b],
  ['POST', '/api/chat/clear', 'chat.clear', () => ({})],
  ['POST', '/api/orchestrate', 'orchestrate.start', (_u, b) => b],
  ['POST', '/api/orchestrate/approve', 'orchestrate.approve', (_u, b) => b],
  ['POST', '/api/settings', 'settings.save', (_u, b) => b],
  ['POST', '/api/attention', 'attention.add', (_u, b) => b],
  ['POST', /^\/api\/attention\/[^/]+\/promote$/, 'attention.promote', (_u, _b, p) => ({ id: seg(p, 3) })],
  ['PATCH', /^\/api\/attention\/[^/]+$/, 'attention.update', (_u, b, p) => ({ id: seg(p, 3), patch: b })],
  ['DELETE', /^\/api\/attention\/[^/]+$/, 'attention.remove', (_u, _b, p) => ({ id: seg(p, 3) })],
];
const matches = (m, p) => (typeof m === 'string' ? m === p : m.test(p));
const findRoute = (method, pathname) => ROUTES.find(([m, matcher]) => m === method && matches(matcher, pathname));

module.exports = { ROUTES, seg, q, matches, findRoute };
```

- [ ] **Step 4: Make `handlers.js` import it**

Replace lines 21–46 of `lib/dashboard/handlers.js` (from `const seg = …` through `const matches = …`) with:

```js
const { ROUTES, findRoute } = require('./routes');
```

and in `handleApi` replace `const route = ROUTES.find(([method, m]) => method === req.method && matches(m, p));` with `const route = findRoute(req.method, p);`. Keep `module.exports = { createHandlers, ROUTES };` unchanged.

- [ ] **Step 5: Run the tests**

Run: `node --test test/routes.test.js test/ops.test.js test/hub-server.test.js`
Expected: all PASS (hub-server tests prove the HTTP surface is unchanged).

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/routes.js lib/dashboard/handlers.js test/routes.test.js
git commit -m "refactor(dashboard): extract the route table into routes.js, loadable without ops.js"
```

---

### Task 2: Workspace — `remote.json` and the `published` flag

**Files:**
- Modify: `lib/workspace.js` (add functions; extend `module.exports`)
- Test: `test/workspace.test.js` (append)

**Interfaces:**
- Consumes: existing `dir(baseDir)`, `projectDir(id, baseDir)`, `registry.listProjects(baseDir)`.
- Produces (all take an optional trailing `baseDir`, like every other workspace function):
  - `remotePath(baseDir)` → `<workspace>/remote.json`
  - `readRemote(baseDir)` → `{ url, token, machineName, transport }` or `null`
  - `writeRemote({ url, token, machineName, transport }, baseDir)` → the object written; file mode `0o600`
  - `clearRemote(baseDir)` → `true` if a file was removed
  - `readMeta(id, baseDir)` → parsed `projects/<id>/meta.json` or `null`
  - `setPublished(id, published, baseDir)` → updated meta, or `null` when `id` is not in the registry
  - `isPublished(id, baseDir)` → boolean (false when unknown)
  - `listPublished(baseDir)` → registry entries (`{ id, path, name, lastOpened, kind }`) whose meta has `published: true`, in `registry.listProjects` order

- [ ] **Step 1: Write the failing tests** (append to `test/workspace.test.js`; it already has a `freshHome()`-style helper that sets `SPECTOFLOW_HOME` per test — reuse the file's existing helper names; the snippet below assumes a helper `home()` returning a fresh temp home and the module loaded as `workspace`, plus `registry`)

```js
test('remote.json: write (0600), read, clear', () => {
  const h = home(); const base = path.join(h, 'dashboard');
  assert.strictEqual(workspace.readRemote(base), null);
  const w = workspace.writeRemote({ url: 'https://dash.example.com', token: 'spf_abc', machineName: 'laptop', transport: 'ws' }, base);
  assert.deepStrictEqual(workspace.readRemote(base), w);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(workspace.remotePath(base)).mode & 0o777, 0o600);
  assert.strictEqual(workspace.clearRemote(base), true);
  assert.strictEqual(workspace.readRemote(base), null);
  assert.strictEqual(workspace.clearRemote(base), false);
});

test('published flag lives in projects/<id>/meta.json and listPublished() filters the registry', () => {
  const h = home(); const base = path.join(h, 'dashboard');
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ws-a-')); const b = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ws-b-'));
  const ea = workspace.registerProject(a, base); workspace.registerProject(b, base);
  assert.strictEqual(workspace.isPublished(ea.id, base), false);
  assert.deepStrictEqual(workspace.listPublished(base), []);
  const meta = workspace.setPublished(ea.id, true, base);
  assert.strictEqual(meta.published, true);
  assert.strictEqual(workspace.readMeta(ea.id, base).published, true);
  assert.strictEqual(workspace.isPublished(ea.id, base), true);
  assert.deepStrictEqual(workspace.listPublished(base).map((p) => p.id), [ea.id]);
  workspace.setPublished(ea.id, false, base);
  assert.deepStrictEqual(workspace.listPublished(base), []);
  assert.strictEqual(workspace.setPublished('zzzzzz', true, base), null);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/workspace.test.js`
Expected: FAIL — `workspace.readRemote is not a function`.

- [ ] **Step 3: Implement in `lib/workspace.js`** (insert before `module.exports`, and extend the export list)

```js
// ---- online dashboard (sub-project C1): remote.json + the per-project `published` flag ----
// remote.json = { url, token, machineName, transport } written by `spectoflow dashboard login`; the
// hub reads it at boot to start the connector. It holds a secret, hence mode 0600 (no-op on Windows).
function remotePath(baseDir) { return path.join(dir(baseDir), 'remote.json'); }
function readRemote(baseDir) {
  const r = readJSON(remotePath(baseDir));
  return r && r.url && r.token ? r : null;
}
function writeRemote({ url, token, machineName, transport }, baseDir) {
  const obj = { url: String(url).replace(/\/+$/, ''), token: String(token), machineName: String(machineName || ''), transport: transport === 'http' ? 'http' : 'ws' };
  fs.mkdirSync(dir(baseDir), { recursive: true });
  fs.writeFileSync(remotePath(baseDir), JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(remotePath(baseDir), 0o600); } catch (_) {}
  return obj;
}
function clearRemote(baseDir) {
  try { fs.unlinkSync(remotePath(baseDir)); return true; } catch { return false; }
}

function metaPath(id, baseDir) { return path.join(projectDir(id, baseDir), 'meta.json'); }
function readMeta(id, baseDir) { return readJSON(metaPath(id, baseDir)); }
// `published: true` means "announce this project to the online dashboard". Only registered projects
// can carry it; null tells the caller the id is unknown (a 404, not a silent write).
function setPublished(id, published, baseDir) {
  const entry = registry.listProjects(baseDir).find((p) => p.id === id);
  if (!entry) return null;
  fs.mkdirSync(projectDir(id, baseDir), { recursive: true });
  const meta = { addedAt: new Date().toISOString(), lastOpened: entry.lastOpened, kind: entry.kind || 'spectoflow', ...(readMeta(id, baseDir) || {}), published: !!published };
  fs.writeFileSync(metaPath(id, baseDir), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}
function isPublished(id, baseDir) { const m = readMeta(id, baseDir); return !!(m && m.published); }
function listPublished(baseDir) { return registry.listProjects(baseDir).filter((p) => isPublished(p.id, baseDir)); }
```

Export line becomes:

```js
module.exports = { dir, exists, settings, settingsPath, lockPath, projectDir, init, registerProject, migrateLegacyHome, readLock,
  remotePath, readRemote, writeRemote, clearRemote, readMeta, setPublished, isPublished, listPublished };
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/workspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/workspace.js test/workspace.test.js
git commit -m "feat(workspace): remote.json (0600) and the per-project published flag"
```

---

### Task 3: The connector — frames, WebSocket transport, reconnection (+ the fake relay test helper, engines ≥ 22)

**Files:**
- Create: `lib/dashboard/connector.js`
- Create: `test/helpers/fake-relay.js`
- Modify: `package.json:46-48` (`engines.node` → `">=22"`)
- Test: `test/connector.test.js`

**Interfaces:**
- Consumes: nothing from the codebase (pure module; the hub wires it in Task 5). Uses Node's global `WebSocket` (Node ≥ 22).
- Produces: `createConnector({ url, token, machineName, version, transport, listPublished, readSnapshot, execOp, log, timing })` →
  `{ start(), stop(), status(), announce(), pushEvent(localId, event), pushSnapshot(localId, project), forceReconnect() }`.
  - `listPublished()` → `[{ localId, name, kind, stats }]` (sync).
  - `readSnapshot(localId)` → `Promise<project|null>` (the `project.read` payload).
  - `execOp(localId, op, args)` → `Promise<result>`; a thrown error with a numeric `.status` becomes `reply.error.status`, anything else 500.
  - `status()` → `{ url, machineName, connected, transport: 'ws'|'http' (the mode in use), lastError, machineId, since }`.
  - `timing` (tests only) overrides `{ backoffMin:1000, backoffMax:30000, dropWindow:60000, dropLimit:3, wsRetryEvery:600000, pollTimeout:35000 }`.
  - In this task `transport:'http'` and the HTTP fallback path are declared but `httpTransport()` is delivered in Task 4 — Task 3's `connect()` calls it, so Task 3 ships a one-line `httpTransport` that immediately reports "HTTP transport not available" through `onDisconnected` (replaced in Task 4).
- The fake relay (`test/helpers/fake-relay.js`): `startFakeRelay({ token='spf_test', pollHold=150, authOk=true })` → `Promise<relay>` with `relay.url`, `relay.port`, `relay.frames` (every upward frame, each tagged `via:'ws'|'http'`), `relay.waitFor(type, { timeout=5000, after=0 })`, `relay.send(frame)` (downward), `relay.dropSockets()`, `relay.rejectUpgrade` (boolean; when true the upgrade is answered 404), `relay.upgrades`, `relay.httpPosts`, `relay.httpPolls`, `relay.close()`.

- [ ] **Step 1: Bump the engine floor**

In `package.json` set `"engines": { "node": ">=22" }`. (The native `WebSocket` client the connector uses shipped unflagged in Node 22; 18/20 are end-of-life — spec decision.)

- [ ] **Step 2: Write the fake relay helper** (`test/helpers/fake-relay.js`)

```js
'use strict';
/*
 * A stand-in for server/ for the spectoflow-side tests — zero-dep, node:http only. Implements just
 * enough of RFC 6455 to talk to Node's native WebSocket client (handshake, masked text frames in,
 * unmasked text frames out, close frames), plus the HTTP fallback endpoints. Records every upward
 * frame (tagged with the transport it came through), lets a test push downward frames and wait for
 * a frame of a given type.
 */
const http = require('http');
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function decodeFrames(buf) {
  const frames = []; let off = 0;
  while (off + 2 <= buf.length) {
    const b0 = buf[off], b1 = buf[off + 1];
    const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    let mask = null;
    if (masked) { if (p + 4 > buf.length) break; mask = buf.subarray(p, p + 4); p += 4; }
    if (p + len > buf.length) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    frames.push({ opcode, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}
function encodeText(str) {
  const data = Buffer.from(str, 'utf8'); const len = data.length; let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, data]);
}
function closeFrame(code, reason) {
  const r = Buffer.from(reason || '', 'utf8'); const body = Buffer.alloc(2 + r.length);
  body.writeUInt16BE(code, 0); r.copy(body, 2);
  return Buffer.concat([Buffer.from([0x88, body.length]), body]);
}

async function startFakeRelay({ token = 'spf_test', pollHold = 150, authOk = true } = {}) {
  const relay = { token, machineId: 'm1', frames: [], sockets: [], outbox: [], waiters: [], upgrades: 0, httpPosts: 0, httpPolls: 0, rejectUpgrade: false };
  const subs = new Set();
  const record = (frame, via) => { const entry = { ...frame, via }; relay.frames.push(entry); for (const s of [...subs]) s(entry); };
  relay.waitFor = (type, { timeout = 5000, after = 0 } = {}) => new Promise((resolve, reject) => {
    const found = relay.frames.slice(after).find((f) => f.type === type);
    if (found) return resolve(found);
    const t = setTimeout(() => { subs.delete(sub); reject(new Error(`no "${type}" frame within ${timeout}ms (got: ${relay.frames.map((f) => f.type).join(',') || 'none'})`)); }, timeout);
    const sub = (f) => { if (f.type === type) { clearTimeout(t); subs.delete(sub); resolve(f); } };
    subs.add(sub);
  });
  const wsSend = (sock, frame) => sock.write(encodeText(JSON.stringify(frame)));
  relay.send = (frame) => {
    if (relay.sockets.length) { for (const s of relay.sockets) wsSend(s, frame); return; }
    relay.outbox.push(frame);
    for (const w of relay.waiters.splice(0)) w();
  };
  relay.dropSockets = () => { for (const s of relay.sockets.splice(0)) s.destroy(); };

  const server = http.createServer(async (req, res) => {
    const authed = req.headers.authorization === `Bearer ${token}` && authOk;
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/connector/whoami' && req.method === 'POST') return authed ? json(200, { machineId: relay.machineId, name: 'fake' }) : json(401, { error: 'invalid token' });
    if (req.url === '/connector/frames' && req.method === 'POST') {
      if (!authed) return json(401, { error: 'invalid token' });
      relay.httpPosts++;
      let body = ''; for await (const c of req) body += c;
      let frames = []; try { frames = JSON.parse(body || '[]'); } catch {}
      const down = [];
      for (const f of frames) { record(f, 'http'); if (f.type === 'auth') down.push({ type: 'auth-ok', machineId: relay.machineId }); }
      down.push(...relay.outbox.splice(0));
      return json(200, down);
    }
    if (req.url === '/connector/frames' && req.method === 'GET') {
      if (!authed) return json(401, { error: 'invalid token' });
      relay.httpPolls++;
      if (relay.outbox.length) return json(200, relay.outbox.splice(0));
      let answered = false;
      const done = () => { if (answered) return; answered = true; clearTimeout(t); json(200, relay.outbox.splice(0)); };
      const t = setTimeout(done, pollHold);
      relay.waiters.push(done);
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on('upgrade', (req, socket) => {
    relay.upgrades++;
    if (req.url !== '/connector/ws' || relay.rejectUpgrade) { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let authedWs = false, buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = decodeFrames(buf); buf = rest;
      for (const fr of frames) {
        if (fr.opcode === 8) { socket.write(closeFrame(1000, '')); socket.end(); return; }
        if (fr.opcode !== 1) continue;
        let f; try { f = JSON.parse(fr.payload.toString('utf8')); } catch { continue; }
        record(f, 'ws');
        if (!authedWs) {
          if (f.type !== 'auth' || f.token !== token || !authOk) { socket.write(closeFrame(4401, 'unauthorized')); socket.end(); return; }
          authedWs = true; relay.sockets.push(socket);
          wsSend(socket, { type: 'auth-ok', machineId: relay.machineId });
          for (const d of relay.outbox.splice(0)) wsSend(socket, d);
        }
      }
    });
    socket.on('close', () => { relay.sockets = relay.sockets.filter((s) => s !== socket); });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  relay.port = server.address().port;
  relay.url = `http://127.0.0.1:${relay.port}`;
  relay.close = () => new Promise((r) => { relay.dropSockets(); server.closeAllConnections(); server.close(() => r()); });
  return relay;
}

module.exports = { startFakeRelay, decodeFrames, encodeText };
```

- [ ] **Step 3: Write the failing tests** (`test/connector.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createConnector } = require('../lib/dashboard/connector');
const { startFakeRelay } = require('./helpers/fake-relay');

const fast = { backoffMin: 30, backoffMax: 60, dropWindow: 60000, dropLimit: 3, wsRetryEvery: 300, pollTimeout: 5000 };
const PUB = [{ localId: 'aaaaaa', name: 'alpha', kind: 'spectoflow', stats: { total: 2, done: 1 } }];
function stubs(published = PUB) {
  return {
    listPublished: () => published,
    readSnapshot: async (localId) => ({ projectName: 'snap-' + localId, plans: [] }),
    execOp: async (p, op, args) => {
      if (op === 'task.add') return { ok: true, p, title: args.title };
      const e = new Error('bad request from test'); e.status = 400; throw e;
    },
  };
}
function connector(relay, extra = {}) {
  return createConnector({ url: relay.url, token: relay.token, machineName: 'test-box', version: '0.25.0', timing: fast, ...stubs(), ...extra });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('auth is the first frame; hello lists only published projects; a snapshot follows per project', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try {
    const hello = await relay.waitFor('hello');
    assert.strictEqual(relay.frames[0].type, 'auth');
    assert.strictEqual(relay.frames[0].token, relay.token);
    assert.strictEqual(relay.frames[0].version, '0.25.0');
    assert.strictEqual(hello.machineName, 'test-box');
    assert.deepStrictEqual(hello.projects, PUB);
    const snap = await relay.waitFor('snapshot');
    assert.strictEqual(snap.p, 'aaaaaa'); assert.strictEqual(snap.project.projectName, 'snap-aaaaaa');
    assert.strictEqual(c.status().connected, true); assert.strictEqual(c.status().machineId, 'm1'); assert.strictEqual(c.status().transport, 'ws');
  } finally { c.stop(); await relay.close(); }
});

test('pushEvent mirrors a local emit as an event frame, in order', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try {
    await relay.waitFor('hello');
    c.pushEvent('aaaaaa', { type: 'change' }); c.pushEvent('aaaaaa', { type: 'message', message: { id: 1 } });
    await relay.waitFor('event');
    await sleep(50);
    const evs = relay.frames.filter((f) => f.type === 'event');
    assert.deepStrictEqual(evs.map((e) => e.event.type), ['change', 'message']);
    assert.strictEqual(evs[0].p, 'aaaaaa');
  } finally { c.stop(); await relay.close(); }
});

test('an op frame runs execOp and replies with the result, or with {status,message} on error', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try {
    await relay.waitFor('hello');
    relay.send({ type: 'op', reqId: 7, p: 'aaaaaa', op: 'task.add', args: { title: 'from online' } });
    const ok = await relay.waitFor('reply');
    assert.deepStrictEqual(ok, { type: 'reply', reqId: 7, result: { ok: true, p: 'aaaaaa', title: 'from online' }, via: 'ws' });
    const n = relay.frames.length;
    relay.send({ type: 'op', reqId: 8, p: 'aaaaaa', op: 'attention.remove', args: { id: 'x' } });
    const err = await relay.waitFor('reply', { after: n });
    assert.deepStrictEqual(err.error, { status: 400, message: 'bad request from test' });
  } finally { c.stop(); await relay.close(); }
});

test('ping is answered with pong', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try { await relay.waitFor('hello'); relay.send({ type: 'ping' }); await relay.waitFor('pong'); }
  finally { c.stop(); await relay.close(); }
});

test('a rejected token never connects and status explains it', async () => {
  const relay = await startFakeRelay(); const c = connector(relay, { token: 'spf_wrong' }); c.start();
  try {
    await relay.waitFor('auth'); await sleep(150);
    assert.strictEqual(c.status().connected, false);
    assert.match(String(c.status().lastError), /token|4401|unauthorized/i);
    assert.strictEqual(relay.frames.filter((f) => f.type === 'hello').length, 0);
  } finally { c.stop(); await relay.close(); }
});

test('after a drop the connector reconnects: auth, hello and snapshots again (still WebSocket)', async () => {
  const relay = await startFakeRelay(); const c = connector(relay); c.start();
  try {
    await relay.waitFor('snapshot');
    const n = relay.frames.length;
    relay.dropSockets();
    const hello2 = await relay.waitFor('hello', { after: n });
    assert.strictEqual(hello2.via, 'ws');
    assert.strictEqual(relay.frames.slice(n).find((f) => f.type === 'auth').via, 'ws');
    await relay.waitFor('snapshot', { after: n });
    assert.strictEqual(c.status().transport, 'ws');
  } finally { c.stop(); await relay.close(); }
});

test('announce() re-sends hello when the published set changes', async () => {
  const relay = await startFakeRelay(); let published = PUB;
  const c = connector(relay, { listPublished: () => published }); c.start();
  try {
    await relay.waitFor('hello');
    const n = relay.frames.length;
    published = [...PUB, { localId: 'bbbbbb', name: 'beta', kind: 'spectoflow', stats: null }];
    c.announce();
    const h = await relay.waitFor('hello', { after: n });
    assert.deepStrictEqual(h.projects.map((p) => p.localId), ['aaaaaa', 'bbbbbb']);
  } finally { c.stop(); await relay.close(); }
});
```

- [ ] **Step 4: Run to see them fail**

Run: `node --test test/connector.test.js`
Expected: FAIL — `Cannot find module '../lib/dashboard/connector'`.

- [ ] **Step 5: Write `lib/dashboard/connector.js`**

```js
'use strict';
/*
 * The local hub's outbound connector to an online dashboard (docs/online-dashboard-connector-design.md §2).
 * One connection per machine; JSON frames, identical on both transports:
 *   up:   auth {token,version} · hello {machineName,projects} · event {p,event} · snapshot {p,project} · reply {reqId,result|error} · pong
 *   down: auth-ok {machineId} · op {reqId,p,op,args} · ping
 * Transport 1 is Node's native WebSocket client (zero-dep, Node ≥ 22); transport 2 is HTTP long-poll
 * (POST batches + GET held ≤ 25 s) for hosts that don't pass WebSockets (cPanel/Passenger). The hub
 * decides nothing here: it hands in listPublished/readSnapshot/execOp and tees its emit into
 * pushEvent/pushSnapshot. Reconnection: exponential backoff 1 s → 30 s with jitter; after an upgrade
 * failure or 3 drops in 60 s the connector falls back to HTTP and retries WebSocket every 10 min.
 * The token travels in-band (auth frame / Authorization header) — never in a URL, never logged.
 */
const DEFAULT_TIMING = { backoffMin: 1000, backoffMax: 30000, dropWindow: 60000, dropLimit: 3, wsRetryEvery: 600000, pollTimeout: 35000 };
const REJECTED = 'token rejected by the server — run `spectoflow dashboard login` again';

function createConnector(opts) {
  const { token, machineName, listPublished, readSnapshot, execOp } = opts;
  const version = opts.version || '0.0.0';
  const base = String(opts.url || '').replace(/\/+$/, '');
  const preferred = opts.transport === 'http' ? 'http' : 'ws';
  const timing = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
  const log = opts.log || (() => {});

  const state = { connected: false, lastError: null, machineId: null, attempts: 0, since: null };
  let mode = preferred;          // transport in use ('ws' | 'http'); may fall back to 'http'
  let stopped = true;
  let active = null;             // the live transport: { send(frame), close() }
  let generation = 0;            // bumps on every connect/stop so a stale transport's callbacks are ignored
  const drops = [];
  let reconnectTimer = null, wsRetryTimer = null;

  function status() {
    return { url: base, machineName, connected: state.connected, transport: mode, lastError: state.lastError, machineId: state.machineId, since: state.since };
  }

  // ---- frames ----
  async function handleDownward(frame, send) {
    if (!frame || typeof frame !== 'object') return;
    if (frame.type === 'auth-ok') { state.machineId = frame.machineId || null; onConnected(); return; }
    if (frame.type === 'ping') { send({ type: 'pong' }); return; }
    if (frame.type === 'op') {
      let reply;
      try {
        const result = await execOp(frame.p, frame.op, frame.args || {});
        reply = { type: 'reply', reqId: frame.reqId, result: result === undefined ? {} : result };
      } catch (e) {
        reply = { type: 'reply', reqId: frame.reqId, error: { status: Number(e && e.status) || 500, message: String(e && e.message || e) } };
      }
      send(reply);
    }
  }
  function onConnected() {
    state.connected = true; state.lastError = null; state.attempts = 0; state.since = new Date().toISOString();
    log(`online dashboard: connected to ${base} (${mode})`);
    announce();
  }
  async function announce() {
    const t = active;
    if (!t || !state.connected) return;
    const projects = listPublished();
    t.send({ type: 'hello', machineName, projects });
    for (const p of projects) {
      try { const project = await readSnapshot(p.localId); if (project && t === active) t.send({ type: 'snapshot', p: p.localId, project }); }
      catch (e) { log(`online dashboard: snapshot of ${p.localId} failed: ${e.message}`); }
    }
  }
  function pushEvent(localId, event) { if (active && state.connected) active.send({ type: 'event', p: localId, event }); }
  function pushSnapshot(localId, project) { if (active && state.connected) active.send({ type: 'snapshot', p: localId, project }); }

  // ---- lifecycle ----
  function onDisconnected(gen, err, { upgradeFailed = false } = {}) {
    if (gen !== generation) return;           // a transport we already replaced
    const was = state.connected;
    state.connected = false; active = null;
    if (err) state.lastError = String(err.message || err);
    if (was) log(`online dashboard: disconnected from ${base}${err ? ' — ' + state.lastError : ''}`);
    if (stopped) return;
    if (mode === 'ws' && preferred === 'ws') {
      const now = Date.now();
      drops.push(now); while (drops.length && now - drops[0] > timing.dropWindow) drops.shift();
      if (upgradeFailed || drops.length >= timing.dropLimit) {
        mode = 'http'; drops.length = 0;
        log('online dashboard: WebSocket unavailable, falling back to HTTP long-poll');
        scheduleWsRetry();
      }
    }
    scheduleReconnect();
  }
  function backoff() {
    const exp = Math.min(timing.backoffMax, timing.backoffMin * 2 ** Math.min(state.attempts, 10));
    state.attempts++;
    return Math.round(exp * (0.75 + Math.random() * 0.5));
  }
  function scheduleReconnect() { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, backoff()); }
  function scheduleWsRetry() {
    clearTimeout(wsRetryTimer);
    wsRetryTimer = setTimeout(() => { if (!stopped && mode === 'http') { mode = 'ws'; forceReconnect(); } }, timing.wsRetryEvery);
  }
  function connect() {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    const gen = ++generation;
    active = mode === 'http' ? httpTransport(gen) : wsTransport(gen);
  }
  function start() { if (!stopped) return; stopped = false; mode = preferred; state.attempts = 0; connect(); }
  function stop() {
    stopped = true; generation++;
    clearTimeout(reconnectTimer); clearTimeout(wsRetryTimer);
    const t = active; active = null; state.connected = false;
    if (t) t.close();
  }
  function forceReconnect() {
    if (stopped) return;
    const t = active; generation++; active = null; state.connected = false; state.attempts = 0;
    if (t) t.close();
    connect();
  }

  // ---- transport 1: native WebSocket ----
  function wsTransport(gen) {
    let ws, opened = false, lastErr = null;
    try { ws = new WebSocket(base.replace(/^http/, 'ws') + '/connector/ws'); }
    catch (e) { setImmediate(() => onDisconnected(gen, e, { upgradeFailed: true })); return { send() {}, close() {} }; }
    const send = (frame) => { if (ws.readyState === 1) ws.send(JSON.stringify(frame)); };
    ws.addEventListener('open', () => { opened = true; send({ type: 'auth', token, version }); });
    ws.addEventListener('message', (ev) => { let f; try { f = JSON.parse(String(ev.data)); } catch { return; } handleDownward(f, send); });
    ws.addEventListener('error', (ev) => { lastErr = new Error((ev && ev.message) || 'websocket error'); });
    ws.addEventListener('close', (ev) => {
      const code = ev && ev.code;
      const err = code === 4401 ? new Error(REJECTED) : lastErr || (code && code !== 1000 && code !== 1005 ? new Error(`connection closed (${code}${ev.reason ? ' ' + ev.reason : ''})`) : null);
      onDisconnected(gen, err, { upgradeFailed: !opened });
    });
    return { send, close: () => { try { ws.close(1000); } catch (_) {} } };
  }

  // ---- transport 2: HTTP long-poll (delivered in Task 4) ----
  function httpTransport(gen) {
    setImmediate(() => onDisconnected(gen, new Error('HTTP transport not available')));
    return { send() {}, close() {} };
  }

  return { start, stop, status, announce, pushEvent, pushSnapshot, forceReconnect };
}

module.exports = { createConnector, DEFAULT_TIMING };
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/connector.test.js`
Expected: all 7 PASS. If the "rejected token" test is flaky on the `lastError` regex, check what the native client reports for a 4401 close (`ev.code`) — the `REJECTED` mapping above depends on the close code reaching the `close` event, which it does with undici's client.

- [ ] **Step 7: Run the whole suite once** (`npm test`) — the engines bump changes nothing at runtime, but confirm nothing else regressed. Expected: same pass count as before + 7.

- [ ] **Step 8: Commit**

```bash
git add lib/dashboard/connector.js test/helpers/fake-relay.js test/connector.test.js package.json
git commit -m "feat(connector): outbound WebSocket connector — auth/hello/event/snapshot/reply frames, backoff reconnection; engines >=22"
```

---

### Task 4: HTTP long-poll transport + automatic fallback

**Files:**
- Modify: `lib/dashboard/connector.js` (replace the `httpTransport` stub)
- Test: `test/connector.test.js` (append)

**Interfaces:**
- Consumes: Task 3's connector internals (`handleDownward`, `onDisconnected(gen, err)`, `generation`, `timing.pollTimeout`, `REJECTED`).
- Produces: `transport:'http'` works end to end; WS → HTTP fallback after an upgrade failure; WS retried after `timing.wsRetryEvery`. Endpoints used, exactly as the spec: `POST <url>/connector/frames` (JSON array of upward frames, `Authorization: Bearer <token>`, response = JSON array of downward frames) and `GET <url>/connector/frames` (same header, long-poll, response = JSON array of downward frames).

- [ ] **Step 1: Write the failing tests** (append to `test/connector.test.js`)

```js
test('--transport=http: no upgrade attempted; auth in the first batch → auth-ok → hello; ops round-trip; upward order preserved', async () => {
  const relay = await startFakeRelay({ pollHold: 100 }); const c = connector(relay, { transport: 'http' }); c.start();
  try {
    const hello = await relay.waitFor('hello');
    assert.strictEqual(relay.upgrades, 0);
    assert.strictEqual(hello.via, 'http');
    assert.strictEqual(relay.frames[0].type, 'auth'); assert.strictEqual(relay.frames[0].via, 'http');
    assert.strictEqual(c.status().transport, 'http'); assert.strictEqual(c.status().connected, true);
    relay.send({ type: 'op', reqId: 1, p: 'aaaaaa', op: 'task.add', args: { title: 'via http' } });
    const rep = await relay.waitFor('reply');
    assert.deepStrictEqual(rep.result, { ok: true, p: 'aaaaaa', title: 'via http' });
    const n = relay.frames.length;
    for (let i = 0; i < 5; i++) c.pushEvent('aaaaaa', { type: 'run-line', chunk: String(i) });
    await sleep(300);
    assert.deepStrictEqual(relay.frames.slice(n).filter((f) => f.type === 'event').map((f) => f.event.chunk), ['0', '1', '2', '3', '4']);
    assert.ok(relay.httpPolls >= 1, 'long-poll loop is running');
  } finally { c.stop(); await relay.close(); }
});

test('WebSocket upgrade failure → HTTP fallback → back to WebSocket after wsRetryEvery', async () => {
  const relay = await startFakeRelay({ pollHold: 100 }); relay.rejectUpgrade = true;
  const c = connector(relay); c.start();
  try {
    const hello = await relay.waitFor('hello');
    assert.strictEqual(hello.via, 'http');
    assert.ok(relay.upgrades >= 1);
    assert.strictEqual(c.status().transport, 'http');
    relay.rejectUpgrade = false;
    const n = relay.frames.length;
    const hello2 = await relay.waitFor('hello', { after: n, timeout: 5000 });
    assert.strictEqual(hello2.via, 'ws');
    assert.strictEqual(c.status().transport, 'ws');
  } finally { c.stop(); await relay.close(); }
});

test('an HTTP-mode token rejection is reported and never loops hot', async () => {
  const relay = await startFakeRelay({ pollHold: 50 }); const c = connector(relay, { transport: 'http', token: 'spf_wrong' }); c.start();
  try {
    await sleep(250);
    assert.strictEqual(c.status().connected, false);
    assert.match(String(c.status().lastError), /token/i);
    assert.ok(relay.httpPosts + relay.httpPolls < 20, 'backoff applies (got ' + (relay.httpPosts + relay.httpPolls) + ' requests in 250ms)');
  } finally { c.stop(); await relay.close(); }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/connector.test.js`
Expected: the three new tests FAIL (`no "hello" frame within 5000ms` / transport stays `ws`).

- [ ] **Step 3: Replace the `httpTransport` stub** in `lib/dashboard/connector.js`

```js
  // ---- transport 2: HTTP long-poll ----
  // Upward frames are POSTed in batches, strictly one batch in flight at a time (ordering). Downward
  // frames arrive in the POST responses and through a GET loop the server holds open ≤ 25 s. The first
  // batch carries `auth` so the frame sequence is the same as on WebSocket; the Authorization header is
  // what actually authenticates every request.
  function httpTransport(gen) {
    const ac = new AbortController();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    let queue = [{ type: 'auth', token, version }];
    let flushing = false, closed = false;
    const alive = () => !closed && gen === generation;
    const signal = () => AbortSignal.any([ac.signal, AbortSignal.timeout(timing.pollTimeout)]);
    const fail = (e) => { if (!alive()) return; closed = true; ac.abort(); onDisconnected(gen, e); };
    const check = (res, what) => {
      if (res.status === 401) throw new Error(REJECTED);
      if (!res.ok) throw new Error(`${what} /connector/frames → HTTP ${res.status}`);
      return res.json();
    };
    async function flush() {
      if (flushing) return;
      flushing = true;
      try {
        while (alive() && queue.length) {
          const batch = queue; queue = [];
          const res = await fetch(base + '/connector/frames', { method: 'POST', headers, body: JSON.stringify(batch), signal: signal() });
          const down = await check(res, 'POST');
          for (const f of down) handleDownward(f, send);   // not awaited: a slow op must not stall the batch loop
        }
      } catch (e) { fail(e); } finally { flushing = false; }
    }
    async function poll() {
      try {
        while (alive()) {
          const res = await fetch(base + '/connector/frames', { headers: { Authorization: headers.Authorization }, signal: signal() });
          if (!alive()) return;
          const down = await check(res, 'GET');
          for (const f of down) handleDownward(f, send);   // not awaited: a slow op must not stall the batch loop
        }
      } catch (e) { fail(e); }
    }
    function send(frame) { if (!alive()) return; queue.push(frame); flush(); }
    flush(); poll();
    return { send, close: () => { closed = true; ac.abort(); } };
  }
```

- [ ] **Step 4: Run the connector tests**

Run: `node --test test/connector.test.js`
Expected: all 10 PASS. Watch the fallback test: the first WS attempt fails at upgrade (`opened === false`) → `mode='http'` → `scheduleWsRetry()` (300 ms in tests) → `forceReconnect()` in ws mode → `hello` via ws.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/connector.js test/connector.test.js
git commit -m "feat(connector): HTTP long-poll transport, automatic fallback and WebSocket retry"
```

---

### Task 5: Hub integration — tee `emit`, snapshots, `execOp`, `/api/hub/remote*`, publish endpoint

**Files:**
- Modify: `lib/dashboard/hub-server.js` (requires; `getProject` emit; new helpers; `handleHubApi`; boot)
- Test: `test/hub-remote.test.js`

**Interfaces:**
- Consumes: Task 3/4 `createConnector`; Task 2 `workspace.readRemote/listPublished/setPublished/isPublished`; `ops`/`OpError` from `./ops`; existing `getProject`, `projectStats`, `projectErrorMessage`, `VERSION`.
- Produces (HTTP, local hub):
  - `GET /api/hub/projects` → `{ projects: [{ …registry entry, stats, published }], remote: <remoteStatus> }`
  - `GET /api/hub/remote` → `{ configured, url, machineName, connected, transport, lastError, since }` (`configured:false` and nulls when no `remote.json`)
  - `POST /api/hub/remote/reconnect` → restarts the connector from the current `remote.json` (or stops it when the file is gone) → `{ ok:true, …remoteStatus }`
  - `POST /api/hub/projects/:id/publish` body `{ published: boolean }` → `{ ok:true, id, published }` or 404
  - Frames upward exactly as spec §2: `event` for every `emit` of a published project, `snapshot` 500 ms after a `change`; `execOp` refuses unpublished projects with status 403 and unknown ops with 404.

- [ ] **Step 1: Write the failing tests** (`test/hub-remote.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { startFakeRelay } = require('./helpers/fake-relay');
const workspace = require('../lib/workspace');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const HUB = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');
const J = { 'Content-Type': 'application/json' };

function setup(relay, { remote = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hubremote-'));
  const base = path.join(home, 'dashboard');
  const mk = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `stf-hr-${n}-`)); execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' }); return workspace.registerProject(d, base); };
  const a = mk('a'), b = mk('b');
  workspace.setPublished(a.id, true, base);
  if (remote) workspace.writeRemote({ url: relay.url, token: relay.token, machineName: 'hub-under-test', transport: 'ws' }, base);
  return { home, base, a, b };
}
function startHub(home, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [HUB], { env: { ...process.env, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(srv); });
  });
}
const port = () => 5400 + Math.floor(Math.random() * 100);
const api = (p, path_, init) => fetch(`http://127.0.0.1:${p}${path_}`, init);

test('hub connects at boot (auth, hello with only published projects, snapshot); publish/unpublish re-announce', async () => {
  const relay = await startFakeRelay(); const { home, a, b } = setup(relay); const P = port(); const srv = await startHub(home, P);
  try {
    const hello = await relay.waitFor('hello', { timeout: 15000 });
    assert.strictEqual(relay.frames[0].type, 'auth');
    assert.strictEqual(hello.machineName, 'hub-under-test');
    assert.deepStrictEqual(hello.projects.map((p) => p.localId), [a.id]);
    assert.strictEqual(hello.projects[0].name, a.name);
    assert.strictEqual(typeof hello.projects[0].stats.total, 'number');
    const snap = await relay.waitFor('snapshot', { timeout: 15000 });
    assert.strictEqual(snap.p, a.id); assert.strictEqual(snap.project.projectName, a.name);

    let n = relay.frames.length;
    let r = await api(P, `/api/hub/projects/${b.id}/publish`, { method: 'POST', headers: J, body: JSON.stringify({ published: true }) });
    assert.strictEqual(r.status, 200);
    const h2 = await relay.waitFor('hello', { after: n });
    assert.deepStrictEqual(h2.projects.map((p) => p.localId).sort(), [a.id, b.id].sort());
    const list = await (await api(P, '/api/hub/projects')).json();
    assert.strictEqual(list.projects.find((p) => p.id === b.id).published, true);
    assert.strictEqual(list.remote.configured, true); assert.strictEqual(list.remote.connected, true); assert.strictEqual(list.remote.transport, 'ws');

    n = relay.frames.length;
    r = await api(P, `/api/hub/projects/${b.id}/publish`, { method: 'POST', headers: J, body: JSON.stringify({ published: false }) });
    assert.strictEqual(r.status, 200);
    const h3 = await relay.waitFor('hello', { after: n });
    assert.deepStrictEqual(h3.projects.map((p) => p.localId), [a.id]);
    r = await api(P, '/api/hub/projects/zzzzzz/publish', { method: 'POST', headers: J, body: JSON.stringify({ published: true }) });
    assert.strictEqual(r.status, 404);
  } finally { srv.kill(); await relay.close(); }
});

test('a local mutation is teed as an event then a debounced snapshot; relay ops run through the same project', async () => {
  const relay = await startFakeRelay(); const { home, a, b } = setup(relay); const P = port(); const srv = await startHub(home, P);
  try {
    await relay.waitFor('snapshot', { timeout: 15000 });
    let n = relay.frames.length;
    const r = await api(P, `/api/task?p=${a.id}`, { method: 'POST', headers: J, body: JSON.stringify({ title: 'Local task' }) });
    assert.strictEqual(r.status, 200);
    const ev = await relay.waitFor('event', { after: n });
    assert.strictEqual(ev.p, a.id); assert.strictEqual(ev.event.type, 'change');
    const snap = await relay.waitFor('snapshot', { after: n });
    assert.ok(JSON.stringify(snap.project.plans).includes('Local task'));

    n = relay.frames.length;
    relay.send({ type: 'op', reqId: 42, p: a.id, op: 'task.add', args: { title: 'Remote task' } });
    const rep = await relay.waitFor('reply', { after: n });
    assert.strictEqual(rep.reqId, 42); assert.ok(!rep.error, JSON.stringify(rep.error));
    const proj = await (await api(P, `/api/project?p=${a.id}`)).json();
    assert.ok(JSON.stringify(proj.plans).includes('Remote task'), 'the op wrote through the same project');
    await relay.waitFor('event', { after: n });   // the remote op's own emit is teed back up

    n = relay.frames.length;
    relay.send({ type: 'op', reqId: 43, p: b.id, op: 'task.add', args: { title: 'nope' } });
    const rej = await relay.waitFor('reply', { after: n });
    assert.strictEqual(rej.error.status, 403);
    n = relay.frames.length;
    relay.send({ type: 'op', reqId: 44, p: a.id, op: 'does.not.exist', args: {} });
    const unk = await relay.waitFor('reply', { after: n });
    assert.strictEqual(unk.error.status, 404);
  } finally { srv.kill(); await relay.close(); }
});

test('GET /api/hub/remote reports the connection; POST /api/hub/remote/reconnect re-handshakes', async () => {
  const relay = await startFakeRelay(); const { home } = setup(relay); const P = port(); const srv = await startHub(home, P);
  try {
    await relay.waitFor('hello', { timeout: 15000 });
    const s = await (await api(P, '/api/hub/remote')).json();
    assert.deepStrictEqual({ configured: s.configured, url: s.url, connected: s.connected, transport: s.transport, machineName: s.machineName }, { configured: true, url: relay.url, connected: true, transport: 'ws', machineName: 'hub-under-test' });
    const n = relay.frames.length;
    const r = await api(P, '/api/hub/remote/reconnect', { method: 'POST' });
    assert.strictEqual(r.status, 200);
    const again = await relay.waitFor('hello', { after: n });
    assert.strictEqual(again.via, 'ws');
    assert.strictEqual(relay.frames.slice(n)[0].type, 'auth');
  } finally { srv.kill(); await relay.close(); }
});

test('without remote.json the hub runs exactly as before and /api/hub/remote says configured:false', async () => {
  const relay = await startFakeRelay(); const { home, a } = setup(relay, { remote: false }); const P = port(); const srv = await startHub(home, P);
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(relay.frames.length, 0);
    const s = await (await api(P, '/api/hub/remote')).json();
    assert.strictEqual(s.configured, false); assert.strictEqual(s.connected, false);
    const list = await (await api(P, '/api/hub/projects')).json();
    assert.strictEqual(list.remote.configured, false);
    assert.strictEqual(list.projects.find((p) => p.id === a.id).published, true);
  } finally { srv.kill(); await relay.close(); }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/hub-remote.test.js`
Expected: FAIL — `no "hello" frame within 15000ms` (hub never connects), `/api/hub/remote` 404.

- [ ] **Step 3: Implement in `lib/dashboard/hub-server.js`**

Add the requires after `const store = require('../store');`:

```js
const { createConnector } = require('./connector');
const { ops, OpError } = require('./ops');
```

Add, right after the `projects` Map declaration (before `getProject`):

```js
// ---- online dashboard (C1): the connector role ----
// One outbound connection to the online dashboard named in the workspace's remote.json (written by
// `spectoflow dashboard login`). Only published projects (meta.json → published:true, cached here as
// a Set so a chatty run-line stream never re-reads the file) are announced and relayed. Every project's
// emit is teed: SSE clients first, then the connector — the same emit an op called from the relay
// uses, so a local click and an online click hit one orchestrator, one pending gate, one state.
let connector = null;
let publishedIds = new Set();
function refreshPublished() { publishedIds = new Set(workspace.listPublished().map((p) => p.id)); }
const snapshotTimers = new Map();
function scheduleSnapshot(id) {
  clearTimeout(snapshotTimers.get(id));
  snapshotTimers.set(id, setTimeout(async () => {
    snapshotTimers.delete(id);
    if (!connector || !publishedIds.has(id)) return;
    try { const project = await readSnapshot(id); if (project) connector.pushSnapshot(id, project); } catch (_) {}
  }, 500));
}
async function readSnapshot(id) {
  const proj = getProject(id);
  return proj ? ops['project.read'](proj.root, {}, { emit() {} }) : null;
}
function listPublishedForHello() {
  return workspace.listPublished().map((p) => ({ localId: p.id, name: p.name, kind: p.kind || 'spectoflow', stats: projectStats(p.path) }));
}
async function execOp(localId, op, args) {
  if (!publishedIds.has(localId)) throw new OpError(403, 'This project is not published.');
  const proj = getProject(localId);
  if (!proj) throw new OpError(404, projectErrorMessage(localId));
  if (!Object.prototype.hasOwnProperty.call(ops, op)) throw new OpError(404, `Unknown operation "${op}".`);
  return ops[op](proj.root, args || {}, { emit: proj.emit });
}
function startConnector() {
  if (connector) { connector.stop(); connector = null; }
  refreshPublished();
  const remote = workspace.readRemote();
  if (!remote) return;
  connector = createConnector({
    url: remote.url, token: remote.token, machineName: remote.machineName || os.hostname(), transport: remote.transport, version: VERSION,
    listPublished: listPublishedForHello, readSnapshot, execOp, log: (m) => console.log(`spectoflow · ${m}`),
  });
  connector.start();
}
function remoteStatus() {
  const remote = workspace.readRemote();
  if (!remote) return { configured: false, url: null, machineName: null, connected: false, transport: null, lastError: null, since: null };
  const s = connector ? connector.status() : { connected: false, transport: remote.transport, lastError: null, since: null };
  return { configured: true, url: remote.url, machineName: remote.machineName, connected: s.connected, transport: s.transport, lastError: s.lastError, since: s.since };
}
```

In `getProject`, replace the `emit` line with:

```js
  const emit = (obj) => {
    const line = 'data: ' + JSON.stringify(obj) + '\n\n';
    for (const res of clients) res.write(line);
    if (connector && publishedIds.has(id)) { connector.pushEvent(id, obj); if (obj.type === 'change') scheduleSnapshot(id); }
  };
```

`listHubProjects` becomes:

```js
function listHubProjects() {
  return registry.listProjects().map((p) => ({ ...p, stats: projectStats(p.path), published: publishedIds.has(p.id) }));
}
```

In `handleHubApi`: the `GET /api/hub/projects` line becomes `sendJSON(res, 200, { projects: listHubProjects(), remote: remoteStatus() })`; in the `DELETE` branch add `if (ok) { refreshPublished(); if (connector) connector.announce(); }` before `sendJSON`; and add these three blocks before `return false;`:

```js
  if (p === '/api/hub/remote' && req.method === 'GET') { sendJSON(res, 200, remoteStatus()); return true; }
  if (p === '/api/hub/remote/reconnect' && req.method === 'POST') { startConnector(); sendJSON(res, 200, { ok: true, ...remoteStatus() }); return true; }
  if (/^\/api\/hub\/projects\/[^/]+\/publish$/.test(p) && req.method === 'POST') {
    const id = decodeURIComponent(p.split('/')[4] || '');
    const { published } = await body(req);
    const meta = workspace.setPublished(id, published !== false);
    if (!meta) { sendJSON(res, 404, { error: 'No project registered with that id.' }); return true; }
    refreshPublished();
    if (connector) connector.announce();
    sendJSON(res, 200, { ok: true, id, published: meta.published });
    return true;
  }
```

Boot: the last line becomes

```js
server.listen(PORT, () => { writeLock(); console.log(`spectoflow · hub → http://localhost:${PORT}${migrated.movedRegistry ? '  (moved your project list into the workspace)' : ''}`); startConnector(); });
```

and the signal handler stops it: `['SIGINT','SIGTERM'].forEach((s)=> process.on(s, ()=>{ if (connector) connector.stop(); clearLock(); process.exit(0); }));`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/hub-remote.test.js test/hub-server.test.js`
Expected: PASS (4 new + the existing hub tests unchanged). The "without remote.json" test is the regression guard for every existing user: no `remote.json` → no connector, no frames.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/hub-server.js test/hub-remote.test.js
git commit -m "feat(hub): connector role — tee emit, debounced snapshots, op execution, /api/hub/remote*, publish endpoint"
```

---

### Task 6: CLI — `dashboard login/logout/publish/unpublish`, remote `status`, no more "later release"

**Files:**
- Modify: `bin/spectoflow.js` (requires; `REMOTE_NOTE`/`resolveDashboardUrl`; `dashboard()` dispatcher; new functions; `startDashboard`; `dashboardStatus`; help + `HELP.dashboard`)
- Modify: `test/cli-dashboard-init.test.js:35-46` (two tests whose expectations change)
- Test: `test/cli-remote.test.js`

**Interfaces:**
- Consumes: Task 2 workspace functions; Task 5 hub endpoints; existing `flag()`, `probeDashboard()`, `resolvePort()`, `workspace.readLock()`, `registry.findByPath()`, `globalConfig.set/get`, `c`.
- Produces: `spectoflow dashboard login --url=<u> --token=<t> [--name=<m>] [--transport=ws|http]`, `dashboard logout`, `dashboard publish [--id=<id>]`, `dashboard unpublish [--id=<id>]`; `dashboard status` prints an "online" line; `spectoflow dashboard` prints the online URL. Exit code 1 + a `!` line on every user error. The token is never printed.

- [ ] **Step 1: Write the failing tests** (`test/cli-remote.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { startFakeRelay } = require('./helpers/fake-relay');
const workspace = require('../lib/workspace');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-remote-'));
const run = (h, args, opts = {}) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: h }, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const remoteFile = (h) => path.join(h, 'dashboard', 'remote.json');

test('login validates the token against /connector/whoami, writes remote.json (0600) and dashboard.url, never echoes the token', async () => {
  const relay = await startFakeRelay(); const h = home();
  try {
    const r = run(h, ['dashboard', 'login', `--url=${relay.url}/`, `--token=${relay.token}`, '--name=my-laptop']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /logged in/i);
    assert.ok(!r.stdout.includes(relay.token));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(remoteFile(h), 'utf8')), { url: relay.url, token: relay.token, machineName: 'my-laptop', transport: 'ws' });
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(remoteFile(h)).mode & 0o777, 0o600);
    assert.strictEqual(run(h, ['config', 'get', 'dashboard.url']).stdout.trim(), relay.url);
  } finally { await relay.close(); }
});

test('login: a rejected token exits 1 and writes nothing; --name defaults to the hostname; --transport=http is stored', async () => {
  const relay = await startFakeRelay(); const h = home();
  try {
    const bad = run(h, ['dashboard', 'login', `--url=${relay.url}`, '--token=spf_wrong']);
    assert.strictEqual(bad.status, 1); assert.match(bad.stdout, /rejected/i); assert.ok(!fs.existsSync(remoteFile(h)));
    const ok = run(h, ['dashboard', 'login', `--url=${relay.url}`, `--token=${relay.token}`, '--transport=http']);
    assert.strictEqual(ok.status, 0, ok.stdout);
    const w = JSON.parse(fs.readFileSync(remoteFile(h), 'utf8'));
    assert.strictEqual(w.transport, 'http'); assert.strictEqual(w.machineName, os.hostname());
    const weird = run(h, ['dashboard', 'login', `--url=${relay.url}`, `--token=${relay.token}`, '--transport=carrier-pigeon']);
    assert.strictEqual(weird.status, 1); assert.match(weird.stdout, /ws or http/);
  } finally { await relay.close(); }
});

test('login without --url/--token prints usage and exits 1; an unreachable server is a clean error', () => {
  const h = home();
  const r = run(h, ['dashboard', 'login']);
  assert.strictEqual(r.status, 1); assert.match(r.stdout, /Usage: spectoflow dashboard login/);
  const down = run(h, ['dashboard', 'login', '--url=http://127.0.0.1:9', '--token=spf_x']);
  assert.strictEqual(down.status, 1); assert.match(down.stdout, /could not reach/i); assert.ok(!/at .*\.js:\d+/.test(down.stderr), 'no stack trace');
});

test('logout removes remote.json and resets dashboard.url to the local default', async () => {
  const relay = await startFakeRelay(); const h = home();
  try {
    run(h, ['dashboard', 'login', `--url=${relay.url}`, `--token=${relay.token}`]);
    const r = run(h, ['dashboard', 'logout']);
    assert.strictEqual(r.status, 0); assert.match(r.stdout, /logged out/i);
    assert.ok(!fs.existsSync(remoteFile(h)));
    assert.strictEqual(run(h, ['config', 'get', 'dashboard.url']).stdout.trim(), 'http://localhost:4319');
    assert.match(run(h, ['dashboard', 'logout']).stdout, /not logged in/i);
  } finally { await relay.close(); }
});

test('publish/unpublish flip the flag in meta.json — by cwd, and by --id', () => {
  const h = home(); const base = path.join(h, 'dashboard');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-pub-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const entry = workspace.registerProject(d, base);
  let r = run(h, ['dashboard', 'publish'], { cwd: d });
  assert.strictEqual(r.status, 0, r.stdout); assert.match(r.stdout, /published/); assert.match(r.stdout, /not logged in/i);
  assert.strictEqual(workspace.isPublished(entry.id, base), true);
  r = run(h, ['dashboard', 'unpublish', `--id=${entry.id}`]);
  assert.strictEqual(r.status, 0); assert.strictEqual(workspace.isPublished(entry.id, base), false);
  r = run(h, ['dashboard', 'publish', '--id=zzzzzz']);
  assert.strictEqual(r.status, 1); assert.match(r.stdout, /no project registered/i);
  const stranger = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-unreg-'));
  r = run(h, ['dashboard', 'publish'], { cwd: stranger });
  assert.strictEqual(r.status, 1); assert.match(r.stdout, /spectoflow dashboard/);
});

test('status prints the online line once logged in (hub not running here)', async () => {
  const relay = await startFakeRelay(); const h = home();
  try {
    run(h, ['dashboard', 'login', `--url=${relay.url}`, `--token=${relay.token}`]);
    const r = run(h, ['dashboard', 'status']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /hub not running/);
    assert.match(r.stdout, new RegExp('online → ' + relay.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(!r.stdout.includes('later release'));
  } finally { await relay.close(); }
});
```

And in `test/cli-dashboard-init.test.js` replace the two tests at lines 35–46 with:

```js
test('spectoflow dashboard --url=<remote> stores it and no longer claims remote dashboards are unsupported', () => {
  const h = home();
  const out = run(h, ['dashboard', 'status', '--url=https://dashboard.example.com'], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(!/later release/i.test(out));
  assert.match(out, /not logged in/i);   // a remote URL without a login → the hint to run `dashboard login`
  assert.strictEqual(run(h, ['config', 'get', 'dashboard.url']).trim(), 'https://dashboard.example.com');
});

test('dashboard login without arguments prints usage and exits 1', () => {
  const r = spawnSync('node', [BIN, 'dashboard', 'login'], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: home() } });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /Usage: spectoflow dashboard login/);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/cli-remote.test.js test/cli-dashboard-init.test.js`
Expected: the new/changed tests FAIL (`login` prints the "later release" note and exits 0; `logout`/`publish` fall through to `startDashboard()`).

- [ ] **Step 3: Implement in `bin/spectoflow.js`**

Add `const os = require('os');` next to the other core requires (line 5 area).

Delete the `REMOTE_NOTE` constant (line 215) and, in `resolveDashboardUrl()`, delete the line `if (!isLocalUrl(url)) console.log(\`${c.y('!')} ${REMOTE_NOTE}\`);` — keep `isLocalUrl` (used below).

Replace the `dashboard()` dispatcher:

```js
async function dashboard() {
  const sub = argv[1];
  if (sub === 'init') return dashboardInit();
  if (sub === 'login') return dashboardLogin();
  if (sub === 'logout') return dashboardLogout();
  if (sub === 'publish') return dashboardPublish(true);
  if (sub === 'unpublish') return dashboardPublish(false);
  if (sub === 'stop') return stopDashboard();
  if (sub === 'status') return dashboardStatus();
  if (sub === 'restart') return restartDashboard();
  if (sub === 'create') return runCustomize('dashboard');
  if (sub === 'validate') return validateDashboardFile(argv[2]);
  return startDashboard();
}
```

Add, right after `dashboard()`:

```js
// ---- online dashboard (C1): login / logout / publish / unpublish ----
// The machine token authenticates this machine to a hosted dashboard (server/). `login` checks it
// against POST /connector/whoami, stores it in the workspace's remote.json (0600) and points
// dashboard.url at the server; the hub — running or next started — opens the outbound connection.
async function fetchJSON(url, init = {}, timeoutMs = 10000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}
// Best-effort call on the running local hub; null when no hub is up (the caller says "next start will").
async function hubCall(pathname, payload) {
  const info = workspace.readLock();
  if (!info || !info.port || !(await probeDashboard(info.port))) return null;
  try { return await fetchJSON(`http://localhost:${info.port}${pathname}`, payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
  catch { return null; }
}
function fail(msg) { console.log(`${c.y('!')} ${msg}`); process.exitCode = 1; }
async function dashboardLogin() {
  const url = flag('url'), token = flag('token'), transport = flag('transport') || 'ws';
  if (!url || !token) { console.log(`Usage: spectoflow dashboard login --url=<https://…> --token=<spf_…> ${c.dim('[--name=<machine name>] [--transport=ws|http]')}`); process.exitCode = 1; return; }
  let base;
  try { base = new URL(url); if (!/^https?:$/.test(base.protocol)) throw new Error(); } catch { return fail('--url must be an http(s) URL, e.g. https://dashboard.example.com'); }
  if (!['ws', 'http'].includes(transport)) return fail('--transport must be ws or http');
  const clean = base.toString().replace(/\/+$/, '');
  let who;
  try { who = await fetchJSON(`${clean}/connector/whoami`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); }
  catch (e) { return fail(`could not reach ${clean} (${e.cause && e.cause.code ? e.cause.code : e.name === 'TimeoutError' ? 'timeout' : e.message})`); }
  if (who.status === 401) return fail(`${clean} rejected this token — create one on the server: node cli.js token create --name="${os.hostname()}"`);
  if (!who.ok) return fail(`${clean} answered HTTP ${who.status} — is that the spectoflow server?`);
  const machineName = flag('name') || os.hostname();
  workspace.migrateLegacyHome(); if (!workspace.exists()) workspace.init({});
  workspace.writeRemote({ url: clean, token, machineName, transport });
  globalConfig.set('dashboard.url', clean);
  console.log(`${c.g('✓')} logged in to ${c.bold(clean)} as ${c.bold(machineName)} ${c.dim(`(machine ${who.data.machineId || '?'}, ${transport})`)}`);
  const r = await hubCall('/api/hub/remote/reconnect', {});
  console.log(`  ${c.dim(r ? 'the running hub is connecting now' : 'the next `spectoflow dashboard` will connect')}`);
  console.log(`  publish a project from inside it:  ${c.g('spectoflow dashboard publish')}`);
}
async function dashboardLogout() {
  const had = workspace.clearRemote();
  globalConfig.set('dashboard.url', `http://localhost:${resolvePort(argv)}`);
  await hubCall('/api/hub/remote/reconnect', {});
  console.log(had ? `${c.g('✓')} logged out — this machine no longer connects to an online dashboard` : `${c.dim('○')} not logged in to any online dashboard`);
}
async function dashboardPublish(published) {
  let id = flag('id');
  if (!id) {
    const entry = registry.findByPath(process.cwd());
    if (!entry) return fail(`this folder isn't registered in the dashboard yet — run ${c.g('spectoflow dashboard')} here first, or pass --id=<id> (see ${c.g('spectoflow projects')})`);
    id = entry.id;
  }
  const meta = workspace.setPublished(id, published);
  if (!meta) return fail(`no project registered with id ${id}`);
  await hubCall(`/api/hub/projects/${encodeURIComponent(id)}/publish`, { published });
  if (!published) return console.log(`${c.g('✓')} ${id} is no longer published`);
  console.log(`${c.g('✓')} ${id} is published`);
  const remote = workspace.readRemote();
  if (remote) console.log(`  online: ${c.bold(remote.url)}`);
  else console.log(`  ${c.dim('not logged in yet —')} ${c.g('spectoflow dashboard login --url=… --token=…')}`);
}
// The one-line "online" status under the local one — used by `dashboard` and `dashboard status`.
async function printOnlineLine(port, running) {
  const remote = workspace.readRemote();
  if (remote) {
    let s = null;
    if (running) { try { s = (await fetchJSON(`http://localhost:${port}/api/hub/remote`)).data; } catch {} }
    if (s && s.connected) return console.log(`${c.g('●')} online → ${c.bold(remote.url)} ${c.dim(`(connected via ${s.transport}, machine "${remote.machineName}")`)}`);
    const why = !running ? 'hub not running' : s && s.lastError ? `not connected: ${s.lastError}` : 'connecting…';
    return console.log(`${c.dim('○')} online → ${c.bold(remote.url)} ${c.dim(`(${why})`)}`);
  }
  const url = globalConfig.get('dashboard.url').value;
  if (!isLocalUrl(url)) console.log(`${c.dim('○')} online → ${url} ${c.dim('— not logged in:')} ${c.g('spectoflow dashboard login --url=… --token=…')}`);
}
```

In `startDashboard()`: after `console.log(\`${c.g('●')} hub already running → …\`)` insert `await printOnlineLine(info.port, true);` (before `return printDashboardCommands();`), and after the `if (up) … else …` block insert `await printOnlineLine(port, up);`.

`dashboardStatus()` becomes:

```js
async function dashboardStatus() {
  if (!(await resolveDashboardUrl())) return;
  const info = workspace.readLock();
  const port = (info && info.port) || resolvePort(argv);
  const running = await probeDashboard(port);
  if (running) console.log(`${c.g('●')} hub running → ${c.bold('http://localhost:' + port)}${info && info.pid ? c.dim(' (pid ' + info.pid + ')') : ''}`);
  else console.log(`${c.dim('○')} hub not running`);
  await printOnlineLine(port, running);
}
```

Help: in the global help's Dashboard group replace the `dashboard login` line with:

```
  ${c.g('dashboard login')} ${c.dim('--url=<u> --token=<t>')}  connect this machine to an online dashboard ${c.dim('(logout · publish · unpublish)')}
```

and in `HELP.dashboard` replace the subcommand list header and the `login` line with:

```
  dashboard: `${c.bold('spectoflow dashboard')} ${c.dim('[--port=NNNN] [--url=<u>] [init|status|stop|restart|create|validate|login|logout|publish|unpublish]')}\n
  …(unchanged text)…
    ${c.g('login')}     connect this machine to an online dashboard: ${c.dim('--url=<https://…> --token=<spf_…> [--name=<machine>] [--transport=ws|http]')}
    ${c.g('logout')}    forget it (remote.json removed, dashboard.url back to local)
    ${c.g('publish')}   make the current project (or ${c.dim('--id=<id>')}) visible online — nothing is published by default
    ${c.g('unpublish')} take it back offline`,
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/cli-remote.test.js test/cli-dashboard-init.test.js test/cli-config.test.js`
Expected: PASS. The `stdio` for `login` tests is `['ignore', 'pipe', 'pipe']` so `resolveDashboardUrl` — not called by `login` anyway — never prompts.

- [ ] **Step 5: Commit**

```bash
git add bin/spectoflow.js test/cli-remote.test.js test/cli-dashboard-init.test.js
git commit -m "feat(cli): dashboard login/logout/publish/unpublish, online status line, remote URLs no longer 'a later release'"
```

---

### Task 7: Front-end — offline read-only state, remote-mode hub page, local "Online" toggle

**Files:**
- Modify: `lib/dashboard/public/index.html:73` (offline bar after `</header>`)
- Modify: `lib/dashboard/public/app.js` (fetch guard, `setOffline`, `load()`, `updateChatBusyUI()`)
- Modify: `lib/dashboard/public/i18n.js` (2 keys × 6 languages)
- Modify: `lib/dashboard/public/styles.css` (append)
- Modify: `lib/dashboard/public/hub.html:37` (id on the empty-state subtitle)
- Modify: `lib/dashboard/public/hub.js` (`loadProjects`, click handler)
- Test: `test/public-remote-ui.test.js`

**Interfaces:**
- Consumes: relay responses (Task 11): `GET /api/project?p=` may carry `online:false` + `lastSeen` (ISO); `GET /api/hub/projects` online returns `{ mode:'remote', projects:[{ id, name, kind, machine, online, lastSeen, stats, lastOpened }] }`; local hub (Task 5) returns `{ projects:[{ …, published }], remote:{ configured, … } }` and `POST /api/hub/projects/:id/publish`.
- Produces: `body.is-offline`, `#offlineBar`, i18n keys `offline.banner` (`{name}`, `{when}`) and `offline.readonly`; `body.hub-remote`; `.hub-card-online[data-publish]` toggle.

- [ ] **Step 1: Write the failing drift-guard test** (`test/public-remote-ui.test.js` — the client is verified by real-browser QA in Task 12; this test pins the contract pieces the server and hub rely on)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PUB = path.resolve(__dirname, '..', 'lib', 'dashboard', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

test('i18n: the two offline keys exist in all 6 languages', () => {
  const src = read('i18n.js');
  for (const key of ['offline.banner', 'offline.readonly']) {
    const n = (src.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || []).length;
    assert.strictEqual(n, 6, `${key} must be defined 6 times (en/fr/es/de/pt/it), found ${n}`);
  }
  assert.ok(/'offline\.banner':'[^']*\{name\}[^']*\{when\}/.test(src), 'en banner uses {name} and {when}');
});

test('app.js: offline state = body.is-offline + a 503 guard on mutating /api calls; index.html has the bar', () => {
  const app = read('app.js');
  assert.ok(app.includes("classList.toggle('is-offline'"), 'body.is-offline toggled');
  assert.ok(app.includes('online===false') || app.includes('online === false'), 'reads online:false');
  assert.ok(/status:\s*503/.test(app), 'mutations short-circuit to 503 while offline');
  assert.ok(read('index.html').includes('id="offlineBar"'));
  assert.ok(read('styles.css').includes('.offline-bar'));
});

test('hub.js: remote mode hides add/remove and shows the machine; local mode has the Online toggle', () => {
  const hub = read('hub.js');
  assert.ok(hub.includes("data.mode === 'remote'"));
  assert.ok(hub.includes('data-publish='));
  assert.ok(hub.includes('/publish'));
  const css = read('styles.css');
  assert.ok(css.includes('.hub-body.hub-remote'));
  const appended = css.slice(css.indexOf('online dashboard'));
  assert.ok(!/gradient\(/.test(appended), 'no gradients in the new rules');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test test/public-remote-ui.test.js`
Expected: FAIL on every assertion.

- [ ] **Step 3: `index.html`** — insert after line 73 (`</header>`):

```html
  <div class="offline-bar" id="offlineBar" hidden><span class="offline-dot"></span><span id="offlineText"></span></div>
```

- [ ] **Step 4: `i18n.js`** — add to each language block (right after its `'topbar.theme.toggle.title'` line):

```js
// en
  'offline.banner':'{name} is offline — last seen {when}. Read-only until its machine reconnects.','offline.readonly':'This project is offline (read-only).',
// fr
  'offline.banner':'{name} est hors ligne — vu pour la dernière fois {when}. Lecture seule jusqu’au retour de sa machine.','offline.readonly':'Ce projet est hors ligne (lecture seule).',
// es
  'offline.banner':'{name} está sin conexión — visto por última vez {when}. Solo lectura hasta que su máquina vuelva.','offline.readonly':'Este proyecto está sin conexión (solo lectura).',
// de
  'offline.banner':'{name} ist offline — zuletzt gesehen {when}. Nur Lesen, bis der Rechner wieder verbunden ist.','offline.readonly':'Dieses Projekt ist offline (nur Lesen).',
// pt
  'offline.banner':'{name} está offline — visto pela última vez {when}. Somente leitura até a máquina voltar.','offline.readonly':'Este projeto está offline (somente leitura).',
// it
  'offline.banner':'{name} è offline — visto l’ultima volta {when}. Sola lettura finché la macchina non torna.','offline.readonly':'Questo progetto è offline (sola lettura).',
```

- [ ] **Step 5: `app.js`** — insert right after `function pathSegments() { … }` (line 32):

```js
// ---- online dashboard (C1): offline, read-only state ----
// Served by the relay while a project's machine is away, /api/project carries online:false + lastSeen.
// One guard on fetch() short-circuits every mutating /api call to a 503 (instead of touching ~40 call
// sites); the banner says why; the busy state (updateChatBusyUI) disables the run/orchestrate buttons.
// The local hub never sends online:false, so none of this ever triggers locally.
let OFFLINE=false;
const _fetch=window.fetch.bind(window);
window.fetch=(url,opts)=>{
  const method=((opts&&opts.method)||'GET').toUpperCase();
  if(OFFLINE&&method!=='GET'&&String(url).startsWith('/api/')) return Promise.resolve(new Response(JSON.stringify({error:t('offline.readonly')}),{status:503,headers:{'Content-Type':'application/json'}}));
  return _fetch(url,opts);
};
function setOffline(p){
  OFFLINE=p.online===false;
  document.body.classList.toggle('is-offline',OFFLINE);
  const bar=$('#offlineBar'); if(!bar) return;
  bar.hidden=!OFFLINE;
  if(OFFLINE){ const when=p.lastSeen?new Date(p.lastSeen).toLocaleString():'—'; $('#offlineText').textContent=t('offline.banner',{name:p.projectName||'project',when}); }
  updateChatBusyUI();
}
```

`load()` becomes:

```js
async function load(){
  const r = await fetch(withProject('/api/project')); P = await r.json(); render(); setOffline(P);
  if(openTaskId) openDrawer(openTaskId,true);
}
```

In `updateChatBusyUI()` the `busy` line becomes `const busy=sseBusy||orchStatus==='running'||OFFLINE;`.

- [ ] **Step 6: `styles.css`** — append at the end:

```css
/* ---- online dashboard (C1): offline read-only state + remote-mode hub page. No gradients. ---- */
.offline-bar { display:flex; align-items:center; gap:8px; padding:7px 16px; background:var(--surface-2); border-bottom:1px solid var(--line); color:var(--ink); font-size:12.5px; }
.offline-bar[hidden] { display:none; }
.offline-dot { width:8px; height:8px; border-radius:50%; background:var(--s-blocked); flex-shrink:0; }
body.is-offline .btn.primary, body.is-offline .wf-step2, body.is-offline .wf-mini { opacity:.55; pointer-events:none; }
.hub-body.hub-remote #hubAddBtn, .hub-body.hub-remote #hubAddBtnEmpty, .hub-body.hub-remote .hub-card-remove { display:none !important; }
.hub-card-machine { display:inline-flex; align-items:center; gap:6px; }
.hub-dot { width:7px; height:7px; border-radius:50%; background:var(--s-blocked); display:inline-block; flex-shrink:0; }
.hub-dot.is-on { background:var(--s-done); }
.hub-card-online { position:absolute; top:8px; right:36px; height:22px; padding:0 9px; border-radius:999px; border:1px solid var(--line); background:var(--surface-2); color:var(--muted); font-size:11px; line-height:20px; cursor:pointer; opacity:.75; }
.hub-card:hover .hub-card-online, .hub-card-online:focus-visible { opacity:1; }
.hub-card-online.is-on { color:var(--s-done); border-color:var(--s-done); opacity:1; }
.hub-body.hub-remote .hub-card-online { display:none; }
```

- [ ] **Step 7: `hub.html`** — line 37 becomes `<p class="hub-empty-sub" id="hubEmptySub">Add your first project to get started — point spectoflow at any folder on your computer.</p>`.

- [ ] **Step 8: `hub.js`** — `loadProjects()` becomes:

```js
  async function loadProjects() {
    const r = await fetch('/api/hub/projects');
    const data = await r.json();
    const rows = data.projects || [];
    const remote = data.mode === 'remote';                       // served by the online relay: read-only list
    const canPublish = !remote && !!(data.remote && data.remote.configured);   // local hub logged in to one
    document.body.classList.toggle('hub-remote', remote);
    empty.hidden = rows.length > 0;
    if (subtitle) {
      subtitle.textContent = rows.length
        ? `${rows.length} project${rows.length === 1 ? '' : 's'} · click a card to open its board`
        : remote ? 'Nothing published yet.' : 'One dashboard, every project — pick one to open its board.';
    }
    const emptySub = document.getElementById('hubEmptySub');
    if (emptySub && remote) emptySub.textContent = 'On a machine: spectoflow dashboard login --url=… --token=…, then spectoflow dashboard publish inside a project.';
    grid.innerHTML = rows.map((p) => {
      const pct = p.stats && p.stats.total ? Math.round(100 * p.stats.done / p.stats.total) : null;
      const stage = pct === null ? 'new' : pct >= 100 ? 'done' : pct > 0 ? 'active' : 'new';
      const stageLabel = { new: 'New', active: 'In progress', done: 'Done' }[stage];
      const where = remote
        ? `<span class="hub-card-machine"><i class="hub-dot${p.online ? ' is-on' : ''}"></i>${esc(p.machine || 'machine')}${p.online ? '' : ' · offline'}</span>`
        : esc(p.path);
      const meta = remote ? `Updated ${esc(timeAgo(p.lastOpened))}` : `Opened ${esc(timeAgo(p.lastOpened))}`;
      const online = canPublish
        ? `<button class="hub-card-online${p.published ? ' is-on' : ''}" data-publish="${p.id}" data-published="${p.published ? '1' : '0'}" title="${p.published ? 'Published to your online dashboard — click to unpublish' : 'Publish to your online dashboard'}">${p.published ? '● Online' : '○ Online'}</button>`
        : '';
      return `<div class="hub-card" data-id="${p.id}">
        <a class="hub-card-open" href="/p/${p.id}/board">
          <div class="hub-card-top">
            <div class="hub-card-name">${esc(p.name)}</div>
            <span class="hub-card-stage is-${stage}">${stageLabel}</span>
          </div>
          <div class="hub-card-path">${where}</div>
          <div class="hub-card-progress"><div class="hub-card-progress-fill" style="width:${pct ?? 0}%"></div></div>
          <div class="hub-card-foot">
            <span class="hub-card-pct">${pct !== null ? `${pct}% · ${p.stats.done}/${p.stats.total} tasks` : 'No tasks yet'}</span>
            <span class="hub-card-meta">${meta}</span>
          </div>
        </a>
        ${online}
        ${remote ? '' : `<button class="hub-card-remove" data-remove="${p.id}" title="Remove from this list" aria-label="Remove ${esc(p.name)}">&times;</button>`}
      </div>`;
    }).join('');
  }
```

and the grid click handler gains the publish branch at its top:

```js
  grid.addEventListener('click', async (e) => {
    const pub = e.target.closest('[data-publish]');
    if (pub) {
      e.preventDefault();
      const id = pub.getAttribute('data-publish');
      const published = pub.getAttribute('data-published') !== '1';
      pub.disabled = true;
      await fetch('/api/hub/projects/' + encodeURIComponent(id) + '/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published }) });
      loadProjects();
      return;
    }
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    // …unchanged…
```

- [ ] **Step 9: Run the tests + a local smoke check**

Run: `node --test test/public-remote-ui.test.js test/hub-server.test.js`
Expected: PASS. Then start the hub on a scratch `SPECTOFLOW_HOME` (`SPECTOFLOW_HOME=<tmp> SPECTOFLOW_PORT=4399 node lib/dashboard/hub-server.js`), open `http://localhost:4399/` — the page must look exactly as before (no remote → no toggle, no banner), and a project board must open with no console error (the fetch wrapper runs on every page load).

- [ ] **Step 10: Commit**

```bash
git add lib/dashboard/public/index.html lib/dashboard/public/app.js lib/dashboard/public/i18n.js lib/dashboard/public/styles.css lib/dashboard/public/hub.html lib/dashboard/public/hub.js test/public-remote-ui.test.js
git commit -m "feat(ui): offline read-only state, remote-mode hub page, Online toggle on local project cards"
```

---

### Task 8: `server/` scaffold — package, Knex config, migrations, `db.js`, `cli.js`

**Files:**
- Create: `server/package.json`, `server/knexfile.js`
- Create: `server/migrations/0001_machines.js`, `server/migrations/0002_projects.js`
- Create: `server/src/db.js`, `server/cli.js`
- Create: `server/.gitignore`
- Test: `server/test/db.test.js`, `server/test/cli.test.js`
- Modify: `package.json:41-44` (root `test` script scoped to `test/` so it never picks up `server/test`)
- Modify: `.gitignore` root (harmless note — `server/node_modules` is already covered by the existing blanket `node_modules/` rule; no change needed, verified in Step 0)

**Interfaces:**
- Consumes: nothing from `spectoflow`. This is the first server task — it stands alone.
- Produces: `server/src/db.js` → `createDb(databaseUrl) → Promise<Db>` where `Db` is
  `{ knex, migrate(), createMachine(name)→{id,name,token}, machineByToken(token)→{id,name,revoked_at}|null, touchMachine(id), listMachines(), revokeMachine(id)→boolean,
    upsertProject({machineId,localId,name,kind})→{id,...}, setPublished(serverId,bool), findProject(serverId)→row|null, findByMachineLocal(machineId,localId)→row|null,
    listPublishedByMachine(machineId)→rows, saveSnapshot(serverId,snapshotObj), listPublic()→rows (published, any machine), destroy() }`.
  `server/knexfile.js` exports `fromUrl(databaseUrl) → knexConfig` (client `better-sqlite3`/`mysql2`/`pg` picked from the URL scheme) and the Knex `migrations` dir config.
  `server/cli.js` — `node cli.js migrate`, `node cli.js token create --name=<n>` (prints the plaintext token once), `token list`, `token revoke <id>`.

- [ ] **Step 0: verify `.gitignore` already covers `server/node_modules`**

Run: `git check-ignore -v server/node_modules/x 2>/dev/null || echo "not ignored"`. The root `.gitignore`'s bare `node_modules/` line matches at any depth, so this should print the matching rule, not "not ignored". If it prints "not ignored", add a `server/node_modules/` line to the root `.gitignore` before continuing.

- [ ] **Step 1: `server/package.json`**

```json
{
  "name": "spectoflow-server",
  "version": "0.1.0",
  "private": true,
  "description": "Hosted relay for spectoflow's online dashboard (sub-project C1) — not published, deployed alongside a checkout of the spectoflow repo.",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "migrate": "node cli.js migrate",
    "test": "node --test test/"
  },
  "engines": { "node": ">=22" },
  "dependencies": {
    "fastify": "^5.1.0",
    "@fastify/websocket": "^11.0.2",
    "@fastify/cookie": "^11.0.2",
    "@fastify/rate-limit": "^10.2.1",
    "@fastify/static": "^8.0.3",
    "knex": "^3.1.0",
    "mysql2": "^3.11.4",
    "better-sqlite3": "^11.5.0",
    "pg": "^8.13.1"
  }
}
```

- [ ] **Step 2: `server/knexfile.js`**

```js
'use strict';
/*
 * DATABASE_URL → Knex config. MySQL is the default deployment target (spec decision); SQLite is what
 * the test suite and local dev use (file or :memory:); PostgreSQL is the third supported driver.
 * Recognized schemes: mysql://…, postgres:// (or postgresql://), sqlite:<path-or-:memory:>.
 */
const path = require('path');

function fromUrl(databaseUrl) {
  const url = databaseUrl || 'mysql://spectoflow:spectoflow@localhost/spectoflow';
  const migrations = { directory: path.join(__dirname, 'migrations') };
  if (url.startsWith('sqlite:')) {
    const file = url.slice('sqlite:'.length);
    return { client: 'better-sqlite3', useNullAsDefault: true, connection: file === ':memory:' ? ':memory:' : { filename: file }, pool: { min: 1, max: 1 }, migrations };
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return { client: 'pg', connection: url, migrations };
  if (url.startsWith('mysql://')) return { client: 'mysql2', connection: url, migrations };
  throw new Error(`Unrecognized DATABASE_URL scheme: "${url}" (expected mysql://, postgres:// or sqlite:)`);
}

module.exports = { fromUrl };
```

- [ ] **Step 3: migrations**

`server/migrations/0001_machines.js`:

```js
'use strict';
exports.up = (knex) => knex.schema.createTable('machines', (t) => {
  t.string('id', 20).primary();
  t.string('name', 100).notNullable();
  t.string('token_hash', 64).notNullable().unique();
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('last_seen').nullable();
  t.timestamp('revoked_at').nullable();
});
exports.down = (knex) => knex.schema.dropTableIfExists('machines');
```

`server/migrations/0002_projects.js`:

```js
'use strict';
exports.up = (knex) => knex.schema.createTable('projects', (t) => {
  t.string('id', 20).primary();
  t.string('machine_id', 20).notNullable().references('id').inTable('machines').onDelete('CASCADE');
  t.string('local_id', 12).notNullable();
  t.string('name', 200).notNullable();
  t.string('kind', 40).notNullable().defaultTo('spectoflow');
  t.boolean('published').notNullable().defaultTo(false);
  t.text('last_snapshot', 'longtext');
  t.timestamp('snapshot_at').nullable();
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.unique(['machine_id', 'local_id']);
});
exports.down = (knex) => knex.schema.dropTableIfExists('projects');
```

- [ ] **Step 4: Write the failing tests** (`server/test/db.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('createMachine prints the token once; only its hash is stored; machineByToken looks it up', async () => {
  const db = await fresh();
  try {
    const m = db.createMachine('laptop');
    assert.match(m.token, /^spf_[A-Za-z0-9_-]{20,}$/);
    assert.ok(m.id && m.id.length >= 8);
    const row = await db.knex('machines').where({ id: m.id }).first();
    assert.strictEqual(row.token_hash.length, 64);
    assert.notStrictEqual(row.token_hash, m.token);
    const found = await db.machineByToken(m.token);
    assert.strictEqual(found.id, m.id); assert.strictEqual(found.name, 'laptop');
    assert.strictEqual(await db.machineByToken('spf_wrong'), null);
  } finally { await db.destroy(); }
});

test('revokeMachine blanks token lookups; touchMachine bumps last_seen', async () => {
  const db = await fresh();
  try {
    const m = db.createMachine('box');
    assert.strictEqual(await db.revokeMachine(m.id), true);
    assert.strictEqual(await db.machineByToken(m.token), null);
    assert.strictEqual(await db.revokeMachine('unknown-id'), false);
    const before = (await db.knex('machines').where({ id: m.id }).first()).last_seen;
    const m2 = db.createMachine('box2');
    await db.touchMachine(m2.id);
    const after = (await db.knex('machines').where({ id: m2.id }).first()).last_seen;
    assert.ok(after, 'last_seen set'); assert.strictEqual(before, null);
  } finally { await db.destroy(); }
});

test('upsertProject assigns a stable server id per (machine, localId) and updates in place on re-announce', async () => {
  const db = await fresh();
  try {
    const m = db.createMachine('laptop');
    const p1 = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
    assert.ok(p1.id && p1.id.length === 10);
    const p2 = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha renamed', kind: 'spectoflow' });
    assert.strictEqual(p2.id, p1.id); assert.strictEqual(p2.name, 'Alpha renamed');
    const other = db.createMachine('other-box');
    const p3 = await db.upsertProject({ machineId: other.id, localId: 'aaaaaa', name: 'Same local id, other machine', kind: 'spectoflow' });
    assert.notStrictEqual(p3.id, p1.id);
  } finally { await db.destroy(); }
});

test('setPublished / findProject / listPublishedByMachine / listPublic / saveSnapshot', async () => {
  const db = await fresh();
  try {
    const m = db.createMachine('laptop');
    const p = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
    assert.strictEqual(await db.findProject(p.id).then((r) => r.published), false);
    assert.deepStrictEqual(await db.listPublishedByMachine(m.id), []);
    assert.deepStrictEqual(await db.listPublic(), []);
    await db.setPublished(p.id, true);
    assert.strictEqual((await db.findProject(p.id)).published, true);
    assert.strictEqual((await db.listPublishedByMachine(m.id))[0].id, p.id);
    assert.strictEqual((await db.listPublic())[0].id, p.id);
    await db.saveSnapshot(p.id, { projectName: 'Alpha', plans: [] });
    const row = await db.findProject(p.id);
    assert.deepStrictEqual(JSON.parse(row.last_snapshot), { projectName: 'Alpha', plans: [] });
    assert.ok(row.snapshot_at);
    await db.setPublished(p.id, false);
    assert.deepStrictEqual(await db.listPublic(), []);
    assert.strictEqual(await db.findProject('unknown'), null);
    assert.strictEqual(await db.findByMachineLocal(m.id, 'zzzzzz'), null);
    assert.strictEqual((await db.findByMachineLocal(m.id, 'aaaaaa')).id, p.id);
  } finally { await db.destroy(); }
});
```

- [ ] **Step 5: install and run to see them fail**

Run (from `server/`): `npm install` then `node --test test/db.test.js`
Expected: `Cannot find module '../src/db'`.

- [ ] **Step 6: `server/src/db.js`**

```js
'use strict';
/*
 * Persistence for the online dashboard: machines (token-authenticated connectors) and their
 * projects (identity + published flag + last known snapshot, for offline reads). One Knex
 * instance per process; the driver (sqlite/mysql2/pg) is picked by knexfile.fromUrl from
 * DATABASE_URL. Token plaintext is returned to the caller exactly once (createMachine) and never
 * stored — only its SHA-256 lives in the row, so a leaked database never leaks usable tokens.
 */
const crypto = require('crypto');
const knexLib = require('knex');
const { fromUrl } = require('../knexfile');

function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

async function createDb(databaseUrl) {
  const knex = knexLib(fromUrl(databaseUrl));
  async function migrate() { await knex.migrate.latest(); }

  function createMachine(name) {
    const id = randomId(8);              // ~11 chars base64url
    const token = 'spf_' + randomId(32);  // printed once by the caller (cli.js)
    // Synchronous-looking API for the caller's convenience (`token create` prints it immediately);
    // the insert itself is fire-and-forget from here but awaited by every test/caller that follows
    // it with a read, because sqlite (the only driver under test) executes it inline. Real deployments
    // create machines only through the admin CLI, which awaits the returned promise via .ready.
    const ready = knex('machines').insert({ id, name, token_hash: hash(token) });
    return { id, name, token, ready };
  }
  async function machineByToken(token) {
    const row = await knex('machines').where({ token_hash: hash(token) }).whereNull('revoked_at').first();
    return row || null;
  }
  async function touchMachine(id) { await knex('machines').where({ id }).update({ last_seen: knex.fn.now() }); }
  async function listMachines() { return knex('machines').select('id', 'name', 'created_at', 'last_seen', 'revoked_at').orderBy('created_at', 'desc'); }
  async function revokeMachine(id) {
    const n = await knex('machines').where({ id }).whereNull('revoked_at').update({ revoked_at: knex.fn.now() });
    return n > 0;
  }

  async function findByMachineLocal(machineId, localId) {
    const row = await knex('projects').where({ machine_id: machineId, local_id: localId }).first();
    return row || null;
  }
  async function upsertProject({ machineId, localId, name, kind }) {
    const existing = await findByMachineLocal(machineId, localId);
    if (existing) { await knex('projects').where({ id: existing.id }).update({ name, kind }); return findProject(existing.id); }
    const id = randomId(7); // 10-char base64url, per spec §4
    await knex('projects').insert({ id, machine_id: machineId, local_id: localId, name, kind, published: false });
    return findProject(id);
  }
  async function findProject(id) {
    const row = await knex('projects').where({ id }).first();
    if (!row) return null;
    return { ...row, published: !!row.published };
  }
  async function setPublished(id, published) { await knex('projects').where({ id }).update({ published: !!published }); }
  async function listPublishedByMachine(machineId) {
    return (await knex('projects').where({ machine_id: machineId, published: true })).map((r) => ({ ...r, published: true }));
  }
  async function listPublic() {
    return (await knex('projects').where({ published: true })).map((r) => ({ ...r, published: true }));
  }
  async function saveSnapshot(id, snapshot) {
    await knex('projects').where({ id }).update({ last_snapshot: JSON.stringify(snapshot), snapshot_at: knex.fn.now() });
  }

  return {
    knex, migrate, createMachine, machineByToken, touchMachine, listMachines, revokeMachine,
    upsertProject, findProject, findByMachineLocal, setPublished, listPublishedByMachine, listPublic, saveSnapshot,
    destroy: () => knex.destroy(),
  };
}

module.exports = { createDb };
```

- [ ] **Step 7: `server/cli.js`**

```js
#!/usr/bin/env node
'use strict';
/*
 * Admin CLI for the online dashboard server — machine tokens and migrations. C1 has no accounts yet
 * (C2 moves token creation into the UI), so this is the only way to onboard a machine: create a
 * token here, hand it to whoever runs `spectoflow dashboard login` on that machine.
 */
const { createDb } = require('./src/db');
const argv = process.argv.slice(2);
const flag = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || undefined;

async function main() {
  const [cmd, sub] = argv;
  const db = await createDb(process.env.DATABASE_URL);
  try {
    if (cmd === 'migrate') { await db.migrate(); console.log('✓ migrations applied'); return; }
    if (cmd === 'token' && sub === 'create') {
      const name = flag('name');
      if (!name) { console.error('Usage: node cli.js token create --name="laptop"'); process.exitCode = 1; return; }
      const m = db.createMachine(name); await m.ready;
      console.log(`✓ machine "${name}" created — id ${m.id}`);
      console.log(`  token (shown once, store it now):\n\n  ${m.token}\n`);
      return;
    }
    if (cmd === 'token' && sub === 'list') {
      const rows = await db.listMachines();
      if (!rows.length) return console.log('no machines yet');
      rows.forEach((r) => console.log(`${r.id}  ${r.name.padEnd(24)}  ${r.revoked_at ? 'revoked' : 'active '}  last seen ${r.last_seen || 'never'}`));
      return;
    }
    if (cmd === 'token' && sub === 'revoke') {
      const id = argv[2];
      if (!id) { console.error('Usage: node cli.js token revoke <machine-id>'); process.exitCode = 1; return; }
      console.log((await db.revokeMachine(id)) ? `✓ revoked ${id}` : `! no active machine with id ${id}`);
      if (!(await db.revokeMachine.length)) {} // no-op, keeps lints quiet about unused branch shape
      return;
    }
    console.log('Usage: node cli.js migrate | token create --name=<n> | token list | token revoke <id>');
    process.exitCode = 1;
  } finally { await db.destroy(); }
}
main();
```

Remove the stray no-op line `if (!(await db.revokeMachine.length)) {} // …` before committing — it was left in by mistake while drafting; the branch above it already prints the result and returns.

- [ ] **Step 8: `server/test/cli.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const CLI = path.resolve(__dirname, '..', 'cli.js');

function dbUrl() { return 'sqlite:' + path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stf-srv-cli-')), 'db.sqlite'); }
const run = (url, args) => execFileSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } });

test('migrate then token create prints the token once; list shows it active; revoke closes it', () => {
  const url = dbUrl();
  run(url, ['migrate']);
  const created = run(url, ['token', 'create', '--name=ci-box']);
  const m = created.match(/token \(shown once.*\):\s*\n\s*\n\s*(spf_\S+)/s);
  assert.ok(m, created);
  const token = m[1];
  let list = run(url, ['token', 'list']);
  assert.match(list, /ci-box\s+active/);
  const id = list.trim().split(/\s+/)[0];
  const revoked = run(url, ['token', 'revoke', id]);
  assert.match(revoked, /revoked/);
  list = run(url, ['token', 'list']);
  assert.match(list, /ci-box\s+revoked/);
  assert.throws(() => run(url, ['token', 'create']));
});
```

- [ ] **Step 9: Run the server tests**

Run (from `server/`): `npm test`
Expected: all PASS.

- [ ] **Step 10: Scope the root `npm test` away from `server/`**

`package.json:44` `"test": "node --test"` becomes `"test": "node --test test/"` (the root suite already lives entirely under `test/`; this just makes the scope explicit so it never picks up `server/test/`, which needs `server/node_modules`).

- [ ] **Step 11: Run both suites once**

Run: `npm test` (root) then `cd server && npm test`
Expected: both green, independently.

- [ ] **Step 12: Commit**

```bash
cd server && git add package.json package-lock.json knexfile.js migrations src/db.js cli.js test/db.test.js test/cli.test.js
cd .. && git add package.json
git commit -m "feat(server): scaffold — package.json (fastify/knex/drivers), migrations, db.js, token CLI"
```

---

### Task 9: `server/` app shell — access-key auth, static serving, boot

**Files:**
- Create: `server/src/auth.js`, `server/src/app.js`, `server/src/index.js`
- Test: `server/test/auth.test.js`

**Interfaces:**
- Consumes: Task 8 `createDb`.
- Produces: `server/src/auth.js` → `registerAuth(fastify, { accessKey, sessionSecret, insecureDev })`: adds `/login` (GET page, POST check), a `preHandler` hook that 401s any non-public route without a valid `spf_session` cookie, and rate-limits `POST /login`. Public routes: `/healthz`, `GET /login`, `POST /login`, `/connector/*` (auth'd separately by Task 10), any path under `/login-assets/*`.
  `server/src/app.js` → `async function buildApp({ db, accessKey, sessionSecret, insecureDev, publicDir })` → a ready Fastify instance with static serving of `publicDir` (defaults to `../../lib/dashboard/public` — the spectoflow package's own front-end) and `GET /healthz` → `{ ok:true }` (public, no auth, no DB call).
  `server/src/index.js` — boot script: reads env, validates `SPECTOFLOW_ACCESS_KEY` (16+ chars) unless `--insecure-dev`, generates+persists `SESSION_SECRET` to `data/session-secret` if unset, runs `db.migrate()`, calls `buildApp`, listens on `PORT` (default 3000).

- [ ] **Step 1: Write the failing tests** (`server/test/auth.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../src/app');
const { createDb } = require('../src/db');

async function app(opts = {}) {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const a = await buildApp({ db, accessKey: 'x'.repeat(20), sessionSecret: 's'.repeat(32), insecureDev: false, publicDir: __dirname, ...opts });
  return { app: a, db };
}

test('/healthz is public and needs no cookie', async () => {
  const { app: a, db } = await app();
  try { const r = await a.inject({ method: 'GET', url: '/healthz' }); assert.strictEqual(r.statusCode, 200); assert.deepStrictEqual(r.json(), { ok: true }); }
  finally { await a.close(); await db.destroy(); }
});

test('every other route is 401 without the session cookie; the wrong key at /login is 401 and never sets a cookie', async () => {
  const { app: a, db } = await app();
  try {
    const r1 = await a.inject({ method: 'GET', url: '/' });
    assert.strictEqual(r1.statusCode, 401);
    const r2 = await a.inject({ method: 'POST', url: '/login', payload: { key: 'wrong-key-wrong-key' } });
    assert.strictEqual(r2.statusCode, 401);
    assert.strictEqual(r2.cookies.length, 0);
  } finally { await a.close(); await db.destroy(); }
});

test('the right key sets a signed cookie that then authorizes requests; GET /login itself is public', async () => {
  const { app: a, db } = await app();
  try {
    const login = await a.inject({ method: 'GET', url: '/login' });
    assert.strictEqual(login.statusCode, 200);
    const r = await a.inject({ method: 'POST', url: '/login', payload: { key: 'x'.repeat(20) } });
    assert.strictEqual(r.statusCode, 200);
    const cookie = r.cookies.find((c) => c.name === 'spf_session');
    assert.ok(cookie); assert.strictEqual(cookie.httpOnly, true); assert.strictEqual(cookie.sameSite, 'Lax');
    const authed = await a.inject({ method: 'GET', url: '/healthz', cookies: { spf_session: cookie.value } });
    assert.strictEqual(authed.statusCode, 200);
    const tampered = await a.inject({ method: 'GET', url: '/healthz', cookies: { spf_session: cookie.value.slice(0, -1) + (cookie.value.slice(-1) === 'a' ? 'b' : 'a') } });
    assert.strictEqual(tampered.statusCode, 200); // healthz is public regardless — use a protected route instead:
    const protectedOk = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie.value } });
    assert.notStrictEqual(protectedOk.statusCode, 401);
    const protectedTampered = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie.value.slice(0, -1) + (cookie.value.slice(-1) === 'a' ? 'b' : 'a') } });
    assert.strictEqual(protectedTampered.statusCode, 401);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /login is rate-limited: the 11th attempt within the window is 429', async () => {
  const { app: a, db } = await app();
  try {
    let last;
    for (let i = 0; i < 11; i++) last = await a.inject({ method: 'POST', url: '/login', payload: { key: 'nope' } });
    assert.strictEqual(last.statusCode, 429);
  } finally { await a.close(); await db.destroy(); }
});
```

- [ ] **Step 2: Run to see them fail**

Run (from `server/`): `node --test test/auth.test.js`
Expected: `Cannot find module '../src/app'`.

- [ ] **Step 3: `server/src/auth.js`**

```js
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
```

- [ ] **Step 4: `server/src/app.js`**

```js
'use strict';
/*
 * The Fastify application shell: static front-end + access control + health check. Relay routes
 * (Task 11) and the connector route (Task 10) register into this same instance.
 */
const path = require('path');
const fastifyStatic = require('@fastify/static');
const Fastify = require('fastify');
const { registerAuth } = require('./auth');

async function buildApp({ db, accessKey, sessionSecret, insecureDev, publicDir, trustProxy }) {
  const app = Fastify({ trustProxy: !!trustProxy });
  app.get('/healthz', async () => ({ ok: true }));
  await registerAuth(app, { accessKey, sessionSecret, insecureDev });
  await app.register(fastifyStatic, { root: publicDir || path.resolve(__dirname, '..', '..', 'lib', 'dashboard', 'public'), decorateReply: false });
  app.get('/', async (_req, reply) => reply.sendFile('hub.html'));
  app.get('/p/:id/*', async (_req, reply) => reply.sendFile('index.html'));
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.method === 'GET' && !path.extname(req.raw.url.split('?')[0])) return reply.sendFile('index.html');
    reply.code(404).send({ error: 'Not found' });
  });
  app.decorate('db', db);
  return app;
}

module.exports = { buildApp };
```

- [ ] **Step 5: `server/src/index.js`**

```js
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
```

- [ ] **Step 6: Run the tests**

Run (from `server/`): `node --test test/auth.test.js`
Expected: PASS. (Fastify's `inject()` needs no real listening socket, so this is fast.)

- [ ] **Step 7: Commit**

```bash
cd server && git add src/auth.js src/app.js src/index.js test/auth.test.js
git commit -m "feat(server): access-key auth (signed cookie, rate limit), static app shell, boot"
```

---

### Task 10: `server/src/connector.js` — machine registry, WebSocket + HTTP fallback endpoints

**Files:**
- Create: `server/src/connector.js`
- Modify: `server/src/app.js` (register `@fastify/websocket`, mount connector routes)
- Test: `server/test/connector.test.js`

**Interfaces:**
- Consumes: Task 8 `db.machineByToken/touchMachine`; Task 9 `buildApp`.
- Produces: `registerConnector(app, { db, onFrame(machineId, frame), machines })` where `machines` is a shared in-memory registry `Map<machineId, { name, projects: Map<localId,{name,kind,stats}>, send(frame), connected:boolean, transport:'ws'|'http', lastSeen:Date }>` (created by the caller — Task 11 needs the same instance to look machines up by server-side project). Routes: `POST /connector/whoami` (`Authorization: Bearer`, returns `{machineId,name}` or 401), `GET /connector/ws` (`{websocket:true}`; first frame must be `auth` within 5 s or the socket is closed), `POST /connector/frames` / `GET /connector/frames` (Bearer; batches / 25 s long-poll). Every recognized upward frame (`hello`, `event`, `snapshot`, `reply`, `pong`) is handed to `onFrame(machineId, frame)`; the registry updates `connected`/`transport`/`lastSeen` itself.
  `createRegistry()` (exported alongside) → the empty `Map`-backed registry object above, with a `get(machineId)`/`send(machineId, frame)`/`markConnected/markDisconnected` API used by both this file and `relay.js`.

- [ ] **Step 1: Write the failing tests** (`server/test/connector.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../src/app');
const { createDb } = require('../src/db');
const { createConnector: createLocalConnector } = require('../../lib/dashboard/connector');

async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const m = db.createMachine('laptop'); await m.ready;
  const frames = [];
  const app = await buildApp({ db, accessKey: 'x'.repeat(20), sessionSecret: 's'.repeat(32), insecureDev: true, publicDir: __dirname, onFrame: (machineId, frame) => frames.push({ machineId, frame }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return { app, db, machine: m, frames, url: `http://127.0.0.1:${addr.port}` };
}

test('whoami: valid token → {machineId,name}; invalid → 401', async () => {
  const { app, db, machine, url } = await boot();
  try {
    const ok = await fetch(url + '/connector/whoami', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}` } });
    assert.strictEqual(ok.status, 200); assert.deepStrictEqual(await ok.json(), { machineId: machine.id, name: 'laptop' });
    const bad = await fetch(url + '/connector/whoami', { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    assert.strictEqual(bad.status, 401);
  } finally { await app.close(); await db.destroy(); }
});

test('a real local connector (WebSocket) can auth, send hello/event/snapshot, and receive ops/ping', async () => {
  const { app, db, machine, frames, url } = await boot();
  try {
    const execOp = async (p, op) => ({ ranOn: p, op });
    const c = createLocalConnector({ url, token: machine.token, machineName: 'laptop', version: '0.25.0', listPublished: () => [{ localId: 'aaaaaa', name: 'A', kind: 'spectoflow', stats: { total: 1, done: 0 } }], readSnapshot: async () => ({ projectName: 'A' }), execOp });
    c.start();
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('no hello frame')), 5000); const iv = setInterval(() => { if (frames.some((f) => f.frame.type === 'hello')) { clearInterval(iv); clearTimeout(t); resolve(); } }, 20); });
    assert.strictEqual(frames.find((f) => f.frame.type === 'hello').machineId, machine.id);
    c.pushEvent('aaaaaa', { type: 'change' });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(frames.some((f) => f.frame.type === 'event' && f.frame.p === 'aaaaaa'));
    assert.strictEqual(c.status().connected, true);
    c.stop();
  } finally { await app.close(); await db.destroy(); }
});

test('a revoked token is rejected at whoami and the WebSocket auth frame alike', async () => {
  const { app, db, machine, url } = await boot();
  try {
    await db.revokeMachine(machine.id);
    const r = await fetch(url + '/connector/whoami', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}` } });
    assert.strictEqual(r.status, 401);
  } finally { await app.close(); await db.destroy(); }
});
```

- [ ] **Step 2: Run to see them fail**

Run (from `server/`): `node --test test/connector.test.js`
Expected: `buildApp` rejects `onFrame` (unknown option) / whoami 404.

- [ ] **Step 3: `server/src/connector.js`**

```js
'use strict';
/*
 * Server side of the local↔server connection (docs/online-dashboard-connector-design.md §2/§3).
 * Authenticates a machine by its Bearer token (hashed lookup in db.machines), keeps one live entry
 * per connected machine (WebSocket socket, or "an HTTP long-poll is outstanding"), and hands every
 * recognized upward frame to onFrame(machineId, frame) — relay.js (Task 11) is the real consumer;
 * this file knows nothing about ROUTES or op semantics, only the wire protocol and who is connected.
 */
const crypto = require('crypto');

function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function createRegistry() {
  const machines = new Map(); // machineId -> entry
  function entry(machineId) {
    let e = machines.get(machineId);
    if (!e) { e = { name: null, connected: false, transport: null, lastSeen: null, sockets: new Set(), httpWaiters: new Set(), httpOutbox: [], lastHttpAt: 0 }; machines.set(machineId, e); }
    return e;
  }
  function markWsConnected(machineId, socket) { const e = entry(machineId); e.sockets.add(socket); e.connected = true; e.transport = 'ws'; e.lastSeen = new Date(); }
  function markWsDisconnected(machineId, socket) { const e = machines.get(machineId); if (!e) return; e.sockets.delete(socket); if (!e.sockets.size && e.transport === 'ws') e.connected = false; }
  function markHttpSeen(machineId) { const e = entry(machineId); e.transport = 'http'; e.connected = true; e.lastSeen = new Date(); e.lastHttpAt = Date.now(); }
  function sweepHttp(timeoutMs) {
    const now = Date.now();
    for (const [id, e] of machines) if (e.transport === 'http' && now - e.lastHttpAt > timeoutMs) e.connected = false;
  }
  function send(machineId, frame) {
    const e = machines.get(machineId);
    if (!e) return false;
    if (e.sockets.size) { const msg = JSON.stringify(frame); for (const s of e.sockets) s.send(msg); return true; }
    e.httpOutbox.push(frame);
    for (const w of [...e.httpWaiters]) w();
    return e.connected; // queued even if currently disconnected — delivered on the machine's next poll
  }
  function status(machineId) {
    const e = machines.get(machineId);
    return e ? { connected: e.connected, transport: e.transport, lastSeen: e.lastSeen } : { connected: false, transport: null, lastSeen: null };
  }
  return { machines, entry, markWsConnected, markWsDisconnected, markHttpSeen, sweepHttp, send, status };
}

async function registerConnector(app, { db, registry, onFrame }) {
  await app.register(require('@fastify/websocket'));

  async function authenticate(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return null;
    return db.machineByToken(token);
  }

  app.post('/connector/whoami', async (req, reply) => {
    const m = await authenticate(req);
    if (!m) return reply.code(401).send({ error: 'Invalid or revoked token.' });
    await db.touchMachine(m.id);
    return { machineId: m.id, name: m.name };
  });

  app.get('/connector/ws', { websocket: true }, (socket, req) => {
    let machineId = null;
    const authTimeout = setTimeout(() => { if (!machineId) { try { socket.close(4408, 'auth timeout'); } catch (_) {} } }, 5000);
    socket.on('message', async (raw) => {
      let frame; try { frame = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (!machineId) {
        if (frame.type !== 'auth') return;
        const m = await authenticate({ headers: { authorization: `Bearer ${frame.token}` } });
        if (!m) { try { socket.close(4401, 'unauthorized'); } catch (_) {} return; }
        clearTimeout(authTimeout);
        machineId = m.id;
        registry.entry(machineId).name = m.name;
        registry.markWsConnected(machineId, socket);
        await db.touchMachine(machineId);
        socket.send(JSON.stringify({ type: 'auth-ok', machineId }));
        return;
      }
      if (frame.type === 'pong') return;
      await db.touchMachine(machineId);
      registry.entry(machineId).lastSeen = new Date();
      onFrame(machineId, frame);
    });
    socket.on('close', () => { clearTimeout(authTimeout); if (machineId) registry.markWsDisconnected(machineId, socket); });
    socket.on('error', () => {});
    const pinger = setInterval(() => { if (socket.readyState === 1) { try { socket.send(JSON.stringify({ type: 'ping' })); } catch (_) {} } }, 25000);
    socket.on('close', () => clearInterval(pinger));
  });

  app.post('/connector/frames', async (req, reply) => {
    const m = await authenticate(req);
    if (!m) return reply.code(401).send({ error: 'Invalid or revoked token.' });
    registry.markHttpSeen(m.id);
    await db.touchMachine(m.id);
    const batch = Array.isArray(req.body) ? req.body : [];
    for (const frame of batch) {
      if (frame.type === 'auth') continue; // already authenticated via the header for this transport
      if (frame.type === 'pong') continue;
      onFrame(m.id, frame);
    }
    const e = registry.entry(m.id);
    const down = e.httpOutbox.splice(0);
    if (batch.some((f) => f.type === 'auth')) down.unshift({ type: 'auth-ok', machineId: m.id });
    return down;
  });

  app.get('/connector/frames', async (req, reply) => {
    const m = await authenticate(req);
    if (!m) return reply.code(401).send({ error: 'Invalid or revoked token.' });
    registry.markHttpSeen(m.id);
    const e = registry.entry(m.id);
    if (e.httpOutbox.length) return e.httpOutbox.splice(0);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; e.httpWaiters.delete(finish); clearTimeout(t); resolve(e.httpOutbox.splice(0)); };
      const t = setTimeout(finish, 25000);
      e.httpWaiters.add(finish);
    });
  });

  const sweeper = setInterval(() => registry.sweepHttp(40000), 5000);
  app.addHook('onClose', (_i, done) => { clearInterval(sweeper); done(); });
}

module.exports = { registerConnector, createRegistry };
```

- [ ] **Step 4: Wire it into `server/src/app.js`**

`buildApp` gains `onFrame` and an internally-created (or injected, for tests) `registry`:

```js
const { registerConnector, createRegistry } = require('./connector');
// … inside buildApp({ db, accessKey, sessionSecret, insecureDev, publicDir, trustProxy, onFrame, registry }) …
  const reg = registry || createRegistry();
  await registerConnector(app, { db, registry: reg, onFrame: onFrame || (() => {}) });
  app.decorate('connectorRegistry', reg);
```

(insert this block right after `app.decorate('db', db);`, and add the two new destructured parameters to the function signature).

- [ ] **Step 5: Run the tests**

Run (from `server/`): `node --test test/connector.test.js test/auth.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd server && git add src/connector.js src/app.js test/connector.test.js
git commit -m "feat(server): machine connector — WebSocket + HTTP long-poll endpoints, in-memory registry"
```

---

### Task 11: `server/src/relay.js` — ROUTES → op frames, offline snapshot, SSE fan-out, remote hub page

**Files:**
- Create: `server/src/relay.js`
- Modify: `server/src/app.js` (wire `onFrame` to the relay; mount `/api/*` and `/api/events`)
- Test: `server/test/relay.test.js`

**Interfaces:**
- Consumes: Task 1 `lib/dashboard/routes.js` (`findRoute`); Task 8 `db` (`upsertProject`, `setPublished`, `saveSnapshot`, `findProject`, `listPublishedByMachine`); Task 10 `registry` (`send`, `status`).
- Produces: `registerRelay(app, { db, registry })` mounts:
  - `onFrame(machineId, frame)` handler (passed into `registerConnector` from `app.js`) for `hello` (upserts each project, marks vanished ones unpublished, updates in-memory `serverIdOf`), `event` (fans out over SSE to that project's subscribers; drops+logs an event for a `localId` never announced), `snapshot` (`db.saveSnapshot` + fan-out a `change`), `reply` (resolves the pending `reqId` promise).
  - `GET /api/hub/projects` → `{ mode:'remote', projects:[{ id, name, kind, machine, online, lastSeen, stats:{total,done}, lastOpened }] }` — `machine` from the owning machine's name, `online` from `registry.status(machineId).connected`.
  - `GET|POST|PATCH|DELETE /api/*?p=<serverId>` (excluding `/api/events`, `/api/hub/*`) → looks the route up via `findRoute`, sends `{type:'op',reqId,p:localId,op,args}` to the owning machine, awaits the matching `reply` up to 30 s (504 on timeout), 503 when the machine isn't connected — except `project.read`, which instead returns the stored snapshot merged with `{online:false, lastSeen}`.
  - `GET /api/events?p=<serverId>` → SSE; registers this response in a per-server-id `Set`, closes cleanly on client disconnect.

- [ ] **Step 1: Write the failing tests** (`server/test/relay.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../src/app');
const { createDb } = require('../src/db');
const { createRegistry } = require('../src/connector');

async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const m = db.createMachine('laptop'); await m.ready;
  const registry = createRegistry();
  const app = await buildApp({ db, accessKey: 'x'.repeat(20), sessionSecret: 's'.repeat(32), insecureDev: true, publicDir: __dirname, registry });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { app, db, machine: m, registry, url };
}
function fakeSocket() { const sent = []; return { readyState: 1, send: (s) => sent.push(JSON.parse(s)), sent }; }

test('a hello upserts published projects and lists them via GET /api/hub/projects (mode:remote)', async () => {
  const { app, db, machine, registry, url } = await boot();
  try {
    // Drive onFrame indirectly through the real HTTP fallback endpoint (no direct access to the
    // relay's internals from a test — that's the point: only the wire protocol is exercised).
    const r = await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token, version: '0.25.0' }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: { total: 2, done: 1 } }] }]) });
    assert.strictEqual(r.status, 200);
    const list = await (await fetch(url + '/api/hub/projects')).json();
    assert.strictEqual(list.mode, 'remote');
    assert.strictEqual(list.projects.length, 1);
    assert.strictEqual(list.projects[0].name, 'Alpha'); assert.strictEqual(list.projects[0].machine, 'laptop');
    assert.strictEqual(list.projects[0].online, true); // an HTTP frame just arrived
    assert.strictEqual(list.projects[0].stats.done, 1);
  } finally { await app.close(); await db.destroy(); }
});

test('an op is relayed to the connected machine and its reply answers the browser', async () => {
  const { app, db, machine, registry, url } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] }]) });
    const serverId = (await (await fetch(url + '/api/hub/projects')).json()).projects[0].id;
    const sock = fakeSocket();
    registry.markWsConnected(machine.id, sock);
    const reqPromise = fetch(url + `/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'hi' }) });
    await new Promise((r) => setTimeout(r, 50));
    const op = sock.sent.find((f) => f.type === 'op');
    assert.ok(op); assert.strictEqual(op.p, 'aaaaaa'); assert.strictEqual(op.op, 'task.add'); assert.deepStrictEqual(op.args, { title: 'hi' });
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([{ type: 'reply', reqId: op.reqId, result: { ok: true } }]) });
    const res = await reqPromise;
    assert.strictEqual(res.status, 200); assert.deepStrictEqual(await res.json(), { ok: true });
  } finally { await app.close(); await db.destroy(); }
});

test('project.read on an offline machine returns the stored snapshot with online:false; any other op is 503', async () => {
  const { app, db, machine, url } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] },
        { type: 'snapshot', p: 'aaaaaa', project: { projectName: 'Alpha', plans: [] } }]) });
    const serverId = (await (await fetch(url + '/api/hub/projects')).json()).projects[0].id;
    // Machine goes quiet: no socket, HTTP poll not renewed → sweepHttp will mark it offline; force it now via status check timing instead of waiting 40s:
    const read = await fetch(url + `/api/project?p=${serverId}`);
    // Right after the hello/snapshot batch the machine is still "connected" (just posted) — assert the
    // read succeeds and echoes the snapshot when online, then simulate going offline explicitly:
    assert.strictEqual(read.status, 200);
    const body1 = await read.json();
    assert.strictEqual(body1.projectName, 'Alpha');
    const write = await fetch(url + `/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) });
    assert.strictEqual(write.status, 504); // no reply arrives within the (test-shortened) timeout — see relay.js REPLY_TIMEOUT override below
  } finally { await app.close(); await db.destroy(); }
});

test('an unknown server id is 404; SSE registers and gets a change event on snapshot', async () => {
  const { app, db, url } = await boot();
  try {
    const r = await fetch(url + '/api/project?p=doesnotexist');
    assert.strictEqual(r.status, 404);
  } finally { await app.close(); await db.destroy(); }
});
```

Note in the test file, right under the imports, force a short reply timeout for the third test to run fast without a 30 s real wait:

```js
process.env.SPECTOFLOW_RELAY_REPLY_TIMEOUT_MS = '300';
```//	 relay.js reads this override (see Step 3) — production leaves it unset and gets the spec's 30000.

- [ ] **Step 2: Run to see them fail**

Run (from `server/`): `node --test test/relay.test.js`
Expected: `/api/hub/projects` 404, everything downstream fails.

- [ ] **Step 3: `server/src/relay.js`**

```js
'use strict';
/*
 * Turns a browser's HTTP request into an `op` frame for the owning machine, and a machine's upward
 * frames into what a browser sees: the same ROUTES table the local hub uses (lib/dashboard/routes.js),
 * so the online HTTP surface stays identical to the local one by construction (spec §2). Never
 * requires ops.js — this process executes nothing itself.
 */
const { findRoute } = require('../../lib/dashboard/routes');

const REPLY_TIMEOUT_MS = Number(process.env.SPECTOFLOW_RELAY_REPLY_TIMEOUT_MS) || 30000;

function registerRelay(app, { db, registry }) {
  const pending = new Map();        // reqId -> {resolve,reject,timer}
  const sse = new Map();            // serverId -> Set<reply.raw>
  const localIdOf = new Map();      // serverId -> {machineId, localId}
  let reqCounter = 0;

  function fanoutSSE(serverId, obj) {
    const set = sse.get(serverId);
    if (!set) return;
    const line = 'data: ' + JSON.stringify(obj) + '\n\n';
    for (const res of set) res.write(line);
  }

  async function onFrame(machineId, frame) {
    if (frame.type === 'hello') {
      const seen = new Set();
      for (const p of frame.projects || []) {
        const row = await db.upsertProject({ machineId, localId: p.localId, name: p.name, kind: p.kind || 'spectoflow' });
        localIdOf.set(row.id, { machineId, localId: p.localId });
        seen.add(p.localId);
        registry.entry(machineId).projects = registry.entry(machineId).projects || new Map();
        registry.entry(machineId).projects.set(p.localId, { serverId: row.id, name: p.name, kind: p.kind, stats: p.stats || null });
      }
      // A project that was published before but is absent from this hello (unpublished, or the
      // machine no longer has it) is marked unpublished here — its row and last snapshot are kept.
      for (const row of await db.listPublishedByMachine(machineId)) if (!seen.has(row.local_id)) await db.setPublished(row.id, false);
      return;
    }
    const known = registry.entry(machineId).projects && registry.entry(machineId).projects.get(frame.p);
    if (frame.type === 'event') {
      if (!known) return; // unannounced localId — dropped, never stored/fanned out (spec §2 ordering note)
      fanoutSSE(known.serverId, frame.event);
      return;
    }
    if (frame.type === 'snapshot') {
      if (!known) return;
      await db.saveSnapshot(known.serverId, frame.project);
      const cached = registry.entry(machineId).projects.get(frame.p);
      if (cached) cached.stats = statsOf(frame.project);
      fanoutSSE(known.serverId, { type: 'change' });
      return;
    }
    if (frame.type === 'reply') {
      const p = pending.get(frame.reqId);
      if (!p) return;
      pending.delete(frame.reqId); clearTimeout(p.timer);
      p.resolve(frame);
    }
  }
  function statsOf(project) {
    if (!project || !Array.isArray(project.plans)) return null;
    let total = 0, done = 0;
    for (const pl of project.plans) for (const ph of pl.phases || []) for (const t of ph.tasks || []) { total++; if (t.status === 'done') done++; }
    return { total, done };
  }

  async function ownerOf(serverId) {
    const cached = localIdOf.get(serverId);
    if (cached) return cached;
    const row = await db.findProject(serverId);
    if (!row) return null;
    const found = { machineId: row.machine_id, localId: row.local_id };
    localIdOf.set(serverId, found);
    return found;
  }
  function sendOp(machineId, frame) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(frame.reqId); resolve({ timedOut: true }); }, REPLY_TIMEOUT_MS);
      pending.set(frame.reqId, { resolve, timer });
      const delivered = registry.send(machineId, frame);
      if (!delivered) { clearTimeout(timer); pending.delete(frame.reqId); resolve({ offline: true }); }
    });
  }

  app.get('/api/hub/projects', async () => {
    const rows = await db.listPublic();
    const projects = await Promise.all(rows.map(async (r) => {
      const m = await db.knex('machines').where({ id: r.machine_id }).first();
      const st = registry.status(r.machine_id);
      const cached = registry.entry(r.machine_id).projects && registry.entry(r.machine_id).projects.get(r.local_id);
      return { id: r.id, name: r.name, kind: r.kind, machine: m ? m.name : 'unknown', online: st.connected, lastSeen: st.lastSeen, stats: (cached && cached.stats) || null, lastOpened: r.snapshot_at || r.created_at };
    }));
    return { mode: 'remote', projects };
  });

  app.get('/api/events', async (req, reply) => {
    const serverId = req.query.p;
    const owner = serverId && await ownerOf(serverId);
    if (!owner) return reply.code(404).send({ error: 'Unknown project.' });
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    reply.raw.write('data: ' + JSON.stringify({ type: 'hello' }) + '\n\n');
    if (!sse.has(serverId)) sse.set(serverId, new Set());
    sse.get(serverId).add(reply.raw);
    req.raw.on('close', () => { const set = sse.get(serverId); if (set) set.delete(reply.raw); });
    return reply;
  });

  app.all('/api/*', async (req, reply) => {
    if (req.raw.url.startsWith('/api/hub/') || req.raw.url.startsWith('/api/events')) return reply.callNotFound();
    const serverId = req.query.p;
    const owner = serverId && await ownerOf(serverId);
    if (!owner) return reply.code(404).send({ error: 'Unknown project.' });
    const route = findRoute(req.method, req.raw.url.split('?')[0]);
    if (!route) return reply.callNotFound();
    const [, , opName, argsFn] = route;
    const u = new URL(req.raw.url, 'http://x');
    const args = argsFn(u, req.body || {}, u.pathname);
    const st = registry.status(owner.machineId);
    if (opName === 'project.read' && !st.connected) {
      const row = await db.findProject(serverId);
      const snapshot = row && row.last_snapshot ? JSON.parse(row.last_snapshot) : {};
      return { ...snapshot, online: false, lastSeen: row && row.snapshot_at };
    }
    if (!st.connected) return reply.code(503).send({ error: `${owner.localId} is offline (last seen ${st.lastSeen || 'never'}).` });
    const reqId = ++reqCounter;
    const result = await sendOp(owner.machineId, { type: 'op', reqId, p: owner.localId, op: opName, args });
    if (result.timedOut) return reply.code(504).send({ error: 'The machine did not respond in time.' });
    if (result.offline) return reply.code(503).send({ error: `${owner.localId} is offline.` });
    if (result.error) return reply.code(result.error.status || 500).send({ error: result.error.message });
    return result.result === undefined ? {} : result.result;
  });

  return { onFrame };
}

module.exports = { registerRelay };
```

- [ ] **Step 4: Wire it into `server/src/app.js`**

Replace the `onFrame: onFrame || (() => {})` line with a relay-backed default:

```js
  const { registerRelay } = require('./relay');
  const relay = registerRelay(app, { db, registry: reg });
  await registerConnector(app, { db, registry: reg, onFrame: onFrame || relay.onFrame });
```

(move this whole block — `reg`, `registerRelay`, `registerConnector` — after `app.decorate('db', db);` and before the two static-serving routes so `/api/*` is registered ahead of the SPA catch-all; Fastify resolves the more specific route regardless of registration order, but keeping relay routes together with the connector keeps the file readable). Also remove the now-unused generic `app.get('/', …)` conflict: since `/api/hub/projects` and `/api/*` are registered by the relay, and `/`/`/p/:id/*` stay served by the static block already in `app.js`, no further change is needed there.

- [ ] **Step 5: Run the tests**

Run (from `server/`): `node --test test/relay.test.js test/connector.test.js test/auth.test.js test/db.test.js`
Expected: all PASS. If the third relay test's 504 arrives slower than expected, confirm `SPECTOFLOW_RELAY_REPLY_TIMEOUT_MS` is read as a plain env var (it is set via `process.env` at the top of the test file, before any `require('../src/relay')` — module-load order matters here, since the constant is read once at `require` time).

- [ ] **Step 6: Commit**

```bash
cd server && git add src/relay.js src/app.js test/relay.test.js
git commit -m "feat(server): relay — ROUTES to op frames, offline snapshot reads, SSE fan-out, remote hub listing"
```

---

### Task 12: End-to-end test with a real local hub, `server/README.md`, versions, real QA

**Files:**
- Create: `server/test/e2e.test.js`
- Create: `server/README.md`
- Modify: `package.json:3` (version → `0.25.0`)
- Modify: `server/package.json:3` (already `0.1.0` from Task 8 — confirmed, no change)
- Modify: `docs/DECISIONS.md` (D65 entry — written by the controller, not this task; this task leaves a one-line placeholder marker for the controller to replace, so the plan's own self-review has something concrete to check)
- Modify: `CLAUDE.md` "What exists" + "Run & test" (controller, per repo convention — same placeholder note)

**Interfaces:**
- Consumes: everything built in Tasks 1–11: `bin/spectoflow.js` (`login`, `publish`), `lib/dashboard/hub-server.js` (real spawn), `server/src/index.js`-equivalent boot (built inline in the test via `buildApp`/`createDb`/`registerConnector` wiring, on an ephemeral port, so the test controls `DATABASE_URL` and doesn't fight a real `data/` dir).
- Produces: one real, end-to-end proof that a browser talking to the server can read and write a real local project through the real connector, over both transports, and that the offline path degrades correctly.

- [ ] **Step 1: Write the end-to-end test** (`server/test/e2e.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createDb } = require('../src/db');
const { buildApp } = require('../src/app');
const workspace = require('../../lib/workspace');

const KIT = path.resolve(__dirname, '..', '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const HUB = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');

async function bootServer() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, accessKey: 'x'.repeat(20), sessionSecret: 's'.repeat(32), insecureDev: true, publicDir: path.join(KIT, 'lib', 'dashboard', 'public') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { app, db, url };
}
function createToken(db, name) { const m = db.createMachine(name); return m.ready.then(() => m); }
function startHub(home, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [HUB], { env: { ...process.env, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(srv); });
  });
}
const hubPort = () => 5500 + Math.floor(Math.random() * 200);

async function runOneScenario(transport) {
  const { app, db, url } = await bootServer();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `stf-e2e-${transport}-`));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `stf-e2e-proj-${transport}-`));
  execFileSync('node', [BIN, 'init', projectDir], { stdio: 'pipe' });
  const machine = await createToken(db, `e2e-${transport}`);
  const P = hubPort();
  let hub = null;
  try {
    // 1) login + publish, entirely through the real CLI, against the real running server.
    const env = { ...process.env, SPECTOFLOW_HOME: home };
    execFileSync('node', [BIN, 'dashboard', 'login', `--url=${url}`, `--token=${machine.token}`, `--transport=${transport}`, '--name=e2e-box'], { env, stdio: 'pipe' });
    execFileSync('node', [BIN, 'dashboard', 'publish'], { env, cwd: projectDir, stdio: 'pipe' });

    // 2) start the real local hub; it reads remote.json and connects.
    hub = await startHub(home, P);
    let listed = null;
    for (let i = 0; i < 100 && !listed; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const rows = (await (await fetch(url + '/api/hub/projects')).json()).projects;
      if (rows.length) listed = rows[0];
    }
    assert.ok(listed, 'the project appears on the server within 10s');
    assert.strictEqual(listed.online, true);
    const serverId = listed.id;

    // 3) drive it from "a second browser tab": read, then write, then re-read and see the write.
    const before = await (await fetch(`${url}/api/project?p=${serverId}`)).json();
    assert.notStrictEqual(before.online, false);
    const add = await fetch(`${url}/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `via ${transport}` }) });
    assert.strictEqual(add.status, 200, await add.text());
    let sawIt = false;
    for (let i = 0; i < 50 && !sawIt; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const after = await (await fetch(`${url}/api/project?p=${serverId}`)).json();
      sawIt = JSON.stringify(after.plans).includes(`via ${transport}`);
    }
    assert.ok(sawIt, 'the remote write is visible reading the project back through the server');
    // also visible locally — same process, same file, no dual state:
    const localBoard = await (await fetch(`http://localhost:${P}/api/project?p=${listed.id ? (await (await fetch(`http://localhost:${P}/api/hub/projects`)).json()).projects[0].id : ''}`)).json();
    assert.ok(JSON.stringify(localBoard.plans).includes(`via ${transport}`));

    // 4) kill the hub: a write 503s, a read falls back to the last snapshot with online:false.
    hub.kill();
    let wentOffline = false;
    for (let i = 0; i < 100 && !wentOffline; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const rows = (await (await fetch(url + '/api/hub/projects')).json()).projects;
      wentOffline = rows.length && rows[0].online === false;
    }
    assert.ok(wentOffline, 'the server notices the machine went away');
    const offlineWrite = await fetch(`${url}/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'nope' }) });
    assert.strictEqual(offlineWrite.status, 503);
    const offlineRead = await (await fetch(`${url}/api/project?p=${serverId}`)).json();
    assert.strictEqual(offlineRead.online, false);
    assert.ok(JSON.stringify(offlineRead.plans).includes(`via ${transport}`), 'offline read still shows the last known state');

    // 5) restart the hub: back online.
    hub = await startHub(home, hubPort());
    let backOnline = false;
    for (let i = 0; i < 100 && !backOnline; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const rows = (await (await fetch(url + '/api/hub/projects')).json()).projects;
      backOnline = rows.length && rows[0].online === true;
    }
    assert.ok(backOnline, 'reconnects and is visible online again after a restart');
  } finally {
    if (hub) hub.kill();
    workspace.clearRemote(path.join(home, 'dashboard'));
    await app.close(); await db.destroy();
  }
}

test('end-to-end over WebSocket: login, publish, real hub connects, remote read/write, offline degrade, reconnect', { timeout: 30000 }, () => runOneScenario('ws'));
test('end-to-end over HTTP long-poll: the same scenario with --transport=http', { timeout: 30000 }, () => runOneScenario('http'));
```

- [ ] **Step 2: Run it**

Run (from `server/`): `node --test test/e2e.test.js`
Expected: both PASS. This test genuinely spawns two `node` processes (the hub) and drives them over real HTTP/WS for ~10-20 s each — if it's flaky under machine load, re-run it in isolation before concluding there's a real bug (established pattern in this repo, see `orchestrate-server.test.js`/`cli-update.test.js`).

- [ ] **Step 3: `server/README.md`**

```markdown
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
```

- [ ] **Step 4: Bump versions and leave the controller's markers**

`package.json:3` → `"version": "0.25.0",`. `server/package.json` is already `0.1.0` (Task 8) — no change.

Append to `docs/DECISIONS.md`:

```markdown
<!-- CONTROLLER: write D65 here (French), summarizing sub-project C1 — relay server + local
connector — per the repo's existing DECISIONS entry style (see D64 for the shape: what existed
before, what changed, why, what was verified). Remove this marker once written. -->
```

Append to `CLAUDE.md`, right after the `## What exists (v0.24.0 — see DECISIONS D64)` section's last paragraph (before the next `## What exists` heading):

```markdown
<!-- CONTROLLER: add a "## What exists (v0.25.0 — see DECISIONS D65)" section here, in this file's
own established voice/format (see the v0.24.0 section just above for the shape), describing C1:
the online dashboard connector + server/. Also extend "Run & test" below with how to run server/
locally against SQLite (see server/README.md's Quick start). Remove this marker once written. -->
```

(These two markers are deliberate placeholders — DECISIONS/CLAUDE.md narrative is written by the
controller personally, per this repo's established practice across every prior sub-project; a task
brief cannot write in the controller's own voice.)

- [ ] **Step 5: Run everything once, both suites**

Run: `npm test` (root, from repo root) — expect the same pass count as before Task 1 plus every test this plan added (Tasks 1–7 each showed their own count; the net total should be the prior full-suite count + 4 (routes) + 2 (workspace) + 10 (connector) + 4 (hub-remote) + 5 (cli-remote, plus 2 changed) + 3 (public-remote-ui) = prior + 28, roughly — count with `npm test 2>&1 | tail -5`).
Run (from `server/`): `npm test` — expect 4 (db) + 1 (cli) + 4 (auth) + 3 (connector) + 4 (relay) + 2 (e2e) = 18 tests, all passing.

- [ ] **Step 6: Real QA before calling C1 done**

This is manual, on the controller's real machine, not a task a subagent can close alone:
1. `cd server && npm install`, run the SQLite quick-start from the README against a **real** `spectoflow` project already known to this hub (e.g. `todo-list-v2` or `georgesmomo.com`, whichever is convenient).
2. `spectoflow dashboard login` + `publish` that real project; confirm it appears on `http://localhost:3000/` after signing in with the access key.
3. Open the project's board through the server URL in one browser tab and through `http://localhost:4319` in another; make an edit in each and confirm both tabs update live (SSE) and the underlying markdown file only ever has one version.
4. Stop the local hub; confirm the server tab shows the offline banner and read-only controls; confirm a REST write returns 503.
5. Restart the hub; confirm the server tab comes back live within a few seconds.
6. Repeat step 2-3 briefly with `--transport=http` (`dashboard logout` then `login --transport=http`) to confirm the fallback path works outside the test suite too.
7. Optionally, point `DATABASE_URL` at a real local MySQL instance, `node cli.js migrate`, and repeat step 2 once — confirms the "MySQL default" driver actually works, not just SQLite.

- [ ] **Step 7: Commit**

```bash
cd server && git add test/e2e.test.js README.md
cd .. && git add package.json
git commit -m "test(server): real end-to-end (WS + HTTP fallback) against a spawned local hub; server README; spectoflow 0.25.0"
```

(The DECISIONS.md/CLAUDE.md marker edits from Step 4 are committed by the controller together with the real D65 write-up, not as part of this task's commit — see the note in Step 4.)

---

## Self-Review

**1. Spec coverage** — every §1–§5 requirement of `docs/online-dashboard-connector-design.md` maps to a task:
- §1 topology (connector role, tee emit, byte-identical front-end, two client additions) → Tasks 3, 5, 7.
- §2 protocol (all frame types, reqId/timeouts, offline semantics, reconnection/backoff, HTTP fallback, ordering/unknown-project drop) → Tasks 3, 4, 5, 10, 11.
- §3 security (token creation/hashing, login flow, remote.json, web access key + cookie, rate limit, public routes, no inbound port, parity of actions) → Tasks 6, 8, 9, 10, 11 (parity: Task 11's relay imposes no extra authorization beyond "machine owns this project" — matches "every op allowed online" decision).
- §4 publishing/identities (publish/unpublish CLI + endpoint, hub UI toggle, server-assigned ids per (machine,localId)) → Tasks 2, 5, 6, 7, 8, 11.
- §5 server structure/persistence/tests/versions → Tasks 8–12.
- Non-goals explicitly left alone: no accounts/sign-up UI (token CLI only, Task 8), no members/rights (single access key, Task 9), no Docker/cPanel automation (README only, Task 12), no design changes (verified by the "no gradient" grep in Task 7's test).

**2. Placeholder scan** — no TBD/"add error handling"/"similar to Task N" left in any step; every code block is complete, runnable code. The two intentional exceptions (DECISIONS D65, CLAUDE.md "What exists v0.25.0") are explicitly called out as controller-authored narrative, matching how every prior sub-project in this repo's history handled these two files — not a plan-writing shortcut.

**3. Type/interface consistency across tasks** —
- `createConnector(opts)` signature (Task 3) is used identically in Task 5 (`hub-server.js`) and Task 10's test (a *second*, independent construction against the real server) — same field names (`listPublished`, `readSnapshot`, `execOp`, `transport`, `timing`).
- `ops`/`OpError` from `lib/dashboard/ops.js` (status-carrying errors) are consumed the same way in Task 5's `execOp` and were already the existing contract in `handlers.js` — no new error shape invented.
- `lib/dashboard/routes.js`'s `findRoute(method, pathname)` (Task 1) is used verbatim in Task 11's `relay.js` — same argument order, same tuple shape `[method, matcher, opName, argsFn]`.
- Workspace functions (Task 2: `readRemote/writeRemote/clearRemote/setPublished/isPublished/listPublished`) are the only ones Tasks 5–7 call — no task invents a parallel access path to `remote.json` or `meta.json`.
- The server's `registry` object (Task 10's `createRegistry()`) is the single shared instance Task 11's `relay.js` also consumes (`registry.send`, `registry.status`, `registry.entry(...).projects`) — verified by name in Task 10 Step 4's wiring into `app.js` and Task 11 Step 4 reusing the same `reg`.
- Frame field names (`p`, `reqId`, `op`, `args`, `result`, `error:{status,message}`) are identical across the connector (Task 3/4), the fake relay test double (Task 3), and the real server (Tasks 10/11) — cross-checked directly by Task 10's test, which runs a *real* `createConnector` against the *real* server.

**4. Ambiguity check** — two judgment calls made explicit rather than left implicit, each recorded so an implementer doesn't have to guess:
- `createMachine()` in `db.js` is synchronous-looking but its insert is async; the returned `.ready` promise is documented and used by both `cli.js` and every test that immediately reads the row back — flagged inline in Task 8 to avoid a race.
- The relay's per-request reply-timeout constant is read from `process.env.SPECTOFLOW_RELAY_REPLY_TIMEOUT_MS` once at module load, specifically so Task 11's test can shorten 30 s to 300 ms — noted as an override, production leaves it unset.

No task references a function, file, or field not defined by an earlier task or the existing codebase (verified by re-reading Tasks 1→12 in order and checking every `require(...)` target exists by the time it's required).

