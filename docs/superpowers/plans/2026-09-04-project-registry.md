# Project Registry (multi-project hub, sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global, self-populating registry of every project spectoflow has seen
(`~/.spectoflow/projects.json`), plus `spectoflow projects list`/`spectoflow projects remove <id>` to
inspect and prune it — the first of five sequenced sub-projects toward the multi-project hub.

**Architecture:** One new zero-dependency module, `lib/registry.js` (mirrors `lib/manifest.js`'s
shape: plain functions, `module.exports` at the bottom, no classes). One new CLI subcommand,
`projects`, wired into `bin/spectoflow.js`'s existing `fns`/`HELP` dispatch tables the same way every
other subcommand already is. Nothing else in the codebase changes — this sub-project does not touch
`spectoflow dashboard`, `server.js`, or any dashboard-facing code. Registering a project happens only
via the new explicit CLI command in this plan; wiring `spectoflow dashboard` to auto-register is
sub-project 4, deliberately out of scope here.

**Tech Stack:** Native Node (`fs`, `path`, `os`, `crypto`), `node:test` — same zero-dep, zero-test-
framework stack as the rest of the repo.

**Spec:** `docs/multi-project-hub-design.md` (see "Sub-project decomposition", item 1). Read it for
the full context this piece serves; this plan implements only the registry + its CLI surface.

## Global Constraints

- Zero runtime dependencies (native `fs`/`path`/`os`/`crypto` only) — matches the whole framework's
  invariant (see root `CLAUDE.md`).
- The registry file lives at `~/.spectoflow/projects.json` in production. Every registry function
  takes an **optional trailing `baseDir` argument** for direct unit testing; when omitted, the
  resolution order is `process.env.SPECTOFLOW_HOME` (test isolation for the *CLI*, which never passes
  `baseDir` explicitly) then `path.join(os.homedir(), '.spectoflow')`.
- Project ids are 6 lowercase hex characters (`crypto.randomBytes(3).toString('hex')`), regenerated
  on collision against ids already in the registry.
- A project is matched by **normalized absolute path** (`path.resolve()`), never by name — two
  different folders can share a basename without colliding; the same folder opened twice never
  duplicates.
- Never throw on a missing/corrupt registry file or an unknown id being removed/touched — these are
  everyday conditions (first run, a stale id), not errors; functions return a boolean/empty result
  instead (matches `store.js`'s `updateTaskLine` returning `false` rather than throwing, and
  `manifest.js`'s `readManifest` returning `null`).
- Follow existing code style exactly: `'use strict'`, a top comment block explaining the file's
  purpose, no semicolons-inconsistency (match the file you're editing), CommonJS `require`/
  `module.exports`.

---

### Task 1: `lib/registry.js` — the registry module

**Files:**
- Create: `lib/registry.js`
- Test: `test/registry.test.js`

**Interfaces:**
- Produces (consumed by Task 2, and later by sub-projects 3–4):
  - `readRegistry(baseDir?) → { projects: Array<{id, path, name, lastOpened}> }`
  - `writeRegistry(baseDir, data)` — `baseDir` required here (internal-ish, but exported for tests)
  - `genId(existingIds: string[], randomFn?: (n:number)=>Buffer) → string` (6 hex chars)
  - `addProject(projectPath: string, baseDir?) → {id, path, name, lastOpened}`
  - `removeProject(id: string, baseDir?) → boolean` (true if something was removed)
  - `touchProject(id: string, baseDir?) → boolean` (true if a matching entry was found and updated)
  - `findByPath(projectPath: string, baseDir?) → entry | null`
  - `listProjects(baseDir?) → entry[]` (sorted newest-`lastOpened`-first)
  - `registryPath(baseDir?) → string` (absolute path to `projects.json`, exported so Task 2 and later
    the hub can locate the file directly if ever needed — e.g. for a `spectoflow projects` diagnostic)

- [ ] **Step 1: Write the failing tests**

Create `test/registry.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../lib/registry');

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-registry-'));
}
function tmpProject(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-proj-' + name + '-'));
}

test('readRegistry returns an empty project list when no file exists yet', () => {
  const base = tmpBase();
  assert.deepStrictEqual(registry.readRegistry(base), { projects: [] });
});

test('readRegistry returns an empty project list when the file is corrupt', () => {
  const base = tmpBase();
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(registry.registryPath(base), '{not json');
  assert.deepStrictEqual(registry.readRegistry(base), { projects: [] });
});

test('addProject creates a new entry with a 6-hex-char id and the folder basename as name', () => {
  const base = tmpBase();
  const proj = tmpProject('a');
  const entry = registry.addProject(proj, base);
  assert.match(entry.id, /^[0-9a-f]{6}$/);
  assert.strictEqual(entry.name, path.basename(proj));
  assert.strictEqual(path.resolve(entry.path), path.resolve(proj));
  assert.ok(entry.lastOpened);
  assert.strictEqual(registry.readRegistry(base).projects.length, 1);
});

test('addProject called again for the same path does not duplicate — updates lastOpened, keeps the id', async () => {
  const base = tmpBase();
  const proj = tmpProject('b');
  const first = registry.addProject(proj, base);
  await new Promise((r) => setTimeout(r, 5)); // force a different ISO timestamp
  const second = registry.addProject(proj, base);
  assert.strictEqual(second.id, first.id);
  assert.notStrictEqual(second.lastOpened, first.lastOpened);
  assert.strictEqual(registry.readRegistry(base).projects.length, 1);
});

test('addProject for a different path creates a distinct entry', () => {
  const base = tmpBase();
  const a = registry.addProject(tmpProject('c1'), base);
  const b = registry.addProject(tmpProject('c2'), base);
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(registry.readRegistry(base).projects.length, 2);
});

test('genId regenerates on collision instead of returning a duplicate', () => {
  let call = 0;
  const randomFn = (n) => { call++; return Buffer.from(call === 1 ? 'aaaaaa' : 'bbbbbb', 'hex'); };
  const id = registry.genId(['aaaaaa'], randomFn);
  assert.strictEqual(id, 'bbbbbb');
  assert.strictEqual(call, 2);
});

test('removeProject removes a known entry and is a harmless no-op for an unknown id', () => {
  const base = tmpBase();
  const entry = registry.addProject(tmpProject('d'), base);
  assert.strictEqual(registry.removeProject('doesnotexist', base), false);
  assert.strictEqual(registry.readRegistry(base).projects.length, 1);
  assert.strictEqual(registry.removeProject(entry.id, base), true);
  assert.strictEqual(registry.readRegistry(base).projects.length, 0);
});

test('touchProject updates lastOpened for a known id, no-ops for an unknown one', async () => {
  const base = tmpBase();
  const entry = registry.addProject(tmpProject('e'), base);
  const before = entry.lastOpened;
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(registry.touchProject('nope', base), false);
  assert.strictEqual(registry.touchProject(entry.id, base), true);
  const after = registry.readRegistry(base).projects[0].lastOpened;
  assert.notStrictEqual(after, before);
});

test('findByPath finds a registered project by normalized path, null when not registered', () => {
  const base = tmpBase();
  const proj = tmpProject('f');
  registry.addProject(proj, base);
  assert.ok(registry.findByPath(proj, base));
  assert.strictEqual(registry.findByPath(tmpProject('g'), base), null);
});

test('listProjects returns entries newest-lastOpened-first', async () => {
  const base = tmpBase();
  const a = registry.addProject(tmpProject('h1'), base);
  await new Promise((r) => setTimeout(r, 5));
  const b = registry.addProject(tmpProject('h2'), base);
  const list = registry.listProjects(base);
  assert.strictEqual(list[0].id, b.id);
  assert.strictEqual(list[1].id, a.id);
});

test('registryPath resolves under the given baseDir', () => {
  const base = tmpBase();
  assert.strictEqual(registry.registryPath(base), path.join(base, 'projects.json'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/registry.test.js`
Expected: every test fails with `Cannot find module '../lib/registry'` (the module doesn't exist yet).

- [ ] **Step 3: Write `lib/registry.js`**

```js
'use strict';
/*
 * The project registry — ~/.spectoflow/projects.json. Tracks every project spectoflow has seen (via
 * `spectoflow dashboard`, wired in a later sub-project), so the multi-project hub knows what to list
 * and switch between. This module owns only the registry file itself; it has no opinion about
 * dashboards, ports, or servers, and nothing else in the codebase calls it yet.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REGISTRY_FILE = 'projects.json';

// Resolution order: an explicit baseDir (unit tests) > SPECTOFLOW_HOME (CLI-level test isolation,
// same convention as SPECTOFLOW_ROOT/SPECTOFLOW_PORT elsewhere in this codebase) > the real home dir.
function registryDir(baseDir) {
  return baseDir || process.env.SPECTOFLOW_HOME || path.join(os.homedir(), '.spectoflow');
}
function registryPath(baseDir) {
  return path.join(registryDir(baseDir), REGISTRY_FILE);
}

function readRegistry(baseDir) {
  try { return JSON.parse(fs.readFileSync(registryPath(baseDir), 'utf8')); }
  catch { return { projects: [] }; }
}

function writeRegistry(baseDir, data) {
  const dir = registryDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryPath(baseDir), JSON.stringify(data, null, 2) + '\n');
}

// 6 hex chars; regenerated on the rare collision against ids already in the registry. `randomFn` is
// injectable (defaults to crypto.randomBytes) so collision handling is testable without depending on
// genuine randomness to ever actually collide.
function genId(existingIds, randomFn) {
  const rand = randomFn || ((n) => crypto.randomBytes(n));
  let id;
  do { id = rand(3).toString('hex'); } while (existingIds.includes(id));
  return id;
}

function findByPath(projectPath, baseDir) {
  const target = path.resolve(projectPath);
  return readRegistry(baseDir).projects.find((p) => path.resolve(p.path) === target) || null;
}

// Registers `projectPath` if it isn't already known (matched by normalized path); either way stamps
// lastOpened to now and returns the entry. Never duplicates the same folder under a second id.
function addProject(projectPath, baseDir) {
  const reg = readRegistry(baseDir);
  const target = path.resolve(projectPath);
  let entry = reg.projects.find((p) => path.resolve(p.path) === target);
  if (!entry) {
    entry = {
      id: genId(reg.projects.map((p) => p.id)),
      path: target,
      name: path.basename(target),
      lastOpened: new Date().toISOString(),
    };
    reg.projects.push(entry);
  } else {
    entry.lastOpened = new Date().toISOString();
  }
  writeRegistry(baseDir, reg);
  return entry;
}

function removeProject(id, baseDir) {
  const reg = readRegistry(baseDir);
  const before = reg.projects.length;
  reg.projects = reg.projects.filter((p) => p.id !== id);
  writeRegistry(baseDir, reg);
  return reg.projects.length < before;
}

function touchProject(id, baseDir) {
  const reg = readRegistry(baseDir);
  const entry = reg.projects.find((p) => p.id === id);
  if (!entry) return false;
  entry.lastOpened = new Date().toISOString();
  writeRegistry(baseDir, reg);
  return true;
}

// Newest-first — the natural "what did I touch most recently" order for both `spectoflow projects
// list` and (in a later sub-project) the hub landing page.
function listProjects(baseDir) {
  return readRegistry(baseDir).projects.slice()
    .sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || ''));
}

module.exports = {
  readRegistry, writeRegistry, genId, addProject, removeProject, touchProject,
  findByPath, listProjects, registryPath,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/registry.test.js`
Expected: all 11 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add lib/registry.js test/registry.test.js
git commit -m "$(cat <<'EOF'
add lib/registry.js — the multi-project hub's project registry

First of five sequenced sub-projects toward the multi-project hub (see
docs/multi-project-hub-design.md). Standalone module, nothing else wired
to it yet: reads/writes ~/.spectoflow/projects.json (or SPECTOFLOW_HOME for
test isolation), matches projects by normalized path so the same folder is
never registered twice, generates a 6-hex-char id per project with collision
retry.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

---

### Task 2: `spectoflow projects` CLI command

**Files:**
- Modify: `bin/spectoflow.js`
- Test: `test/cli-projects.test.js`

**Interfaces:**
- Consumes: everything from Task 1's `lib/registry.js` (`listProjects`, `removeProject`).
- Produces: nothing new for other code to consume — this is a leaf, terminal CLI command. `projects`
  joins the existing `fns`/`HELP` dispatch tables (see `bin/spectoflow.js:548` `fns` and `:501`
  `HELP`), following the exact same shape every other subcommand already uses.

- [ ] **Step 1: Write the failing tests**

Create `test/cli-projects.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');

// Every invocation gets its own SPECTOFLOW_HOME so these tests never touch the real developer
// machine's ~/.spectoflow/projects.json (same isolation convention as SPECTOFLOW_ROOT elsewhere).
function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-registry-home-'));
}
function run(home, args) {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SPECTOFLOW_HOME: home },
  });
}

test('projects list prints a friendly message when nothing is registered yet', () => {
  const home = freshHome();
  const out = run(home, ['projects']);
  assert.match(out, /no projects registered/i);
});

test('projects list shows a registered project\'s id, name and path', () => {
  const home = freshHome();
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-registry-proj-'));
  const registry = require('../lib/registry');
  const entry = registry.addProject(proj, home);
  const out = run(home, ['projects', 'list']);
  assert.ok(out.includes(entry.id));
  assert.ok(out.includes(entry.name));
  assert.ok(out.includes(proj) || out.includes(path.resolve(proj)));
});

test('projects (no subcommand) behaves the same as projects list', () => {
  const home = freshHome();
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-registry-proj2-'));
  const registry = require('../lib/registry');
  const entry = registry.addProject(proj, home);
  const out = run(home, ['projects']);
  assert.ok(out.includes(entry.id));
});

test('projects remove <id> removes a known entry', () => {
  const home = freshHome();
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cli-registry-proj3-'));
  const registry = require('../lib/registry');
  const entry = registry.addProject(proj, home);
  const out = run(home, ['projects', 'remove', entry.id]);
  assert.match(out, /removed/i);
  assert.strictEqual(registry.readRegistry(home).projects.length, 0);
});

test('projects remove <unknown-id> reports it was not found, without throwing', () => {
  const home = freshHome();
  const out = run(home, ['projects', 'remove', 'ffffff']);
  assert.match(out, /no project/i);
});

test('projects remove with no id prints usage instead of crashing', () => {
  const home = freshHome();
  const out = run(home, ['projects', 'remove']);
  assert.match(out, /usage/i);
});

test('projects -h shows per-command help instead of running the command', () => {
  const home = freshHome();
  const out = run(home, ['projects', '-h']);
  assert.match(out, /spectoflow projects/i);
  assert.match(out, /registered/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cli-projects.test.js`
Expected: every test fails — `projects` isn't a recognized command yet, so the CLI falls through to
printing the general `help()` screen instead of the expected output (no matching text found).

- [ ] **Step 3: Wire the command into `bin/spectoflow.js`**

Add the `require` near the top, alongside the other `lib/` requires (after `const manifest =
require('../lib/manifest');` at line 11):

```js
const registry = require('../lib/registry');
```

Add the command functions. Place them near `dashboardStatus`/`stopDashboard` (after the `dashboard()`
function, i.e. right after line 284's closing brace, before the `// ---- Customize` comment on line
286):

```js
// ---- projects: the multi-project registry's CLI surface (~/.spectoflow/projects.json) ----
function projectsCmd() {
  const sub = argv[1];
  if (sub === 'remove') return projectsRemove(argv[2]);
  return projectsList();
}
function projectsList() {
  console.log(wordmark());
  const rows = registry.listProjects();
  if (!rows.length) {
    console.log(c.dim('  no projects registered yet — run `spectoflow dashboard` inside one'));
    return;
  }
  const w = Math.max(4, ...rows.map((r) => r.name.length));
  rows.forEach((r) => console.log(`  ${c.g(r.id)}  ${r.name.padEnd(w)}  ${c.dim(r.path)}`));
}
function projectsRemove(id) {
  if (!id) { console.log('Usage: spectoflow projects remove <id>'); return; }
  const ok = registry.removeProject(id);
  console.log(ok ? `${c.g('✓')} removed ${id}` : `${c.y('!')} no project registered with id ${id}`);
}
```

Add to the `HELP` map (insert right after the `dashboard:` entry, before `skill:`, around line 524):

```js
  projects: `${c.bold('spectoflow projects')} ${c.dim('[remove <id>]')}\n
  List every project spectoflow has seen via ${c.g('spectoflow dashboard')} (a global registry at
  ${c.dim('~/.spectoflow/projects.json')}) — id, name, path. ${c.g('remove <id>')} drops one (e.g. a
  project that moved or was deleted) from this list only; it never touches that project's own files.`,
```

Add to the `fns` dispatch map (insert alongside the other entries, around line 549):

```js
const fns = {
  init, update, dashboard, stop: stopDashboard, status, list: listAll, help, version,
  projects: projectsCmd,
  agents: () => { console.log(wordmark()); printAgents(false); },
  skills: () => { console.log(wordmark()); printSkills(false); },
  workflow: () => { console.log(wordmark()); printWorkflow(false); },
  skill: () => runCustomize('skill'),
  agent: () => runCustomize('agent'),
};
```

Add one line to the grouped `help()` screen's "Dashboard" section (after the `dashboard restart` line,
around line 481):

```
  ${c.g('dashboard restart')}            stop then start
  ${c.g('projects')} ${c.dim('[remove <id>]')}     list every project seen so far (~/.spectoflow/projects.json)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/cli-projects.test.js`
Expected: all 7 tests pass, 0 failures.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `node --test test/*.test.js`
Expected: same pass count as before this task plus the 11 (Task 1) + 7 (Task 2) new tests; the one
pre-existing full-suite-only environmental flake (`update restarts an already-running dashboard...`,
documented in `test/cli-update.test.js`) is the only tolerated failure — if anything else fails,
investigate before committing.

- [ ] **Step 6: Commit**

```bash
git add bin/spectoflow.js test/cli-projects.test.js
git commit -m "$(cat <<'EOF'
add `spectoflow projects [remove <id>]` — CLI surface for the project registry

Second half of sub-project 1 toward the multi-project hub. Lists every
project registered in ~/.spectoflow/projects.json (id, name, path) and lets
you drop a stale entry (moved/deleted project) without touching that
project's own files. Nothing yet writes to the registry automatically —
`spectoflow dashboard` auto-registering the current project is sub-project 4.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017oCVy8vdqnLs6sJaGLQ8aV
EOF
)"
```

## Self-review notes (completed during authoring)

- **Spec coverage:** design doc's sub-project 1 ("Registry + CLI `projects` commands... Fully
  standalone; no change to the dashboard server itself") — fully covered by Tasks 1–2; deliberately
  does **not** touch `spectoflow dashboard`/`server.js` per the design doc's own scoping.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type/signature consistency:** `baseDir` is the trailing optional argument on every `lib/
  registry.js` export used across both tasks and both test files — checked for drift, none found.
