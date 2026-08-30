# Dashboard 0.12 — Nav, Chat & Visual Richness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes. Visual tasks are generative — pin structure + acceptance; the CONTROLLER live-verifies each in Chrome.

**Goal:** Round out the dashboard — a redesigned header, Info + Backlog tabs, enriched Agents & Skills (with a full-body drawer), a full Chat tab beside a redesigned floating widget — and bring back the reference's dynamism: the smooth **area curve**, **icons** everywhere, and **animations**.

**Architecture:** Two small back-end additions (a `runtime.history` snapshot; a scoped read-only `/api/agentfile` endpoint) + extended agent/skill front-matter parsing. Everything else is client-side over the existing `/api/project` + SSE. Pure SVG chart builders live in a testable `charts.js` (browser+Node, like `stats.js`). Files: `templates/dashboard/public/{index.html,app.js,styles.css,charts.js}`, `templates/dashboard/{server.js}`, `templates/lib/store.js`, `test/*`.

**Tech Stack:** Zero-dep browser JS + inline SVG/markdown; native `node:test`; existing SSE server.

**Spec:** `docs/dashboard-nav-design.md` (approved; O1–O5 resolved).

## Global Constraints

- **Zero runtime dependencies.** Inline SVG, a tiny hand-written markdown renderer, a hand-inlined SVG icon set — NO chart/icon/markdown library. No new npm deps.
- **Preserve** the orchestrator, chat run/approve logic, granular writes, SSE, and ALL existing `/api/*` contracts. The ONLY new endpoint is `GET /api/agentfile`. The ONLY new data is `runtime.history`.
- **Motion honours `prefers-reduced-motion`** (the codebase already guards this; every new animation must sit under a `@media (prefers-reduced-motion: reduce)` disable or reuse the existing guard).
- **Theme-aware:** every colour a token on `:root`, re-declared for light. Keep the amber `--signal` identity.
- **Security:** `/api/agentfile` is read-only and strictly scoped to `.spectoflow/agents/**` and `.spectoflow/skills/**`; reject any path that escapes those dirs (`..`, absolute, symlink-out). Return 400/404, never arbitrary file contents.
- **English** UI; `node -c` must pass on edited JS; `npm test` green after each task.
- **Semver:** feature → **0.12.0**.
- **Live verification is the controller's step** for every visual task (screenshots in Chrome against a seeded preview project).

---

### Task 1: Back-end foundation — snapshot history, front-matter fields, `/api/agentfile`

**Files:** Modify `templates/lib/store.js`, `templates/dashboard/server.js`; Test: `test/dashboard-backend.test.js` (create).

**Interfaces:**
- Produces: `store.recordSnapshot(runtime, {total,done}, date) → runtime` (dedupes `date` in `runtime.history`, caps to 60, newest-last). `store.readAgents`/skills now include `standards`/`uses` (agents) and `inputs`/`outputs`/`standard` (skills). `GET /api/agentfile?path=<rel>` → `{content}` scoped to agents/skills.

- [ ] **Step 1: Write failing tests**

```js
// test/dashboard-backend.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../templates/lib/store');

test('recordSnapshot dedupes today and caps history', () => {
  let rt = { history: [] };
  rt = store.recordSnapshot(rt, { total: 5, done: 1 }, '2026-08-01');
  rt = store.recordSnapshot(rt, { total: 5, done: 2 }, '2026-08-01'); // same day → update
  assert.strictEqual(rt.history.length, 1);
  assert.deepStrictEqual(rt.history[0], { date: '2026-08-01', total: 5, done: 2 });
  rt = store.recordSnapshot(rt, { total: 6, done: 3 }, '2026-08-02'); // new day → append
  assert.strictEqual(rt.history.length, 2);
  for (let i = 0; i < 80; i++) rt = store.recordSnapshot(rt, { total: 6, done: i }, '2026-10-' + String((i % 28) + 1).padStart(2, '0'));
  assert.ok(rt.history.length <= 60, 'capped');
});

test('readAgents/readSkills expose the upgraded front-matter fields', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-fm-'));
  fs.mkdirSync(path.join(d, '.spectoflow', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(d, '.spectoflow', 'skills', 'write-spec'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spectoflow', 'agents', 'a.md'),
    '---\nname: business-analyst\ncapability: analysis\nuses: [analyze-requirements, write-spec]\nstandards: [BDD, acceptance criteria]\ndescription: x\n---\n# BA\n');
  fs.writeFileSync(path.join(d, '.spectoflow', 'skills', 'write-spec', 'SKILL.md'),
    '---\nname: write-spec\ncapability: analysis\ninputs: a need\noutputs: a spec\nstandard: spec-kit\ndescription: y\n---\n# write-spec\n');
  const a = store.readAgents(d).find((x) => x.name === 'business-analyst');
  assert.deepStrictEqual(a.uses, ['analyze-requirements', 'write-spec']);
  assert.deepStrictEqual(a.standards, ['BDD', 'acceptance criteria']);
  const sk = (store.readSkills ? store.readSkills(d) : []).find((x) => x.name === 'write-spec')
    || store.readProject(d).skills.find((x) => x.name === 'write-spec');
  assert.strictEqual(sk.standard, 'spec-kit');
  assert.strictEqual(sk.inputs, 'a need');
});
```

- [ ] **Step 2: Run — expect FAIL** (`recordSnapshot`/fields missing). `node --test test/dashboard-backend.test.js`.

- [ ] **Step 3: Implement in `store.js`**

Add `recordSnapshot`:
```js
function recordSnapshot(runtime, counts, date) {
  runtime.history = runtime.history || [];
  const d = date || new Date().toISOString().slice(0, 10);
  const last = runtime.history[runtime.history.length - 1];
  const snap = { date: d, total: counts.total | 0, done: counts.done | 0 };
  if (last && last.date === d) runtime.history[runtime.history.length - 1] = snap;
  else runtime.history.push(snap);
  if (runtime.history.length > 60) runtime.history = runtime.history.slice(-60);
  return runtime;
}
```
Extend `frontmatter`-based readers: in `listMd` (agents) also parse `standards` (list) + `uses` (list); add a skills reader exposing `capability`/`inputs`/`outputs`/`standard`. Reuse the flat-list parse (`.replace(/[\[\]]/g,'').split(',').map(trim)`). Export `recordSnapshot` (+ `readSkills` if added). In `readProject`, after reading runtime + plans, call `recordSnapshot(runtime, {total, done})` for today and (only if it changed) persist via `writeRuntime` — OR seed one point if history empty. Keep it side-effect-light: recording on `readProject` is acceptable (dashboard polls it); guard so it doesn't rewrite runtime every read if unchanged.

- [ ] **Step 4: Add `/api/agentfile` to `server.js`**

```js
if (p === '/api/agentfile' && req.method === 'GET') {
  const rel = new URL(req.url, 'http://x').searchParams.get('path') || '';
  const base = path.join(ROOT, '.spectoflow');
  const abs = path.resolve(base, rel);
  const okDir = abs.startsWith(path.join(base, 'agents') + path.sep) || abs.startsWith(path.join(base, 'skills') + path.sep);
  if (!okDir || !abs.endsWith('.md') || !fs.existsSync(abs) || fs.statSync(abs).isDirectory())
    return sendJSON(res, 400, { error: 'not an agent/skill file' });
  return sendJSON(res, 200, { content: fs.readFileSync(abs, 'utf8') });
}
```
Add a server test (in the same test file or a dedicated one) that starts the server against a temp project and asserts: a real agent file returns `{content}`; `?path=../../package.json` and `?path=../config.json` return 400.

- [ ] **Step 5: Run — GREEN.** `node --test test/dashboard-backend.test.js` then `npm test`.
- [ ] **Step 6: Commit** — `feat(dashboard): runtime.history snapshot + agent/skill front-matter fields + /api/agentfile`

---

### Task 2: `charts.js` — pure SVG chart builders (donut, area curve, bars, ring) + tests

**Files:** Create `templates/dashboard/public/charts.js`; Test: `test/dashboard-charts.test.js`. (This refactors the 0.11 inline `donut`/`ring`/`bars` out of app.js and ADDS the smooth `area` curve, ported from the reference's technique.)

**Interfaces:** `window.SpectoCharts` / `module.exports` = `{ donut(segs,opts), area(series,labels,opts), bars(items,opts), ring(pct,opts), polar(cx,cy,r,deg) }`, all returning SVG-string markup (pure, no DOM). `area` builds a Catmull-Rom-smoothed path with gradient fill + grid + animated line (`pathLength="1"`).

- [ ] **Step 1: Write failing tests** (assert the pure math/markup, not pixels):

```js
// test/dashboard-charts.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../templates/dashboard/public/charts');

test('donut builds one arc path per non-zero segment with a centre label', () => {
  const svg = C.donut([{ value: 1, color: '#a', label: 'A' }, { value: 1, color: '#b', label: 'B' }], { center: '2', sub: 'TASKS' });
  assert.strictEqual((svg.match(/<path /g) || []).length, 2);
  assert.match(svg, /2/); assert.match(svg, /TASKS/);
});
test('donut skips zero-value segments', () => {
  const svg = C.donut([{ value: 3, color: '#a' }, { value: 0, color: '#b' }]);
  assert.strictEqual((svg.match(/<path /g) || []).length, 1);
});
test('area builds a smoothed line + filled area per series with grid', () => {
  const svg = C.area([{ name: 'scope', color: '#a', data: [5, 5, 6] }, { name: 'done', color: '#b', data: [0, 2, 3] }], ['d1', 'd2', 'd3']);
  assert.match(svg, /class="area-line"/);
  assert.match(svg, /class="area-fill"/);
  assert.ok((svg.match(/ C /g) || []).length >= 1, 'has bezier smoothing');
  assert.match(svg, /pathLength="1"/);
});
test('ring encodes the pct in the arc dash', () => {
  const svg = C.ring(50);
  assert.match(svg, /50/);
});
test('polar returns [x,y] on the circle', () => {
  const [x, y] = C.polar(50, 50, 40, 0);
  assert.ok(Math.abs(x - 50) < 1 && Math.abs(y - 10) < 1); // 0° = top
});
```

- [ ] **Step 2: Run — FAIL** (module missing).
- [ ] **Step 3: Implement `charts.js`** — a UMD wrapper (like stats.js) exporting `polar`, `donut`, `area`, `bars`, `ring`. Port the reference's `donut` (arc paths, gaps, `--i` stagger, centre) and `area` (the `smooth(pts)` Catmull-Rom bezier, gradient `area-fill` at ~.13 opacity, 4-line grid + labels, `area-line` with `pathLength="1"`, dots + value labels, `data-tip` hit-rects) and `bars` (grow + `data-count` count-up) and a `ring(pct)` (background track + `url(#grad)` foreground arc via stroke-dasharray). Colours come in via args (the caller passes token values). `0°` = top. Guard `module.exports` for Node, `window.SpectoCharts` for browser.
- [ ] **Step 4: Run — GREEN**; `npm test`.
- [ ] **Step 5: Rewire app.js** to use `SpectoCharts` (replace the 0.11 inline `donut`/`ring`/`bars`), include `<script src="charts.js">` before app.js in index.html. Controller live-verify: the 0.11 Overview donut/ring/bars still render (now from charts.js). Screenshot.
- [ ] **Step 6: Commit** — `feat(dashboard): charts.js — donut, smooth area curve, bars, ring (+ tests)`

---

### Task 3: Header redesign + icon set

**Files:** Create `templates/dashboard/public/icons.js` (an `ICON` map of inline SVG strings) or inline in app.js; Modify `index.html`, `app.js`, `styles.css`.

- [ ] **Step 1:** Add a small SVG line-icon set (info, board, backlog, workflow, agents, chat, run/play, sun/moon already exist; plus small status/section glyphs) as `ICON.name → '<svg…>'`.
- [ ] **Step 2:** Rework the topbar in index.html + `render()`: left = brand mark + `spectoflow / <projectType>` + a subtitle line (mode · language) + a slim global-progress meter (done/total %); centre = the tab nav with an icon per tab — **Board · Backlog · Workflow · Agents & Skills · Chat · Info** — active tab underlined with `--signal`; right = active-agent/lang/mode chips + a pulsing sync dot + a **Run** quick-action (opens the chat widget) + theme toggle. Wire the new tabs' panels (empty placeholders for Backlog/Chat/Info — filled in later tasks) so switching works.
- [ ] **Step 3:** styles.css — the denser header, icon-tab styling, the slim meter, pulsing sync dot (`@keyframes pulse`), theme-aware.
- [ ] **Step 4: Controller live-verify** — all six tabs switch; header looks right in dark + light; Run opens the widget. Screenshot.
- [ ] **Step 5: Commit** — `feat(dashboard): redesigned header + icon tabs (Board/Backlog/Workflow/Agents/Chat/Info)`

---

### Task 4: Overview area curve + animated charts + motion

**Files:** Modify `app.js` (Overview: add the curve; upgrade donut/bars to the animated charts.js versions + count-up), `styles.css` (chart animations, gradient defs, tooltip layer), `index.html` (a `<div id="tooltip">`).

- [ ] **Step 1:** In `renderOverview()`, add the **area curve** beside the donut: `SpectoCharts.area([{name:'Scope',color:cssv('--cool'),data: history.map(h=>h.total)},{name:'Delivered',color:cssv('--signal'),data: history.map(h=>h.done)}], history.map(h=>h.date.slice(5)))` from `P.runtime.history` (seed one point if empty). Upgrade the donut to the gap+stagger version and bars to the grow+count-up version.
- [ ] **Step 2:** styles.css — port the animations: `@keyframes rise/grow/pop`, `.area-line{ stroke-dasharray:1; stroke-dashoffset:1; animation:draw 1.1s ... }`, `.seg-anim` arc draw, `.bar-fill` staggered grow, the gradient `<defs>` for the ring/area, count-up JS (a `countUp()` that animates `data-count` spans). All under a `@media (prefers-reduced-motion: reduce){ *{animation:none!important} }` guard.
- [ ] **Step 3:** A tiny **tooltip**: a single `#tooltip` div positioned on `mousemove` over `.hit` elements reading `data-tip`.
- [ ] **Step 4: Controller live-verify** — the curve renders (scope vs delivered) and animates in; donut arcs draw; numbers count up; hovering a chart shows a tooltip; reduced-motion disables it. Screenshot.
- [ ] **Step 5: Commit** — `feat(dashboard): scope-vs-delivered area curve + chart animations + tooltips`

---

### Task 5: Info tab

**Files:** Modify `index.html` (Info panel), `app.js` (`renderInfo()`), `styles.css`.

- [ ] **Step 1:** `renderInfo()` from `P.config` + aggregates: project type, mode, language, active agent, runners (list), and counts (tasks total/done + %, specs, agents, skills, enabled workflow steps); the specs list; a compact enabled-workflow summary. Icons on section headers.
- [ ] **Step 2:** styles.css — Info panel cards/rows, theme-aware.
- [ ] **Step 3: Controller live-verify** — Info tab shows correct config + counts. Screenshot.
- [ ] **Step 4: Commit** — `feat(dashboard): Info (project) tab`

---

### Task 6: Backlog tab (flat sortable/filterable table)

**Files:** Modify `index.html` (Backlog panel), `app.js` (`renderBacklog()` + sort/filter state), `styles.css`.

- [ ] **Step 1:** `renderBacklog()` — a table of ALL tasks (`SpectoStats`/`allTasks`): columns id · title · phase · status · owner · level · 💬. Header click sorts (toggle asc/desc) by that column; reuse status chips (`--s-*`). Filter chips (status/owner/level) + a search reuse the Board filter idea. A row click → `openDrawer(id)`.
- [ ] **Step 2:** styles.css — dense table, sortable header affordance, theme-aware, responsive (horizontal scroll on narrow).
- [ ] **Step 3: Controller live-verify** — Backlog lists all tasks; sorting a column reorders; a status filter narrows; a row opens the drawer. Screenshot.
- [ ] **Step 4: Commit** — `feat(dashboard): Backlog tab — flat sortable/filterable task table`

---

### Task 7: Agents & Skills enrichment + full-body drawer

**Files:** Modify `app.js` (`renderTeam()` richer cards + a body drawer using `/api/agentfile` + a tiny markdown renderer), `styles.css`; possibly `index.html`.

- [ ] **Step 1:** Enrich cards: agent card shows title · capability · `standards` chips · `uses` skill chips · description; skill card shows name · capability · `standard` · inputs/outputs · description (from Task 1's extended fields).
- [ ] **Step 2:** Click a card → open a drawer that `fetch('/api/agentfile?path=agents/<file>')` (or `skills/<slug>/SKILL.md`) and renders the markdown body with a **tiny inline renderer** (`mdLite(text)`: `#/##/###` → headings, `- ` → list items, ``` fences → `<pre>`, `` `code` `` → inline code, blank lines → paragraphs; escape HTML first). Fall back to `<pre>` if empty.
- [ ] **Step 3:** styles.css — enriched cards, the body-drawer markdown styling, theme-aware.
- [ ] **Step 4: Controller live-verify** — cards show standards/uses; clicking Security Engineer opens a drawer with the real OWASP playbook body rendered as markdown; a traversal path is rejected. Screenshot.
- [ ] **Step 5: Commit** — `feat(dashboard): enriched Agents & Skills cards + full-body drawer`

---

### Task 8: Chat tab + redesigned floating widget (+ chevron fix)

**Files:** Modify `index.html` (Chat panel + widget markup), `app.js` (`renderChatLog(container)` shared by tab + widget), `styles.css`.

- [ ] **Step 1:** Extract the chat transcript rendering into a shared `renderChatLog(el)` used by BOTH the Chat tab and the floating widget (so they never drift). Add a **Chat tab** panel: full-height transcript + the Send/Orchestrate input + the Approve/Cancel approval row (reuse `renderApproval`/`doRun`/`doOrchestrate`/`approve` unchanged).
- [ ] **Step 2:** Redesign the **floating widget** to match the new palette/cards — larger, cleaner header (title · agent select · close), same transcript + input. Keep all run/orchestrate/approve JS logic identical.
- [ ] **Step 3:** Fix the 0.11 **chevron** minor: the phase-collapse chevron should point down when expanded, right when collapsed (swap the `.is-collapsed .chevron` rotation in styles.css).
- [ ] **Step 4: Controller live-verify** — the Chat tab shows the conversation full-width; the redesigned widget opens from Run and works (send via stub still streams); Approve/Cancel still function in an orchestration; the phase chevron now points the conventional way. Screenshot.
- [ ] **Step 5: Commit** — `feat(dashboard): full Chat tab + redesigned floating widget; fix phase chevron`

---

### Task 9: Docs + version

**Files:** `docs/DECISIONS.md` (D23, French), `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `README.md`, `package.json` (0.12.0), `docs/dashboard-nav-design.md` (status → implemented).

- [ ] **Step 1:** DECISIONS D23 (French) — the header redesign; Info + Backlog tabs; enriched Agents & Skills + body drawer via the scoped `/api/agentfile`; Chat tab + redesigned widget (shared `renderChatLog`); the returned dynamism — area curve fed by `runtime.history`, `charts.js` module, icons, animations (reduced-motion safe). Reference `docs/dashboard-nav-design.md`.
- [ ] **Step 2:** ROADMAP — a Done 0.12 entry; keep the "Before publish" note (naming + real-agent shakedown).
- [ ] **Step 3:** ARCHITECTURE — dashboard section: the new tabs, `charts.js`/`stats.js` client-side, `runtime.history`, the one read endpoint.
- [ ] **Step 4:** CLAUDE.md → v0.12.0 + the new tabs/curve/chat.
- [ ] **Step 5:** README → v0.12 + a line.
- [ ] **Step 6:** package.json → 0.12.0; design doc status → implemented.
- [ ] **Step 7:** `npm test` green → commit `spectoflow 0.12.0 — dashboard nav, chat & dynamism`.

---

## Self-Review

**Spec coverage:** header+icons → T3; Info → T5; Backlog → T6; Agents&Skills enrichment+drawer (+endpoint) → T1+T7; Chat tab + widget redesign → T8; area curve+dynamism+icons → T2 (charts) + T4 (curve/animations) + T3 (icons); snapshot history (O4) → T1; markdown renderer (O2) → T7; /api/agentfile (O3) → T1; chevron fix → T8; docs/version → T9. O1 (header subtitle+meter) → T3.

**Placeholder scan:** the testable anchors (store snapshot/fields, /api/agentfile, charts.js) carry verbatim tests + code; the visual tasks are generative (structure + acceptance + controller live-verify) — correct for a redesign, not placeholders.

**Type consistency:** `SpectoCharts.{donut,area,bars,ring,polar}` (T2) consumed by T4; `store.recordSnapshot`/extended agent-skill fields (T1) consumed by T4 (curve) + T7 (cards); `/api/agentfile` (T1) consumed by T7; `renderChatLog(el)` (T8) shared by tab + widget. Status keys = the six `--s-*` tokens throughout.
