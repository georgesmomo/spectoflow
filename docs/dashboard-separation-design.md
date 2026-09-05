# Dashboard separation — design (sub-project A of the "one dashboard, many projects" program)

**Status:** approved by user, section-by-section, 2026-09-05. Implementation via `writing-plans`.

## Program context (why this is sub-project A)

The user's target is a spectoflow that is simple for technical and non-technical people alike:
install the package, `spectoflow init` a project (framework only), and manage every project from
**one dashboard that lives outside the projects** — locally today, hosted online tomorrow — which
scans a project when it is added, adapts to it, and follows the agents' work in real time.

That target decomposes into four sub-projects, in dependency order. Each gets its own spec → plan →
implementation cycle and ships on its own:

| | Sub-project | What it delivers | Depends on |
|---|---|---|---|
| **A** | **Dashboard separation** (this document) | Dashboard code leaves the projects; global config; dashboard workspace; pure operations layer | — |
| B | Smart add | Add *any* folder (stack detection, minimal view, "Initialize" button); agent-proposed views on add of a spectoflow project (D46's "Auto", run by default) | A (`kind`, `projects/<id>/`) |
| C | Online dashboard | Same app served online, multi-account (accounts, members with rights, project groups), token management in the UI, `spectoflow dashboard login`, a local connector that pushes state up and executes instructions coming down | A (`ops.js`, `dashboard.url`) |
| D | Theme redesign | All six designs redone: **zero gradients anywhere** (the user reads gradients as "AI-generated"); scheduled right after A so B and C draw their new screens on the final look | A |

A is the foundation: it settles *where things live* and *what the interface between a dashboard and
a project is*. Everything B, C and D need from the structure is put in place here (see "What A
prepares", at the end) without building any of them.

## Problem

Since v0.23 the hub already serves many projects from one process (D58). But the dashboard's
**code** is still vendored into every project (`.spectoflow/dashboard/`: 17 code files + 12 fonts,
plus `lib/store.js`, `agents-registry.js`, `customize-prompts.js`, `custom-dashboard.js`), and the
hub `require()`s each project's own copy. Real-use consequences this session alone:

- A project inited before v0.23.0 has no `handlers.js` → "needs an update" (D59). Every future
  dashboard change is gated on every project running `spectoflow update`.
- A host project whose `package.json` says `"type":"module"` made Node treat the vendored
  CommonJS files as ESM → "dashboard code failed to load" (D62).
- Which version is actually running is never obvious: the hub's own front-end (`PUBLIC`) is the
  package's, but the server logic is the project's — two versions of one feature, per project.
- User data (generated custom views, `dashboard/custom/*.json`) lives inside the dashboard's code
  folder, so "the dashboard" cannot be removed from a project without a data migration.
- The dashboard's own state (project registry, lock) sits loose in `~/.spectoflow/` with no notion
  of a configurable location, no global settings, and no per-project dashboard-side data — none
  of which the online dashboard (C) can be built on.

## Goals

1. **One copy of the dashboard code**, in the npm package. A project contains only the framework.
2. **Any registered project opens** in the hub, whether or not it has run `spectoflow update` —
   the hub reads the project's markdown/config; it never loads code from a project.
3. **Global config** (`~/.spectoflow/config.json`) editable from anywhere with `spectoflow config`,
   including where the dashboard workspace lives and which dashboard URL projects talk to.
4. **A dashboard workspace** (`spectoflow dashboard init [--path]`): the dashboard's own state,
   with a folder per project for dashboard-side data.
5. **A pure operations layer** (`lib/dashboard/ops.js`): every dashboard action as a function
   `(root, args) → result`, HTTP-free, so C can drive the same operations over a WebSocket.
6. **Nothing breaks**: existing projects keep working before, during and after migration; a user
   modification is never deleted silently.

## Non-goals (explicitly deferred)

- Detecting/adding non-spectoflow folders; agent-generated views on add — **B**.
- `dashboard login`, tokens, accounts, the connector, serving online — **C**. In A a remote
  `dashboard.url` is accepted and stored, and answered with a clear "remote dashboards arrive in a
  later release" message; nothing blocks.
- Any visual change to the six designs — **D**. A adds no new gradient anywhere.
- Migrating per-viewer browser prefs (localStorage: design, tab, sidebar) into the workspace.
  YAGNI in A; the `projects/<id>/` folder exists for B/C to fill.
- Splitting the npm package in two (`spectoflow` + a dashboard package). The `lib/dashboard/`
  layout makes that extraction mechanical if C's hosting needs it; two installs would contradict
  the "simple for non-technical users" goal today.

## Design

### 1. Three places, one responsibility each

**The npm package — all the code, one copy.**

```
lib/
  dashboard/
    hub-server.js        (moved from lib/)              HTTP listener, SSE, /p/<id>, hub API, lock
    handlers.js          (moved from templates/)        thin: HTTP route → op, JSON in/out
    ops.js               (NEW)                          pure operations (root, args) → result
    runner.js orchestrator.js summarize.js files.js     (moved from templates/dashboard/)
    public/              (moved from templates/dashboard/public/)  front-end, designs, fonts
  store.js customize-prompts.js custom-dashboard.js   (moved from templates/lib/; agents-registry.js
                                                       is deleted — the dashboard reads adapters.js, §5)
  global-config.js       (NEW)   ~/.spectoflow/config.json: read/write/get/set, defaults, layering
  workspace.js           (NEW)   the dashboard workspace: init, locate, registry, per-project folder
  registry.js            (kept; its file now lives inside the workspace — see §2)
  init.js update.js ownership.js manifest.js adapters.js detect.js mcp.js brand.js   (kept)
```

**The project (`.spectoflow/`) — the framework, versioned with the code.**

```
.spectoflow/
  AGENTS.md README.md workflow.md capabilities.md policy.md config.json
  agents/  skills/
  dashboards/          (NEW name) user-generated custom views, <id>.json  — was dashboard/custom/
  lib/spec-drift.js    kept: run in place by the audit-source skill and the Stop hook
  hooks/spec-drift.js  kept
  package.json         kept ({"type":"commonjs"}, D62 — still needed for the two files above)
  runtime.json         kept, gitignored, unchanged
```

Gone from the project: `dashboard/` (all of it), `lib/store.js`, `lib/agents-registry.js`,
`lib/customize-prompts.js`, `lib/custom-dashboard.js`, `.dashboard.lock`.

The `generate-dashboard` skill validated its output with
`node -e "require('./.spectoflow/lib/custom-dashboard').validateSpec(...)"`. It now runs
`spectoflow dashboard validate <file>` (a new CLI command; `npx spectoflow …` when installed
locally). The validator is the package's `lib/custom-dashboard.js` — one copy, no drift guard
needed for it any more.

**The dashboard workspace — the dashboard's own state.** Default location `~/.spectoflow/`;
the `dashboard/` part is movable.

```
~/.spectoflow/
  config.json          global config (schema in §2)
  dashboard/           the workspace — location = config dashboard.path
    dashboard.json     { "name": "…", "port": 4319, "design": "console" }
    projects.json      the registry (moved here from ~/.spectoflow/projects.json)
    hub.lock           { pid, port, url, startedAt }  (moved here)
    projects/<id>/
      meta.json        { "addedAt", "lastOpened", "kind": "spectoflow" }
                       B adds a scan cache here; C adds members, rights, tokens.
```

`~/.spectoflow/config.json` is created by `bin/postinstall.js` when it can (global, TTY install —
the existing guard), and otherwise lazily by the first command that needs it. The postinstall is a
convenience, never a dependency (its output/effects are not reliable — D37).

### 2. Global config and the CLI

**`lib/global-config.js`** — file `~/.spectoflow/config.json` (honours `SPECTOFLOW_HOME` like
`registry.js` does today, for test isolation):

```json
{
  "dashboard": { "url": "http://localhost:4319", "path": "~/.spectoflow/dashboard" },
  "defaults":  { "agent": "claude", "language": "en", "mode": "semi", "design": "console" }
}
```

- `spectoflow config` lists every key with its effective value and where it comes from
  (`set`/`default`). `spectoflow config get <key>` prints one value. `spectoflow config set <key>
  <value>` writes it (dotted keys: `dashboard.url`, `defaults.agent`, …). Unknown keys are refused
  with the list of valid ones; values are validated per key (`defaults.agent` must be a registry
  id, `defaults.mode` one of autopilot/semi/manual, `dashboard.url` a URL, `dashboard.path` a
  writable path — expanded from `~`).
- **Layering, lowest to highest priority: kit templates < global `defaults.*` < project
  `.spectoflow/config.json`.** `spectoflow init` fills the new project's `config.json` from
  `defaults.*`; after that the project file is the source of truth for that project (a later
  change to a global default does not retro-apply — the project's own file wins, as today).

**`spectoflow dashboard init [--path <dir>] [--port N] [--name "…"] [--design <id>]`**

1. Resolve the target: `--path` (expanded, made absolute), else the current `dashboard.path`,
   else the default. Create `<path>/dashboard.json` (from flags, else sensible defaults; name
   defaults to the folder's name), `<path>/projects/`, and an empty `projects.json` if none exists.
2. **Idempotent**: re-running on an existing workspace never deletes or overwrites what is there;
   flags update `dashboard.json` fields only when explicitly passed.
3. If the previous `dashboard.path` pointed to a *different* workspace whose `projects.json` has
   entries and the new one's is empty, copy the registry over (the user "moved" their dashboard;
   losing the project list would be the surprise). The old folder is left untouched.
4. Write `dashboard.path` to the global config. Print where the workspace is and how to start it.

**`spectoflow dashboard`** (start — from inside a project or from anywhere):

1. Read `dashboard.url`. **Unset and on a TTY → prompt once:** `Dashboard URL
   [http://localhost:4319]:` — Enter accepts the local default; the answer is saved to the global
   config and never asked again. `--url <u>` sets it without prompting (and saves it). Not a TTY
   and unset → local, no prompt, saved.
2. **Local URL** → if no workspace exists at `dashboard.path`, initialize the default one silently
   (zero-config path preserved: a fresh install still works with `spectoflow init` + `spectoflow
   dashboard` and nothing else). Then, exactly as today: probe the lock, join the running hub or
   start it, register the current folder if it is a spectoflow project, open/print the URL.
3. **Remote URL** → print: this version manages local dashboards; remote dashboards (login,
   token) arrive in a later release — then continue with the *local* workspace so the user is
   never stuck. `spectoflow dashboard login` is reserved for C and is listed in help as "coming".
4. The port comes from `dashboard.json` (default 4319); `--port` overrides for this start.

`dashboard status | stop | restart`, `spectoflow status`, `spectoflow projects [remove <id>]`,
`update`'s per-project reload — unchanged in behaviour; they read the lock/registry from the
workspace. `spectoflow dashboard validate <file>` is new (§1).

### 3. The hub and the project interface — what prepares C

**Loading a project.** `getProject(id)` no longer `require()`s anything from the project. It calls
the package's own `createHandlers(root)`. A project is therefore openable the moment it is
registered, whatever spectoflow version it was inited with. `projectErrorMessage()` (D59) shrinks
to two cases: unknown id, folder gone. "Needs an update" cannot happen any more.

**`lib/dashboard/ops.js` — the operations layer.** One exported function per operation, pure
with respect to HTTP: `(root, args, ctx) → result` or `throw new OpError(status, message)`.
`ctx` carries what an operation may need beyond the root: `emit` (SSE broadcast), `workspace`
(for per-project dashboard data), `projectId`. The registry of operations is the contract:

| op | today's route | notes |
|---|---|---|
| `project.read` | `GET /api/project` | the full state payload (`P`) |
| `task.setStatus` | `POST /api/task/:id/status` | granular line write |
| `task.comment` | `POST /api/task/:id/comment` | |
| `task.add` | `POST /api/task` | `store.addTask()` |
| `workflow.toggle` | `POST /api/workflow/toggle` | D60's name-matching preserved |
| `settings.save` | `POST /api/settings` | mode/language/agent/design → project `config.json` |
| `attention.list/add/update/remove/promote` | `/api/attention*` | |
| `run.start` | `POST /api/run` | spawns the agent (`runner.js`) |
| `orchestrate.start` / `orchestrate.approve` | `/api/orchestrate*` | |
| `chat.clear` / `chat.summarize` | `/api/chat/*` | |
| `files.tree/read/write/mkdir` | `/api/files/*` | same traversal/symlink guards |
| `agentfile.read` | `GET /api/agentfile` | |

`handlers.js` becomes a routing table: parse the HTTP request → pick the op → call it → serialize
the result / the `OpError` status. **C plugs a WebSocket message handler onto the same table**
(`{op, args}` → `ops[op](root, args, ctx)`) with the operations untouched — that is the concrete
meaning of "the online dashboard uses the same interface". `runner.js`/`orchestrator.js`/
`summarize.js`/`files.js` keep their current module boundaries; only their location changes.

**Watching.** `watchDirs` gains `.spectoflow/dashboards` (and keeps the legacy
`.spectoflow/dashboard/custom` while it exists — see §4). Nothing else changes in SSE.

**Per-project dashboard data.** When a project is added (hub API or CLI registration),
`workspace.js` creates `projects/<id>/meta.json`. `lastOpened` moves there from the registry entry
over time; in A the registry keeps it too (read: registry; write: both) so nothing that reads the
registry today changes. The registry entry gains `kind: "spectoflow"` (B will add `"folder"`).

### 4. Migration and compatibility — "nothing breaks"

**`update` learns about retired files.** New rule in `lib/update.js`, evaluated before the
existing create/refresh/offer matrix: a path that is **in the project's manifest but not in the
kit** is *retired*. Retired and on-disk hash **equals** the manifest hash (never touched by the
user) → **deleted**, reported as `−  removed`. Retired but the hash **differs** (user modified it)
→ **kept**, reported as `!  kept (you modified it; no longer part of the kit)`. Not even `--force`
deletes a modified file — `--force` overwrites *diverged framework files with the kit's version*;
there is no kit version of a retired file to restore, so there is nothing legitimate to force.
Directories left empty by removals are removed. `--dry-run` lists what would be removed/kept.
A project **without a manifest** (a legacy install, pre-D-manifest) has no hashes to prove a file
untouched, so nothing is ever deleted there: `update` adopts the current kit as usual and prints
one hint naming the leftover folders (`.spectoflow/dashboard/`, the four retired `lib/` files) as
safe to delete by hand — the next `update`, now with a manifest, cannot delete them either (they
are not in it), so the hint is the only path; it is explicit and it is safe.

**Data migration runs before any removal**, as its own step in `update` (and is idempotent):

1. `.spectoflow/dashboard/custom/*.json` → `.spectoflow/dashboards/<same name>` — moved. If the
   destination already exists, the destination is kept and the source is left in place with a
   warning (the user resolves it; nothing is lost).
2. `.spectoflow/.dashboard.lock` is deleted (a per-project lock has no meaning any more).
3. `.gitignore`: the `.spectoflow/.dashboard.lock` line is removed; `.spectoflow/runtime.json`
   stays.
4. Only then are retired files evaluated — `dashboard/custom/` is empty by now (or holds only
   conflicts the warning already named), so the retired-files rule can clear `dashboard/`.

**Workspace migration** (first start of the new hub): if `~/.spectoflow/projects.json` exists and
`<workspace>/projects.json` does not, move it; same for `hub.lock` (a stale one is just removed).
One-time, silent, logged in the hub's startup line.

**Compatibility rules the code must honour:**

- A project **not yet migrated** opens in the new hub (goal 2). Its custom views are read from
  `dashboards/` first, then from the legacy `dashboard/custom/` — so they show up before and after
  `update`. `store.js` owns that lookup; nothing in the front-end knows about two locations.
- The legacy single-project entry point `templates/dashboard/server.js` is **retired** (the file
  disappears from projects through the retired-files rule). `spectoflow dashboard` is the single
  way to start a dashboard. Framework texts that named the old entry point are updated:
  `templates/AGENTS.md` (router step "start the dashboard"), `templates/README.md`, and this
  repository's own `CLAUDE.md` "Run & test" section.
- Skills/agents that named moved files are updated: `skills/generate-dashboard/SKILL.md` (write to
  `.spectoflow/dashboards/`, validate with `spectoflow dashboard validate`), `agents/
  framework-curator.md` (same paths). `skills/audit-source` and `hooks/spec-drift.js` are
  unchanged (their files stay).
- `ownership.js` needs no change: framework-owned = everything in `templates/` minus user-owned —
  the retired-files rule is computed from the *previous* manifest, which is exactly the list of
  files the kit used to ship.
- The CLI's `skill create` / `agent create` / `dashboard create` and `runCustomize` call
  `startRun` from the package's `lib/dashboard/runner.js` (they used to reach into the project's
  copy).

### 5. Testing

- **Existing suite, re-based.** `dashboard-backend.test.js`, `orchestrate-server.test.js`,
  `cli-update.test.js` (and any other test that spawned `templates/dashboard/server.js`) spawn the
  hub (`lib/dashboard/hub-server.js` with `SPECTOFLOW_HOME` isolation) and call the same routes
  under `/api/*?p=<id>`. Assertions are unchanged — that is the parity check for the move.
- **New unit tests, no server:** `ops.*` for every operation in the table (read, mutate, error
  statuses) against a temp project; `global-config` (defaults, get/set, validation, `~`
  expansion, `SPECTOFLOW_HOME`); `workspace` (init, `--path`, idempotence, registry carry-over
  rule, `meta.json` creation); `update` retired files (intact → removed; modified → kept + warning;
  `--dry-run` lists; `--force` still never deletes a modified file; empty dirs removed); data
  migration (custom → dashboards, conflict keeps destination, lock + gitignore cleanup,
  idempotent on a second run); `dashboard validate` CLI.
- **Compatibility tests:** the hub opens a project scaffolded by the *previous* kit layout (a
  fixture with `dashboard/custom/x.json` and no `dashboards/`) without `update`, and its custom
  view is listed; after `update` the view is served from `dashboards/` and `dashboard/` is gone.
- **Drift guards:** the `CZ_KINDS` ↔ `customize-prompts.js` guard is kept. The
  `agents-registry.js` ↔ `adapters.js` guard is deleted together with `agents-registry.js`
  itself: it only ever existed because `.spectoflow/` had to be self-contained (D48). The
  dashboard now reads `lib/adapters.js` directly — one roster, no drift possible.
- **Real QA before release:** `spectoflow update` on the user's two real projects (`todo-list-v2`,
  `georgesmomo.com`), both opened in the new hub before *and* after their migration, custom views
  intact, screenshots (headless Chrome / CDP as in D63) attached to the DECISIONS entry.

### 6. Version and release

**0.24.0.** Visible structural change, no breaking behaviour for a user who does nothing (old
projects open; `spectoflow dashboard` still works with zero config). Documented as D64 with the
migration guide; `docs/ARCHITECTURE.md` updated to the three-places model; `CLAUDE.md` "What
exists" and "Run & test" updated.

## What A prepares for B, C and D (and deliberately does not build)

- **B** — the registry's `kind` field and the `projects/<id>/` folder (scan cache lands there);
  the hub's add flow already auto-inits a folder, B replaces "auto-init" with "detect, show,
  offer to init".
- **C** — `ops.js` is the whole point: a WebSocket handler on the local connector maps
  `{op, args}` to the same functions; `dashboard.url` already exists in the global config and is
  already asked once; `projects/<id>/` is where members/rights/tokens go; `hub-server.js` keeps
  HTTP concerns in one file so a login page and a token API bolt on without touching operations.
- **D** — A adds no gradient and touches no design file; D starts from a clean structural base.

## Migration guide (for the D64 entry and README)

1. `npm install -g spectoflow@0.24`.
2. `spectoflow dashboard` anywhere — the default workspace is created; existing projects are
   carried over. Optional: `spectoflow dashboard init --path <dir>` to put the workspace elsewhere.
3. In each project, `spectoflow update` — removes the vendored dashboard, moves custom views to
   `.spectoflow/dashboards/`. Until you do, the project already opens fine in the new dashboard.
4. `spectoflow config` to review global defaults.
