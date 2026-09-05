# Dashboard Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every line of dashboard code out of projects into the npm package, add a global config and a dashboard workspace, expose every dashboard action as a pure operation, and migrate existing projects without ever deleting a user modification.

**Architecture:** Three places, one responsibility each — the package (`lib/`, all code), the project (`.spectoflow/`, framework only), the workspace (`~/.spectoflow/dashboard/`, dashboard state). The hub loads `lib/dashboard/handlers.js` (a route→op table over `lib/dashboard/ops.js`) for every project instead of `require()`-ing a per-project copy. `spectoflow update` gains a "retired files" rule driven by the previous manifest.

**Tech Stack:** Node ≥ 18, zero runtime dependencies (native `http`/`fs`/`readline`/`crypto`), `node --test`.

**Spec:** `docs/dashboard-separation-design.md` — the binding authority. Read it in full before Task 1.

## Global Constraints

- **Zero runtime dependencies** for the package and the installed framework (native Node only).
- **Everything in English**, including code comments and CLI copy.
- **Never delete a user-modified file** in `update`, not even with `--force`; a project with no manifest gets a hint, never a deletion.
- **A project that never ran `update` must open in the new hub** (the hub never loads code from a project).
- **No new CSS gradient anywhere**; no design file is touched by this plan.
- `SPECTOFLOW_HOME` is the test-isolation env var: global config lives at `$SPECTOFLOW_HOME/config.json`, the default workspace at `$SPECTOFLOW_HOME/dashboard/`. Tests must never touch the real `~/.spectoflow`.
- Version: **0.24.0**. Commit messages end with the session's attribution trailer (see the repo's recent commits).
- Windows is a first-class platform (`path.sep`, `windowsHide`, no real signals) — every test in this repo already runs on Windows.

**Deviation from the spec, recorded here:** the spec's op table names `task.setStatus`; the route it maps (`PATCH /api/task/:id`) applies a general patch (`status`, `owner`, `level`…), so the op is named `task.update`. Everything else follows the spec's table verbatim.

---

## File structure (locked in)

```
lib/
  dashboard/
    hub-server.js        git mv lib/hub-server.js               (Task 2)
    handlers.js          git mv templates/dashboard/handlers.js  (Task 2), rewritten as a route table (Task 3)
    ops.js               NEW                                     (Task 3)
    runner.js orchestrator.js summarize.js files.js   git mv from templates/dashboard/ (Task 2)
    public/              git mv templates/dashboard/public/      (Task 2)
  store.js customize-prompts.js custom-dashboard.js   git mv from templates/lib/ (Task 2)
  adapters.js            + knownAgents()                          (Task 1)
  detect.js              + isAgentInstalled(), installedAgents()  (Task 1)
  global-config.js       NEW                                     (Task 5)
  workspace.js           NEW                                     (Task 6)
  registry.js            registryDir() → the workspace           (Task 6)
  update.js              data migration + retired-files rule     (Task 8)
  init.js                defaults from global config; no .dashboard.lock gitignore line (Task 5, 8)
templates/
  dashboards/.gitkeep    NEW — the custom-views folder ships empty (Task 4)
  (dashboard/ and lib/{store,agents-registry,customize-prompts,custom-dashboard}.js are gone)
bin/spectoflow.js        config · dashboard init/validate/login · URL prompt · update rows (Tasks 4-8)
bin/postinstall.js       ensures ~/.spectoflow/config.json (Task 5)
test/                    re-based on the hub (Task 2) + new files per task
```

---

### Task 1: One agent roster — merge `agents-registry.js` into `adapters.js` + `detect.js`

The dashboard's `agents-registry.js` only existed because `.spectoflow/` had to be self-contained. Once the dashboard lives in the package it reads `lib/adapters.js` directly. This task does the merge **before** any file moves, so the move itself stays a pure relocation.

**Files:**
- Modify: `lib/adapters.js` (add `knownAgents()`; export it)
- Modify: `lib/detect.js` (add `isAgentInstalled`, `installedAgents`)
- Modify: `templates/dashboard/runner.js:11-23`, `templates/dashboard/handlers.js:23,42-43,58-65`, `templates/dashboard/summarize.js` (wherever it requires `agents-registry`)
- Delete: `templates/lib/agents-registry.js`, `test/agents-registry.test.js`
- Test: `test/agents-roster.test.js` (new)

**Interfaces:**
- Produces: `adapters.knownAgents() → [{ id, label, bin, dirs, runner, headless, docsUrl }]` (REGISTRY order); `detect.isAgentInstalled(id, projectRoot, opts) → boolean`; `detect.installedAgents(projectRoot, opts) → string[]`.

- [ ] **Step 1: Write the failing test**

```js
// test/agents-roster.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const adapters = require('../lib/adapters');
const detect = require('../lib/detect');

function bindir(...bins) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-roster-'));
  for (const b of bins) fs.writeFileSync(path.join(d, b), '');
  return d;
}

test('knownAgents() is REGISTRY flattened to the dashboard shape, same order, every field present', () => {
  const known = adapters.knownAgents();
  assert.strictEqual(known.length, adapters.REGISTRY.length);
  adapters.REGISTRY.forEach((a, i) => {
    const k = known[i];
    assert.deepStrictEqual(k, { id: a.id, label: a.label, bin: a.detect.bin, dirs: a.detect.dirs || [], runner: a.runner, headless: a.headless, docsUrl: a.docsUrl });
    assert.match(k.docsUrl || '', /^https:\/\//, `${a.id} has a docs URL`);
    assert.strictEqual(typeof k.headless, 'boolean', `${a.id} declares headless explicitly`);
  });
});

test('isAgentInstalled: true when the bin is on PATH, false for an unknown id', () => {
  const bin = bindir('claude');
  const opts = { env: { PATH: bin }, platform: 'linux' };
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-roster-proj-'));
  assert.strictEqual(detect.isAgentInstalled('claude', proj, opts), true);
  assert.strictEqual(detect.isAgentInstalled('codex', proj, opts), false);
  assert.strictEqual(detect.isAgentInstalled('not-an-agent', proj, opts), false);
});

test('isAgentInstalled: true when the project has the agent\'s config dir even with an empty PATH', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-roster-proj2-'));
  fs.mkdirSync(path.join(proj, '.codex'));
  assert.strictEqual(detect.isAgentInstalled('codex', proj, { env: { PATH: '' }, platform: 'linux' }), true);
});

test('installedAgents lists installed ids in REGISTRY order', () => {
  const bin = bindir('codex', 'claude');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-roster-proj3-'));
  const ids = detect.installedAgents(proj, { env: { PATH: bin }, platform: 'linux' });
  assert.deepStrictEqual(ids, ['claude', 'codex']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/agents-roster.test.js`
Expected: FAIL — `adapters.knownAgents is not a function`.

- [ ] **Step 3: Add `knownAgents()` to `lib/adapters.js`**

Just above `module.exports = { generate, defaultRunners, REGISTRY };` add:

```js
// The dashboard's flat view of REGISTRY (id/label/bin/dirs/runner/headless/docsUrl) — one roster for
// the CLI and the dashboard, now that the dashboard ships in this package (D64).
function knownAgents() {
  return REGISTRY.map((a) => ({ id: a.id, label: a.label, bin: a.detect.bin, dirs: a.detect.dirs || [], runner: a.runner, headless: a.headless, docsUrl: a.docsUrl }));
}
```
and export it: `module.exports = { generate, defaultRunners, REGISTRY, knownAgents };`

- [ ] **Step 4: Add the two detection helpers to `lib/detect.js`**

Replace the `module.exports` line with:

```js
// True if `id` looks genuinely installed: its bin resolves on PATH, or the project already has its
// config dir (a project can be set up for an agent whose bin isn't on THIS machine's PATH, e.g. a
// remote/CI runner). Unknown ids are never "installed".
function isAgentInstalled(id, projectRoot, opts) {
  const a = REGISTRY.find((x) => x.id === id);
  if (!a) return false;
  if (a.detect.bin && binOnPath(a.detect.bin, opts)) return true;
  return (a.detect.dirs || []).some((d) => fs.existsSync(path.join(projectRoot, d)));
}

// ids of every known agent actually installed for this project, in REGISTRY (priority) order.
function installedAgents(projectRoot, opts) {
  return REGISTRY.filter((a) => isAgentInstalled(a.id, projectRoot, opts)).map((a) => a.id);
}

module.exports = { binOnPath, detectAgents, isAgentInstalled, installedAgents };
```

- [ ] **Step 5: Switch the dashboard files to the merged roster**

In `templates/dashboard/runner.js`: replace `const agentsRegistry = require('../lib/agents-registry');` with
```js
const adapters = require(require('path').join(__dirname, '..', '..', 'lib', 'adapters'));
const detect = require(require('path').join(__dirname, '..', '..', 'lib', 'detect'));
```
and in `resolveRunnerCommand`: `agentsRegistry.KNOWN_AGENTS.find` → `adapters.knownAgents().find`, `agentsRegistry.isAgentInstalled(` → `detect.isAgentInstalled(`.

In `templates/dashboard/handlers.js`: same two requires replace line 23; `agentsRegistry.KNOWN_AGENTS` → `adapters.knownAgents()` (3 places), `agentsRegistry.isAgentInstalled` → `detect.isAgentInstalled`, `agentsRegistry.installedAgents` → `detect.installedAgents`.

In `templates/dashboard/summarize.js`: `grep -n agents-registry templates/dashboard/summarize.js` — if it requires it, apply the same replacement; if not, nothing to do.

(The `__dirname/../../lib` requires are temporary: these files still sit under `templates/` until Task 2 moves them, and the package's `lib/` is two levels up from there. Task 2 rewrites them to `../adapters` / `../detect`.)

- [ ] **Step 6: Delete the old roster and its drift guard**

```bash
git rm templates/lib/agents-registry.js test/agents-registry.test.js
```
`grep -rn "agents-registry" lib templates bin test` must print nothing.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all pass (the previous count minus the 3 deleted drift tests plus 4 new; the known Windows symlink skip remains).

- [ ] **Step 8: Commit**

```bash
git add -A lib/adapters.js lib/detect.js templates/dashboard test/agents-roster.test.js
git commit -m "refactor: one agent roster — knownAgents() on adapters, installed checks on detect"
```

---

### Task 2: Move the dashboard into the package and run the hub off it (parity)

Pure relocation with `git mv`, requires re-pointed, `templates/dashboard/server.js` retired, and the hub made to load the package's `handlers.js` for every project. The existing test suite, re-based onto the hub, is the parity check.

**Files:**
- Move: `templates/dashboard/{handlers,runner,orchestrator,summarize,files}.js` → `lib/dashboard/`; `templates/dashboard/public/` → `lib/dashboard/public/`; `lib/hub-server.js` → `lib/dashboard/hub-server.js`; `templates/lib/{store,customize-prompts,custom-dashboard}.js` → `lib/`
- Delete: `templates/dashboard/server.js`, `templates/dashboard/custom/.gitkeep`
- Modify: `lib/dashboard/hub-server.js`, `lib/init.js:15`, `bin/spectoflow.js:7,15,16,272`, requires inside every moved file
- Modify tests: `test/dashboard-backend.test.js`, `test/dashboard-agents-api.test.js`, `test/orchestrate-server.test.js`, `test/hub-server.test.js`, `test/ownership.test.js`, `test/esm-host-project.test.js`, `test/cli-update.test.js`, plus every `require('../templates/...')` in `test/`

**Interfaces:**
- Produces: `lib/dashboard/handlers.js#createHandlers(root) → { handleApi, watchDirs, onBoot }` (unchanged shape); `lib/dashboard/hub-server.js` started with `SPECTOFLOW_HOME` + `SPECTOFLOW_PORT`; `require('../lib/store')` etc. from tests.

- [ ] **Step 1: Move the files (history-preserving)**

```bash
mkdir -p lib/dashboard
git mv templates/dashboard/handlers.js templates/dashboard/runner.js templates/dashboard/orchestrator.js templates/dashboard/summarize.js templates/dashboard/files.js lib/dashboard/
git mv templates/dashboard/public lib/dashboard/public
git mv lib/hub-server.js lib/dashboard/hub-server.js
git mv templates/lib/store.js templates/lib/customize-prompts.js templates/lib/custom-dashboard.js lib/
git rm templates/dashboard/server.js templates/dashboard/custom/.gitkeep
rmdir templates/dashboard 2>/dev/null; ls templates
```
`templates/lib/` must now contain only `spec-drift.js`.

- [ ] **Step 2: Re-point requires inside the moved files**

- `lib/dashboard/runner.js`: the two Task-1 requires become `const adapters = require('../adapters'); const detect = require('../detect');`; `require('../lib/store')` → `require('../store')`.
- `lib/dashboard/handlers.js`: same; `require('../lib/store')` → `require('../store')`.
- `lib/dashboard/orchestrator.js`, `lib/dashboard/summarize.js`: `require('../lib/store')` → `require('../store')`.
- `lib/store.js`: `require('./custom-dashboard')` is already right.
- `lib/init.js:15`: `require('../templates/lib/store')` → `require('./store')`.
- `bin/spectoflow.js`: line 7 → `require('../lib/store')`; line 15 → `require('../lib/dashboard/runner')`; line 16 → `require('../lib/customize-prompts')`; in `startDashboard()` → `const hubPath = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');`.
- Check: `grep -rn "templates/lib\|templates/dashboard\|'\.\./lib/store'\|agents-registry" lib bin` prints nothing.

- [ ] **Step 3: Make the hub load the package's handlers (`lib/dashboard/hub-server.js`)**

Replace the header constants and `getProject`/`projectErrorMessage`/`reloadProject`/`projectStats`:

```js
const registry = require('../registry');
const { createHandlers } = require('./handlers');
const store = require('../store');

const PORT = process.env.SPECTOFLOW_PORT ? Number(process.env.SPECTOFLOW_PORT) : 4319;
const PUBLIC = path.join(__dirname, 'public');
const TEMPLATES = path.join(__dirname, '..', '..', 'templates');
const VERSION = require('../../package.json').version;
```

```js
// id -> { id, root, handlers, clients:Set, emit, watchers:[] }. The route logic is THIS package's
// handlers.js for every project (D64): nothing is ever require()'d from a project, so a project that
// has never run `spectoflow update` opens exactly like a fresh one.
const projects = new Map();
function getProject(id) {
  if (projects.has(id)) return projects.get(id);
  const entry = registry.listProjects().find((p) => p.id === id);
  if (!entry || !fs.existsSync(entry.path)) return null;
  const handlers = createHandlers(entry.path);
  const clients = new Set();
  const emit = (obj) => { const line = 'data: ' + JSON.stringify(obj) + '\n\n'; for (const res of clients) res.write(line); };
  handlers.onBoot();
  const watchers = [];
  handlers.watchDirs.forEach((d) => {
    const dir = path.join(entry.path, d);
    if (fs.existsSync(dir)) { try { watchers.push(fs.watch(dir, { recursive: false }, () => emit({ type: 'change' }))); } catch (_) {} }
  });
  const proj = { id, root: entry.path, handlers, clients, emit, watchers };
  projects.set(id, proj);
  return proj;
}

// Only called after getProject(id) returned null. Two causes remain (D64 removed "needs an update").
function projectErrorMessage(id) {
  const entry = registry.listProjects().find((p) => p.id === id);
  if (!entry) return 'Unknown project.';
  return `Project "${entry.name}" is registered, but its folder no longer exists at ${entry.path}.`;
}

// Re-opens a project: drops its cached entry and closes its watchers so the next request re-runs
// onBoot and re-watches (a project's dirs may have changed after `spectoflow update`). Returns false
// (a harmless no-op) if this id was never loaded.
function reloadProject(id) {
  const proj = projects.get(id);
  if (!proj) return false;
  proj.watchers.forEach((w) => { try { w.close(); } catch (_) {} });
  projects.delete(id);
  return true;
}

function projectStats(root) {
  try {
    const plans = store.readPlans(root);
    let total = 0, done = 0;
    for (const pl of plans) for (const ph of pl.phases) for (const t of ph.tasks) { total++; if (t.status === 'done') done++; }
    return { total, done };
  } catch { return null; }
}
```
Also `addHubProject`: `require('./init')` → `require('../init')`. Update the file's header comment (the paragraph about "each project's own vendored handlers.js") to say the route logic is the package's.

- [ ] **Step 4: Re-base the three single-server test files onto the hub**

In each of `test/dashboard-backend.test.js`, `test/dashboard-agents-api.test.js`, `test/orchestrate-server.test.js`:

1. `require('../templates/lib/store')` → `require('../lib/store')`; add `const registry = require('../lib/registry');`.
2. Replace `const SERVER = path.join(KIT, 'templates', 'dashboard', 'server.js');` with `const HUB = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');`.
3. Replace the `startServer` function with:

```js
// The hub serves many projects; every /api/* call carries ?p=<id>. `withP()` appends the id of the
// project the current test started, so the request helpers below stay one-liners.
let currentId = null;
const withP = (p) => p + (p.includes('?') ? '&' : '?') + 'p=' + currentId;
function startServer(root, port, extraEnv = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-home-'));
  currentId = registry.addProject(root, path.join(home, 'dashboard')).id;
  return new Promise((resolve) => {
    const srv = spawn('node', [HUB], { env: { ...process.env, ...extraEnv, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(srv); });
  });
}
```
4. In every request helper of the file (`get`, `post`, `patch`, `del`, `req`, `sse`… whatever the file defines), pass the path through `withP(...)` where the `path:` option is built — e.g. `http.get({ host: '127.0.0.1', port, path: withP(p) }, …)` and `http.request({ …, path: withP(p), … })`. Test bodies stay untouched.
5. `dashboard-agents-api.test.js` passes `extraEnv` (a fake PATH) to `startServer` — keep that third argument working as shown above.

(`registry.addProject(root, baseDir)` with an explicit baseDir = `<home>/dashboard` is where Task 6 will put the workspace; using it now keeps these files stable across Task 6.)

- [ ] **Step 5: Fix the remaining test couplings**

- `sed -i "s#'../templates/lib/store'#'../lib/store'#; s#'../templates/lib/custom-dashboard'#'../lib/custom-dashboard'#; s#'../templates/lib/customize-prompts'#'../lib/customize-prompts'#; s#'../templates/dashboard/orchestrator'#'../lib/dashboard/orchestrator'#; s#'../templates/dashboard/files'#'../lib/dashboard/files'#; s#'../templates/dashboard/public/charts'#'../lib/dashboard/public/charts'#; s#'../templates/dashboard/public/stats'#'../lib/dashboard/public/stats'#" test/*.js`
- `test/cli-customize.test.js` mentions `templates/dashboard/public/app.js` in a comment and may read it — `grep -n "public/app.js" test/cli-customize.test.js test/customize-prompts.test.js` and re-point any path to `lib/dashboard/public/app.js`.
- `test/ownership.test.js`: replace the two assertions `files.includes('lib/store.js')` / `files.includes('dashboard/server.js')` with
  ```js
  assert.ok(files.includes('lib/spec-drift.js'), 'the in-project drift tool');
  assert.ok(files.includes('package.json'), 'the type:commonjs pin (D62)');
  assert.ok(!files.some((f) => f.startsWith('dashboard/')), 'the dashboard no longer ships into projects (D64)');
  assert.ok(!files.includes('lib/store.js'), 'the storage engine lives in the package now');
  ```
- `test/hub-server.test.js`:
  - `project(home, prefix)` → `return registry.addProject(d, path.join(home, 'dashboard'));`
  - the lock test: `registry.hubLockPath(home)` → `registry.hubLockPath(path.join(home, 'dashboard'))`.
  - the test at line ~338 that `fs.unlinkSync(... 'dashboard', 'handlers.js')` and expects "needs an update": rename it `a project that never ran update (no .spectoflow/dashboard at all) opens normally` and make it `fs.rmSync(path.join(a.path, '.spectoflow', 'dashboard'), { recursive: true, force: true })` (a no-op on a fresh init now, kept for legacy fixtures), then assert `GET /api/project?p=<id>` is 200 and `/p/<id>/board` is 200.
- `test/cli-update.test.js`: `registry.findByPath(projA, home)` → `registry.findByPath(projA, path.join(home, 'dashboard'))` (same for `projB`); `const lockPath = path.join(home, 'hub.lock')` → `path.join(home, 'dashboard', 'hub.lock')`. (These paths become real in Task 6; until then the registry/lock still land at `home/` — so **for this task only**, keep the old paths and put a `// TODO(Task 6)` marker? No: markers are plan failures. Instead make Task 2's hub honour the workspace path already: in `lib/registry.js` change `registryDir` to `return baseDir || path.join(process.env.SPECTOFLOW_HOME || path.join(os.homedir(), '.spectoflow'), 'dashboard');` — Task 6 replaces this line with the global-config-driven one.) Apply the same `path.join(home, 'dashboard')` in `test/cli-projects.test.js` wherever `registry.addProject(proj, home)` / `registry.readRegistry(home)` appear.
- `test/esm-host-project.test.js`: keep test 1. Replace test 2 with a hub-level check (the premise "Node loads the project's code" is gone):
  ```js
  test('the hub opens a project whose own package.json says "type":"module"', async () => {
    const proj = initModuleTypeProject();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-esm-home-'));
    const entry = require('../lib/registry').addProject(proj, path.join(home, 'dashboard'));
    const port = 7600 + Math.floor(Math.random() * 100);
    const { spawn } = require('node:child_process');
    const HUB = path.resolve(__dirname, '..', 'lib', 'dashboard', 'hub-server.js');
    const srv = await new Promise((resolve) => {
      const s = spawn('node', [HUB], { env: { ...process.env, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
      s.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(s); });
    });
    try {
      const res = await fetch(`http://localhost:${port}/api/project?p=${entry.id}`);
      assert.strictEqual(res.status, 200);
    } finally { srv.kill(); }
  });
  ```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all pass. If a re-based file fails on a `?p=` missing, a helper in that file still bypasses `withP()`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: the dashboard ships in the package — hub loads lib/dashboard/handlers.js for every project"
```

---

### Task 3: `ops.js` — pure operations; `handlers.js` becomes a route table

**Files:**
- Create: `lib/dashboard/ops.js`
- Rewrite: `lib/dashboard/handlers.js`
- Test: `test/ops.test.js` (new)

**Interfaces:**
- Consumes: `store`, `files`, `runner.startRun`, `summarize.runSummarize`, `orchestrator`, `adapters.knownAgents`, `detect.isAgentInstalled/installedAgents` (Task 1-2 locations).
- Produces: `ops[name](root, args, ctx) → Promise<result> | result`, throws `OpError(status, message)`; `ctx = { emit }`. `handlers.createHandlers(root)` unchanged shape. Every op in the spec's table (with `task.update`).

- [ ] **Step 1: Write the failing tests**

```js
// test/ops.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ops, OpError } = require('../lib/dashboard/ops');
const store = require('../lib/store');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function project() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ops-')); execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' }); return d; }
function ctx() { const events = []; return { emit: (e) => events.push(e), events }; }

test('project.read returns the full payload with projectName, version and the agent roster', async () => {
  const root = project();
  const p = await ops['project.read'](root, {}, ctx());
  assert.strictEqual(p.projectName, path.basename(root));
  assert.strictEqual(p.version, require('../package.json').version);
  assert.ok(Array.isArray(p.knownAgents) && p.knownAgents.length > 5);
  assert.ok(Array.isArray(p.installedAgents));
});

test('task.add creates a task and emits a change; an empty title is a 400', async () => {
  const root = project(); const c = ctx();
  const r = await ops['task.add'](root, { title: 'Write the thing' }, c);
  assert.match(r.task.id, /^T-\d+/);
  assert.deepStrictEqual(c.events, [{ type: 'change' }]);
  await assert.rejects(() => ops['task.add'](root, { title: '  ' }, ctx()), (e) => e instanceof OpError && e.status === 400);
});

test('task.update patches a task line; an unknown id is a 404', async () => {
  const root = project(); const c = ctx();
  const { task } = await ops['task.add'](root, { title: 'Patch me' }, c);
  await ops['task.update'](root, { id: task.id, patch: { status: 'in_progress' } }, c);
  const all = store.readPlans(root).flatMap((pl) => pl.phases.flatMap((ph) => ph.tasks));
  assert.strictEqual(all.find((t) => t.id === task.id).status, 'in_progress');
  await assert.rejects(() => ops['task.update'](root, { id: 'T-999', patch: {} }, c), (e) => e.status === 404);
});

test('workflow.toggle flips a step whose line carries a {cap:...} annotation (D60)', async () => {
  const root = project(); const c = ctx();
  const before = store.readWorkflow(root).find((s) => s.name === 'Brainstorm').enabled;
  await ops['workflow.toggle'](root, { name: 'Brainstorm' }, c);
  assert.strictEqual(store.readWorkflow(root).find((s) => s.name === 'Brainstorm').enabled, !before);
});

test('settings.save refuses an agent that is not installed (400) and accepts mode/language', async () => {
  const root = project(); const c = ctx();
  await assert.rejects(() => ops['settings.save'](root, { agent: 'goose' }, { ...c, env: { PATH: '' } }), (e) => e.status === 400);
  const r = await ops['settings.save'](root, { mode: 'manual', language: 'fr' }, c);
  assert.strictEqual(r.config.mode, 'manual');
  assert.strictEqual(r.config.language, 'fr');
});

test('attention.add / update / promote / remove round-trip through runtime.json', async () => {
  const root = project(); const c = ctx();
  const { item } = await ops['attention.add'](root, { text: 'look at this' }, c);
  const upd = await ops['attention.update'](root, { id: item.id, patch: { text: 'look harder' } }, c);
  assert.strictEqual(upd.item.text, 'look harder');
  const prom = await ops['attention.promote'](root, { id: item.id }, c);
  assert.match(prom.task.id, /^T-/);
  assert.strictEqual(store.readRuntime(root).attention[0].status, 'resolved');
  await ops['attention.remove'](root, { id: item.id }, c);
  assert.strictEqual(store.readRuntime(root).attention.length, 0);
  await assert.rejects(() => ops['attention.update'](root, { id: 'nope', patch: {} }, c), (e) => e.status === 404);
});

test('files.write rejects a path outside the root with a 400 and never emits', async () => {
  const root = project(); const c = ctx();
  await assert.rejects(() => ops['files.write'](root, { path: '../escape.txt', content: 'x' }, c), (e) => e.status === 400);
  assert.strictEqual(c.events.length, 0);
});

test('agentfile.read serves an agent file and 400s on traversal', async () => {
  const root = project();
  const ok = await ops['agentfile.read'](root, { path: 'agents/business-analyst.md' }, ctx());
  assert.ok(ok.content.length > 0);
  await assert.rejects(() => ops['agentfile.read'](root, { path: '../config.json' }, ctx()), (e) => e.status === 400);
});

test('chat.clear empties the message log and emits', async () => {
  const root = project(); const c = ctx();
  const rt = store.readRuntime(root); rt.messages = [{ role: 'user', text: 'hi' }]; store.writeRuntime(root, rt);
  await ops['chat.clear'](root, {}, c);
  assert.deepStrictEqual(store.readRuntime(root).messages, []);
  assert.deepStrictEqual(c.events, [{ type: 'change' }]);
});

test('every op named in the spec table exists', () => {
  for (const name of ['project.read', 'agentfile.read', 'files.tree', 'files.read', 'files.write', 'files.mkdir', 'task.add', 'task.update', 'task.comment', 'workflow.toggle', 'run.start', 'chat.summarize', 'chat.clear', 'orchestrate.start', 'orchestrate.approve', 'settings.save', 'attention.add', 'attention.promote', 'attention.update', 'attention.remove'])
    assert.strictEqual(typeof ops[name], 'function', name);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/ops.test.js`
Expected: FAIL — `Cannot find module '../lib/dashboard/ops'`.

- [ ] **Step 3: Write `lib/dashboard/ops.js`**

```js
'use strict';
/*
 * The dashboard's operations — one pure function per action, (root, args, ctx) → result, with no
 * HTTP in sight. handlers.js maps HTTP routes onto this table; the online dashboard (sub-project C)
 * will map WebSocket messages onto the very same table. ctx.emit broadcasts SSE events to every
 * client of this project; ops call it themselves after a successful mutation so any caller gets
 * the same live behaviour. Errors are OpError(status, message) — the transport turns status into
 * its own vocabulary (HTTP status code today).
 */
const fs = require('fs');
const path = require('path');
const store = require('../store');
const files = require('./files');
const { startRun } = require('./runner');
const { runSummarize } = require('./summarize');
const orchestrator = require('./orchestrator');
const adapters = require('../adapters');
const detect = require('../detect');

const PKG_VERSION = require('../../package.json').version;

class OpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new OpError(400, msg); };
const notFound = (msg) => { throw new OpError(404, msg); };
const text = (v, msg) => { if (!v || !String(v).trim()) bad(msg); return String(v).trim(); };

function frameworkVersion(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.spectoflow', '.manifest.json'), 'utf8')).version || PKG_VERSION; } catch { return PKG_VERSION; }
}
function findPlanFileForTask(root, id) {
  for (const pl of store.readPlans(root)) for (const ph of pl.phases) if (ph.tasks.find((t) => t.id === id)) return pl.file;
  return null;
}
function readAgentFile(root, rel) {
  const base = path.join(root, '.spectoflow');
  const aDir = path.join(base, 'agents'), sDir = path.join(base, 'skills');
  const abs = path.resolve(base, rel || '');
  const okDir = abs.startsWith(aDir + path.sep) || abs.startsWith(sDir + path.sep);
  if (!okDir || !abs.endsWith('.md') || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) bad('not an agent/skill file');
  let real; try { real = fs.realpathSync(abs); } catch { real = null; }
  const realA = (() => { try { return fs.realpathSync(aDir); } catch { return aDir; } })();
  const realS = (() => { try { return fs.realpathSync(sDir); } catch { return sDir; } })();
  const okReal = real && (real.startsWith(realA + path.sep) || real.startsWith(realS + path.sep));
  if (!okReal || !real.endsWith('.md') || fs.statSync(real).isDirectory()) bad('not an agent/skill file');
  return { content: fs.readFileSync(real, 'utf8') };
}
function writeConfig(root, patch, detectOpts) {
  const cp = path.join(root, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
  if (patch.mode && ['autopilot', 'semi', 'manual'].includes(patch.mode)) cfg.mode = patch.mode;
  if (typeof patch.language === 'string' && patch.language.trim()) cfg.language = patch.language.trim();
  if (typeof patch.design === 'string' && /^[a-z0-9-]{1,40}$/.test(patch.design)) cfg.design = patch.design;
  if (typeof patch.agent === 'string' && patch.agent.trim()) {
    const id = patch.agent.trim();
    const known = adapters.knownAgents().find((a) => a.id === id);
    // Never activate an agent whose CLI isn't actually there — it would just fail silently later.
    if (!detect.isAgentInstalled(id, root, detectOpts)) bad(`${known ? known.label : id} isn't installed here (its command wasn't found on PATH). Install it, then try again.`);
    cfg.agent = id;
    if (known && known.runner) { cfg.runners = cfg.runners || {}; if (!cfg.runners[id]) cfg.runners[id] = known.runner; }
  }
  fs.writeFileSync(cp, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}
const filesResult = (r) => { if (r.error) bad(r.error); return r; };
const changed = (ctx, result) => { ctx.emit({ type: 'change' }); return result; };

const ops = {
  'project.read': (root) => {
    const p = store.readProject(root);
    p.version = frameworkVersion(root);
    p.projectName = path.basename(root);
    p.knownAgents = adapters.knownAgents().map((a) => ({ id: a.id, label: a.label, headless: a.headless, docsUrl: a.docsUrl }));
    p.installedAgents = detect.installedAgents(root);
    return p;
  },
  'agentfile.read': (root, { path: rel }) => readAgentFile(root, rel),

  'files.tree': (root) => ({ tree: files.tree(root) }),
  'files.read': (root, { path: rel }) => filesResult(files.readFile(root, rel || '')),
  'files.write': (root, { path: rel, content }, ctx) => changed(ctx, filesResult(files.writeFile(root, rel, content))),
  'files.mkdir': (root, { path: rel }, ctx) => changed(ctx, filesResult(files.mkdir(root, rel))),

  'task.add': (root, { title, phase, file, owner, level }, ctx) => {
    const t = store.addTask(root, { title: text(title, 'A title is required.'), phase, file, owner, level });
    return changed(ctx, { task: t });
  },
  'task.update': (root, { id, patch }, ctx) => {
    const file = findPlanFileForTask(root, id); if (!file) notFound(`Task ${id} not found.`);
    store.updateTaskLine(root, file, id, patch || {});
    return changed(ctx, { ok: true });
  },
  'task.comment': (root, { id, text: body, action }, ctx) => {
    const msg = text(body, 'Empty comment.');
    const file = findPlanFileForTask(root, id); if (!file) notFound(`Task ${id} not found.`);
    store.addTaskComment(root, file, id, msg, 'me');
    if (action === 'analyze') store.updateTaskLine(root, file, id, { status: 'to_analyze' });
    return changed(ctx, { ok: true });
  },
  'workflow.toggle': (root, { name }, ctx) => {
    const wf = path.join(root, '.spectoflow', 'workflow.md');
    const lines = fs.readFileSync(wf, 'utf8').split('\n');
    // Strip the trailing {cap:... skill:... policy} annotation BEFORE "(optional)" — the same order as
    // store.readWorkflow(), which is what the client's step names come from (D60).
    const stepName = (rest) => { const ann = rest.match(/\{([^}]*)\}\s*$/); if (ann) rest = rest.slice(0, ann.index).trim(); return rest.replace(/\s*\(optional\)\s*$/i, '').trim(); };
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*- \[)( |x|X)(\]\s+)(.*)$/);
      if (m && stepName(m[4]) === name) lines[i] = m[1] + (m[2].trim() ? ' ' : 'x') + m[3] + m[4];
    }
    fs.writeFileSync(wf, lines.join('\n'));
    return changed(ctx, { ok: true });
  },

  'run.start': (root, { prompt, agent }, ctx) => {
    text(prompt, 'Empty request.');
    const r = startRun(root, { prompt, agent }, ctx.emit);
    if (r.error) bad(r.error);
    return { runId: r.runId };
  },
  'chat.summarize': (root, { agent }, ctx) => {
    const r = runSummarize(root, { agent }, ctx.emit);
    if (r.error) bad(r.error);
    return { ok: true };
  },
  'chat.clear': (root, _args, ctx) => {
    const rt = store.readRuntime(root); rt.messages = []; store.writeRuntime(root, rt);
    return changed(ctx, { ok: true });
  },
  'orchestrate.start': (root, { request }, ctx) => {
    const req = text(request, 'Empty request.');
    const active = store.readRuntime(root).orchestration;
    if (active && ['running', 'awaiting_approval'].includes(active.status)) throw new OpError(409, 'An orchestration is already active.');
    const mode = store.readConfig(root).mode || 'semi';
    orchestrator.runOrchestration({ root, request: req, mode, runStep: orchestrator.defaultRunStep, confirm: orchestrator.defaultConfirm }, ctx.emit)
      .catch((e) => ctx.emit({ type: 'message', message: { role: 'orchestrator', kind: 'status', text: 'orchestration error: ' + e.message } }));
    const o = store.readRuntime(root).orchestration;
    return { orchestrationId: o && o.id };
  },
  'orchestrate.approve': (_root, { decision, note }) => {
    if (!orchestrator.submitDecision(decision, note)) throw new OpError(409, 'No pending approval.');
    return { ok: true };
  },

  'settings.save': (root, patch, ctx) => changed(ctx, { config: writeConfig(root, patch || {}, ctx.env ? { env: ctx.env } : undefined) }),

  'attention.add': (root, { text: body }, ctx) => {
    const msg = text(body, 'Empty note.');
    const rt = store.readRuntime(root); rt.attention = rt.attention || [];
    const item = { id: 'att' + Date.now().toString(36), at: new Date().toISOString(), by: 'me', source: 'user', status: 'open', text: msg };
    rt.attention.unshift(item); store.writeRuntime(root, rt);
    return changed(ctx, { item });
  },
  'attention.promote': (root, { id }, ctx) => {
    const rt = store.readRuntime(root); const it = (rt.attention || []).find((x) => x.id === id);
    if (!it) notFound('Note not found.');
    const t = store.addTask(root, { phase: 'Attention', title: it.text, owner: 'user' });
    it.status = 'resolved'; it.promotedTo = t.id; store.writeRuntime(root, rt);
    return changed(ctx, { task: t });
  },
  'attention.update': (root, { id, patch }, ctx) => {
    const rt = store.readRuntime(root); const it = (rt.attention || []).find((x) => x.id === id);
    if (!it) notFound('Note not found.');
    const p = patch || {};
    if (typeof p.text === 'string' && p.text.trim()) it.text = p.text.trim();
    if (p.status && ['open', 'resolved'].includes(p.status)) it.status = p.status;
    store.writeRuntime(root, rt);
    return changed(ctx, { item: it });
  },
  'attention.remove': (root, { id }, ctx) => {
    const rt = store.readRuntime(root); rt.attention = (rt.attention || []).filter((x) => x.id !== id); store.writeRuntime(root, rt);
    return changed(ctx, { ok: true });
  },
};

module.exports = { ops, OpError };
```

(`settings.save` reads `ctx.env` only so a test can simulate an empty PATH; the HTTP layer never sets it.)

- [ ] **Step 4: Run the ops tests**

Run: `node --test test/ops.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Rewrite `lib/dashboard/handlers.js` as a route table**

```js
'use strict';
/*
 * HTTP glue for one project: parse the request, pick the op, call it, serialize. Every operation
 * lives in ops.js (pure, transport-agnostic) — nothing here decides anything about the project.
 *
 * createHandlers(root) returns what a listener-owning process (hub-server.js) needs:
 *   - handleApi(req, res, u, emit): Promise<boolean> — true if this was an API route (handled).
 *     Excludes /api/events: SSE registration stays with whoever owns the HTTP listener.
 *   - watchDirs: dirs (relative to root) whose changes should emit {type:'change'}.
 *   - onBoot(): once per project per process (creates the custom-views dir, clears a stale
 *     in-flight orchestration).
 */
const fs = require('fs');
const path = require('path');
const { ops, OpError } = require('./ops');
const orchestrator = require('./orchestrator');

function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }

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

function createHandlers(root) {
  async function handleApi(req, res, u, emit) {
    const p = u.pathname;
    const route = ROUTES.find(([method, m]) => method === req.method && matches(m, p));
    if (!route) return false;
    const [, , opName, args] = route;
    const b = req.method === 'GET' ? {} : await body(req);
    try {
      const result = await ops[opName](root, args(u, b, p), { emit });
      sendJSON(res, 200, result);
    } catch (e) {
      if (e instanceof OpError) sendJSON(res, e.status, { error: e.message });
      else sendJSON(res, 500, { error: String(e && e.message || e) });
    }
    return true;
  }
  function onBoot() {
    try { fs.mkdirSync(path.join(root, '.spectoflow', 'dashboards'), { recursive: true }); } catch (_) {}
    // A process restart loses any in-flight orchestration; clear a stale 'running'/'awaiting_approval'
    // so the 409 guard in orchestrate.start can't wedge forever. Not a resume — just un-wedging.
    try { orchestrator.reconcileOnBoot(root); } catch (_) {}
  }
  return {
    handleApi,
    // The legacy custom-views dir is watched too, until `spectoflow update` migrates it (Task 4/8).
    watchDirs: ['plans', 'specs', '.spectoflow', '.spectoflow/dashboards', '.spectoflow/dashboard/custom'],
    onBoot,
  };
}

module.exports = { createHandlers, ROUTES };
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all pass — the re-based server tests exercise every route through the table; status codes must match (400/404/409 come from `OpError`).

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/ops.js lib/dashboard/handlers.js test/ops.test.js
git commit -m "feat(dashboard): ops.js — pure operations; handlers.js is a route table over them"
```

---

### Task 4: Custom views live in `.spectoflow/dashboards/` (legacy location still read) + `spectoflow dashboard validate`

**Files:**
- Modify: `lib/store.js` (`readCustomDashboards`)
- Create: `templates/dashboards/.gitkeep`
- Modify: `bin/spectoflow.js` (`dashboard validate <file>` subcommand + help), `templates/skills/generate-dashboard/SKILL.md`, `templates/agents/framework-curator.md`, `lib/dashboard/public/app.js:909-913` (comment only)
- Test: `test/custom-views-location.test.js` (new)

**Interfaces:**
- Produces: `store.readCustomDashboards(root)` reads `dashboards/*.json` then `dashboard/custom/*.json` (legacy), first id wins; CLI `spectoflow dashboard validate <file>` exits 0 and prints `valid`, or exits 1 and prints the errors.

- [ ] **Step 1: Write the failing test**

```js
// test/custom-views-location.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const store = require('../lib/store');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
const VIEW = (id) => JSON.stringify({ id, title: 'View ' + id, icon: 'info', blocks: [{ type: 'markdown', text: 'hello' }] });
function project() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-views-')); execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' }); return d; }

test('init ships an empty .spectoflow/dashboards/ folder', () => {
  const root = project();
  assert.ok(fs.existsSync(path.join(root, '.spectoflow', 'dashboards')));
  assert.ok(!fs.existsSync(path.join(root, '.spectoflow', 'dashboard')), 'no vendored dashboard any more');
});

test('readCustomDashboards reads the new folder, then the legacy one, first id wins', () => {
  const root = project();
  fs.writeFileSync(path.join(root, '.spectoflow', 'dashboards', 'a.json'), VIEW('a'));
  fs.mkdirSync(path.join(root, '.spectoflow', 'dashboard', 'custom'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spectoflow', 'dashboard', 'custom', 'b.json'), VIEW('b'));
  fs.writeFileSync(path.join(root, '.spectoflow', 'dashboard', 'custom', 'a.json'), JSON.stringify({ ...JSON.parse(VIEW('a')), title: 'LEGACY a' }));
  const views = store.readCustomDashboards(root);
  assert.deepStrictEqual(views.map((v) => v.id), ['a', 'b']);
  assert.strictEqual(views[0].title, 'View a', 'the new location wins over the legacy copy');
});

test('spectoflow dashboard validate <file> exits 0 on a valid spec and 1 with errors on an invalid one', () => {
  const root = project();
  const good = path.join(root, 'good.json'); fs.writeFileSync(good, VIEW('ok'));
  const bad = path.join(root, 'bad.json'); fs.writeFileSync(bad, JSON.stringify({ id: 'x', blocks: [{ type: 'nope' }] }));
  const g = spawnSync('node', [BIN, 'dashboard', 'validate', good], { encoding: 'utf8' });
  assert.strictEqual(g.status, 0); assert.match(g.stdout, /valid/i);
  const b = spawnSync('node', [BIN, 'dashboard', 'validate', bad], { encoding: 'utf8' });
  assert.strictEqual(b.status, 1); assert.match(b.stdout + b.stderr, /invalid|error/i);
});
```
(If `VIEW`'s shape is rejected by `validateSpec`, open `lib/custom-dashboard.js`'s `BLOCK_TYPES` and use the simplest valid block it documents — the test must use a spec the validator accepts.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/custom-views-location.test.js`
Expected: FAIL on all three (no `dashboards/` dir; legacy-only read; unknown subcommand).

- [ ] **Step 3: Ship the folder and read both locations**

`git add -f templates/dashboards/.gitkeep` after `mkdir -p templates/dashboards && : > templates/dashboards/.gitkeep`.

In `lib/store.js` replace `readCustomDashboards`:

```js
// ---- user-generated custom views (.spectoflow/dashboards/<id>.json) ---------------------------
// One JSON file per custom dashboard page (lib/custom-dashboard.js owns the block schema). The
// pre-0.24 location (.spectoflow/dashboard/custom/) is still read — a project that hasn't run
// `spectoflow update` yet must show its views — but the new folder wins on an id collision. A
// malformed file is skipped, never thrown.
const CUSTOM_VIEW_DIRS = [['.spectoflow', 'dashboards'], ['.spectoflow', 'dashboard', 'custom']];
function readCustomDashboards(projectRoot) {
  const out = []; const seen = new Set();
  for (const parts of CUSTOM_VIEW_DIRS) {
    const dir = path.join(projectRoot, ...parts);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (validateSpec(spec).valid && !seen.has(spec.id)) { seen.add(spec.id); out.push(spec); }
      } catch { /* skip malformed */ }
    }
  }
  return out;
}
```

- [ ] **Step 4: Add `dashboard validate` to the CLI**

In `bin/spectoflow.js`, `dashboard()`: add `if (sub === 'validate') return validateDashboardFile(argv[2]);` and the function:

```js
// `spectoflow dashboard validate <file>` — the generate-dashboard skill's verification step (it used
// to require() a lib file vendored in the project; the validator lives in this package now).
function validateDashboardFile(file) {
  if (!file) { console.log('Usage: spectoflow dashboard validate <file.json>'); process.exitCode = 1; return; }
  let spec;
  try { spec = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
  catch (e) { console.log(`${c.y('invalid')} — cannot read/parse ${file}: ${e.message}`); process.exitCode = 1; return; }
  const r = require('../lib/custom-dashboard').validateSpec(spec);
  if (r.valid) { console.log(`${c.g('valid')} — ${spec.id} (${(spec.blocks || []).length} block(s))`); return; }
  console.log(`${c.y('invalid')} — ${file}`);
  (r.errors || []).forEach((e) => console.log(`  ${c.y('!')} ${e}`));
  process.exitCode = 1;
}
```
Help: in the `dashboard` entry of `HELP` add `    ${c.g('validate <file>')}  check a custom-view JSON against the block schema`.

- [ ] **Step 5: Update the framework texts that named the old paths**

- `templates/skills/generate-dashboard/SKILL.md`: `.spectoflow/dashboard/custom/*.json` → `.spectoflow/dashboards/*.json` (2 places); `.spectoflow/dashboard/custom/<id>.json` → `.spectoflow/dashboards/<id>.json` (3 places); replace the `node -e "…validateSpec…"` command block with:
  ```
  spectoflow dashboard validate .spectoflow/dashboards/<id>.json
  ```
  (add: "use `npx spectoflow …` if spectoflow isn't on PATH"); `.spectoflow/lib/custom-dashboard.js` → "the block schema documented above (`spectoflow dashboard validate` enforces it)" (2 places, lines ~71 and ~150).
- `templates/agents/framework-curator.md`: `.spectoflow/dashboard/custom/<id>.json` → `.spectoflow/dashboards/<id>.json`; `` `.spectoflow/lib/custom-dashboard.js`'s validation`` → `` `spectoflow dashboard validate` ``; the References bullet for `.spectoflow/lib/custom-dashboard.js` → `` `spectoflow dashboard validate <file>` — the declarative block vocabulary's validator (in the spectoflow package). ``
- `templates/AGENTS.md:94`: `.spectoflow/dashboard/custom/<id>.json` → `.spectoflow/dashboards/<id>.json`.
- `lib/dashboard/public/app.js:909-913` comment: same two path renames.
- `grep -rn "dashboard/custom\|\.spectoflow/lib/custom-dashboard" templates lib bin` → only `lib/store.js`'s legacy constant and `lib/dashboard/handlers.js`'s legacy watch dir may remain.

- [ ] **Step 6: Run the tests**

Run: `node --test test/custom-views-location.test.js && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: custom views live in .spectoflow/dashboards/ (legacy dir still read); spectoflow dashboard validate"
```

---

### Task 5: Global config — `lib/global-config.js`, `spectoflow config`, defaults at `init`, postinstall

**Files:**
- Create: `lib/global-config.js`
- Modify: `bin/spectoflow.js` (`config` command + help + dispatch), `lib/init.js` (`defaults`), `bin/postinstall.js`
- Test: `test/global-config.test.js`, `test/cli-config.test.js` (new)

**Interfaces:**
- Produces: `globalConfig.homeDir()`, `configPath()`, `defaultDashboardPath()`, `read() → { dashboard:{url,path}, defaults:{agent,language,mode,design} }` (merged with defaults), `get(key) → { value, source: 'set'|'default' }`, `set(key, value) → value` (validated, `~` expanded for paths), `list() → [{key,value,source}]`, `ensure()` (creates the file with `{}` if absent), `KEYS`, `expandHome(p)`.
- `initLib.runInit({ …, defaults })` — optional; falls back to `globalConfig.read().defaults`.

- [ ] **Step 1: Write the failing tests**

```js
// test/global-config.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-gc-'));
  const prev = process.env.SPECTOFLOW_HOME; process.env.SPECTOFLOW_HOME = home;
  delete require.cache[require.resolve('../lib/global-config')];
  try { return fn(require('../lib/global-config'), home); }
  finally { if (prev === undefined) delete process.env.SPECTOFLOW_HOME; else process.env.SPECTOFLOW_HOME = prev; delete require.cache[require.resolve('../lib/global-config')]; }
}

test('read() returns every default when no file exists, and get() reports source=default', () => withHome((gc, home) => {
  const cfg = gc.read();
  assert.strictEqual(cfg.dashboard.url, 'http://localhost:4319');
  assert.strictEqual(cfg.dashboard.path, path.join(home, 'dashboard'));
  assert.deepStrictEqual(cfg.defaults, { agent: 'claude', language: 'en', mode: 'semi', design: 'console' });
  assert.deepStrictEqual(gc.get('defaults.mode'), { value: 'semi', source: 'default' });
}));

test('set() writes the file, get() then reports source=set, list() shows every key', () => withHome((gc, home) => {
  gc.set('defaults.mode', 'manual');
  assert.ok(fs.existsSync(path.join(home, 'config.json')));
  assert.deepStrictEqual(gc.get('defaults.mode'), { value: 'manual', source: 'set' });
  assert.deepStrictEqual(gc.list().map((k) => k.key), gc.KEYS);
}));

test('set() validates: unknown key, bad mode, bad url, unknown agent all throw', () => withHome((gc) => {
  assert.throws(() => gc.set('nope.key', 'x'), /unknown key/i);
  assert.throws(() => gc.set('defaults.mode', 'turbo'), /autopilot, semi, manual/);
  assert.throws(() => gc.set('dashboard.url', 'not a url'), /url/i);
  assert.throws(() => gc.set('defaults.agent', 'skynet'), /unknown agent/i);
}));

test('set("dashboard.path") expands ~ and stores an absolute path', () => withHome((gc) => {
  const v = gc.set('dashboard.path', '~/my-hub');
  assert.strictEqual(v, path.join(os.homedir(), 'my-hub'));
  assert.ok(path.isAbsolute(gc.read().dashboard.path));
}));

test('ensure() creates an empty config file once and never overwrites a set value', () => withHome((gc, home) => {
  gc.ensure();
  assert.strictEqual(fs.readFileSync(path.join(home, 'config.json'), 'utf8').trim(), '{}');
  gc.set('defaults.language', 'fr');
  gc.ensure();
  assert.strictEqual(gc.get('defaults.language').value, 'fr');
}));
```

```js
// test/cli-config.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-config-'));
const run = (h, args) => execFileSync('node', [BIN, ...args], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: h } });

test('config lists every key with its value and source', () => {
  const out = run(home(), ['config']);
  assert.match(out, /dashboard\.url\s+http:\/\/localhost:4319\s+\(default\)/);
  assert.match(out, /defaults\.agent/);
});

test('config set then config get round-trips, and init picks the default up', () => {
  const h = home();
  run(h, ['config', 'set', 'defaults.language', 'fr']);
  assert.strictEqual(run(h, ['config', 'get', 'defaults.language']).trim(), 'fr');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-config-proj-'));
  run(h, ['init', proj]);
  const cfg = JSON.parse(fs.readFileSync(path.join(proj, '.spectoflow', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.language, 'fr');
});

test('config set with a bad value fails with exit code 1 and names the valid choices', () => {
  const r = spawnSync('node', [BIN, 'config', 'set', 'defaults.mode', 'turbo'], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: home() } });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout + r.stderr, /autopilot, semi, manual/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/global-config.test.js test/cli-config.test.js`
Expected: FAIL — `Cannot find module '../lib/global-config'`; unknown `config` command prints help.

- [ ] **Step 3: Write `lib/global-config.js`**

```js
'use strict';
/*
 * Global config — ~/.spectoflow/config.json (or $SPECTOFLOW_HOME/config.json). Settings that apply
 * to every project on this machine: where the dashboard workspace lives, which dashboard URL
 * projects talk to, and the defaults `spectoflow init` seeds a new project's config.json with.
 * Layering, lowest to highest: kit templates < these defaults < the project's own config.json.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REGISTRY } = require('./adapters');

const KEYS = ['dashboard.url', 'dashboard.path', 'defaults.agent', 'defaults.language', 'defaults.mode', 'defaults.design'];
const MODES = ['autopilot', 'semi', 'manual'];

function homeDir() { return process.env.SPECTOFLOW_HOME || path.join(os.homedir(), '.spectoflow'); }
function configPath() { return path.join(homeDir(), 'config.json'); }
function defaultDashboardPath() { return path.join(homeDir(), 'dashboard'); }
function expandHome(p) { return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p; }

function defaults() {
  return { dashboard: { url: 'http://localhost:4319', path: defaultDashboardPath() }, defaults: { agent: 'claude', language: 'en', mode: 'semi', design: 'console' } };
}
function readRaw() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {}; } catch { return {}; }
}
function writeRaw(obj) {
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(obj, null, 2) + '\n');
}
const getPath = (obj, key) => key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
const setPath = (obj, key, value) => { const ks = key.split('.'); let o = obj; for (const k of ks.slice(0, -1)) o = (o[k] = o[k] || {}); o[ks[ks.length - 1]] = value; };

function read() {
  const d = defaults(), raw = readRaw();
  return { dashboard: { ...d.dashboard, ...(raw.dashboard || {}) }, defaults: { ...d.defaults, ...(raw.defaults || {}) } };
}
function get(key) {
  if (!KEYS.includes(key)) throw new Error(`unknown key "${key}" — valid keys: ${KEYS.join(', ')}`);
  const raw = getPath(readRaw(), key);
  return raw !== undefined ? { value: raw, source: 'set' } : { value: getPath(defaults(), key), source: 'default' };
}
function list() { return KEYS.map((key) => ({ key, ...get(key) })); }

function validate(key, value) {
  const v = String(value).trim();
  switch (key) {
    case 'dashboard.url': { let u; try { u = new URL(v); } catch { throw new Error('dashboard.url must be a URL, e.g. http://localhost:4319'); } if (!/^https?:$/.test(u.protocol)) throw new Error('dashboard.url must start with http:// or https://'); return u.origin; }
    case 'dashboard.path': { if (!v) throw new Error('dashboard.path must be a folder path'); return path.resolve(expandHome(v)); }
    case 'defaults.agent': { if (!REGISTRY.some((a) => a.id === v)) throw new Error(`unknown agent "${v}" — one of: ${REGISTRY.map((a) => a.id).join(', ')}`); return v; }
    case 'defaults.language': { if (!/^[a-z]{2}$/.test(v)) throw new Error('defaults.language must be a 2-letter code (en, fr, es, de, pt, it…)'); return v; }
    case 'defaults.mode': { if (!MODES.includes(v)) throw new Error(`defaults.mode must be one of: ${MODES.join(', ')}`); return v; }
    case 'defaults.design': { if (!/^[a-z0-9-]{1,40}$/.test(v)) throw new Error('defaults.design must be a design id (console, orbit, …)'); return v; }
    default: throw new Error(`unknown key "${key}" — valid keys: ${KEYS.join(', ')}`);
  }
}
function set(key, value) {
  const v = validate(key, value);
  const raw = readRaw(); setPath(raw, key, v); writeRaw(raw);
  return v;
}
// Creates the file (empty object) if it doesn't exist — never touches an existing one.
function ensure() { if (!fs.existsSync(configPath())) writeRaw({}); }

module.exports = { KEYS, homeDir, configPath, defaultDashboardPath, expandHome, read, get, set, list, ensure };
```

- [ ] **Step 4: Wire `spectoflow config` into the CLI and `init`**

In `bin/spectoflow.js` add near the other commands:

```js
const globalConfig = require('../lib/global-config');
// ---- config: global settings (~/.spectoflow/config.json), editable from anywhere ----
function configCmd() {
  const sub = argv[1];
  try {
    if (sub === 'get') { if (!argv[2]) throw new Error('Usage: spectoflow config get <key>'); console.log(globalConfig.get(argv[2]).value); return; }
    if (sub === 'set') { if (!argv[2] || argv[3] === undefined) throw new Error('Usage: spectoflow config set <key> <value>'); const v = globalConfig.set(argv[2], argv[3]); console.log(`${c.g('✓')} ${argv[2]} = ${v}`); return; }
    console.log(wordmark());
    const rows = globalConfig.list();
    const w = Math.max(...rows.map((r) => r.key.length));
    rows.forEach((r) => console.log(`  ${c.g(r.key.padEnd(w))}  ${String(r.value).padEnd(28)}  ${c.dim('(' + r.source + ')')}`));
    console.log(c.dim(`\n  file: ${globalConfig.configPath()}   ·   spectoflow config set <key> <value>`));
  } catch (e) { console.log(`${c.y('!')} ${e.message}`); process.exitCode = 1; }
}
```
Dispatch: `config: configCmd,` in `fns`. Help (global): under **Project** add `  ${c.g('config')} ${c.dim('[get <key>|set <key> <value>]')}  global settings for every project (~/.spectoflow/config.json)`. `HELP.config`:
```js
  config: `${c.bold('spectoflow config')} ${c.dim('[get <key> | set <key> <value>]')}\n
  Global settings that apply to every project on this machine, stored in ${c.dim('~/.spectoflow/config.json')}:
    ${c.g('dashboard.url')}     the dashboard projects talk to (default http://localhost:4319)
    ${c.g('dashboard.path')}    where the dashboard workspace lives (default ~/.spectoflow/dashboard)
    ${c.g('defaults.agent')}    ${c.g('defaults.language')}  ${c.g('defaults.mode')}  ${c.g('defaults.design')}   seeds for ${c.g('spectoflow init')}
  A project's own .spectoflow/config.json always wins over these defaults.`,
```

In `lib/init.js`: add `const globalConfig = require('./global-config');`; `runInit({ target, templatesDir, version, agentsArg, defaults })`; after `const cfg = JSON.parse(...)`:
```js
  const d = defaults || globalConfig.read().defaults;
  cfg.mode = d.mode; cfg.language = d.language; cfg.design = d.design;
  // The active agent: an explicit --agent wins; else the global default when it's actually detected
  // here (or nothing is); else the first detected one.
  cfg.agent = agentsArg ? agents[0] : ((detected.includes(d.agent) || !detected.length) ? d.agent : detected[0]);
  if (!agents.includes(cfg.agent)) agents.unshift(cfg.agent);
```
replacing the existing `cfg.agent = agents[0];` line (keep the `cfg.runners` line after it). Also drop `'.spectoflow/.dashboard.lock'` from the `.gitignore` loop (only `'.spectoflow/runtime.json'` remains).

In `bin/postinstall.js`, inside the existing `if (global && TTY)` block, first line: `try { require('../lib/global-config').ensure(); } catch {}`.

- [ ] **Step 5: Run the tests**

Run: `node --test test/global-config.test.js test/cli-config.test.js && npm test`
Expected: PASS. (`init-detect.test.js` may assert on the chosen agent — if a case fails, it is the `d.agent` rule above; re-check the rule against the test's expectation, the rule is the spec.)

- [ ] **Step 6: Commit**

```bash
git add lib/global-config.js lib/init.js bin/spectoflow.js bin/postinstall.js test/global-config.test.js test/cli-config.test.js
git commit -m "feat: global config (~/.spectoflow/config.json) + spectoflow config; init seeds from defaults"
```

---

### Task 6: The dashboard workspace — `lib/workspace.js`; registry, lock and hub move into it

**Files:**
- Create: `lib/workspace.js`
- Modify: `lib/registry.js` (`registryDir`, `addProject` gains `kind`), `lib/dashboard/hub-server.js` (boot: migrate legacy home, ensure workspace, port from settings; `addHubProject` via `workspace.registerProject`), `bin/spectoflow.js` (`startDashboard`/`dashboardStatus`/`stopDashboard`/`status`/`update` read the lock via `workspace.readLock()`; `resolvePort` uses the workspace port)
- Test: `test/workspace.test.js` (new); `test/hub-server.test.js` (+1 migration test)

**Interfaces:**
- Produces: `workspace.dir(baseDir?)`, `workspace.init({ path, port, name, design }) → { dir, created, registryCarried }`, `workspace.settings(baseDir?) → { name, port, design }`, `workspace.lockPath(baseDir?)`, `workspace.readLock() → lock | null` (workspace lock, else the legacy `<home>/hub.lock`), `workspace.projectDir(id, baseDir?)`, `workspace.registerProject(projectPath, baseDir?) → entry` (registry + `projects/<id>/meta.json`), `workspace.migrateLegacyHome(baseDir?) → { movedRegistry, movedLock }`.
- `registry.registryDir(baseDir)` → `baseDir || globalConfig.read().dashboard.path`; entries carry `kind: 'spectoflow'`.

- [ ] **Step 1: Write the failing tests**

```js
// test/workspace.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ws-'));
  const prev = process.env.SPECTOFLOW_HOME; process.env.SPECTOFLOW_HOME = home;
  for (const m of ['../lib/global-config', '../lib/registry', '../lib/workspace']) delete require.cache[require.resolve(m)];
  try { return fn(require('../lib/workspace'), require('../lib/registry'), require('../lib/global-config'), home); }
  finally { if (prev === undefined) delete process.env.SPECTOFLOW_HOME; else process.env.SPECTOFLOW_HOME = prev; }
}

test('init() creates the default workspace with dashboard.json, projects.json and projects/', () => withHome((ws, _r, gc, home) => {
  const r = ws.init({});
  assert.strictEqual(r.dir, path.join(home, 'dashboard'));
  assert.strictEqual(r.created, true);
  for (const f of ['dashboard.json', 'projects.json', 'projects']) assert.ok(fs.existsSync(path.join(r.dir, f)), f);
  assert.deepStrictEqual(ws.settings(), { name: 'dashboard', port: 4319, design: 'console' });
  assert.strictEqual(gc.get('dashboard.path').value, r.dir);
}));

test('init() is idempotent and only updates fields explicitly passed', () => withHome((ws) => {
  ws.init({ port: 5000 });
  const again = ws.init({ name: 'Team' });
  assert.strictEqual(again.created, false);
  assert.deepStrictEqual(ws.settings(), { name: 'Team', port: 5000, design: 'console' });
}));

test('init({path}) moves the workspace and carries the registry over when the new one is empty', () => withHome((ws, registry, gc, home) => {
  ws.init({});
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ws-proj-'));
  ws.registerProject(proj);
  const elsewhere = path.join(home, 'elsewhere');
  const r = ws.init({ path: elsewhere });
  assert.strictEqual(r.registryCarried, true);
  assert.strictEqual(gc.get('dashboard.path').value, elsewhere);
  assert.strictEqual(registry.listProjects().length, 1, 'the registry is now read from the new workspace');
  assert.ok(fs.existsSync(path.join(home, 'dashboard', 'projects.json')), 'the old workspace is left untouched');
}));

test('registerProject() writes projects/<id>/meta.json and stamps kind:spectoflow on the entry', () => withHome((ws) => {
  ws.init({});
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ws-proj2-'));
  const e = ws.registerProject(proj);
  assert.strictEqual(e.kind, 'spectoflow');
  const meta = JSON.parse(fs.readFileSync(path.join(ws.projectDir(e.id), 'meta.json'), 'utf8'));
  assert.strictEqual(meta.kind, 'spectoflow');
  assert.ok(meta.addedAt);
}));

test('migrateLegacyHome() moves a pre-0.24 projects.json and hub.lock into the workspace, once', () => withHome((ws, registry, _gc, home) => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'projects.json'), JSON.stringify({ projects: [{ id: 'abc123', path: home, name: 'x', lastOpened: '2026-01-01T00:00:00.000Z' }] }));
  fs.writeFileSync(path.join(home, 'hub.lock'), '{"pid":1,"port":1}');
  const r = ws.migrateLegacyHome();
  assert.deepStrictEqual(r, { movedRegistry: true, movedLock: true });
  assert.ok(!fs.existsSync(path.join(home, 'projects.json')));
  assert.strictEqual(registry.listProjects()[0].id, 'abc123');
  assert.deepStrictEqual(ws.migrateLegacyHome(), { movedRegistry: false, movedLock: false });
}));

test('readLock() falls back to a legacy <home>/hub.lock so an old running hub is still found', () => withHome((ws, _r, _gc, home) => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'hub.lock'), '{"pid":42,"port":4319}');
  assert.deepStrictEqual(ws.readLock(), { pid: 42, port: 4319 });
}));
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/workspace.test.js`
Expected: FAIL — `Cannot find module '../lib/workspace'`.

- [ ] **Step 3: Write `lib/workspace.js` and re-point `lib/registry.js`**

`lib/registry.js`: replace `registryDir` with
```js
// The registry lives inside the dashboard workspace (D64). An explicit baseDir (unit tests) wins;
// otherwise the workspace is wherever the global config says (default $SPECTOFLOW_HOME/dashboard).
function registryDir(baseDir) {
  return baseDir || require('./global-config').read().dashboard.path;
}
```
(a lazy `require` — global-config requires adapters, never registry, so there is no cycle; lazy keeps `SPECTOFLOW_HOME` changes in tests effective). In `addProject`, the new-entry literal gains `kind: 'spectoflow',`. Delete the `os` import if now unused. Remove the Task-2 interim `'dashboard'` join.

`lib/workspace.js`:
```js
'use strict';
/*
 * The dashboard workspace — the dashboard's own state, outside every project: dashboard.json
 * (name/port/design), projects.json (the registry), hub.lock, and projects/<id>/ for dashboard-side
 * per-project data (meta.json today; B adds a scan cache, C adds members/tokens). Default location
 * $SPECTOFLOW_HOME/dashboard (~/.spectoflow/dashboard); movable via global config dashboard.path.
 */
const fs = require('fs');
const path = require('path');
const globalConfig = require('./global-config');
const registry = require('./registry');

const SETTINGS_DEFAULTS = { name: null, port: 4319, design: 'console' };

function dir(baseDir) { return baseDir || globalConfig.read().dashboard.path; }
function settingsPath(baseDir) { return path.join(dir(baseDir), 'dashboard.json'); }
function lockPath(baseDir) { return path.join(dir(baseDir), 'hub.lock'); }
function projectDir(id, baseDir) { return path.join(dir(baseDir), 'projects', id); }

function readJSON(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; } }
function settings(baseDir) {
  const raw = readJSON(settingsPath(baseDir)) || {};
  const s = { ...SETTINGS_DEFAULTS, ...raw };
  if (!s.name) s.name = path.basename(dir(baseDir));
  return s;
}
function exists(baseDir) { return fs.existsSync(settingsPath(baseDir)); }

// Idempotent: creates what is missing, never deletes, updates dashboard.json only for fields passed.
// Moving the workspace (a new `path`) carries the registry over when the new one has no projects.
function init({ path: newPath, port, name, design } = {}) {
  const prevDir = globalConfig.read().dashboard.path;
  const target = newPath ? path.resolve(globalConfig.expandHome(newPath)) : prevDir;
  const created = !exists(target);
  fs.mkdirSync(path.join(target, 'projects'), { recursive: true });
  const s = { ...SETTINGS_DEFAULTS, ...(readJSON(settingsPath(target)) || {}) };
  if (!s.name) s.name = path.basename(target);
  if (name !== undefined) s.name = String(name);
  if (port !== undefined) s.port = Number(port);
  if (design !== undefined) s.design = String(design);
  fs.writeFileSync(settingsPath(target), JSON.stringify(s, null, 2) + '\n');
  let registryCarried = false;
  const targetReg = registry.readRegistry(target);
  if (!fs.existsSync(registry.registryPath(target))) {
    const prevReg = path.resolve(prevDir) !== path.resolve(target) ? registry.readRegistry(prevDir) : { projects: [] };
    if (prevReg.projects.length && !targetReg.projects.length) { registry.writeRegistry(target, prevReg); registryCarried = true; }
    else registry.writeRegistry(target, { projects: [] });
  }
  if (path.resolve(target) !== path.resolve(prevDir) || globalConfig.get('dashboard.path').source === 'default') globalConfig.set('dashboard.path', target);
  return { dir: target, created, registryCarried };
}

function registerProject(projectPath, baseDir) {
  const entry = registry.addProject(projectPath, baseDir);
  const pd = projectDir(entry.id, baseDir);
  fs.mkdirSync(pd, { recursive: true });
  const metaPath = path.join(pd, 'meta.json');
  if (!fs.existsSync(metaPath)) fs.writeFileSync(metaPath, JSON.stringify({ addedAt: new Date().toISOString(), lastOpened: entry.lastOpened, kind: entry.kind || 'spectoflow' }, null, 2) + '\n');
  return entry;
}

// Pre-0.24 the registry and lock sat directly in ~/.spectoflow/. Move them into the workspace the
// first time the new code runs — one-time, and only when the workspace has none of its own.
function migrateLegacyHome(baseDir) {
  const home = globalConfig.homeDir();
  const target = dir(baseDir);
  const r = { movedRegistry: false, movedLock: false };
  if (path.resolve(home) === path.resolve(target)) return r;
  fs.mkdirSync(target, { recursive: true });
  const legacyReg = path.join(home, 'projects.json');
  if (fs.existsSync(legacyReg) && !fs.existsSync(registry.registryPath(target))) { fs.renameSync(legacyReg, registry.registryPath(target)); r.movedRegistry = true; }
  const legacyLock = path.join(home, 'hub.lock');
  if (fs.existsSync(legacyLock) && !fs.existsSync(lockPath(target))) { fs.renameSync(legacyLock, lockPath(target)); r.movedLock = true; }
  return r;
}

// The hub's lock: the workspace's, else a legacy one still written by a pre-0.24 hub that may be
// running right now (so `dashboard status/stop` keep finding it across the upgrade).
function readLock(baseDir) {
  return readJSON(lockPath(baseDir)) || readJSON(path.join(globalConfig.homeDir(), 'hub.lock'));
}

module.exports = { dir, exists, settings, settingsPath, lockPath, projectDir, init, registerProject, migrateLegacyHome, readLock };
```

- [ ] **Step 4: Move the hub and the CLI onto the workspace**

`lib/dashboard/hub-server.js`:
- `const workspace = require('../workspace');`; boot sequence before `http.createServer`:
  ```js
  const migrated = workspace.migrateLegacyHome();
  if (!workspace.exists()) workspace.init({});
  const PORT = process.env.SPECTOFLOW_PORT ? Number(process.env.SPECTOFLOW_PORT) : workspace.settings().port;
  const LOCK = workspace.lockPath();
  ```
  (delete the old `PORT`/`LOCK` lines; keep `writeLock`/`clearLock`). In the `listen` callback log: `` `spectoflow · hub → http://localhost:${PORT}${migrated.movedRegistry ? '  (moved your project list into the workspace)' : ''}` `` — the tests match `/hub →/`, keep that substring.
- `addHubProject`: `registry.addProject(abs)` → `workspace.registerProject(abs)`.

`bin/spectoflow.js`:
- `const workspace = require('../lib/workspace');`
- `resolvePort(args)`: precedence `--port` > `SPECTOFLOW_PORT` > `workspace.settings().port` (wrap in try/catch → 4319).
- Every `try { info = JSON.parse(fs.readFileSync(registry.hubLockPath(), 'utf8')); } catch {}` (in `update`, `startDashboard`, `dashboardStatus`, `stopDashboard`, `status`) → `const info = workspace.readLock();`; `stopDashboard`'s `fs.unlinkSync(lockPath)` → unlink both `workspace.lockPath()` and `path.join(globalConfig.homeDir(), 'hub.lock')`, each in its own try.
- `startDashboard`: `registry.addProject(root)` → `workspace.registerProject(root)` **only if** `fs.existsSync(path.join(root, '.spectoflow'))` — from a non-project folder the hub starts without registering anything (`boardUrl` then points at `/`). Before the lock probe: `workspace.migrateLegacyHome(); if (!workspace.exists()) workspace.init({});`.

- [ ] **Step 5: Add the hub migration test to `test/hub-server.test.js`**

```js
test('a pre-0.24 ~/.spectoflow/projects.json is moved into the workspace on first start, projects intact', async () => {
  const home = freshHome();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hub-legacy-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const entry = registry.addProject(d, home); // legacy location: directly under home
  const port = 7400 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await getJSON(port, `/api/project?p=${entry.id}`);
    assert.strictEqual(res.status, 200);
    assert.ok(fs.existsSync(path.join(home, 'dashboard', 'projects.json')));
    assert.ok(!fs.existsSync(path.join(home, 'projects.json')));
  } finally { srv.kill(); }
});
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/workspace.test.js test/hub-server.test.js && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/workspace.js lib/registry.js lib/dashboard/hub-server.js bin/spectoflow.js test/workspace.test.js test/hub-server.test.js
git commit -m "feat: dashboard workspace (~/.spectoflow/dashboard) — registry, lock and per-project meta live there"
```

---

### Task 7: CLI — `dashboard init [--path …]`, the one-time URL prompt, `dashboard login` (reserved)

**Files:**
- Modify: `bin/spectoflow.js` (`dashboard()` dispatch, `dashboardInit()`, `resolveDashboardUrl()`, `startDashboard()`, help)
- Test: `test/cli-dashboard-init.test.js` (new)

**Interfaces:**
- Consumes: `workspace.init`, `globalConfig.get/set`.
- Produces: `spectoflow dashboard init [--path <dir>] [--port N] [--name "…"] [--design <id>]`; `spectoflow dashboard [--url <u>]`; `spectoflow dashboard login` prints the "coming in a later release" message and exits 0.

- [ ] **Step 1: Write the failing tests**

```js
// test/cli-dashboard-init.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-dinit-'));
const run = (h, args, opts = {}) => execFileSync('node', [BIN, ...args], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: h }, ...opts });

test('dashboard init creates the default workspace and reports where it is', () => {
  const h = home();
  const out = run(h, ['dashboard', 'init']);
  assert.match(out, /workspace/i);
  assert.ok(fs.existsSync(path.join(h, 'dashboard', 'dashboard.json')));
});

test('dashboard init --path --port --name writes them and points the global config at the path', () => {
  const h = home();
  const target = path.join(h, 'team-hub');
  run(h, ['dashboard', 'init', `--path=${target}`, '--port=4555', '--name=Team']);
  const s = JSON.parse(fs.readFileSync(path.join(target, 'dashboard.json'), 'utf8'));
  assert.strictEqual(s.port, 4555); assert.strictEqual(s.name, 'Team');
  assert.strictEqual(run(h, ['config', 'get', 'dashboard.path']).trim(), target);
});

test('spectoflow dashboard with no TTY and no dashboard.url stores the local default without prompting', () => {
  const h = home();
  // `status` exercises resolveDashboardUrl() without starting a server.
  run(h, ['dashboard', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(run(h, ['config', 'get', 'dashboard.url']).trim(), 'http://localhost:4319');
});

test('spectoflow dashboard --url=<remote> stores it and explains remote dashboards are not managed yet', () => {
  const h = home();
  const out = run(h, ['dashboard', 'status', '--url=https://dashboard.example.com'], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /later release|not managed yet|coming/i);
  assert.strictEqual(run(h, ['config', 'get', 'dashboard.url']).trim(), 'https://dashboard.example.com');
});

test('dashboard login is reserved: exits 0 with the same message', () => {
  const r = spawnSync('node', [BIN, 'dashboard', 'login'], { encoding: 'utf8', env: { ...process.env, SPECTOFLOW_HOME: home() } });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /later release|coming/i);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/cli-dashboard-init.test.js`
Expected: FAIL (unknown subcommands; `dashboard.url` unset stays `(default)`).

- [ ] **Step 3: Implement in `bin/spectoflow.js`**

```js
const readline = require('readline');
const flag = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || undefined;

// `spectoflow dashboard init [--path <dir>] [--port N] [--name "…"] [--design <id>]`
function dashboardInit() {
  try {
    const r = workspace.init({ path: flag('path'), port: flag('port'), name: flag('name'), design: flag('design') });
    console.log(logo());
    console.log(`${c.g('✓')} dashboard workspace ${r.created ? 'created' : 'updated'} at ${c.bold(r.dir)}`);
    if (r.registryCarried) console.log(`  ${c.dim('your project list was carried over from the previous workspace')}`);
    const s = workspace.settings();
    console.log(`  ${c.dim('name')} ${s.name}   ${c.dim('port')} ${s.port}   ${c.dim('design')} ${s.design}`);
    console.log(`\n  start it:  ${c.g('spectoflow dashboard')}\n`);
  } catch (e) { console.log(`${c.y('!')} ${e.message}`); process.exitCode = 1; }
}

const REMOTE_NOTE = 'This version manages local dashboards. Remote dashboards (login with a token) come in a later release — continuing with your local dashboard.';
function isLocalUrl(u) { try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(u).hostname); } catch { return true; } }
// The one-time question: which dashboard should projects talk to? Enter keeps the local default.
// --url answers it without prompting; no TTY = local, silently. The answer is saved and never asked again.
async function resolveDashboardUrl() {
  const fromFlag = flag('url');
  if (fromFlag) { globalConfig.set('dashboard.url', fromFlag); }
  else if (globalConfig.get('dashboard.url').source === 'default') {
    let answer = '';
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      answer = await new Promise((r) => rl.question(`Dashboard URL [${globalConfig.get('dashboard.url').value}]: `, (a) => { rl.close(); r(a.trim()); }));
    }
    globalConfig.set('dashboard.url', answer || globalConfig.get('dashboard.url').value);
  }
  const url = globalConfig.get('dashboard.url').value;
  if (!isLocalUrl(url)) console.log(`${c.y('!')} ${REMOTE_NOTE}`);
  return url;
}
```
- `dashboard()`: add `if (sub === 'init') return dashboardInit();` and `if (sub === 'login') { console.log(REMOTE_NOTE); return; }`; make `startDashboard`, `dashboardStatus`, `restartDashboard`, `stopDashboard` each begin with `await resolveDashboardUrl();` (they are all `async`).
- `startDashboard()` after the URL: `workspace.migrateLegacyHome(); if (!workspace.exists()) workspace.init({});` (Task 6 placed these; keep one copy, right after the URL step).
- Help: **Dashboard** group gains `  ${c.g('dashboard init')} ${c.dim('[--path=<dir>] [--port=N] [--name=…]')}  create/move the dashboard workspace (default ~/.spectoflow/dashboard)` and `  ${c.g('dashboard login')}               connect to a remote dashboard ${c.dim('(coming in a later release)')}`; `HELP.dashboard` lists `init`, `validate`, `login`, and `--url=<u>`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/cli-dashboard-init.test.js && npm test`
Expected: PASS. (`cli-update.test.js` starts hubs via `dashboard --port=…` with `stdio:'pipe'` → no TTY → local URL stored silently; still green.)

- [ ] **Step 5: Commit**

```bash
git add bin/spectoflow.js test/cli-dashboard-init.test.js
git commit -m "feat(cli): dashboard init --path, one-time dashboard URL prompt, dashboard login reserved"
```

---

### Task 8: `update` migrates a project — data first, then retired files (never a user modification)

**Files:**
- Modify: `lib/update.js`, `bin/spectoflow.js` (`update()` output rows + legacy hint + reload message), `lib/init.js` (done in Task 5: no `.dashboard.lock` gitignore line)
- Test: `test/update-retired.test.js` (new), `test/cli-update.test.js` (message wording)

**Interfaces:**
- Produces: `runUpdate()` report gains `removed: []`, `kept: []`, `migration: { movedViews: [], conflicts: [], removedLock: boolean, gitignoreCleaned: boolean }`, `legacyLeftovers: []` (paths that exist in a manifest-less project and would have been retired).

- [ ] **Step 1: Write the failing tests**

```js
// test/update-retired.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const manifest = require('../lib/manifest');
const { runUpdate } = require('../lib/update');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const TPL = path.join(KIT, 'templates');
const VERSION = require('../package.json').version;

// A project as 0.23.x left it: the current kit plus a vendored dashboard + old lib files, all
// recorded in the manifest as framework-owned, plus a custom view in the old folder.
function legacyProject({ withManifest = true, modifyOne = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-retired-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const sf = path.join(d, '.spectoflow');
  const vendored = { 'dashboard/server.js': '// old server', 'dashboard/handlers.js': '// old handlers', 'dashboard/public/app.js': '// old app', 'lib/store.js': '// old store', 'lib/agents-registry.js': '// old roster' };
  for (const [rel, body] of Object.entries(vendored)) { const fp = path.join(sf, ...rel.split('/')); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, body); }
  fs.mkdirSync(path.join(sf, 'dashboard', 'custom'), { recursive: true });
  fs.writeFileSync(path.join(sf, 'dashboard', 'custom', 'kpis.json'), '{"id":"kpis"}');
  fs.writeFileSync(path.join(sf, '.dashboard.lock'), '{"pid":1}');
  fs.appendFileSync(path.join(d, '.gitignore'), '.spectoflow/.dashboard.lock\n');
  const m = manifest.readManifest(sf);
  for (const rel of Object.keys(vendored)) m.files[rel] = manifest.sha256(fs.readFileSync(path.join(sf, ...rel.split('/'))));
  if (modifyOne) fs.writeFileSync(path.join(sf, 'dashboard', 'handlers.js'), '// I EDITED THIS');
  if (withManifest) manifest.writeManifest(sf, m); else fs.unlinkSync(path.join(sf, '.manifest.json'));
  return d;
}
const has = (d, rel) => fs.existsSync(path.join(d, '.spectoflow', ...rel.split('/')));

test('retired files that are intact are removed, their empty folders pruned, and the manifest forgets them', () => {
  const d = legacyProject();
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(r.removed.sort(), ['dashboard/handlers.js', 'dashboard/public/app.js', 'dashboard/server.js', 'lib/agents-registry.js', 'lib/store.js']);
  assert.ok(!has(d, 'dashboard'), 'dashboard/ is gone entirely');
  assert.ok(!has(d, 'lib/store.js'));
  assert.ok(has(d, 'lib/spec-drift.js'), 'still-shipped files stay');
  const m = manifest.readManifest(path.join(d, '.spectoflow'));
  assert.ok(!('dashboard/server.js' in m.files));
});

test('a retired file the user modified is kept (even with --force), reported, and stays tracked', () => {
  const d = legacyProject({ modifyOne: true });
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION, force: true });
  assert.deepStrictEqual(r.kept, ['dashboard/handlers.js']);
  assert.strictEqual(fs.readFileSync(path.join(d, '.spectoflow', 'dashboard', 'handlers.js'), 'utf8'), '// I EDITED THIS');
  assert.ok(!has(d, 'dashboard/server.js'), 'the untouched siblings still go');
  const again = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(again.kept, ['dashboard/handlers.js'], 'still warned about next time');
});

test('data migration runs first: custom views move to dashboards/, the lock and the gitignore line go', () => {
  const d = legacyProject();
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(r.migration.movedViews, ['kpis.json']);
  assert.ok(has(d, 'dashboards/kpis.json'));
  assert.ok(!has(d, '.dashboard.lock'));
  assert.strictEqual(r.migration.removedLock, true);
  assert.ok(!fs.readFileSync(path.join(d, '.gitignore'), 'utf8').includes('.dashboard.lock'));
  assert.ok(fs.readFileSync(path.join(d, '.gitignore'), 'utf8').includes('.spectoflow/runtime.json'));
});

test('a view that already exists in dashboards/ is kept there; the legacy copy is reported as a conflict, not lost', () => {
  const d = legacyProject();
  fs.writeFileSync(path.join(d, '.spectoflow', 'dashboards', 'kpis.json'), '{"id":"kpis","title":"NEW"}');
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(r.migration.conflicts, ['kpis.json']);
  assert.match(fs.readFileSync(path.join(d, '.spectoflow', 'dashboards', 'kpis.json'), 'utf8'), /NEW/);
  assert.ok(has(d, 'dashboard/custom/kpis.json'), 'the legacy file is left for the user to resolve');
  assert.ok(!has(d, 'dashboard/server.js'), 'everything else in dashboard/ still retires');
});

test('--dry-run reports removals and moves but writes nothing', () => {
  const d = legacyProject();
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION, dryRun: true });
  assert.ok(r.removed.length > 0 && r.migration.movedViews.length === 1);
  assert.ok(has(d, 'dashboard/server.js') && has(d, 'dashboard/custom/kpis.json') && !has(d, 'dashboards/kpis.json'));
});

test('a project with no manifest deletes nothing and lists the leftovers as a hint', () => {
  const d = legacyProject({ withManifest: false });
  const r = runUpdate({ projectRoot: d, templatesDir: TPL, version: VERSION });
  assert.deepStrictEqual(r.removed, []);
  assert.deepStrictEqual(r.legacyLeftovers.sort(), ['dashboard', 'lib/agents-registry.js', 'lib/store.js']);
  assert.ok(has(d, 'dashboard/server.js'));
  assert.ok(has(d, 'dashboards/kpis.json'), 'the data migration still runs — it is safe');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/update-retired.test.js`
Expected: FAIL — `r.removed` is undefined.

- [ ] **Step 3: Implement in `lib/update.js`**

Add after `toDisk`:

```js
// Files the kit shipped before 0.24 and no longer does. Used ONLY for the no-manifest hint: with a
// manifest, retired files are computed from it, not from this list.
const LEGACY_LEFTOVERS = ['dashboard', 'lib/store.js', 'lib/agents-registry.js', 'lib/customize-prompts.js', 'lib/custom-dashboard.js'];

// Data migration (0.23 → 0.24): custom views out of the old dashboard folder, the per-project lock
// and its .gitignore line gone. Runs before any removal, is idempotent, and never overwrites.
function migrateProjectData(projectRoot, sf, dryRun) {
  const r = { movedViews: [], conflicts: [], removedLock: false, gitignoreCleaned: false };
  const oldDir = path.join(sf, 'dashboard', 'custom'), newDir = path.join(sf, 'dashboards');
  if (fs.existsSync(oldDir)) {
    for (const f of fs.readdirSync(oldDir).filter((x) => x.endsWith('.json')).sort()) {
      if (fs.existsSync(path.join(newDir, f))) { r.conflicts.push(f); continue; }
      r.movedViews.push(f);
      if (!dryRun) { fs.mkdirSync(newDir, { recursive: true }); fs.renameSync(path.join(oldDir, f), path.join(newDir, f)); }
    }
  }
  const lock = path.join(sf, '.dashboard.lock');
  if (fs.existsSync(lock)) { r.removedLock = true; if (!dryRun) fs.unlinkSync(lock); }
  const gi = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(gi)) {
    const lines = fs.readFileSync(gi, 'utf8').split('\n');
    const kept = lines.filter((l) => l.trim() !== '.spectoflow/.dashboard.lock');
    if (kept.length !== lines.length) { r.gitignoreCleaned = true; if (!dryRun) fs.writeFileSync(gi, kept.join('\n')); }
  }
  return r;
}

// Remove `fp`, then every now-empty parent up to (not including) `stop`.
function removeAndPrune(fp, stop) {
  fs.unlinkSync(fp);
  let dir = path.dirname(fp);
  while (dir.startsWith(stop + path.sep)) {
    try { if (fs.readdirSync(dir).length) break; fs.rmdirSync(dir); } catch { break; }
    dir = path.dirname(dir);
  }
}
```

In `runUpdate`: extend the report literal with `removed: [], kept: [], migration: null, legacyLeftovers: [],`. Right after `const nextFiles = {};` add `report.migration = migrateProjectData(projectRoot, sf, dryRun);`. After the framework-files loop, before the manifest write:

```js
  // Retired files: in the previous manifest, no longer in the kit. Intact (hash == baseline) → gone;
  // modified → kept and reported, and it stays in the manifest so the next run warns again. --force
  // never applies here: there is no kit version to restore, so nothing legitimate to force.
  const kit = new Set(ownership.listFrameworkFiles(templatesDir));
  for (const rel of Object.keys(baseline)) {
    if (kit.has(rel)) continue;
    const diskPath = toDisk(sf, rel);
    if (!fs.existsSync(diskPath)) continue; // already gone — just drop it from the manifest
    if (manifest.sha256(fs.readFileSync(diskPath)) === baseline[rel]) {
      if (!dryRun) removeAndPrune(diskPath, sf);
      report.removed.push(rel);
    } else {
      report.kept.push(rel);
      nextFiles[rel] = baseline[rel];
    }
  }
  if (!prev) {
    for (const rel of LEGACY_LEFTOVERS) if (fs.existsSync(toDisk(sf, rel))) report.legacyLeftovers.push(rel);
  }
```

- [ ] **Step 4: Show it in the CLI**

In `bin/spectoflow.js` `update()`: count `changed` also with `r.removed.length + r.migration.movedViews.length`; add rows after `.new`:
```js
  row(c.dim('−'), 'removed', r.removed, c.dim, 'no longer part of the kit (the dashboard lives in the spectoflow package now)');
  row(c.y('!'), 'kept', r.kept, c.y, 'you modified these and they are no longer part of the kit — delete them yourself when ready');
  if (r.migration.movedViews.length) console.log(`  ${c.cy('→')}  ${c.cy('views'.padEnd(9))} ${c.dim(String(r.migration.movedViews.length).padStart(2))}   ${c.dim('custom views moved to .spectoflow/dashboards/')}`);
  r.migration.conflicts.forEach((f) => console.log(`  ${c.y('!')}  ${c.y('conflict'.padEnd(9))}      ${c.dim(`dashboards/${f} already exists — the old copy stays in dashboard/custom/ for you to merge`)}`));
  if (r.legacyLeftovers.length) console.log(`  ${c.y('!')}  ${c.dim('this project has no install manifest, so nothing was deleted. Safe to remove by hand: ' + r.legacyLeftovers.map((p) => '.spectoflow/' + p).join(', '))}`);
```
Reload message: `'Hub is running — reloaded this project\'s server code (other open projects unaffected).'` → `'Hub is running — reloaded this project (other open projects unaffected).'`; in `test/cli-update.test.js` the assertion `/reloaded this project/i` still matches.

- [ ] **Step 5: Run the tests**

Run: `node --test test/update-retired.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/update.js bin/spectoflow.js test/update-retired.test.js
git commit -m "feat(update): migrate custom views, retire the vendored dashboard — never a user-modified file"
```

---

### Task 9: Framework texts, repo docs, version 0.24.0, demo, real-project QA

**Files:**
- Modify: `templates/AGENTS.md:118-132`, `templates/README.md:21-27`, `README.md` (root: any `node .spectoflow/dashboard/server.js` mention), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (D64), `CLAUDE.md` ("What exists" + "Run & test"), `package.json` (0.24.0), `demo/.spectoflow/**` via `update`

- [ ] **Step 1: Framework texts**

`templates/AGENTS.md` "## Dashboard" section → 
```
Launch it with `spectoflow dashboard` (default http://localhost:4319 — or the workspace's port; `--port=NNNN`
overrides). The dashboard is part of the spectoflow package, not of this project: nothing under
`.spectoflow/` runs it. Zero deps, live via SSE.

**At the end of `init`, and on the first request in a session,** check whether the dashboard is
running — UNLESS the user said they don't want it, or `.spectoflow/config.json` →
`dashboard.autostart` is `false`. If it's not running, start it **detached** (spawn `spectoflow
dashboard`, unref'd/backgrounded so it doesn't block you), then share the URL. Always be able to
answer "is the dashboard running?" — check (`spectoflow dashboard status`), don't assume.
```
`templates/README.md:23`: drop `(or: node .spectoflow/dashboard/server.js)`; add a line `spectoflow dashboard init --path <dir>   # move the dashboard workspace (default ~/.spectoflow/dashboard)` and `spectoflow config                 # global defaults + dashboard URL/path`. Root `README.md`: `grep -n "dashboard/server.js\|projects.json" README.md` and fix each to the new commands/paths.

- [ ] **Step 2: Repo docs**

- `docs/ARCHITECTURE.md`: add a "Three places" section (package / project / workspace — copy the trees from the spec §1) and replace any description of the vendored dashboard.
- `docs/DECISIONS.md`: append **D64 — 0.24.0 : le dashboard sort des projets** in the house style (French, ACTÉ, cause/fix/QA, files), summarising the spec's decisions, the deviation (`task.update`), and the migration guide (spec's last section).
- `CLAUDE.md`: new "What exists (v0.24.0 — see DECISIONS D64)" header paragraph; "Run & test" becomes:
  ```bash
  node bin/spectoflow.js init /tmp/try        # scaffold a project (framework only)
  node bin/spectoflow.js dashboard            # from /tmp/try: registers it and starts/joins the hub → http://localhost:4319
  node bin/spectoflow.js config               # global defaults, dashboard URL/path
  cd demo && node ../bin/spectoflow.js dashboard   # or preview with the demo
  npm test
  ```
  and delete the `node .spectoflow/dashboard/server.js` lines.

- [ ] **Step 3: Version, demo, suite**

```bash
sed -i 's/"version": "0.23.5"/"version": "0.24.0"/' package.json
cd demo && node ../bin/spectoflow.js update && cd ..
npm test
```
Expected: `update` on `demo/` reports `removed` (its vendored dashboard) and `views` if any; suite green.

- [ ] **Step 4: Real-project QA (record the results in D64)**

1. `spectoflow dashboard stop` (the running published hub), then from `D:\projet_tmp\todo-list-v2`: `node D:/projet_tmp/spectoflow/bin/spectoflow.js dashboard` — expect the "moved your project list into the workspace" note once; `ls ~/.spectoflow/dashboard` shows `dashboard.json projects.json hub.lock projects/`.
2. Open `http://localhost:4319/` and both real projects (`todo-list-v2`, `georgesmomo.com`) **before** running `update` in them — both boards must load (goal 2). Headless screenshot each (`chrome --headless=new --screenshot=… <url>`).
3. In each real project: `node D:/projet_tmp/spectoflow/bin/spectoflow.js update` — expect `removed` rows and no `kept`; `ls .spectoflow` shows `dashboards/` and no `dashboard/`; boards still load; screenshots again.
4. `spectoflow config`, `spectoflow dashboard status`, `spectoflow projects` all consistent.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "spectoflow 0.24.0 — the dashboard leaves the projects (global config, workspace, ops layer, migration)"
```
Then ask the user for push + tag `v0.24.0` (the publish workflow runs on the tag) — never push without that explicit yes.

---

## Self-review (done while writing)

- **Spec coverage:** §1 three places → Tasks 2, 4, 6; §2 config/CLI → Tasks 5, 7 (URL prompt, `--url`, non-TTY, remote note, `init --path` carry-over, `validate` in Task 4); §3 hub loads package code + `ops.js` + `watchDirs` + `kind`/`meta.json` → Tasks 2, 3, 6; §4 migration (data first, retired rule, no-manifest hint, `--force` never deletes, workspace migration, legacy read of custom views, texts) → Tasks 4, 6, 8, 9; §5 tests → every task; §6 version/docs → Task 9.
- **Placeholders:** none — every step carries its code or its exact edit; the one open shape (`VIEW` in Task 4's test) states how to resolve it against the validator.
- **Type consistency:** `ops[name](root, args, ctx)` / `OpError(status, message)` used identically in Tasks 3 and the handlers table; `workspace.registerProject`, `readLock`, `migrateLegacyHome`, `settings` named the same in Tasks 6-8; `registry.addProject(root, path.join(home,'dashboard'))` in Task 2's tests matches Task 6's workspace layout; `report.removed/kept/migration/legacyLeftovers` identical between `update.js` and the CLI rows.
