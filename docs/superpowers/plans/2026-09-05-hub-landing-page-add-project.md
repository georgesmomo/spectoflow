# Hub landing page + Add Project + client routing (sub-project 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Task 4 is the one exception**: it is a large number of small, surgical edits across one already-
> huge file (`app.js`, 1823 lines) that the plan's own author fully researched and verified against
> the live file before writing this document — the controller executes Task 4 directly (Edit tool,
> not a dispatched subagent) rather than re-deriving that same research inside a fresh subagent with
> no context. The SAME rigor still applies: full verification (real browser QA — this is UI logic
> with no existing automated coverage — plus the full `node --test` suite for regressions) before
> committing, and an independent review pass after.

**Goal:** Make the multi-project hub genuinely usable end-to-end: a real landing page listing every
registered project, a non-technical "+ Add project" flow (server-side folder browser + paste-a-path,
both auto-initing an un-inited folder), and the existing per-project dashboard (`app.js`) rewired to
be project-aware so it actually works when reached through `/p/<id>/...`.

**Architecture:** Backend additions live in `lib/hub-server.js` (extending sub-project 3's
registry-driven core) plus a new `lib/init.js` (pure project-scaffolding logic extracted from
`bin/spectoflow.js`, reused by the Add Project auto-init step). The landing page is a **separate**,
deliberately small static page (`hub.html`/`hub.js`) — not folded into the existing 1823-line
per-project SPA (`app.js`) — reusing the same design tokens (`styles.css`) for visual consistency.
`app.js` itself gets a single new concept, `PROJECT_ID` (parsed once from the URL's `/p/<id>/...`
prefix) and one funnel function (`withProject(url)`) that every existing `/api/*` call is routed
through, so no call site can silently forget the project context.

**Tech Stack:** Node.js native `http`/`fs`/`path`/`os` only (zero runtime dependencies). Vanilla JS,
no framework, for `hub.js` (matches the rest of this codebase). `node --test` for the backend tasks;
real browser QA for the two UI/client tasks (this codebase's established pattern for UI work with no
existing automated coverage — see DECISIONS D40/D45/D53 etc.).

**Spec:** `docs/multi-project-hub-design.md` — §3bis (Add Project — non-technical UX, the reason this
sub-project exists in this shape), "Sub-project decomposition" item 4.

## Global Constraints

- **Zero runtime dependencies.** Native `http`/`fs`/`path`/`os` only, everywhere in this plan.
- **`GET /api/hub/browse` lists folder NAMES only** — never file contents, never file listings inside
  a folder, never anything from a project's own `.spectoflow/` internals. It exists to let someone
  find a folder, nothing more.
- **`/p/<id>/...` and `?p=<id>` are already fixed** (sub-project 3, committed) — this plan does not
  renegotiate the URL scheme, only builds on it.
- **`lib/registry.js` is not modified** — every new backend piece uses its existing exports
  (`listProjects`, `addProject`, `removeProject`) exactly as already committed.
- **`bin/spectoflow.js init <path>` must keep behaving identically** after Task 1's extraction — this
  is a pure refactor, proven by the EXISTING test suite (17 files spawn `init` as their own fixture
  setup) passing unmodified, not new tests.
- **Task 2/3's split**: Task 2 ships a plain-but-fully-functional `hub.html`/`hub.js` (real API calls,
  no styling polish) so its own tests can assert real behavior end-to-end; Task 3 applies the actual
  visual design on top of the SAME markup/API contract — Task 2's tests must still pass unmodified
  after Task 3.
- **Every new/changed file keeps this codebase's existing comment style**: sparse, explaining *why*,
  never *what* the code already says.

---

### Task 1: Extract `lib/init.js` (pure, reusable — needed by Task 2's auto-init)

**Files:**
- Create: `lib/init.js`
- Modify: `bin/spectoflow.js` (remove `copyDir`/`ID_RE`/`normalizePlans`, lines 97-128; replace
  `init()`, lines 130-222, with a thin wrapper; add one `require` near the top)
- Test: none new — proven by the EXISTING suite (see Step 1)

**Interfaces:**
- Produces (for Task 2): `lib/init.js` exports `{ runInit({ target, templatesDir, version,
  agentsArg }) }` → `{ target, agents, detected, written, notes }`. `target`/`templatesDir` are
  absolute paths; `version` is the framework version string to record; `agentsArg` is an optional
  comma-separated agent-id override (omit to auto-detect, mirrors the CLI's `--agent=` flag).

- [ ] **Step 1: Record the baseline**

This is a pure refactor. Run: `node --test test/*.test.js`
Note the exact pass count — 17 test files spawn `node bin/spectoflow.js init <dir>` as their own
fixture setup (`test/cli-customize.test.js`, `test/cli-update.test.js`, `test/dashboard-agents-api.
test.js`, `test/dashboard-backend.test.js`, `test/hub-server.test.js`, `test/init-detect.test.js`,
`test/init-manifest.test.js`, `test/orchestrate-defaults.test.js`, `test/orchestrate-gates.test.js`,
`test/orchestrate-loop.test.js`, `test/orchestrate-resume.test.js`, `test/orchestrate-server.test.js`,
`test/resolve-dirs.test.js`, `test/resolve-step.test.js`, `test/runner.test.js`, `test/summarize.
test.js`, `test/update.test.js`) — this task's blast radius if anything is wrong is the whole suite.

- [ ] **Step 2: Create `lib/init.js`**

```js
'use strict';
/*
 * Pure, reusable project-scaffolding logic — extracted from bin/spectoflow.js's `init()`, which was
 * CLI-argv/console.log-coupled and unusable from server code. Needed by the hub's "+ Add project"
 * flow (lib/hub-server.js): a folder with no .spectoflow/ yet gets auto-inited in place instead of
 * requiring a separate terminal step. bin/spectoflow.js's own `init` command is now a thin wrapper
 * around this same function, so both callers share one implementation.
 */
const fs = require('fs');
const path = require('path');
const detect = require('./detect');
const ownership = require('./ownership');
const manifest = require('./manifest');
const adapters = require('./adapters');
const mcp = require('./mcp');
const store = require('../templates/lib/store');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

// Existing project: give id-less checkbox tasks a stable id, in place.
const ID_RE = /^[A-Za-z]{1,5}-?\d+[A-Za-z]?$/;
function normalizePlans(root, config) {
  const dirName = store.resolvePlansDir(root, config || store.readConfig(root));
  const dir = path.join(root, dirName);
  if (!fs.existsSync(dir)) return 0;
  let added = 0, seq = 1;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fp = path.join(dir, f);
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*- \[[ xX]\]\s+)(\S+)(\s.*)?$/);
      if (m && !ID_RE.test(m[2])) {
        const id = 'T-' + String(seq++).padStart(3, '0');
        lines[i] = `${m[1]}${id} ${m[2]}${m[3] || ''}`;
        touched = true; added++;
      } else if (m) { seq++; }
    }
    if (touched) fs.writeFileSync(fp, lines.join('\n'));
  }
  return added;
}

function runInit({ target, templatesDir, version, agentsArg }) {
  fs.mkdirSync(target, { recursive: true });
  const notes = [];

  let agents, detected = [];
  if (agentsArg) {
    agents = agentsArg.split(',');
  } else {
    detected = detect.detectAgents(target);
    agents = detected.length ? detected : ['claude', 'codex'];
    notes.push(detected.length
      ? `Detected agent(s): ${detected.join(', ')} — active: ${agents[0]}.`
      : 'No agent CLI detected — defaulted to claude + codex.');
  }

  // preserve an existing CLAUDE.md
  const claude = path.join(target, 'CLAUDE.md');
  if (fs.existsSync(claude) && !fs.existsSync(claude + '.tomerge')) {
    fs.renameSync(claude, claude + '.tomerge');
    notes.push('Existing CLAUDE.md preserved as CLAUDE.md.tomerge — your agent merges it on first run.');
  }

  // canonical framework → .spectoflow/
  const spectoflowDir = path.join(target, '.spectoflow');
  copyDir(templatesDir, spectoflowDir);

  // record the install baseline so `update` can tell untouched framework files from user edits
  const frameworkFiles = ownership.listFrameworkFiles(templatesDir);
  manifest.writeManifest(spectoflowDir, {
    version,
    files: manifest.hashFileMap(spectoflowDir, frameworkFiles),
  });

  // set the active agent and seed runner commands from the selected/detected agents
  const cfgPath = path.join(spectoflowDir, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.agent = agents[0];
  cfg.runners = { ...cfg.runners, ...adapters.defaultRunners(agents) };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  // artifact folders — reuse an existing differently-named folder (e.g. a project that already
  // keeps its plans in `plan/`, singular) instead of always forcing the plans/specs convention;
  // mkdir is a no-op when the resolved folder already exists.
  const plansDirName = store.resolvePlansDir(target, cfg);
  const specsDirName = store.resolveSpecsDir(target, cfg);
  fs.mkdirSync(path.join(target, specsDirName), { recursive: true });
  fs.mkdirSync(path.join(target, plansDirName), { recursive: true });
  if (plansDirName !== 'plans') notes.push(`Using existing '${plansDirName}/' as the plans folder (set plansDir in config.json to override).`);
  if (specsDirName !== 'specs') notes.push(`Using existing '${specsDirName}/' as the specs folder (set specsDir in config.json to override).`);

  // existing project: id-normalize any plans already there
  const added = normalizePlans(target, cfg);
  if (added) notes.push(`Normalized ${added} existing task(s) with stable ids.`);

  // per-agent shims
  const written = adapters.generate(target, agents);

  // wire Playwright MCP into the project's MCP config so the E2E agent can drive a real browser and
  // generate/run Playwright tests. Idempotent + non-destructive: never touches an existing entry.
  // npx fetches the server on first use, so this config IS the whole install — spectoflow stays
  // zero-dep (this writes into the user's project, never into spectoflow).
  const mcpTargets = [path.join(target, '.mcp.json')];
  if (agents.includes('cursor')) mcpTargets.push(path.join(target, '.cursor', 'mcp.json'));
  for (const fp of mcpTargets) {
    const rel = path.relative(target, fp).split(path.sep).join('/');
    const r = mcp.mergeMcpServer(fp, 'playwright', mcp.PLAYWRIGHT_MCP);
    if (r === 'created' || r === 'added') notes.push(`Wired Playwright MCP into ${rel} (npx @playwright/mcp — for the E2E agent; commit it to share).`);
    else if (r === 'skipped') notes.push(`Left ${rel} as-is (couldn't parse it) — add a 'playwright' MCP server yourself for browser-driven E2E.`);
  }

  // gitignore the volatile runtime
  const gi = path.join(target, '.gitignore');
  const giText = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  for (const line of ['.spectoflow/runtime.json', '.spectoflow/.dashboard.lock']) {
    if (!giText.includes(line)) fs.appendFileSync(gi, ((fs.existsSync(gi) && fs.readFileSync(gi, 'utf8').length) ? '\n' : '') + line + '\n');
  }

  return { target, agents, detected, written, notes };
}

module.exports = { runInit };
```

- [ ] **Step 3: Modify `bin/spectoflow.js`**

Remove lines 97-128 entirely (`function copyDir`, the `ID_RE` constant, and `function
normalizePlans`) — they moved into `lib/init.js` verbatim and are used nowhere else in this file
(confirmed by grep — `copyDir(`/`normalizePlans(`/`ID_RE` appear only inside `init()`, which this
step also replaces).

Add a require near the top, alongside the other `lib/` requires (after `const registry =
require('../lib/registry');` at line 12):

```js
const initLib = require('../lib/init');
```

Replace the entire `init()` function (currently lines 130-222) with:

```js
function init() {
  const target = path.resolve(argv[1] && !argv[1].startsWith('--') ? argv[1] : '.');
  const agentsArg = (argv.find((a) => a.startsWith('--agent=')) || '').split('=')[1];
  const r = initLib.runInit({ target, templatesDir: TPL, version: VERSION, agentsArg });
  console.log(logo());
  console.log(`${c.g('✓')} installed in ${c.bold(r.target)}`);
  console.log(`  ${c.dim('.spectoflow/')}   framework — brain, workflow, agents, skills, policy, dashboard, config`);
  console.log(`  ${c.dim('specs/ plans/')}  markdown artifacts (your source of truth)`);
  r.written.forEach((w) => console.log(`  ${c.cy('+')} ${w}`));
  r.notes.forEach((n) => console.log(`  ${c.y('!')} ${c.dim(n)}`));
  const port = resolvePort(argv);
  console.log(`\n${c.bold('Next')}`);
  console.log(`  ${c.dim('1)')} Open your agent here — or just say what you want to build.`);
  console.log(`  ${c.dim('2)')} ${c.g('spectoflow dashboard')}  ${c.dim('→ http://localhost:' + port)}`);
  console.log(`  ${c.dim('3)')} ${c.g('spectoflow list')}       ${c.dim('see the agents, skills & workflow you got')}`);
  console.log('');
}
```

- [ ] **Step 4: Run the full suite and confirm parity with the Step 1 baseline**

Run: `node --test test/*.test.js`
Expected: identical pass count to Step 1's baseline (never fewer; never a *different* test failing
than whatever pre-existing documented flakes were already present). If anything new fails, it is a
real regression from this extraction — investigate before continuing.

- [ ] **Step 5: Commit**

```bash
git add lib/init.js bin/spectoflow.js
git commit -m "$(cat <<'EOF'
extract lib/init.js — pure, reusable project-scaffolding (no CLI coupling)

First task of sub-project 4 toward the multi-project hub. bin/spectoflow.js's
`init()` was CLI-argv/console.log-coupled, unusable from server code. Pure
refactor -- zero behavior change, proven by the existing suite (17 test files
spawn `init` as their own fixture setup) passing unmodified. `bin/spectoflow.js
init` is now a thin wrapper around lib/init.js's runInit(), which the hub's
"+ Add project" flow (next task) calls directly to auto-init a plain folder.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

---

### Task 2: Hub API endpoints + a plain, functional `hub.html`/`hub.js`

**Files:**
- Modify: `lib/hub-server.js` (add the hub API + serve `hub.html` at `GET /`)
- Create: `templates/dashboard/public/hub.html`, `templates/dashboard/public/hub.js` (plain/
  unstyled — Task 3 applies the real design on top, same markup/API contract)
- Test: `test/hub-server.test.js` (add new test cases to the existing file — do not remove the 9
  from sub-project 3)

**Interfaces:**
- Consumes: `lib/init.js`'s `runInit(...)` (Task 1); `lib/registry.js`'s `listProjects`,
  `addProject`, `removeProject` (unchanged, already committed).
- Produces (for Task 3): the exact same `hub.html`/`hub.js` DOM structure and `/api/hub/*` contract —
  Task 3 restyles, it does not change ids/classes/endpoints.

- [ ] **Step 1: Write the failing tests**

Add these test cases to the END of `test/hub-server.test.js` (the file already has 9 tests from
sub-project 3 at the top — do not touch those; append after them, reusing the same helpers
`freshHome`/`project`/`get`/`getJSON`/`reqJSON`/`startHub` already defined in that file):

```js
test('GET /api/hub/projects lists every registered project with basic stats', async () => {
  const home = freshHome();
  const a = project(home, 'x');
  const port = 6200 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await getJSON(port, '/api/hub/projects');
    assert.strictEqual(res.status, 200);
    const found = res.body.projects.find((p) => p.id === a.id);
    assert.ok(found, 'project appears in the list');
    assert.strictEqual(found.name, a.name);
    assert.ok(found.stats && typeof found.stats.total === 'number');
  } finally { srv.kill(); }
});

test('GET /api/hub/browse with no path returns starting points (at least one)', async () => {
  const home = freshHome();
  const port = 6300 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await getJSON(port, '/api/hub/browse');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.entries) && res.body.entries.length > 0);
  } finally { srv.kill(); }
});

test('GET /api/hub/browse?path=<real dir> lists its subfolders', async () => {
  const home = freshHome();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hubapi-browse-'));
  fs.mkdirSync(path.join(parent, 'my-project'));
  const port = 6400 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await getJSON(port, '/api/hub/browse?path=' + encodeURIComponent(parent));
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.entries.some((e) => e.name === 'my-project'));
  } finally { srv.kill(); }
});

test('POST /api/hub/projects registers an already-inited folder without re-initing it', async () => {
  const home = freshHome();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hubapi-add-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const port = 6500 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'POST', '/api/hub/projects', { path: d });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.initialized, false);
    const list = await getJSON(port, '/api/hub/projects');
    assert.ok(list.body.projects.some((p) => p.path === path.resolve(d)));
  } finally { srv.kill(); }
});

test('POST /api/hub/projects auto-inits a plain folder that is not a spectoflow project yet', async () => {
  const home = freshHome();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hubapi-autoinit-'));
  const port = 6600 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'POST', '/api/hub/projects', { path: d });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.initialized, true);
    assert.ok(fs.existsSync(path.join(d, '.spectoflow', 'config.json')), 'the folder is now a real spectoflow project');
  } finally { srv.kill(); }
});

test('POST /api/hub/projects rejects a path that does not exist', async () => {
  const home = freshHome();
  const port = 6700 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'POST', '/api/hub/projects', { path: path.join(os.tmpdir(), 'stf-does-not-exist-xyz') });
    assert.strictEqual(res.status, 400);
  } finally { srv.kill(); }
});

test('DELETE /api/hub/projects/:id removes a registered entry', async () => {
  const home = freshHome();
  const a = project(home, 'del');
  const port = 6800 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await reqJSON(port, 'DELETE', `/api/hub/projects/${a.id}`);
    assert.strictEqual(res.status, 200);
    const list = await getJSON(port, '/api/hub/projects');
    assert.ok(!list.body.projects.some((p) => p.id === a.id));
  } finally { srv.kill(); }
});

test('GET / serves the real hub page (hub.html), not the old placeholder', async () => {
  const home = freshHome();
  const port = 6900 + Math.floor(Math.random() * 100);
  const srv = await startHub(home, port);
  try {
    const res = await get(port, '/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('<html') || res.body.includes('<!DOCTYPE'));
  } finally { srv.kill(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/hub-server.test.js`
Expected: the 9 sub-project-3 tests still pass; these 8 new ones fail (the endpoints/`hub.html`
don't exist yet).

- [ ] **Step 3: Create `templates/dashboard/public/hub.html`** (plain — no visual design yet)

```html
<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>spectoflow · projects</title>
  <link rel="icon" type="image/png" href="/logo-dark.png" />
  <link rel="icon" type="image/png" media="(prefers-color-scheme: dark)" href="/logo-white.png" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="hub-body">
  <header class="hub-header">
    <div class="hub-brand">
      <img class="brand-logo-img is-dark" src="/logo-white.png" alt="" />
      <img class="brand-logo-img is-light" src="/logo-dark.png" alt="" />
      <span class="hub-brand-name">spectoflow</span>
    </div>
  </header>

  <main class="hub-main">
    <div class="hub-titlebar">
      <h1>Your projects</h1>
      <button class="hub-add-btn" id="hubAddBtn">+ Add project</button>
    </div>

    <div id="hubEmpty" class="hub-empty" hidden>
      <p class="hub-empty-title">No projects yet</p>
      <p class="hub-empty-sub">Add your first project to get started — point spectoflow at any folder on your computer.</p>
      <button class="hub-add-btn hub-add-btn-lg" id="hubAddBtnEmpty">+ Add your first project</button>
    </div>

    <div id="hubGrid" class="hub-grid"></div>
  </main>

  <div id="hubModal" class="hub-modal" hidden>
    <div class="hub-modal-card">
      <div class="hub-modal-head">
        <h2>Add a project</h2>
        <button class="hub-modal-close" id="hubModalClose" aria-label="Close">&times;</button>
      </div>
      <div class="hub-modal-tabs">
        <button class="hub-modal-tab is-active" data-mode="browse">Browse</button>
        <button class="hub-modal-tab" data-mode="paste">Paste a path</button>
      </div>

      <div id="hubBrowsePane" class="hub-modal-pane">
        <div class="hub-browse-crumb" id="hubBrowseCrumb"></div>
        <div class="hub-browse-list" id="hubBrowseList"></div>
        <div class="hub-browse-footer">
          <span class="hub-browse-current" id="hubBrowseCurrent"></span>
          <button class="hub-add-btn" id="hubBrowseUse">Use this folder</button>
        </div>
      </div>

      <div id="hubPastePane" class="hub-modal-pane" hidden>
        <label class="hub-paste-label" for="hubPasteInput">Folder path</label>
        <input class="hub-paste-input" id="hubPasteInput" type="text" placeholder="e.g. C:\Users\you\Projects\my-app" autocomplete="off" spellcheck="false" />
        <button class="hub-add-btn" id="hubPasteUse">Use this path</button>
      </div>

      <p class="hub-modal-error" id="hubModalError" hidden></p>
      <p class="hub-modal-status" id="hubModalStatus" hidden></p>
    </div>
  </div>

  <script src="/hub.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `templates/dashboard/public/hub.js`**

```js
'use strict';
(function () {
  const grid = document.getElementById('hubGrid');
  const empty = document.getElementById('hubEmpty');
  const modal = document.getElementById('hubModal');
  const modalError = document.getElementById('hubModalError');
  const modalStatus = document.getElementById('hubModalStatus');
  const browsePane = document.getElementById('hubBrowsePane');
  const pastePane = document.getElementById('hubPastePane');
  const browseCrumb = document.getElementById('hubBrowseCrumb');
  const browseList = document.getElementById('hubBrowseList');
  const browseCurrent = document.getElementById('hubBrowseCurrent');
  let browsePath = null; // null = show starting points (home dir / drives)

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function timeAgo(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  async function loadProjects() {
    const r = await fetch('/api/hub/projects');
    const data = await r.json();
    const rows = data.projects || [];
    empty.hidden = rows.length > 0;
    grid.innerHTML = rows.map((p) => {
      const pct = p.stats && p.stats.total ? Math.round(100 * p.stats.done / p.stats.total) : null;
      return `<div class="hub-card" data-id="${p.id}">
        <a class="hub-card-open" href="/p/${p.id}/board">
          <div class="hub-card-name">${esc(p.name)}</div>
          <div class="hub-card-path">${esc(p.path)}</div>
          ${pct !== null ? `<div class="hub-card-progress"><div class="hub-card-progress-fill" style="width:${pct}%"></div></div><div class="hub-card-pct">${pct}% · ${p.stats.done}/${p.stats.total} tasks</div>` : ''}
          <div class="hub-card-meta">Opened ${esc(timeAgo(p.lastOpened))}</div>
        </a>
        <button class="hub-card-remove" data-remove="${p.id}" title="Remove from this list" aria-label="Remove ${esc(p.name)}">&times;</button>
      </div>`;
    }).join('');
  }

  // No native confirm() — it blocks the tab (and this codebase never uses it, see D46). A second
  // click within 3s on the same remove button confirms; the button flips to a checkmark meanwhile.
  let pendingRemoveId = null;
  function confirmRemove(id) {
    if (pendingRemoveId === id) { pendingRemoveId = null; return true; }
    pendingRemoveId = id;
    const btn = grid.querySelector('[data-remove="' + id + '"]');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓'; btn.title = 'Click again to confirm';
      setTimeout(() => { if (btn.textContent === '✓') btn.textContent = orig; }, 3000);
    }
    return false;
  }
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.getAttribute('data-remove');
    if (!confirmRemove(id)) return;
    await fetch('/api/hub/projects/' + encodeURIComponent(id), { method: 'DELETE' });
    loadProjects();
  });

  function openModal() { modal.hidden = false; modalError.hidden = true; modalStatus.hidden = true; browsePath = null; loadBrowse(); }
  function closeModal() { modal.hidden = true; }
  document.getElementById('hubAddBtn').addEventListener('click', openModal);
  document.getElementById('hubAddBtnEmpty').addEventListener('click', openModal);
  document.getElementById('hubModalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.querySelectorAll('.hub-modal-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.hub-modal-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const mode = tab.getAttribute('data-mode');
      browsePane.hidden = mode !== 'browse';
      pastePane.hidden = mode !== 'paste';
    });
  });

  async function loadBrowse() {
    const q = browsePath ? ('?path=' + encodeURIComponent(browsePath)) : '';
    const r = await fetch('/api/hub/browse' + q);
    const data = await r.json();
    if (data.error) { browseList.innerHTML = '<p class="hub-browse-empty">' + esc(data.error) + '</p>'; return; }
    browsePath = data.current || null;
    browseCurrent.textContent = browsePath || 'Choose a starting point';
    browseCrumb.innerHTML = data.parent ? `<button class="hub-crumb-up" id="hubCrumbUp">&larr; Up</button>` : '';
    const up = document.getElementById('hubCrumbUp');
    if (up) up.addEventListener('click', () => { browsePath = data.parent; loadBrowse(); });
    browseList.innerHTML = (data.entries || []).map((e) =>
      `<button class="hub-browse-item" data-path="${esc(e.path)}">${esc(e.name)}</button>`
    ).join('') || '<p class="hub-browse-empty">No sub-folders here.</p>';
    browseList.querySelectorAll('[data-path]').forEach((el) => {
      el.addEventListener('click', () => { browsePath = el.getAttribute('data-path'); loadBrowse(); });
    });
  }

  async function submitPath(p) {
    modalError.hidden = true; modalStatus.hidden = false; modalStatus.textContent = 'Adding…';
    const r = await fetch('/api/hub/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) });
    const data = await r.json();
    if (!r.ok) { modalStatus.hidden = true; modalError.hidden = false; modalError.textContent = data.error || 'Could not add that folder.'; return; }
    location.href = '/p/' + data.entry.id + '/board';
  }
  document.getElementById('hubBrowseUse').addEventListener('click', () => { if (browsePath) submitPath(browsePath); });
  document.getElementById('hubPasteUse').addEventListener('click', () => {
    const v = document.getElementById('hubPasteInput').value.trim();
    if (v) submitPath(v);
  });

  loadProjects();
})();
```

- [ ] **Step 5: Modify `lib/hub-server.js`**

Add `const os = require('os');` to the requires at the top (alongside `const fs = require('fs');`).
Add `const TEMPLATES = path.join(__dirname, '..', 'templates');` and `const VERSION =
require('../package.json').version;` alongside the existing `const PUBLIC = ...` constant. Add a
local `body(req)` helper (identical to `templates/dashboard/handlers.js`'s own) right after the
existing `sendJSON` function:

```js
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }
```

Add this whole block after `getProject()` and before `serveStatic()`:

```js
// ---- hub API: list/add/remove registered projects, browse the filesystem to find one ----
function projectStats(root) {
  // Best-effort — a moved/deleted/corrupt project must never break the whole listing.
  try {
    const store = require(path.join(root, '.spectoflow', 'lib', 'store.js'));
    const plans = store.readPlans(root);
    let total = 0, done = 0;
    for (const pl of plans) for (const ph of pl.phases) for (const t of ph.tasks) { total++; if (t.status === 'done') done++; }
    return { total, done };
  } catch { return null; }
}
function listHubProjects() {
  return registry.listProjects().map((p) => ({ ...p, stats: projectStats(p.path) }));
}
function listRoots() {
  const home = os.homedir();
  const roots = [{ name: path.basename(home) || home, path: home }];
  if (process.platform === 'win32') {
    for (const code of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${code}:\\`;
      if (fs.existsSync(drive)) roots.push({ name: drive, path: drive });
    }
  } else if (home !== '/') {
    roots.push({ name: '/', path: '/' });
  }
  return roots;
}
function browseDirs(reqPath) {
  if (!reqPath) return { entries: listRoots(), parent: null, current: null };
  let abs;
  try { abs = path.resolve(reqPath); } catch { return { error: 'Invalid path.' }; }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { error: 'Not a folder.' };
  let names;
  try { names = fs.readdirSync(abs, { withFileTypes: true }); } catch { return { error: 'Cannot read this folder.' }; }
  const entries = names.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(abs) !== abs ? path.dirname(abs) : null;
  return { entries, parent, current: abs };
}
function addHubProject(rawPath) {
  let abs;
  try { abs = path.resolve(rawPath); } catch { return { error: 'Invalid path.' }; }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { error: 'That folder does not exist.' };
  const hasSpectoflow = fs.existsSync(path.join(abs, '.spectoflow'));
  if (!hasSpectoflow) {
    const { runInit } = require('./init');
    runInit({ target: abs, templatesDir: TEMPLATES, version: VERSION });
  }
  const entry = registry.addProject(abs);
  return { entry, initialized: !hasSpectoflow };
}
async function handleHubApi(req, res, u) {
  const p = u.pathname;
  if (p === '/api/hub/projects' && req.method === 'GET') { sendJSON(res, 200, { projects: listHubProjects() }); return true; }
  if (p === '/api/hub/projects' && req.method === 'POST') {
    const { path: rawPath } = await body(req);
    if (!rawPath || !String(rawPath).trim()) { sendJSON(res, 400, { error: 'A folder path is required.' }); return true; }
    const r = addHubProject(String(rawPath).trim());
    if (r.error) { sendJSON(res, 400, r); return true; }
    sendJSON(res, 200, r); return true;
  }
  if (/^\/api\/hub\/projects\/[^/]+$/.test(p) && req.method === 'DELETE') {
    const id = decodeURIComponent(p.split('/')[4] || '');
    const ok = registry.removeProject(id);
    sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'No project registered with that id.' });
    return true;
  }
  if (p === '/api/hub/browse' && req.method === 'GET') {
    const reqPath = u.searchParams.get('path') || '';
    const r = browseDirs(reqPath);
    sendJSON(res, r.error ? 400 : 200, r);
    return true;
  }
  return false;
}
```

In the request handler, add a branch for `/api/hub/` **before** the existing generic `if
(p.startsWith('/api/'))` branch (hub routes also start with `/api/` but carry no `?p=` project id —
they must not fall into the per-project branch):

```js
    if (p.startsWith('/api/hub/')) {
      const handled = await handleHubApi(req, res, u);
      if (handled) return;
      res.writeHead(404); return res.end('Not found');
    }
```

Replace the existing `GET /` branch:

```js
    if (p === '/') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(hubPlaceholderHtml());
    }
```

with:

```js
    if (p === '/') {
      return serveStatic('/hub.html', req, res);
    }
```

...and delete the now-unused `hubPlaceholderHtml()` function entirely (its whole definition, the
block right before the `PROJECT_PREFIX` constant).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/hub-server.test.js`
Expected: all 17 tests pass (9 from sub-project 3 + 8 new).

- [ ] **Step 7: Run the full suite to check for regressions**

Run: `node --test test/*.test.js`
Expected: previous pass count + 8; only the pre-existing documented `cli-update.test.js` flake
tolerated (re-run it alone to confirm if it appears).

- [ ] **Step 8: Commit**

```bash
git add lib/hub-server.js test/hub-server.test.js templates/dashboard/public/hub.html templates/dashboard/public/hub.js
git commit -m "$(cat <<'EOF'
add the hub API + a plain, functional hub.html/hub.js (GET / becomes real)

Second task of sub-project 4. GET /api/hub/projects (list + basic per-project
task stats), POST /api/hub/projects (register a folder, auto-initing it via
lib/init.js if it isn't a spectoflow project yet), DELETE /api/hub/projects/:id,
and GET /api/hub/browse (a server-side folder browser -- lists directory NAMES
only, from the home dir / drive roots -- a browser genuinely cannot hand a page
a real absolute filesystem path, see docs/multi-project-hub-design.md §3bis).

hub.html/hub.js are deliberately plain here (no visual design) -- real, working
end-to-end (Browse + Paste a path both converge on the same add flow, remove
works, stats render), verified by 8 new tests. Visual design is the next task,
applied on top of this exact same markup/API contract.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

---

### Task 3: Visual design pass on `hub.html` (+ CSS) — no markup/API contract changes

**Files:**
- Modify: `templates/dashboard/public/hub.html` (attribute/class additions only — every existing
  `id` stays, so `hub.js` from Task 2 needs zero changes)
- Modify: `templates/dashboard/public/styles.css` (append a new `.hub-*` section)
- Test: none new — Task 2's 8 tests must still pass unmodified (proves the redesign didn't touch
  behavior); this task's own verification is real browser QA (no automated coverage exists for
  visual design in this codebase — matches DECISIONS D40/D45/D53's established pattern)

**Interfaces:**
- Consumes: Task 2's `hub.html` ids/classes and `/api/hub/*` contract — unchanged.
- Produces: nothing further in this plan consumes hub's CSS; it is a terminal, visual-only change.

- [ ] **Step 1: Add the theme toggle button to `hub.html`**

In the `<header class="hub-header">` block, add a theme toggle button right after the closing
`</div>` of `.hub-brand`:

```html
    <button class="hub-theme-toggle" id="hubThemeToggle" aria-label="Toggle theme" title="Toggle theme">◐</button>
```

- [ ] **Step 2: Wire the theme toggle in `hub.js`**

Add this at the very top of the IIFE in `templates/dashboard/public/hub.js` (before `const grid =
...`), reusing the SAME `localStorage` key (`spf-theme`) the per-project dashboard already uses
(`templates/dashboard/public/app.js` line 1778-1779), so a theme choice made in either place applies
in both:

```js
  (function () {
    const s = localStorage.getItem('spf-theme');
    if (s) document.documentElement.setAttribute('data-theme', s);
  })();
```

And this near the bottom, right before the final `loadProjects();` call:

```js
  document.getElementById('hubThemeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('spf-theme', next);
  });
```

- [ ] **Step 3: Append the hub design to `templates/dashboard/public/styles.css`**

Add this whole block at the end of the file:

```css

/* ---- Hub landing page (multi-project) — reuses the same tokens as the per-project dashboard,
   deliberately simpler: no per-design skins, no tabs, just a calm project picker. ---- */
.hub-body { min-height:100%; display:flex; flex-direction:column; }
.hub-header { display:flex; align-items:center; justify-content:space-between; padding:16px 24px; border-bottom:1px solid var(--line); }
.hub-brand { display:flex; align-items:center; gap:9px; font-weight:700; }
.hub-brand .brand-logo-img { width:22px; height:22px; }
.hub-brand-name { font-size:15px; }
.hub-theme-toggle { width:32px; height:32px; border-radius:8px; border:1px solid var(--line); background:var(--surface); color:var(--ink); cursor:pointer; font-size:14px; }
.hub-main { flex:1; max-width:1080px; width:100%; margin:0 auto; padding:32px 24px 60px; }
.hub-titlebar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; flex-wrap:wrap; }
.hub-titlebar h1 { font-size:24px; font-weight:700; margin:0; }
.hub-add-btn { font-family:var(--sans); font-size:13.5px; font-weight:600; padding:9px 16px; border-radius:9px; border:1px solid transparent; background:var(--signal); color:var(--on-accent); cursor:pointer; transition:filter .15s; }
.hub-add-btn:hover { filter:brightness(1.08); }
.hub-add-btn-lg { padding:12px 22px; font-size:14.5px; margin-top:14px; }
.hub-empty { text-align:center; padding:60px 20px; border:1px dashed var(--line); border-radius:var(--radius); }
.hub-empty-title { font-size:18px; font-weight:700; margin:0 0 8px; }
.hub-empty-sub { color:var(--muted); font-size:13.5px; max-width:420px; margin:0 auto; }
.hub-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px; }
.hub-card { position:relative; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); transition:border-color .15s,transform .15s; }
.hub-card:hover { border-color:var(--signal); transform:translateY(-1px); }
.hub-card-open { display:block; padding:16px; text-decoration:none; color:inherit; }
.hub-card-name { font-size:15px; font-weight:700; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hub-card-path { font-family:var(--mono); font-size:10.5px; color:var(--faint); margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hub-card-progress { height:5px; border-radius:999px; background:var(--surface-2); margin-top:12px; overflow:hidden; }
.hub-card-progress-fill { height:100%; background:var(--s-done); border-radius:999px; }
.hub-card-pct { font-family:var(--mono); font-size:10.5px; color:var(--muted); margin-top:6px; }
.hub-card-meta { font-size:11px; color:var(--faint); margin-top:10px; }
.hub-card-remove { position:absolute; top:8px; right:8px; width:22px; height:22px; border-radius:999px; border:1px solid var(--line); background:var(--surface-2); color:var(--muted); cursor:pointer; font-size:13px; line-height:1; }
.hub-card-remove:hover { color:var(--s-blocked); border-color:var(--s-blocked); }

.hub-modal { position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:20; padding:20px; }
.hub-modal-card { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); width:100%; max-width:460px; max-height:86vh; display:flex; flex-direction:column; padding:20px; }
.hub-modal-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.hub-modal-head h2 { font-size:16px; margin:0; }
.hub-modal-close { width:28px; height:28px; border-radius:8px; border:1px solid var(--line); background:var(--surface-2); color:var(--ink); cursor:pointer; font-size:16px; line-height:1; }
.hub-modal-tabs { display:flex; gap:6px; margin-bottom:14px; }
.hub-modal-tab { flex:1; font-family:var(--sans); font-size:12.5px; font-weight:600; padding:7px 10px; border-radius:8px; border:1px solid var(--line); background:var(--surface-2); color:var(--muted); cursor:pointer; }
.hub-modal-tab.is-active { background:var(--signal); border-color:var(--signal); color:var(--on-accent); }
.hub-modal-pane { display:flex; flex-direction:column; gap:10px; min-height:0; }
.hub-browse-crumb { min-height:20px; }
.hub-crumb-up { font-family:var(--mono); font-size:11.5px; color:var(--cool); background:none; border:0; cursor:pointer; padding:0; }
.hub-browse-list { display:flex; flex-direction:column; gap:4px; max-height:220px; overflow-y:auto; border:1px solid var(--line); border-radius:9px; padding:6px; }
.hub-browse-item { text-align:left; font-family:var(--sans); font-size:13px; padding:7px 9px; border-radius:6px; border:0; background:none; color:var(--ink); cursor:pointer; }
.hub-browse-item:hover { background:var(--surface-2); }
.hub-browse-empty { color:var(--faint); font-size:12.5px; padding:6px 2px; margin:0; }
.hub-browse-footer { display:flex; align-items:center; gap:10px; justify-content:space-between; }
.hub-browse-current { font-family:var(--mono); font-size:10.5px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
.hub-paste-label { font-size:12px; color:var(--muted); }
.hub-paste-input { font-family:var(--mono); font-size:13px; padding:9px 11px; border-radius:8px; border:1px solid var(--line); background:var(--surface-2); color:var(--ink); }
.hub-modal-error { color:var(--s-blocked); font-size:12.5px; margin:4px 0 0; }
.hub-modal-status { color:var(--muted); font-size:12.5px; margin:4px 0 0; }
```

- [ ] **Step 4: Real browser QA (no automated test covers visual design in this codebase)**

Start a hub-server instance pointed at a temp `SPECTOFLOW_HOME`/port (same pattern as
`test/hub-server.test.js`'s own fixtures) with at least 2-3 registered projects (some with tasks, one
with none, to see both the populated and zero-stats card states), and verify in a real browser tab:
- The empty state renders correctly with ZERO projects registered (fresh `SPECTOFLOW_HOME`).
- Cards render with correct name/path/progress-bar/percentage/last-opened for each registered project;
  clicking a card's body navigates to `/p/<id>/board`.
- The remove (×) button requires two clicks (confirm-in-place) before actually removing, and the
  list updates without a full page reload.
- "+ Add project" opens the modal; the Browse tab shows real folders starting from the home
  directory, clicking a folder descends into it, "↑ Up" goes back, "Use this folder" adds the
  CURRENTLY-shown folder (not whatever was last clicked into) and redirects into the new project.
- The Paste tab: entering a real, not-yet-a-project folder path and submitting shows the folder
  becoming a real project (auto-init) and redirects in; entering a non-existent path shows a clear
  inline error, no crash, modal stays open so the user can correct it.
- Light/dark theme toggle works and matches the per-project dashboard's own toggle (same
  `localStorage` key — verify by toggling on the hub page, then opening a project and confirming its
  theme matches).
- No JS console errors during any of the above.

Fix anything found before proceeding to Step 5. This step has no fixed pass/fail count — it is
"verified clean" or "found and fixed", recorded as such in the commit message / ledger.

- [ ] **Step 5: Run the full suite once (should be untouched by a pure-CSS/markup-attribute change)**

Run: `node --test test/hub-server.test.js` — confirm all 17 tests still pass unmodified (proves the
visual pass changed nothing behavioral).

- [ ] **Step 6: Commit**

```bash
git add templates/dashboard/public/hub.html templates/dashboard/public/hub.js templates/dashboard/public/styles.css
git commit -m "$(cat <<'EOF'
design pass on the hub landing page (cards, modal, theme toggle)

Third task of sub-project 4. Same markup ids/classes and /api/hub/* contract
as the previous task (its 8 tests still pass unmodified) -- this is styling +
the theme-toggle wiring only. Reuses the exact same design tokens as the
per-project dashboard (styles.css's :root palette) for visual consistency,
deliberately simpler than the per-design multi-skin system (no tabs, one
purpose: list projects, add one). Verified by hand in a real browser: empty
state, populated cards with progress bars, two-click remove confirm, the
Browse (click-through folder tree) and Paste (path field) Add Project flows
both working end to end including auto-init, light/dark toggle sharing the
same localStorage key as the per-project dashboard's own toggle.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

---

### Task 4: `app.js` becomes project-aware (executed directly by the controller — see the note at the top of this document)

**Files:**
- Modify: `templates/dashboard/public/app.js` (surgical edits at the exact locations below — not a
  full-file rewrite; the file is 1823 lines, only ~30 lines change)
- Modify: `templates/dashboard/public/index.html` (one new "back to hub" link near the brand logo)
- Modify: `templates/dashboard/public/styles.css` (style for that one new link)
- Test: none new — verified by real browser QA (Step-by-step below) plus the full `node --test`
  suite for regressions (this file has no existing direct unit coverage; it never did, before this
  plan either — matches this codebase's established pattern for UI logic)

**Interfaces:**
- Consumes: the `/p/<id>/...` path prefix and `?p=<id>` query-param scheme (sub-project 3, already
  committed) — this task is what makes the EXISTING per-project dashboard actually speak that scheme
  instead of assuming it's the only project a server will ever show.

- [ ] **Step 1: Add `PROJECT_ID` + `withProject()` + `projectPath()` + `pathSegments()`**

Insert this new block right after line 16 (the design-skin-restore IIFE), before line 18's `$`/`$$`
helpers:

```js
// The project this dashboard tab is showing — derived once from the URL's /p/<id>/... prefix. The
// hub-server's legacy-route redirect (sub-project 3) guarantees a bookmark without this prefix never
// reaches this file directly; it 302s to a /p/<id>/... URL first.
const PROJECT_ID = (() => { const m = location.pathname.match(/^\/p\/([0-9a-f]{6})(?:\/|$)/); return m ? m[1] : null; })();
// Every /api/* fetch/EventSource call funnels its URL through this — the one place a project id gets
// attached, so no call site can forget it. Handles both "no query string yet" (?p=) and "already has
// one" (&p=, e.g. '/api/agentfile?path=...').
function withProject(url) { if (!PROJECT_ID) return url; return url + (url.includes('?') ? '&' : '?') + 'p=' + encodeURIComponent(PROJECT_ID); }
// Prefixes an app-internal path (e.g. '/board', '/custom/x') with /p/<id> for history.pushState/
// replaceState — every page navigation this file performs stays within the current project.
function projectPath(rest) { return PROJECT_ID ? '/p/' + PROJECT_ID + rest : rest; }
// location.pathname's segments with a leading /p/<id> stripped, if present — the single place that
// strip happens, so tabFromPath()/taskFromPath() never have to know about the prefix twice.
function pathSegments() { const s = location.pathname.split('/').filter(Boolean); return (s[0] === 'p' && s[1]) ? s.slice(2) : s; }
```

- [ ] **Step 2: Wrap every `fetch`/`EventSource` URL with `withProject(...)`**

Each of the following is a find-and-replace of the URL argument only — nothing else on the line
changes. Given as exact before → after pairs (unique enough in the file to locate unambiguously; if
an editor's exact-match fails because whitespace differs slightly from what's quoted here, locate by
the line number given first, from the CURRENT file — these were verified against it directly):

1. Line 25: `fetch('/api/project')` → `fetch(withProject('/api/project'))`
2. Line 33: `new EventSource('/api/events')` → `new EventSource(withProject('/api/events'))`
3. Line 126: `fetch('/api/run',{` → `fetch(withProject('/api/run'),{`
4. Line 133: `fetch('/api/orchestrate',{` → `fetch(withProject('/api/orchestrate'),{`
5. Line 136: `fetch('/api/orchestrate/approve',{` → `fetch(withProject('/api/orchestrate/approve'),{`
6. Line 143: `fetch('/api/chat/summarize',{` → `fetch(withProject('/api/chat/summarize'),{`
7. Line 147: `fetch('/api/chat/clear',{method:'POST'})` → `fetch(withProject('/api/chat/clear'),{method:'POST'})`
8. Line 149: `fetch('/api/task/'+encodeURIComponent(id),{` → `fetch(withProject('/api/task/'+encodeURIComponent(id)),{`
9. Line 150: `fetch('/api/task/'+encodeURIComponent(id)+'/comment',{` → `fetch(withProject('/api/task/'+encodeURIComponent(id)+'/comment'),{`
10. Line 151: `fetch('/api/workflow/toggle',{` → `fetch(withProject('/api/workflow/toggle'),{`
11. Line 734: `fetch('/api/attention',{` → `fetch(withProject('/api/attention'),{`
12. Line 759 (inside `submitBacklogAdd`): `fetch('/api/task',{method:'POST',headers:{'Content-Type':'application/json'},` → `fetch(withProject('/api/task'),{method:'POST',headers:{'Content-Type':'application/json'},`
13. Line 768: `fetch('/api/attention/'+encodeURIComponent(id),{method:'PATCH',` → `fetch(withProject('/api/attention/'+encodeURIComponent(id)),{method:'PATCH',`
14. Line 769: `fetch('/api/attention/'+encodeURIComponent(id),{method:'DELETE'})` → `fetch(withProject('/api/attention/'+encodeURIComponent(id)),{method:'DELETE'})`
15. Line 770: `fetch('/api/attention/'+encodeURIComponent(id)+'/promote',{method:'POST'})` → `fetch(withProject('/api/attention/'+encodeURIComponent(id)+'/promote'),{method:'POST'})`
16. Line 829: `fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:id})})` → wrap the URL: `fetch(withProject('/api/settings'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:id})})`
17. Line 835: same URL, inside `saveDesign` — `fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({design:id})})` → `fetch(withProject('/api/settings'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({design:id})})`
18. Line 867: same URL again — `fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,language})})` → `fetch(withProject('/api/settings'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,language})})`
19. Line 1035: `fetch('/api/run',{` → `fetch(withProject('/api/run'),{` (this is a second, separate call site from #3 above — a different function; both need the wrap independently)
20. Line 1166: `fetch('/api/agentfile?path='+encodeURIComponent(rel))` → `fetch(withProject('/api/agentfile?path='+encodeURIComponent(rel)))`
21. Line 1328: `fetch('/api/files/tree')` → `fetch(withProject('/api/files/tree'))`
22. Line 1491: `fetch('/api/files/read?'+new URLSearchParams({path:relPath}))` → `fetch(withProject('/api/files/read?'+new URLSearchParams({path:relPath})))`
23. Line 1518: `fetch('/api/files/write',{` → `fetch(withProject('/api/files/write'),{`
24. Line 1613: `fetch(endpoint,{` → `fetch(withProject(endpoint),{` (`endpoint` is a variable already set to `/api/files/mkdir` or `/api/files/write` two lines above — wrap the variable itself, not a literal string)

After this step, grep the file for `fetch('/api` and `fetch('/api` with no `withProject` wrapping
anywhere — there should be zero remaining matches (every `/api/*` call goes through the wrapper).
Run: `grep -n "fetch('/api" templates/dashboard/public/app.js` and confirm it returns nothing (every
match should now read `fetch(withProject(...` instead).

- [ ] **Step 3: Make routing project-aware**

Replace (around line 1048-1054):

```js
function tabFromPath(){
  const s=location.pathname.split('/').filter(Boolean);
  if(s[0]==='custom'&&s[1]) return 'custom:'+decodeURIComponent(s[1]);
  const t=normalizeTab(s[0]);
  return ROUTES.includes(t)?t:null;
}
function taskFromPath(){ const s=location.pathname.split('/').filter(Boolean); return (ROUTES.includes(s[0])&&s[1])?decodeURIComponent(s[1]):null; }
```

with:

```js
function tabFromPath(){
  const s=pathSegments();
  if(s[0]==='custom'&&s[1]) return 'custom:'+decodeURIComponent(s[1]);
  const t=normalizeTab(s[0]);
  return ROUTES.includes(t)?t:null;
}
function taskFromPath(){ const s=pathSegments(); return (ROUTES.includes(s[0])&&s[1])?decodeURIComponent(s[1]):null; }
```

Replace, in `navigateTab` (around line 1059):

```js
    history.pushState(null,'', isCustom ? '/custom/'+encodeURIComponent(tabId.slice(7)) : '/'+tabId);
```

with:

```js
    history.pushState(null,'', projectPath(isCustom ? '/custom/'+encodeURIComponent(tabId.slice(7)) : '/'+tabId));
```

Replace line 1626:

```js
  if(!keep && taskFromPath()!==id) history.pushState(null,'','/'+activeTab+'/'+encodeURIComponent(id));
```

with:

```js
  if(!keep && taskFromPath()!==id) history.pushState(null,'',projectPath('/'+activeTab+'/'+encodeURIComponent(id)));
```

Replace line 1660:

```js
function closeDrawer(){ if(taskFromPath()) history.pushState(null,'','/'+activeTab); openTaskId=null; $('#drawer').setAttribute('aria-hidden','true'); }
```

with:

```js
function closeDrawer(){ if(taskFromPath()) history.pushState(null,'',projectPath('/'+activeTab)); openTaskId=null; $('#drawer').setAttribute('aria-hidden','true'); }
```

Replace line 1710:

```js
if(location.pathname.split('/').filter(Boolean)[0]==='settings') history.replaceState(null,'','/personalize');
```

with:

```js
if(pathSegments()[0]==='settings') history.replaceState(null,'',projectPath('/personalize'));
```

- [ ] **Step 4: Add a "back to hub" link**

In `templates/dashboard/public/index.html`, right after the closing `</a>` of `.brand-logo` (the
element with `href="/board"`, around line 20), add:

```html
      <a class="hub-back-link" href="/" title="Back to your projects" aria-label="Back to your projects">⌂</a>
```

This is a plain link (full page navigation, not SPA `pushState`) — intentionally: leaving to the hub
means leaving this project's dashboard entirely, unlike every other in-app navigation here.

Append to `templates/dashboard/public/styles.css`:

```css
.hub-back-link { display:flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:7px; color:var(--muted); text-decoration:none; font-size:15px; flex-shrink:0; transition:background .15s,color .15s; }
.hub-back-link:hover { background:var(--surface-2); color:var(--ink); }
```

- [ ] **Step 5: Real browser QA**

Register at least 2 projects in a hub-server instance (temp `SPECTOFLOW_HOME`), open project A at
`/p/<idA>/board`, and verify:
- Every tab (Board, Chat, Requests, Attention, Backlog, Workflow, Agents & Skills, Files, Info,
  Personalize, Documentation) loads and functions exactly as before this task (this is the highest-
  risk step — any missed `fetch` call site from Step 2 shows up here as a silently-broken feature).
- The URL bar shows `/p/<idA>/<tab>` when switching tabs (not a bare `/<tab>`), and back/forward
  browser buttons work correctly within project A.
- Opening a task drawer updates the URL to `/p/<idA>/<tab>/<taskId>`; closing it goes back to
  `/p/<idA>/<tab>`.
- The live SSE indicator connects (green "live", not "offline") — proves `EventSource` picked up the
  right `?p=`.
- Creating a task (Backlog "+ Add"), adding an attention note, and using the Files tab (tree loads,
  open a file, create a new one) all still work and affect ONLY project A — open project B in a
  second tab at `/p/<idB>/board` at the same time and confirm actions in A never appear in B (the
  real point of this whole plan).
- The new "⌂ back to hub" link in the header navigates to `/` (the real hub landing page from Task
  3) and shows both registered projects.
- No JS console errors anywhere in the above.

Fix anything found before proceeding.

- [ ] **Step 6: Run the full suite**

Run: `node --test test/*.test.js`
Expected: no change in pass count from before this task (this is a client-JS-only change; nothing
server-side moved) — only the pre-existing documented `cli-update.test.js` flake tolerated.

- [ ] **Step 7: Commit**

```bash
git add templates/dashboard/public/app.js templates/dashboard/public/index.html templates/dashboard/public/styles.css
git commit -m "$(cat <<'EOF'
app.js becomes project-aware: every /api/* call and every internal nav now
carries /p/<id> — the per-project dashboard actually works through the hub

Fourth and final task of sub-project 4. PROJECT_ID is parsed once from the
URL's /p/<id>/... prefix; withProject(url) is the one funnel every existing
fetch()/EventSource() call is routed through (24 call sites); projectPath()/
pathSegments() do the same for history.pushState/replaceState and route
parsing. Verified end to end by hand: every tab, task drawer open/close,
back/forward, live SSE, and -- the actual point of the whole multi-project
hub -- two projects open in two tabs at once with zero cross-talk between
them. A small "back to hub" link (plain navigation, not SPA) was added next
to the brand logo.

This closes sub-project 4 (docs/multi-project-hub-design.md) -- the hub is now
usable end to end: register a project (CLI or the new non-technical Browse/
Paste "+ Add project" flow), see it on the landing page, open it, work in it,
switch to another one, all without a terminal. Sub-project 5 (CLI integration:
`spectoflow dashboard` joins the hub instead of spawning its own server) is
the next and last piece before this replaces the single-project dashboard
entirely.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

## Self-review notes (completed during authoring)

- **Spec coverage:** design doc's §3bis (Add Project non-technical UX) — Task 2's Browse/Paste/
  auto-init flow. §3's landing page — Tasks 2-3. §3's URL-scheme decision (`/p/<id>/...` +
  `?p=<id>`) — already server-side since sub-project 3; Task 4 is what makes the CLIENT honor it.
  "A way back to the hub" (§3, explicitly called out as needed) — Task 4 Step 4.
- **Placeholder scan:** no TBD/TODO. Every step has complete, runnable code; Task 4's per-site edits
  were each verified against the real current file content (line numbers + exact surrounding code)
  before being written here, not guessed.
- **Type/signature consistency:** `withProject(url)`/`projectPath(rest)`/`pathSegments()` (Task 4) are
  used with the same signatures everywhere they appear; Task 2's `hub.html` element ids
  (`hubAddBtn`, `hubGrid`, `hubModal`, etc.) are the exact same ones Task 3 styles and Task 2's own
  `hub.js` already wires — verified no drift between the two tasks' file content.
