# CLI integration — `spectoflow dashboard` joins the hub (sub-project 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `spectoflow dashboard` (and its `status`/`stop`/`restart` subcommands, and `update`'s
auto-effect step) operate on the one global multi-project hub instead of spawning/managing a
per-project `templates/dashboard/server.js` process — the last piece before the hub replaces the
single-project dashboard entirely.

**Architecture:** A global lock file, `~/.spectoflow/hub.lock` (or `$SPECTOFLOW_HOME/hub.lock` for
test isolation — same env-var convention as the registry), replaces the per-project
`.spectoflow/.dashboard.lock` as what `bin/spectoflow.js`'s dashboard commands read/write. `spectoflow
dashboard` registers (or touches) the current folder in the registry, checks the global lock, and
either joins an already-running hub or spawns `lib/hub-server.js` (never
`templates/dashboard/server.js` — that file remains only for direct single-project invocation,
untouched). Since one hub process now serves N projects, `update`'s "restart so changes take effect"
step is replaced with a **surgical per-project reload** (a new `POST /api/hub/reload/:id` — clears
only that project's own `require.cache` entries and its in-memory hub state) instead of restarting
the whole process, so updating project A never disrupts anyone with project B open at the same time
— confirmed with the user as the explicit design choice for this exact interaction.

**Tech Stack:** Node.js native `http`/`fs`/`path`/`child_process` only (zero runtime dependencies).
Global `fetch()` (Node 18+, already relied on elsewhere in this codebase's own test files) for the
CLI's reload call.

**Spec:** `docs/multi-project-hub-design.md` — §4 (CLI changes), "Sub-project decomposition" item 5.
This plan's reload-vs-restart design for `update` was raised as a genuine open question (not covered
by the original doc) and resolved directly with the user: **reload only the updated project**, never
disrupt other concurrently-open projects.

## Global Constraints

- **Zero runtime dependencies.**
- **`templates/dashboard/server.js` is untouched** — it remains the direct single-project entry point
  (`node .spectoflow/dashboard/server.js`), used by the existing test suite's direct spawns
  (`dashboard-backend.test.js` etc.) and by anyone who still runs it by hand. Only the CLI's own
  `dashboard`/`status`/`stop`/`restart`/`update` commands change what they spawn/manage.
  Test-suite/`CLAUDE.md` migration to the hub-first model everywhere else is the next (and final)
  sub-project, out of scope here.
- **The global hub lock path is derived the same way the registry resolves its own directory**
  (explicit `baseDir` > `SPECTOFLOW_HOME` env > `~/.spectoflow`) — added to `lib/registry.js` as
  `hubLockPath(baseDir)`, reusing its existing (private) directory-resolution logic, so both modules
  agree on where `hub.lock` lives without duplicating that env-var fallback a third time.
- **`update`'s auto-effect step never restarts the whole hub.** It calls the new reload endpoint for
  only the current project; a project the hub hasn't loaded yet (never opened) reports "no reload
  needed" rather than an error — there is nothing cached to invalidate.
- **Only `test/cli-update.test.js`'s one directly-affected test needs rewriting in this plan** — grep-
  confirmed it is the only test file that invokes `spectoflow dashboard` via the CLI; every other test
  that exercises a real server spawns `templates/dashboard/server.js` or `lib/hub-server.js` directly,
  bypassing the CLI commands this plan changes, and is unaffected.

---

### Task 1: `lib/registry.js` gets `hubLockPath()`; `lib/hub-server.js` gets a lock file + per-project reload

**Files:**
- Modify: `lib/registry.js` (add `hubLockPath`, export it)
- Modify: `lib/hub-server.js` (add lock-file write/clear on the global path; add `reloadProject(id)` +
  `POST /api/hub/reload/:id`)
- Test: `test/hub-server.test.js` (add new cases to the existing file)

**Interfaces:**
- Produces (for Task 2): `lib/registry.js` exports `hubLockPath(baseDir)` returning the absolute path
  to the global hub's lock file (same shape as today's per-project `.dashboard.lock`: `{pid, port,
  url, startedAt}`, written by `lib/hub-server.js` on `listen`). `lib/hub-server.js` exposes
  `POST /api/hub/reload/<id>` → `{ok:true, reloaded:boolean}` (never a 4xx — reloading an id the hub
  never loaded is a harmless no-op, not an error).

- [ ] **Step 1: Write the failing tests**

Add these test cases to the END of `test/hub-server.test.js` (after the existing 17 — do not touch
those), reusing the file's existing `freshHome`/`project`/`get`/`getJSON`/`reqJSON`/`startHub` helpers:

```js
test('hub-server writes the GLOBAL lock file (~/.spectoflow/hub.lock, not a per-project one)', async () => {
  const home = freshHome();
  const port = 7000 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    await get(port, '/'); // ensure the server has fully started before checking the lock
    const registry = require('../lib/registry');
    const lock = JSON.parse(fs.readFileSync(registry.hubLockPath(home), 'utf8'));
    assert.strictEqual(lock.port, port);
    assert.strictEqual(lock.pid, srv.pid);
  } finally { srv.kill(); }
});

test('POST /api/hub/reload/:id on a project the hub never loaded reports reloaded:false, no error', async () => {
  const home = freshHome();
  const a = project(home, 'reload-unloaded');
  const port = 7100 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'POST', `/api/hub/reload/${a.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reloaded, false);
  } finally { srv.kill(); }
});

test('POST /api/hub/reload/:id on a loaded project reports reloaded:true and the project stays servable', async () => {
  const home = freshHome();
  const a = project(home, 'reload-loaded');
  const port = 7200 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    await getJSON(port, `/api/project?p=${a.id}`); // load it into the hub's in-memory map first
    const res = await reqJSON(port, 'POST', `/api/hub/reload/${a.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reloaded, true);
    const after = await getJSON(port, `/api/project?p=${a.id}`);
    assert.strictEqual(after.status, 200, 'still servable immediately after reload');
  } finally { srv.kill(); }
});

test('reloading project A never disturbs project B, concurrently loaded in the same hub', async () => {
  const home = freshHome();
  const a = project(home, 'reload-a');
  const b = project(home, 'reload-b');
  const port = 7300 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    await getJSON(port, `/api/project?p=${a.id}`);
    await getJSON(port, `/api/project?p=${b.id}`);
    const reloadRes = await reqJSON(port, 'POST', `/api/hub/reload/${a.id}`);
    assert.strictEqual(reloadRes.body.reloaded, true);
    const bAfter = await getJSON(port, `/api/project?p=${b.id}`);
    assert.strictEqual(bAfter.status, 200);
    assert.strictEqual(bAfter.body.projectName, path.basename(b.path), 'B unaffected by A\'s reload');
  } finally { srv.kill(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/hub-server.test.js`
Expected: the 17 existing tests still pass; these 4 new ones fail (`registry.hubLockPath` doesn't
exist yet, `/api/hub/reload/*` isn't routed yet — no lock file is written at all today).

- [ ] **Step 3: Add `hubLockPath` to `lib/registry.js`**

Add this function, right after `registryPath` (keep the same style — reuses the module's existing
private `registryDir(baseDir)` helper, unchanged):

```js
function hubLockPath(baseDir) {
  return path.join(registryDir(baseDir), 'hub.lock');
}
```

Add `hubLockPath` to the `module.exports` object (alongside the existing exports — do not remove or
reorder any of the others):

```js
module.exports = {
  readRegistry, writeRegistry, genId, addProject, removeProject, touchProject,
  findByPath, listProjects, registryPath, hubLockPath,
};
```

- [ ] **Step 4: Add the lock file + reload endpoint to `lib/hub-server.js`**

Add `reloadProject` right after `getProject` (before `serveStatic`):

```js
// Clears every require.cache entry under this project's own .spectoflow/ tree (its vendored
// handlers.js and everything IT requires — orchestrator.js, runner.js, files.js, summarize.js,
// lib/store.js, lib/agents-registry.js) and drops its cached Map entry. The require cache keys by
// absolute path, so this can never touch another project's identically-named files. Returns false
// (a harmless no-op, not an error) if this id was never loaded — nothing to invalidate.
function reloadProject(id) {
  const proj = projects.get(id);
  if (!proj) return false;
  const prefix = path.join(proj.root, '.spectoflow') + path.sep;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix)) delete require.cache[key];
  }
  projects.delete(id);
  return true;
}
```

Add a branch to `handleHubApi` (alongside the existing `/api/hub/*` routes — order among them doesn't
matter, they're mutually exclusive path patterns):

```js
  if (/^\/api\/hub\/reload\/[^/]+$/.test(p) && req.method === 'POST') {
    const id = decodeURIComponent(p.split('/')[4] || '');
    const reloaded = reloadProject(id);
    sendJSON(res, 200, { ok: true, reloaded });
    return true;
  }
```

Add the lock file itself, right after the `PROJECT_PREFIX` constant and before the `server =
http.createServer(...)` line:

```js
const LOCK = registry.hubLockPath();
function writeLock(){ try{ fs.mkdirSync(path.dirname(LOCK),{recursive:true}); fs.writeFileSync(LOCK, JSON.stringify({ pid:process.pid, port:PORT, url:`http://localhost:${PORT}`, startedAt:new Date().toISOString() })+'\n'); }catch{} }
function clearLock(){ try{ const l=JSON.parse(fs.readFileSync(LOCK,'utf8')); if(l.pid===process.pid) fs.unlinkSync(LOCK); }catch{} }
process.on('exit', clearLock);
['SIGINT','SIGTERM'].forEach((s)=> process.on(s, ()=>{ clearLock(); process.exit(0); }));
```

Replace the final `server.listen(...)` line:

```js
server.listen(PORT, () => { console.log(`spectoflow · hub → http://localhost:${PORT}`); });
```

with:

```js
server.listen(PORT, () => { writeLock(); console.log(`spectoflow · hub → http://localhost:${PORT}`); });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/hub-server.test.js`
Expected: all 21 tests pass (17 existing + 4 new).

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `node --test test/*.test.js`
Expected: previous pass count + 4; only the pre-existing documented `cli-update.test.js` flake
tolerated (re-run it alone to confirm if it appears). If the machine is under heavy concurrent load
from other sessions (a known, previously-observed condition on this machine — full-suite runs have
been externally killed or badly stalled by unrelated concurrent processes this session), a clean run
of `test/hub-server.test.js` alone plus any one or two files that exercise adjacent server code (e.g.
`test/dashboard-backend.test.js`) is acceptable evidence in place of a full-suite run that cannot
complete — note explicitly in the report which was actually achieved.

- [ ] **Step 7: Commit**

```bash
git add lib/registry.js lib/hub-server.js test/hub-server.test.js
git commit -m "$(cat <<'EOF'
lib/hub-server.js: global lock file + per-project reload (no full restart)

First task of sub-project 5 toward the multi-project hub. registry.hubLockPath()
gives both the hub and the future CLI integration one agreed-on location for
~/.spectoflow/hub.lock (same shape as today's per-project .dashboard.lock).

POST /api/hub/reload/<id> clears only that project's own require.cache subtree
(everything under its .spectoflow/) and its in-memory hub entry -- the next
request for it re-requires fresh bytes. This is what lets `spectoflow update`
(next task) make its own project's server-side changes take effect without
restarting the whole hub process and disrupting every other project anyone
else has open in it right now -- confirmed with the user as the deliberate
design choice for this exact interaction (a full-hub-restart was the simpler
alternative, explicitly rejected in favor of this more surgical one).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

---

### Task 2: `bin/spectoflow.js` — `dashboard`/`status`/`stop`/`restart`/`update` operate on the hub

**Files:**
- Modify: `bin/spectoflow.js` (`startDashboard`, `dashboardStatus`, `stopDashboard`, `status`, `update`
  — `restartDashboard` and `printDashboardCommands` need no code change, only benefit from the above)
- Modify: `test/cli-update.test.js` (rewrite the one test that exercises the old per-project-restart
  behavior — the other 4 tests in this file are untouched)

**Interfaces:**
- Consumes: Task 1's `registry.hubLockPath()` and `POST /api/hub/reload/:id`; `lib/hub-server.js`
  itself (spawned by path, exactly how `templates/dashboard/server.js` is spawned today).

- [ ] **Step 1: Write the failing test**

Replace the existing test named `update restarts an already-running dashboard so the update actually
takes effect` in `test/cli-update.test.js` (leave the other 4 tests in this file untouched) with:

```js
// Spawns real hub-server processes end to end (like other spawn-a-real-server tests in this suite)
// — reliably green in isolation; under heavy concurrent load (this machine has been observed running
// several unrelated sessions' own test suites at once) HTTP probes and process spawns can occasionally
// exceed even generous timeouts. Re-run in isolation (`node --test test/cli-update.test.js`) if this
// ever fails under full-suite load.
test('update reloads this project in the running hub WITHOUT restarting it or disturbing other projects', async () => {
  // A long-running hub process keeps every project's framework modules (require()'d on first open)
  // cached in memory — new bytes on disk from `update` change nothing until that project is reloaded.
  // Under the hub model this must be a SURGICAL per-project reload, not a full restart: restarting
  // would kick every other project anyone has open in the same hub right now.
  const projA = install();
  const projB = install(); // a second, unrelated project sharing the same hub
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-hub-home-'));
  const sfA = path.join(projA, '.spectoflow');
  const lockPath = path.join(home, 'hub.lock');
  const port = 4600 + Math.floor(Math.random() * 200);
  const env = { ...process.env, SPECTOFLOW_HOME: home };
  execFileSync('node', [BIN, 'dashboard', `--port=${port}`], { cwd: projA, env, stdio: 'pipe' });
  for (let i = 0; i < 150 && !fs.existsSync(lockPath); i++) await new Promise((r) => setTimeout(r, 200));
  const lockBefore = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  // Register + warm-load B into the same hub (so we can prove reloading A never disturbs it).
  execFileSync('node', [BIN, 'dashboard', `--port=${port}`], { cwd: projB, env, stdio: 'pipe' });
  const registry = require('../lib/registry');
  const entryA = registry.findByPath(projA, home);
  const entryB = registry.findByPath(projB, home);
  await fetch(`http://localhost:${port}/api/project?p=${entryB.id}`); // warm B's own cache entry
  try {
    fs.writeFileSync(path.join(sfA, 'AGENTS.md'), 'DRIFTED'); // force `changed` to be non-zero
    const out = execFileSync('node', [BIN, 'update', '--force'], { cwd: projA, env, encoding: 'utf8' });
    assert.match(out, /reloaded this project/i);
    // The hub process itself must NOT have restarted -- same pid, same lock, the whole point of a
    // surgical reload over a full restart.
    const lockAfter = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.strictEqual(lockAfter.pid, lockBefore.pid, 'the hub process itself was never restarted');
    // A must still be servable after its own reload.
    const resA = await fetch(`http://localhost:${port}/api/project?p=${entryA.id}`);
    assert.strictEqual(resA.status, 200, 'the just-reloaded project A still responds');
    // B, never touched by A's update, must be completely unaffected.
    const resB = await fetch(`http://localhost:${port}/api/project?p=${entryB.id}`);
    assert.strictEqual(resB.status, 200);
    const bodyB = await resB.json();
    assert.strictEqual(bodyB.projectName, path.basename(projB), 'project B fully unaffected by A\'s update/reload');
  } finally {
    execFileSync('node', [BIN, 'dashboard', 'stop', `--port=${port}`], { cwd: projA, env, stdio: 'pipe' });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/cli-update.test.js`
Expected: the 4 untouched tests pass; this new one fails (`spectoflow dashboard` still spawns the
per-project `templates/dashboard/server.js` and writes the per-project lock — no global
`~/.spectoflow/hub.lock` appears at the path this test expects, and `update` still prints
"restarting" against the old per-project logic, never "reloaded this project").

- [ ] **Step 3: Rewrite `bin/spectoflow.js`'s dashboard commands**

Replace `startDashboard()` (currently the function starting `// Start in the background and return
control...`) entirely with:

```js
// Start in the background and return control. Registers (or touches) the current folder in the
// global registry first, then either joins an already-running hub or spawns a new one — probing first
// so a second start just reports the running one instead of spawning a duplicate.
async function startDashboard() {
  const root = process.cwd();
  const entry = registry.addProject(root);
  const boardUrl = (p) => `http://localhost:${p}/p/${entry.id}/board`;
  const lockPath = registry.hubLockPath();
  let info = null;
  try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  if (info && info.port && await probeDashboard(info.port)) {
    console.log(`${c.g('●')} hub already running → ${c.bold(boardUrl(info.port))}`);
    return printDashboardCommands();
  }
  const port = resolvePort(argv);
  const hubPath = path.join(KIT, 'lib', 'hub-server.js');
  const env = Object.assign({}, process.env, { SPECTOFLOW_PORT: String(port) });
  const child = spawn('node', [hubPath], { detached: true, stdio: 'ignore', env });
  child.unref();                                   // let this CLI exit while the hub keeps running
  // Confirm it actually came up (a still-releasing port from a just-stopped instance, or any other
  // startup error, would otherwise print a false "started" while the detached process silently died).
  let up = false;
  for (let i = 0; i < 20 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await probeDashboard(port, 300); }
  if (up) console.log(`${c.g('✓')} hub started → ${c.bold(boardUrl(port))}  ${c.dim('(pid ' + child.pid + ')')}`);
  else console.log(`${c.y('!')} spawned (pid ${child.pid}) but it isn't responding on http://localhost:${port} yet — check ${c.g('spectoflow dashboard status')} in a moment, or its own output if something's wrong.`);
  printDashboardCommands();
}
```

Replace `dashboardStatus()` entirely with:

```js
async function dashboardStatus() {
  const lockPath = registry.hubLockPath();
  let info = null;
  try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  const port = (info && info.port) || resolvePort(argv);
  const running = await probeDashboard(port);
  if (running) console.log(`${c.g('●')} hub running → ${c.bold('http://localhost:' + port)}${info && info.pid ? c.dim(' (pid ' + info.pid + ')') : ''}`);
  else console.log(`${c.dim('○')} hub not running`);
}
```

Replace `stopDashboard()` entirely with:

```js
// Stop the running hub: read the global lock it wrote, verify it's actually up, then terminate it
// and clear the lock. Safe against a stale lock (a recycled pid) because it only kills when the port
// still responds.
async function stopDashboard() {
  const lockPath = registry.hubLockPath();
  let info = null;
  try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  const port = (info && info.port) || resolvePort(argv);
  const running = await probeDashboard(port);
  if (!running) {
    if (info) { try { fs.unlinkSync(lockPath); } catch {} }   // stale lock
    return console.log('No spectoflow hub is running.');
  }
  if (info && info.pid) {
    try {
      process.kill(info.pid);                  // SIGTERM → hub clears its own lock (POSIX)
      try { fs.unlinkSync(lockPath); } catch {}     // and we clear it too (Windows has no real signals)
      return console.log(`spectoflow hub stopped (pid ${info.pid}, was on http://localhost:${port}).`);
    } catch {}
  }
  console.log(`A hub is responding on http://localhost:${port} but isn't stoppable via the lock file — stop it where you launched it (Ctrl+C).`);
}
```

`restartDashboard()` needs no change — it already just calls `stopDashboard()` then `startDashboard()`
and both now operate on the hub correctly.

- [ ] **Step 4: Update the generic `status()` command's dashboard check**

Replace, inside `status()`:

```js
  const port = resolvePort(argv);
  const running = await probeDashboard(port);
  console.log(`dashboard: ${running ? `running → http://localhost:${port}` : 'not running'}`);
```

with:

```js
  const lockPath = registry.hubLockPath();
  let info = null;
  try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  const port = (info && info.port) || resolvePort(argv);
  const running = await probeDashboard(port);
  console.log(`dashboard: ${running ? `running → http://localhost:${port}` : 'not running'}`);
```

- [ ] **Step 5: Replace `update()`'s auto-restart step with a surgical reload**

Replace this block inside `update()`:

```js
  if (!dryRun && changed) {
    const lock = path.join(root, '.spectoflow', '.dashboard.lock');
    let info = null;
    try { info = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch {}
    if (info && info.port && (await probeDashboard(info.port, 2000))) {
      console.log(`  ${c.dim('Dashboard is running — restarting it on port ' + info.port + ' to apply the update…')}`);
      // Restart on the SAME port it was already on, not resolvePort(argv)'s default — `update`
      // itself was never given a --port, so a naive restartDashboard() would silently move a
      // non-default-port dashboard back to 4319.
      argv.push(`--port=${info.port}`);
      await restartDashboard();
    }
  }
```

with:

```js
  if (!dryRun && changed) {
    const lockPath = registry.hubLockPath();
    let info = null;
    try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
    if (info && info.port && (await probeDashboard(info.port, 2000))) {
      const entry = registry.findByPath(root);
      if (entry) {
        try {
          const res = await fetch(`http://localhost:${info.port}/api/hub/reload/${entry.id}`, { method: 'POST' });
          const body = await res.json().catch(() => ({}));
          console.log(`  ${c.dim(body.reloaded
            ? 'Hub is running — reloaded this project\'s server code (other open projects unaffected).'
            : 'Hub is running, but this project wasn\'t loaded in it yet — nothing to reload.')}`);
        } catch {
          console.log(`  ${c.y('!')} Hub is running on port ${info.port} but the reload request failed — restart it yourself if changes don't seem to take effect: ${c.g('spectoflow dashboard restart')}`);
        }
      }
    }
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/cli-update.test.js`
Expected: all 5 tests pass (the 4 untouched + the rewritten one).

- [ ] **Step 7: Run the full suite to check for regressions**

Run: `node --test test/*.test.js`
Expected: same pass count as before this task (no net test-count change — one test replaced, not
added); only the pre-existing documented flake tolerated. Given this machine's observed heavy
concurrent load this session, accept a clean isolated run of `test/cli-update.test.js` plus
`test/hub-server.test.js` as sufficient evidence if a true full-suite run cannot complete — note
explicitly which was actually achieved.

- [ ] **Step 8: Commit**

```bash
git add bin/spectoflow.js test/cli-update.test.js
git commit -m "$(cat <<'EOF'
spectoflow dashboard joins the hub instead of spawning its own server

Second and final task of sub-project 5 -- closes the multi-project hub
decomposition. `spectoflow dashboard` now registers (or touches) the current
folder in the global registry, then joins an already-running hub or spawns
lib/hub-server.js (never templates/dashboard/server.js, which stays untouched
for direct single-project use) -- printing a direct /p/<id>/board URL either
way. `status`/`stop`/`restart` now read/write the global ~/.spectoflow/
hub.lock instead of a per-project lock file.

`update`'s "make server-side changes take effect" step no longer restarts a
whole process -- it calls the new POST /api/hub/reload/<id> (previous task)
so only the project actually being updated gets its cached code invalidated;
anyone else with a different project open in the same hub is never disturbed.
Verified end to end: two projects sharing one hub, updating project A leaves
the hub process's own pid unchanged (no restart) and project B fully
unaffected and still servable throughout.

This closes sub-project 5 (docs/multi-project-hub-design.md) and, with it,
the whole multi-project hub decomposition (1: registry+CLI, 2: server split,
3: multi-project core, 4: landing page+Add Project+client routing, 5: this).
templates/dashboard/server.js remains for direct single-project invocation
and the existing test suite's own direct spawns -- migrating those plus
CLAUDE.md's "Run & test" section to the hub-first model is calmly left for a
follow-up pass, not required for the hub itself to be complete and usable.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

## Self-review notes (completed during authoring)

- **Spec coverage:** design doc's §4 CLI changes (register/touch, probe global lock, join-or-spawn,
  status/stop/restart on the hub) — Task 2. The `update`-restart-vs-reload interaction wasn't covered
  by the original doc at all; raised directly with the user mid-planning and resolved (reload only,
  confirmed) before this plan was written, per its own "Spec" section note above.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code, each verified against the
  real current file content (exact function bodies read directly) before being written here.
- **Type/signature consistency:** `registry.hubLockPath(baseDir)` (Task 1) called with no `baseDir` in
  every Task 2 call site (CLI runs in production context, relies on the same `SPECTOFLOW_HOME` env
  fallback already used elsewhere in `bin/spectoflow.js`) — consistent with `registry.listProjects()`/
  `removeProject()`'s existing no-baseDir calls in the same file. `POST /api/hub/reload/:id`'s
  `{ok:true, reloaded:boolean}` shape is used identically by both Task 1's own tests and Task 2's
  `update()` consumer.
- **Blast-radius check (performed before writing, not assumed):** grepped every test file for CLI
  `dashboard` invocations — only `test/cli-update.test.js` spawns it; every other server-spawning test
  in the suite bypasses the CLI entirely (spawns `templates/dashboard/server.js`/`lib/hub-server.js`
  directly with env vars), so this plan's blast radius is precisely one test, not the whole suite.
