# Multi-project hub — design

**Status:** approved by user, section-by-section, 2026-09-04. Implementation via `writing-plans`.

## Problem

Today, `spectoflow dashboard` is one process bound to one project root (`ROOT`, a constant read
once from `SPECTOFLOW_ROOT`/cwd at server startup — see `templates/dashboard/server.js`). Working
across several spectoflow-managed projects means several independent dashboard processes, each on
its own port, with no way to see or switch between them from one place.

This design turns the dashboard into a genuinely multi-project tool: **one server process, one port,
serving every registered project concurrently** — different browser tabs can look at different
projects at the same time, live, no restart to switch.

## Decisions locked in with the user (in order asked)

1. **Live-switching single server**, not a hub-that-launches-independent-per-project-servers.
2. **Global registry the user builds up themselves** (auto-populated on use), not a directory scan.
3. **Concurrent per-tab viewing**: different tabs may show different projects at the same time (not
   one shared "current project" for the whole server).
4. **Full replacement**, not a bolt-on: even a single project goes through the multi-project URL
   scheme and server — no bifurcated single-project vs. multi-project codepath to maintain.
5. **One server/port for everything**: `spectoflow dashboard` detects a running global server,
   starts it if absent, and either way registers the current folder and opens straight to it — never
   two competing servers.
6. **Hub landing page** at `/`: a list of registered projects, not an auto-redirect to the last one.
7. **Opaque short-hash project IDs** in the URL (e.g. `/p/a3f8c1/board`); the human-readable name is
   registry metadata shown in the UI, never load-bearing for routing — no collision handling needed.

## 1. The registry

`~/.spectoflow/projects.json`:

```json
{
  "projects": [
    { "id": "a3f8c1", "path": "D:/projet_tmp/todo-list-v2", "name": "todo-list-v2", "lastOpened": "2026-09-04T19:00:00.000Z" }
  ]
}
```

- `id`: 6 hex chars, generated once at first registration (`crypto.randomBytes(3).toString('hex')`),
  regenerated on the rare collision (registry is small — a linear scan for uniqueness is fine).
- `path`: absolute, normalized (matches the mixed-separator fix from D55/`files.js` — reuse the same
  `path.resolve()` normalization discipline).
- `name`: the folder's basename at registration time. Cosmetic only; never re-derives the id.
- `lastOpened`: updated whenever a project is opened (drives sort order on the hub page, and the
  "last known project" fallback for old bookmarks — see §3).
- A project already in the registry (matched by normalized `path`) is never duplicated; opening it
  again just updates `lastOpened`.
- New module `lib/registry.js` (zero-dep, mirrors `lib/manifest.js`'s style): `readRegistry()`,
  `addProject(path)` → `{id, created}`, `removeProject(id)`, `touchProject(id)`, `findByPath(path)`.
  Directly unit-testable, no server involved — same split already used for `lib/manifest.js`,
  `lib/ownership.js`, etc.

## 2. Server architecture

`server.js` currently has a handful of module-level globals that assume exactly one project:

| Today | Becomes |
|---|---|
| `const ROOT = ...` (fixed at startup) | Resolved per-request from `/p/<id>/...`, looked up in the registry. A request for an unknown `id` (removed project, stale bookmark) gets a clear 404, not a crash. |
| `const clients = new Set()` (server.js) | `const clients = new Map()` — `projectId → Set<res>`. `/api/events` takes `?p=<id>`; `emit(projectId, obj)` only writes to that project's subscribers. |
| `let pending = null` (orchestrator.js) | `const pending = new Map()` — `projectId → pending`. `submitDecision` takes a project id; two projects can each have their own awaiting-approval step without colliding. |
| One `fs.watch` set up once at boot, on the fixed `ROOT` | Set up per project, the first time that project is registered/opened in this server's lifetime; kept alive for the process's life (registries are small; no need to tear down on last-tab-close). |

`store.js` needs **no changes** — every function already takes `root`/`projectRoot` as an explicit
first argument (confirmed by reading it: `readProject(root)`, `readRuntime(root)`, `addTask(root,
...)`, etc.). The per-project data model (`.spectoflow/`, `runtime.json`, `plans/`, `specs/`) is
completely unaffected by this change; only the server's own in-memory session/broadcast state needed
to stop assuming a single global project.

`runner.js`/`summarize.js`/`files.js` already take `root` as a parameter too (confirmed) — they need
no structural change, just to keep receiving the right root per request instead of a closed-over
constant.

## 3. URL scheme + hub landing page

- `GET /` → hub page: cards for every registered project (name, path, a quick stat or two pulled from
  that project's own `runtime.json`/plan files, last-opened time), sorted by `lastOpened` desc. Click
  → navigates into that project.
- `GET /p/<id>/board`, `/p/<id>/chat`, `/p/<id>/files`, … → the existing dashboard, unchanged in every
  way except the URL now carries the project id. **Decided**: pages use the path prefix (`/p/<id>/
  board`, so a URL is bookmarkable/shareable on its own); every `/api/*` call the client makes instead
  gains a `?p=<id>` query param (same style already settled for `/api/events?p=<id>` above) — a
  smaller `app.js` diff than rewriting every fetch URL's path, and the hub-server-side routing is
  identical either way (it reads the id from wherever it lands, path or query).
- **Old bookmarks** (`/board`, `/chat`, no project prefix) — not an error: redirect to
  `/p/<lastOpenedId>/board` if the registry is non-empty, else to `/` (the hub). Mirrors the same
  "never leave a bookmark dead" instinct already applied to the `/settings` → `/personalize` rename
  in D52.
- A way back to the hub from inside a project (the brand logo already navigates to Board today —
  it'll need a second, explicit hub link, since "back to Board" and "back to the hub" are now two
  different destinations).
- Per-project preferences (design skin, language, active agent — all in that project's own
  `config.json`) are completely unaffected; switching projects in the browser is switching which
  project's `config.json`/state the current tab is reading, nothing more.

## 3bis. Adding a project — non-technical UX (added after user feedback)

The original design only covered the CLI path (`spectoflow dashboard` inside a folder registers it).
Raised directly by the user: the whole point of a hub is to make working across projects easier, and
a **project manager who has never opened a terminal** must still be able to add one — the CLI-only
path fails that bar. A "+ Add project" button on the hub page (`GET /`) covers this, with two ways in,
both landing on the same server-side validation:

- **Browse** — a folder-picker **built server-side**, not a native OS dialog. A browser cannot hand a
  web page a real absolute filesystem path (even `<input type="file" webkitdirectory>` only exposes a
  relative file list — a deliberate browser security limitation, not a bug to work around) — so instead
  the hub-server itself lists directories (same principle as the existing per-project File Explorer's
  `/api/files/tree`, just rooted at the whole machine instead of one project): `GET /api/hub/browse?
  path=<abs>` returns the subdirectories of `path` (folder **names** only — never file contents, never
  file listings, this endpoint has no reason to reveal either); an empty `path` returns starting points
  (the user's home directory, plus, on Windows, the available drive letters). The client renders this
  as a click-through folder tree in a modal — the browser never touches a real path itself, it only
  ever sends back a string the *server* already resolved and confirmed exists.
- **Paste a path** — a plain text field for a path copied from Explorer/Finder's own address bar
  (something most non-technical users already know how to do) — same validation, same endpoint below.
- Both converge on `POST /api/hub/projects { path }`: confirms the folder exists; if it has no
  `.spectoflow/` yet, runs `init` on it automatically (server-side call into the same logic
  `spectoflow init` uses — see `lib/init.js` in the decomposition below, extracted for exactly this
  reuse) instead of erroring or requiring a separate terminal step; then `registry.addProject(path)`
  and redirect the browser straight to `/p/<id>/board`. One click-through flow, zero terminal required
  after the initial `npm install -g spectoflow`.
- The CLI path (`spectoflow dashboard` auto-registering, see §4) keeps working unchanged in parallel —
  added for technical users who prefer it, never the only way in.
- Security note: `/api/hub/browse` is a genuinely wider surface than anything today (it can list
  directory names anywhere reachable on the machine, not just inside one project root) — acceptable
  under this whole tool's existing trust model (a local, single-user dev tool already trusting
  `/api/files/write` to write anywhere under a project root), but folder **names only**, never content,
  keeps it as narrow as the feature actually needs.

## 4. CLI changes

- `spectoflow dashboard` (run inside a project folder):
  1. Register (or touch) the current folder in the global registry.
  2. Check for a running global server via `~/.spectoflow/hub.lock` (same shape as today's
     per-project `.dashboard.lock`, just relocated to the user-level directory) — probe it the same
     way `bin/spectoflow.js` already probes a per-project lock (`probeDashboard`).
  3. Not running → spawn it (detached, same pattern as today), wait for it to come up, then open
     `/p/<id>/board`.
  4. Already running → just open `/p/<id>/board` on that server's port. Never spawns a second server.
- `spectoflow dashboard status/stop/restart` now operate on the one global server, not a per-project
  one — the messaging changes slightly ("stopping the spectoflow hub" rather than "stopping the
  dashboard for `<project>`") but the mechanics (probe → confirm → kill/restart) are the same shape
  already built and tested for the per-project lock.
- New: `spectoflow projects list` (table: id, name, path, last opened) and `spectoflow projects
  remove <id>` — for pruning a project that moved or was deleted. Not auto-pruned on its own; a
  missing path just shows an error card on the hub page rather than silently disappearing (keeps the
  registry legible: nothing vanishes without the user asking).

## Addendum (found while planning): the server must split in two

`server.js` today is a monolith: one `http.createServer` listener plus every `/api/*` route handler,
all closed over the single `ROOT` constant. A single hub process can only ever run **one** copy of
that file — but the project's own core invariant ("canonical framework lives in `.spectoflow/`,"
each project vendors its own copy so it can keep running against an older dashboard version even
after `spectoflow` itself is upgraded globally) means different registered projects may legitimately
carry *different versions* of that logic. Ruling (confirmed with the user): **the frontend is
unavoidably global** — one browser tab can't run two versions of the same SPA depending on which
project happens to be open, so the hub always serves the current globally-installed
`templates/dashboard/public/*` regardless of project. **The backend route logic stays
per-project-vendored**, split out so the hub can load it dynamically per project:

- **`templates/dashboard/handlers.js`** (new, vendored exactly like `server.js` is today — copied by
  `init`/`update`, owned by the ownership/manifest system the same way): everything `server.js`
  currently does *except* the HTTP listener and the lock-file bootstrapping — `project()`,
  `writeConfig()`, `promoteAttention()`, `findPlanFileForTask()`, and every `/api/*` branch,
  parameterized on `root` (a function argument now, not a closed-over constant). Exports a factory,
  e.g. `createHandlers(root) → { handleApi(req, res, u, emit) → Promise<boolean> }` (`true` = this
  route was handled; `false` = fall through to static/SPA serving).
- **`lib/hub-server.js`** (new, global — ships with the npm package under `lib/`, never copied into
  any project's `.spectoflow/`): the actual process `spectoflow dashboard` spawns. Owns the HTTP
  listener, the registry, `/` (hub landing page) and `/p/<id>/...` URL parsing, the per-project SSE
  client map and `fs.watch` set, and — per registered project — `require()`s that project's own
  `<path>/.spectoflow/dashboard/handlers.js` (Node's require cache keys by resolved absolute path, so
  two projects' `handlers.js` files, even identically named, are cached and run completely
  independently; no manual cache-busting needed).

This turns "split server.js" into its own necessary sub-project (see decomposition below) — it did
not exist as a distinct step in the original design.

## Sub-project decomposition (discovered scope exceeds one plan)

Sequenced, each independently planned/implemented/tested/shipped (same rhythm as this session's
0.22.x chantiers) rather than one giant plan:

1. **Registry + CLI `projects` commands** — `lib/registry.js`, `spectoflow projects list/remove`.
   Fully standalone; no change to the dashboard server itself. *(This document's next plan.)*
2. **Server split, single-project parity** — extract `handlers.js` out of today's `server.js`; new
   `lib/hub-server.js` that runs exactly the one project it's pointed at (no `/p/<id>` prefix yet).
   Goal: prove the split preserves 100% of today's behavior before adding concurrency.
3. **Multi-project server core** — `lib/hub-server.js` upgraded from "one fixed project" to a
   registry-resolved `Map<id, …>`, `/p/<id>/...` URL parsing, `/api/events?p=<id>` per-project SSE
   client sets, old-bookmark redirect, a plain placeholder for `GET /` (a bare project list — the
   real landing page is the next sub-project). Proven by its own new tests (same spawn-a-real-hub-
   server style as sub-project 2's). Singularly about proving concurrent per-project isolation works;
   no UI, no Add Project yet.
4. **Hub landing page + Add Project + client routing** — `GET /` becomes the real designed landing
   page (project cards + stats), the `/api/hub/browse` + `/api/hub/projects` endpoints and their
   "+ Add project" modal (§3bis above) — including `lib/init.js` extracted from `bin/spectoflow.js`'s
   CLI-argv/console.log-coupled `init()` (today unusable from server code) so the auto-init step can
   call it directly — and `app.js`'s project-aware fetch (`?p=<id>` on every API call) + navigation
   (path prefix, back-to-hub link). Depends on sub-project 3 (needs the multi-project server core
   already working).
5. **CLI integration finalized** — `spectoflow dashboard` auto-registers into and joins the one
   global hub (global `~/.spectoflow/hub.lock`) instead of spawning its own server; `status/stop/
   restart` operate on the hub.
6. **Test-suite migration + hardening** — adapt the tests that spawn a real dashboard server
   (`dashboard-backend.test.js`, `orchestrate-server.test.js`, `cli-update.test.js`) to the new
   process model; update `CLAUDE.md`'s "Run & test" section (no more direct `node .spectoflow/
   dashboard/server.js`).

## Explicitly out of scope for this pass

- Running an agent/orchestration **across** two projects at once, or any cross-project data view —
  each project's chat/orchestrator/tasks stay fully independent; the hub only changes *how many can
  be open and switched between*, not any cross-project feature.
- Auto-discovery/directory scanning for projects (explicitly decided against — registry is
  self-populated by use).
- Migrating/renaming existing per-project `.dashboard.lock` files or `.spectoflow/` layout — those
  are untouched; only the *server process* model changes.

## Risk / rollout notes

- This touches the most heavily-used, most recently-stabilized part of the codebase
  (`server.js`, the SSE pipeline, `orchestrator.js`) — the implementation plan should preserve every
  existing behavior for the single-project case as a first-class, continuously-tested path (a
  registry with exactly one project must behave identically to today's dashboard in every way that
  isn't the URL prefix itself).
- The existing test suite's pattern of spawning real dashboard servers per test
  (`dashboard-backend.test.js`, `orchestrate-server.test.js`, `cli-update.test.js`) needs to adapt:
  those tests currently assume "start a server, it serves this one project at `/`" — under the new
  model they'll start the global server and hit `/p/<id>/...`. This is a mechanical update across
  several test files, worth calling out explicitly in the implementation plan so it isn't
  under-scoped.
