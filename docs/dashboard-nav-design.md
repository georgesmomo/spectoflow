# Dashboard navigation & chat — design (0.12)

> Status: **implemented** (O1–O5 resolved at their proposed defaults, 2026-08-30). Target: spectoflow **0.12**. A follow-up to the 0.11
> control-room redesign: a better header, new **Infos** and **Backlog** tabs, an enriched **Agents &
> Skills** tab (with a full-body drawer), and a full **Chat** tab beside a redesigned floating widget.
> Graduates to `DECISIONS.md` (D23).

## Purpose

0.11 delivered the control-room Board. This pass rounds out the **navigation** and the **chat**: give
the header more presence, add the two views the reference has that spectoflow lacked (project **Infos**
and a flat **Backlog**), make **Agents & Skills** actually show the upgraded playbooks (not just a
one-line description), and make the group-chat comfortably readable via a dedicated **Chat** tab while
keeping a nicer floating widget for quick access from any tab. Built on the same zero-dep, SSE,
granular-write foundation.

## Decisions (from brainstorming)

- **Chat: both.** A full-screen **Chat tab** (large transcript + Send/Orchestrate input) AND a
  **redesigned floating widget** — both render the same `runtime.messages` log and use `/api/run` +
  `/api/orchestrate` (unchanged).
- **Backlog: flat filterable/sortable table** — all tasks across all plans in one dense table.
- **Agents & Skills: enriched cards + full-body drawer** — cards show `capability` + `standards` +
  `uses` (skills: `inputs`/`outputs`/`standard`); clicking opens a drawer with the file's full
  markdown body. This needs one small read-only endpoint.
- **Also fold in** the 0.11 deferred chevron minor (phase-collapse chevron direction was inverted).
- **Bring back the reference's dynamism, curves and icons.** The user likes the old dashboard's motion
  and visuals: re-introduce the **smooth area curve** (dropped in 0.11), **icons** throughout, and the
  **animations** (cards rise-in, bars grow staggered, donut arcs draw, count-up numbers, gradient
  progress ring, pulsing sync dot) — porting the reference's exact SVG/CSS techniques.

## Visual richness & motion (ported from the reference code)

Studied from the reference's `app.js` chart helpers + `styles.css` animations. To adopt (all zero-dep,
theme-aware, respecting `prefers-reduced-motion`):
- **Area curve** — a Catmull-Rom-smoothed SVG path (`area(series, labels)`): scope-vs-delivered over
  time, gradient fill (`fill-opacity ~.13`), 4-line grid + axis labels, an **animated draw**
  (`pathLength="1"` + dash offset), dots + value labels, and hover hit-rects with a small tooltip. This
  is the "courbe" the user wants back.
- **Donut with gaps + staggered arc-draw** (upgrade the 0.11 donut): `seg-anim` per arc via `--i`, a
  centre value, tooltips.
- **Bars: staggered grow + count-up** — `grow .9s cubic-bezier` with `animation-delay: calc(var(--i)*.07s)`
  and a number that counts up from 0 (`data-count`).
- **Gradient progress ring** for the Global-progress KPI — `stroke: url(#grad)`, animated
  `stroke-dashoffset` (1s ease).
- **Card motion** — `@keyframes rise` (fade + translateY) on cards/sections on render; smooth
  `transition` on chevron/tabs/hover; **pulsing sync dot** (`@keyframes pulse`).
- **Icons** — inline SVG icons on every tab, KPI card, and section header (info/board/backlog/workflow/
  agents/chat, plus small status/section glyphs), matching the reference's line-icon style.
- A tiny **tooltip** layer (a single positioned div fed by `data-tip`) for chart hovers.

## Header

Rework the topbar into a denser, more deliberate control-room header:
- **Left:** brand mark + `spectoflow` + `/ <projectType>` + a small subtitle (mode · language) OR the
  global progress as a slim inline meter.
- **Centre/left:** the tab nav — **Board · Backlog · Workflow · Agents & Skills · Chat · Info** — with
  icons + active underline (the amber signal).
- **Right:** active-agent · lang · mode chips · a **sync** indicator · a **Run** quick-action (opens
  the chat widget) · theme toggle. Consistent chip system, better spacing/hierarchy.

## New tab — Info (project)

Read from `config` + aggregates (no new data): project type, **mode**, **language**, **active agent**,
`runners`, and counts (tasks total/done + %, specs, agents, skills, workflow steps enabled). Plus the
**specs** list and a compact **workflow** summary (enabled steps). A calm, readable "about this
project" panel. All client-side from `GET /api/project`.

## New tab — Backlog

A single dense **table** of every task across all `plans/*.md`:
- Columns: **id · title · phase · status · owner · level · 💬 comments**.
- **Sortable** by clicking a column header; **filterable** by status / owner / level chips + a text
  search (reuse the Board's filter logic where possible).
- A row click opens the existing **drawer** (`openDrawer(id)`); status chips use the `--s-*` tokens.
- Read-only view over the same data the Board uses (no writes beyond the drawer's existing ones).

## Enriched Agents & Skills + full-body drawer

- **Cards** show more: an agent card = title · `capability` · `standards` (chips) · `uses` (skill
  chips) · description; a skill card = name · `capability` · `standard` · `inputs`/`outputs` ·
  description.
- **Click → drawer** showing the file's **full markdown body** (Operating standards / Method / Quality
  bar / References …), rendered as lightweight markdown (headings/lists/code — a tiny inline renderer,
  zero-dep) or as a monospace pre if simpler.
- **Data:**
  - Extend `store` so the agents/skills objects returned by `readProject` include the new front-matter
    fields (`standards`, `uses` for agents; `inputs`, `outputs`, `standard` for skills). Small, testable.
  - **One new read-only endpoint** for the body: `GET /api/agentfile?path=<rel>` (or `/api/doc`),
    strictly scoped to `.spectoflow/agents/**` and `.spectoflow/skills/**`, path-traversal-safe,
    returns `{ content }`. This is the increment's only server change.

## Chat tab + redesigned floating widget

- **Chat tab:** a full-height panel rendering the `runtime.messages` group-chat (identified bubbles by
  role/agent, coloured by kind — reuse the widget's renderer) with the Send/Orchestrate input and the
  Approve/Cancel approval row when an orchestration awaits. Comfortable width, its own scroll.
- **Floating widget:** redesigned — larger, cleaner header (title · agent select · close), the same
  transcript + input, matched to the new palette/cards. It's the quick-access twin of the Chat tab
  (same messages, same endpoints). A shared `renderChatLog(container)` powers both so they never drift.

## Board Overview gains the area curve

The 0.11 Overview (KPI cards · donut · workflow strip · phase bars) gets the **scope-vs-delivered area
curve** back, shown beside the donut (as in the reference). It plots **total tasks (scope)** and **done
tasks (delivered)** over time from a lightweight history (below).

## Data flow & server surface (delta)

- **Snapshot history for the curve (small server addition):** `store` records a daily snapshot
  `{ date, total, done }` into `runtime.history` (deduped per date — update today's, append a new day;
  cap to the last ~60). Written when the runtime is next persisted / on task mutations (or computed on
  read from plans if history is empty, seeding a single point). The dashboard's `area()` reads
  `runtime.history`. This is the one genuinely new piece of data.
- **One new endpoint:** `GET /api/agentfile?path=` (read-only, scoped to `.spectoflow/agents/**` +
  `.spectoflow/skills/**`, path-traversal-safe) → `{ content }` — for the Agents & Skills body drawer.
- **`store`:** agent/skill objects gain the extra front-matter fields (parsing only; no write change).
- Everything else (Infos, Backlog, header, Chat tab, widget, icons, animations) is **client-side** over
  the existing `GET /api/project` + SSE. `/api/run`, `/api/orchestrate`, granular task/workflow APIs
  unchanged.

## Testability

- `store` front-matter extension → extend the existing store/roster tests (assert an agent object
  carries `standards`/`uses`, a skill carries `inputs`/`outputs`/`standard`). Native `node --test`.
- The new endpoint → a small server/handler test: returns a known file's content; **rejects** a
  path-traversal (`../`) or a path outside agents/skills. Native test.
- Shared chat/backlog aggregation stays in `stats.js`/pure helpers where it makes sense (testable).
- **Snapshot history** → a pure `recordSnapshot(runtime, {total,done}, date)` helper in `store`,
  unit-tested (dedupes today, appends a new day, caps length). The `area()`/`donut()` SVG builders can
  be pure string functions in a browser+Node module (like `stats.js`) → unit-test their path/arc math.
- All rendering (header, tabs, drawer, chat, curve, animations) verified **live in Chrome** by the
  controller.

## Constraints

- Zero runtime deps; inline SVG/markdown; theme-aware (dark + light via tokens).
- **Motion respects `prefers-reduced-motion`** (animations disabled when the user asks) — the
  dashboard already has this guard; every new animation honours it.
- Preserve the orchestrator, chat run/approve logic, granular writes, SSE, and all existing `/api/*`.
- The new endpoint is **read-only** and **path-scoped** to agents/skills — never serves arbitrary files.
- English UI; output language stays `config.language`.

## Out of scope

The reference's remaining tabs (Planning quotidien, Points de vigilance, Fichiers, Déploiement,
Settings). A full markdown renderer (a tiny subset suffices). Editing agents/skills from the UI.

## Resolved decisions (from review)

- **O1 → RESOLVED:** header left = brand + `/ projectType` + a subtitle (mode · language) AND a slim
  global-progress meter under the brand.
- **O2 → RESOLVED:** the agent/skill body drawer uses a **tiny inline markdown renderer**
  (headings / lists / inline-code / paragraphs); fall back to a `pre` only if a file breaks it.
- **O3 → RESOLVED:** `GET /api/agentfile?path=` → `{ content }`, scoped to `.spectoflow/agents/**` +
  `.spectoflow/skills/**`, path-traversal-safe.
- **O4 → RESOLVED:** the area curve is fed by a real `runtime.history` daily snapshot (scope = total,
  delivered = done), seeded with one point when empty so the panel is never blank.
- **O5 → RESOLVED:** a small hand-inlined SVG line-icon set (no icon font/library).
