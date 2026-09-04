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
  way except the URL now carries the project id. All API calls the client makes gain the same
  `/p/<id>/...` prefix (or an equivalent `?p=<id>` — implementation detail decided during planning,
  whichever composes more cleanly with the existing route table in `server.js`).
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
