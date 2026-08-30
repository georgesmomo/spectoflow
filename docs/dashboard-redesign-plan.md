# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Frontend rendering is generative — pin structure + tokens + acceptance; the CONTROLLER live-verifies each visual task in Chrome.

**Goal:** Bring the dashboard to a polished control-room standard (Overview with KPI cards, status donut, workflow strip, per-phase bars; filter chips + search; a right sidebar with À demander + Journal; a global restyle) — keeping spectoflow's amber identity, preserving the orchestrator/chat/workflow/SSE.

**Architecture:** Front-only. All aggregates are computed client-side from the existing `GET /api/project`; the one shared, testable piece is `templates/dashboard/public/stats.js`. Charts are hand-rolled inline SVG (zero-dep). Files: `templates/dashboard/public/{index.html, app.js, styles.css, stats.js}`; `test/dashboard-stats.test.js`.

**Tech Stack:** Zero-dep browser JS + inline SVG; native `node:test` for `stats.js`; the existing SSE server (`server.js`) is UNCHANGED.

**Spec:** `docs/dashboard-redesign-design.md` (approved; O1–O3 resolved).

## Global Constraints

- **Zero runtime dependencies.** No chart library — donut/rings/bars/sparklines are inline SVG. No new npm deps.
- **No server/API change.** `server.js`, `store`, `runner`, `orchestrator` and all `/api/*` contracts stay exactly as they are. The redesign reads the same `GET /api/project` and the same SSE `change`/`message`/`run-*` events.
- **Preserve behaviour:** the chat widget (Send/Orchestrate), Approve/Cancel approval row, the task drawer, the Workflow toggle, granular writes, SSE realtime. Only visuals + the new Overview/sidebar are added.
- **Theme-aware:** every colour is a token on bare `:root`, re-declared under `[data-theme="light"]` (and dark). The existing theme toggle must keep working in both directions.
- **Keep spectoflow's identity:** `--signal` stays amber `#e6a54b` (the live/active accent); `--cool` cyan secondary. Status tokens keep their current meanings.
- **English** UI text. Everything markdown/JS in English.
- **Semver:** feature → minor → **0.11.0**.
- **Live verification is the controller's step:** a subagent edits the files and runs static checks (`node -c`), then the controller loads the dashboard in Chrome against the `demo/` or a preview project and confirms the visual result with a screenshot.

### Merged palette tokens (use these EXACT values in styles.css `:root`, dark)

```
--bg:#10151b; --surface:#171e26; --surface-2:#1e2732; --line:#2a3641;
--ink:#e9edf2; --muted:#94a2af; --faint:#63727e;
--signal:#e6a54b; --cool:#5fb2cc;
--s-todo:#7d8f97; --s-in_progress:#e6a54b; --s-to_validate:#5fb2cc;
--s-to_analyze:#ab8cd9; --s-done:#5fb67e; --s-blocked:#db7268;
--radius:14px; --shadow:0 10px 30px rgba(0,0,0,.38);
```
Light theme keeps parity (adapt the neutrals; keep the same accent/status hues, darker where needed for contrast).

---

### Task 1: `stats.js` shared aggregation module + unit test

**Files:**
- Create: `templates/dashboard/public/stats.js`
- Test: `test/dashboard-stats.test.js`

**Interfaces:**
- Produces: `stats(project) → { total, done, pct, byStatus, phases, toAsk, running, statuses }` and
  `STATUSES`. Browser: `window.SpectoStats`. Node: `module.exports`.
  - `project` is the `GET /api/project` shape: `{ plans:[{file, phases:[{title, tasks:[{id,title,status,owner,level}]}]}], runtime:{ agents:[{tool,status}], messages:[], orchestration:{status,currentStep,steps}|undefined } , … }`.
  - `byStatus`: counts keyed by each of the 6 statuses. `phases`: `[{title,file,done,total,pct}]`.
    `toAsk`: tasks with status `to_validate`|`to_analyze` → `[{id,title,status,file}]`.
    `running`: `{ agents:Number(running), lastRun:{tool,status}|null, orchestration|null }`.

- [ ] **Step 1: Write the failing test**

```js
// test/dashboard-stats.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { stats, STATUSES } = require('../templates/dashboard/public/stats');

const project = {
  plans: [{
    file: 'login.md',
    phases: [
      { title: 'Phase 1', tasks: [
        { id: 'T-001', title: 'a', status: 'done' },
        { id: 'T-002', title: 'b', status: 'in_progress' },
        { id: 'T-003', title: 'c', status: 'to_validate' } ] },
      { title: 'Phase 2', tasks: [
        { id: 'T-004', title: 'd', status: 'to_analyze' },
        { id: 'T-005', title: 'e', status: 'done' } ] },
    ],
  }],
  runtime: { agents: [{ tool: 'claude', status: 'running' }, { tool: 'codex', status: 'done' }],
             orchestration: { status: 'running', currentStep: 1 } },
};

test('stats aggregates totals, pct and byStatus', () => {
  const s = stats(project);
  assert.strictEqual(s.total, 5);
  assert.strictEqual(s.done, 2);
  assert.strictEqual(s.pct, 40);
  assert.strictEqual(s.byStatus.to_validate, 1);
  assert.strictEqual(s.byStatus.done, 2);
  assert.deepStrictEqual(STATUSES, ['todo','in_progress','to_validate','to_analyze','done','blocked']);
});
test('stats computes per-phase progress', () => {
  const s = stats(project);
  assert.strictEqual(s.phases.length, 2);
  assert.deepStrictEqual(s.phases[0], { title: 'Phase 1', file: 'login.md', done: 1, total: 3, pct: 33 });
  assert.strictEqual(s.phases[1].pct, 50);
});
test('stats lists to_validate + to_analyze under toAsk', () => {
  const s = stats(project);
  assert.deepStrictEqual(s.toAsk.map((t) => t.id).sort(), ['T-003', 'T-004']);
});
test('stats reports running agents + last run + orchestration', () => {
  const s = stats(project);
  assert.strictEqual(s.running.agents, 1);
  assert.deepStrictEqual(s.running.lastRun, { tool: 'codex', status: 'done' });
  assert.strictEqual(s.running.orchestration.status, 'running');
});
test('stats is safe on an empty project', () => {
  const s = stats({});
  assert.strictEqual(s.total, 0); assert.strictEqual(s.pct, 0);
  assert.deepStrictEqual(s.toAsk, []); assert.strictEqual(s.running.agents, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-stats.test.js` → Expected: FAIL (`Cannot find module …/stats`).

- [ ] **Step 3: Implement `stats.js`**

```js
// templates/dashboard/public/stats.js
'use strict';
(function (root) {
  const STATUSES = ['todo', 'in_progress', 'to_validate', 'to_analyze', 'done', 'blocked'];
  const allTasks = (p) => (p.plans || []).flatMap((pl) => pl.phases.flatMap((ph) => ph.tasks.map((t) => ({ ...t, file: pl.file }))));
  function stats(p) {
    p = p || {};
    const tasks = allTasks(p);
    const total = tasks.length;
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    tasks.forEach((t) => { if (byStatus[t.status] === undefined) byStatus[t.status] = 0; byStatus[t.status]++; });
    const done = byStatus.done || 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const phases = (p.plans || []).flatMap((pl) => pl.phases.map((ph) => {
      const d = ph.tasks.filter((t) => t.status === 'done').length, tot = ph.tasks.length;
      return { title: ph.title, file: pl.file, done: d, total: tot, pct: tot ? Math.round((d / tot) * 100) : 0 };
    }));
    const toAsk = tasks.filter((t) => t.status === 'to_validate' || t.status === 'to_analyze')
      .map((t) => ({ id: t.id, title: t.title, status: t.status, file: t.file }));
    const rt = p.runtime || {};
    const agents = (rt.agents || []);
    const last = agents.length ? agents[agents.length - 1] : null;
    const running = {
      agents: agents.filter((a) => a.status === 'running').length,
      lastRun: last ? { tool: last.tool, status: last.status } : null,
      orchestration: rt.orchestration || null,
    };
    return { total, done, pct, byStatus, phases, toAsk, running, statuses: STATUSES };
  }
  const api = { stats, STATUSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpectoStats = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes** — `node --test test/dashboard-stats.test.js` → PASS; then `npm test` (full suite green).

- [ ] **Step 5: Commit** — `git add templates/dashboard/public/stats.js test/dashboard-stats.test.js && git commit -m "feat(dashboard): stats.js shared aggregation module + tests"`

---

### Task 2: Palette + design-token refresh (styles.css)

**Files:** Modify `templates/dashboard/public/styles.css` (`:root` and `[data-theme="light"]` token blocks + the base card/surface rules).

- [ ] **Step 1:** Replace the dark `:root` token values with the merged palette (exact values in Global Constraints). Update the light `[data-theme="light"]` block to keep parity (adapt neutrals; keep accent/status hues). Bump `--radius` to `14px`, `--shadow` to the softer value.
- [ ] **Step 2:** Apply the tokens to the existing base components (topbar, panels, cards, chips, task cards, chat, drawer) so the whole UI adopts the warmer surfaces + softer radius/shadow. Do NOT restructure markup here — only the look.
- [ ] **Step 3: Controller live-verify** — load the dashboard in Chrome; confirm the existing Board/Workflow/Agents/chat render with the new palette in BOTH themes (toggle), nothing broken. Screenshot.
- [ ] **Step 4: Commit** — `feat(dashboard): merged control-room palette (amber signal kept)`

---

### Task 3: Overview section (KPI cards + status donut + workflow strip + phase bars)

**Files:** Modify `templates/dashboard/public/index.html` (Board panel: add an Overview block above the board), `app.js` (render from `SpectoStats.stats(P)` + SVG helpers), `styles.css` (Overview components).

**Interfaces:** Consumes `window.SpectoStats.stats(P)` (Task 1). `P` is the loaded project.

- [ ] **Step 1:** In index.html, restructure the Board panel into a main column + right sidebar shell; add an `#overview` container at the top of the main column with four `#kpi*` card slots, a `#donut` slot, a `#wfStrip` slot, and a `#phaseBars` slot. Keep the existing `#board` below.
- [ ] **Step 2:** In app.js add pure SVG helpers `donut(segments,size)`, `ring(pct,size)`, `bars(rows)` (inline SVG strings/elements) and a `renderOverview()` that reads `SpectoStats.stats(P)`:
  - 4 KPI cards: Global progress (ring = pct, done/total), In progress (`byStatus.in_progress`), To validate (`byStatus.to_validate`), Running/last orchestration (`running.agents` + `running.orchestration?.status` or `running.lastRun`).
  - Donut of `byStatus` using the status token colours, big total/pct in the centre, a legend.
  - Workflow strip: the enabled `P.workflow` steps as a compact animated flow (reuse the `wf-arrow` flow animation), disabled steps dimmed.
  - Phase bars: one labelled bar per `stats.phases` entry (title, done/total, %).
  Call `renderOverview()` from `render()`.
- [ ] **Step 3:** styles.css — the Overview grid, KPI cards, donut/legend, workflow strip, phase bars, all theme-aware with the tokens.
- [ ] **Step 4: Controller live-verify** — Chrome against a project with real tasks (init a preview with a seeded plan, or use `demo/`); confirm the KPI numbers/donut/bars match the data, the strip animates, both themes OK, responsive collapse. Screenshot.
- [ ] **Step 5: Commit** — `feat(dashboard): Overview — KPI cards, status donut, workflow strip, phase bars`

---

### Task 4: Filter chips + search over the task board

**Files:** Modify index.html (a filter row between Overview and `#board`), app.js (filter state + apply on render), styles.css (chip row).

- [ ] **Step 1:** Add a filter row: status chips (All + the 6 statuses, using status colours) + a text search input. (Owner/level chips optional if cheap.)
- [ ] **Step 2:** app.js — hold a `filter` state (active status + query); `renderBoard()` filters tasks by status and case-insensitive title/id match; chips toggle; the count/empty states update. Default = All. Filtering is client-side only (no writes).
- [ ] **Step 3:** styles.css — chip row (active chip uses its status colour), search input.
- [ ] **Step 4: Controller live-verify** — Chrome: toggling a status chip filters the board; search narrows it; "All" resets. Screenshot.
- [ ] **Step 5: Commit** — `feat(dashboard): board filter chips + search`

---

### Task 5: Right sidebar — À demander + Journal

**Files:** Modify index.html (right sidebar in the Board shell), app.js (render from stats + runtime.messages), styles.css (sidebar).

- [ ] **Step 1:** index.html — a right `<aside class="side">` with two blocks: **À demander** (`#toAsk`) and **Journal** (`#journal`).
- [ ] **Step 2:** app.js —
  - À demander: `SpectoStats.stats(P).toAsk` → compact rows (id · title · status chip); clicking a row opens that task's drawer (reuse `openDrawer`).
  - Journal: `P.runtime.messages` reverse-chronological → entries (role · agent · kind · text, coloured by kind like the chat). Live: the SSE `message`/`change` handler already triggers `load()` → re-render; ensure the Journal updates.
- [ ] **Step 3:** styles.css — the sidebar blocks, toAsk rows, journal feed (scrolls independently).
- [ ] **Step 4: Controller live-verify** — Chrome: a `to_validate` task appears under À demander and opens its drawer; running an agent posts messages that show in the Journal live. Screenshot.
- [ ] **Step 5: Commit** — `feat(dashboard): right sidebar — À demander + Journal`

---

### Task 6: Restyle pass — task cards, phase collapsibles, Workflow / Agents & Skills, chat

**Files:** Modify app.js (phase sections collapsible; enriched task cards), styles.css (the new card system across all tabs + chat widget).

- [ ] **Step 1:** Phase sections in `renderBoard()` become collapsible (title · mini progress bar · count · chevron); remember collapsed state per phase in `localStorage` (guarded try/catch). Task cards adopt the reference card style (id badge, level/status chips, owner, tags, comment count) — keep the click→drawer.
- [ ] **Step 2:** Restyle the Workflow diagram and the Agents & Skills cards to the new card system (no structural/behaviour change — the workflow toggle still edits `workflow.md`). Restyle the chat widget + Approve/Cancel to match.
- [ ] **Step 3: Controller live-verify** — Chrome: collapse/expand a phase (persists on reload); Workflow toggle still works; Agents/Skills and chat look consistent; Orchestrate + Approve/Cancel still function. Screenshot.
- [ ] **Step 4: Commit** — `feat(dashboard): collapsible phases + unified card system across tabs`

---

### Task 7: Docs + version

**Files:** Modify `docs/DECISIONS.md` (D22, French), `docs/ROADMAP.md` (move "Design pass" → Done 0.11; the Next list becomes empty / "publish"), `docs/ARCHITECTURE.md` (dashboard section: Overview + sidebar + stats.js), `CLAUDE.md` (v0.11.0 + the Overview/sidebar), `README.md` (v0.11 + a line + ideally a screenshot reference), `package.json` (0.11.0), `docs/dashboard-redesign-design.md` (status → implemented).

- [ ] **Step 1:** DECISIONS D22 (French) — record: the control-room redesign; amber identity kept + reference structure/palette adopted; Overview (KPI/donut/workflow strip/phase bars), filters, right sidebar (À demander + Journal); zero-dep inline-SVG charts; client-side aggregates via the shared `stats.js` (unit-tested); no server/API change; orchestrator/chat/workflow/SSE preserved. Reference `docs/dashboard-redesign-design.md`.
- [ ] **Step 2:** ROADMAP — "Design pass" → Done (0.11). The roadmap's Next list is now empty; note the remaining pre-publish items (naming decision, real-agent shakedown) if a "Before publish" section fits.
- [ ] **Step 3:** ARCHITECTURE — update the dashboard data-flow paragraph (Overview + sidebar computed client-side via `stats.js`; charts inline SVG).
- [ ] **Step 4:** CLAUDE.md → v0.11.0 + the dashboard now has an Overview + right sidebar (À demander / Journal).
- [ ] **Step 5:** README → v0.11 header + one line on the control-room dashboard.
- [ ] **Step 6:** package.json → `"version": "0.11.0"`; set the design doc status to **implemented**.
- [ ] **Step 7:** `npm test` (green) → commit `spectoflow 0.11.0 — control-room dashboard redesign`.

---

## Self-Review

**Spec coverage:** palette merge → Task 2 (verbatim tokens); Overview (KPI/donut/strip/bars) → Task 3;
filters → Task 4; sidebar À demander + Journal → Task 5; restyle/collapsibles/tabs/chat → Task 6;
stats.js + tests (O3) → Task 1; O1 (Running KPI) → Task 3 Step 2; O2 (workflow strip) → Task 3 Step 2;
zero-dep/no-server-change/theme-aware/preserve → Global Constraints, enforced per task; docs/version → Task 7.

**Placeholder scan:** `stats.js` and its test are verbatim; the palette tokens are verbatim. The
visual tasks are intentionally generative (pinned structure + tokens + acceptance + controller
live-verify), the correct spec for a redesign — not placeholders.

**Type consistency:** `SpectoStats.stats(P)` returns `{total,done,pct,byStatus,phases:[{title,file,done,total,pct}],toAsk:[{id,title,status,file}],running:{agents,lastRun,orchestration},statuses}` — used consistently by Tasks 3 (KPI/donut/bars) and 5 (toAsk/Journal). Status keys match the six `--s-*` tokens.
