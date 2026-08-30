# Dashboard redesign — design

> Status: **approved** (O1–O3 resolved by review, 2026-08-30). Target: spectoflow **0.11**. The last
> roadmap item ("Design pass"). Brings the dashboard to a polished control-room standard, inspired by a
> reference dashboard the user supplied, adapted to spectoflow's data model. Graduates to
> `DECISIONS.md` (D22).

## Purpose

The dashboard works but looks utilitarian next to the reference (a rich dark control-room: KPI cards,
a status donut, per-phase progress bars, filter chips, a right sidebar with "À demander" + "Journal").
This pass raises spectoflow's dashboard to that standard **without touching the orchestrator, chat
widget, workflow engine, or SSE realtime** — it is visual + a new **Overview** section, computed from
data we already have.

## Decisions (from brainstorming)

- **Keep spectoflow's identity, adopt the reference's structure.** Retain the **amber `--signal`**
  (`#e6a54b`) as the "live/active" accent (spectoflow's identity — the amber dot = what's running) and
  the cyan secondary; adopt the reference's **card system, warm-neutral surfaces, 14px radius, soft
  shadows, and status-colour mapping**. Not a wholesale palette swap.
- **Zero runtime dependencies** — charts are hand-rolled inline **SVG** (donut, bars, sparkline); no
  chart library.
- **Preserve** the orchestrator, chat widget, Approve/Cancel, Workflow diagram, Agents & Skills,
  granular writes, and SSE realtime. Machine-facing APIs unchanged.
- **The reference's time-series area chart is dropped** (spectoflow keeps no dated snapshots) and
  **replaced** by a spectoflow-native **"workflow at a glance" strip**.

## Palette (merge)

Extend the existing `styles.css` tokens (dark + light already exist). Adopt the reference's warmer
neutrals and status hues; keep amber as the signal.

```
--bg #10151b   --surface #171e26   --surface-2 #1e2732   --line #2a3641
--ink #e9edf2  --muted #94a2af     --faint #63727e
--signal #e6a54b (KEEP — live/active)   --cool #5fb2cc (secondary)
--radius 14px   --shadow 0 10px 30px rgba(0,0,0,.38)
status: --s-todo #7d8f97 · --s-in_progress #e6a54b · --s-to_validate #5fb2cc
        --s-to_analyze #ab8cd9 · --s-done #5fb67e · --s-blocked #db7268
```
Light theme keeps parity (the toggle already exists). Every colour is a token defined on bare `:root`
and re-declared under the theme blocks (theme-aware).

## Layout

**Topbar** (kept, refined): brand + project · tabs (Board / Workflow / Agents & Skills) · right:
active-agent / lang / mode chips · sync dot · theme toggle.

**Board tab** gains a two-column shell: a **main column** and a **right sidebar**.

- **Main column, top = Overview:**
  1. **KPI card row** (4 cards): *Global progress* (a donut-ring % of done/total), *In progress*,
     *To validate* (`to_validate`), *Running / last orchestration* (agents running + last run status).
     Each card: label, big number, a coloured accent, a sparkline or ring where it helps.
  2. **Status donut** — distribution across the 6 statuses (uses the existing status colours), big
     count/% in the centre, a legend.
  3. **Workflow-at-a-glance strip** — the enabled workflow steps as a compact animated strip (reuse
     the Workflow diagram's flow animation), replacing the reference's time-series chart.
  4. **Per-phase progress bars** — one labelled bar per plan phase (done/total, %).
- **Filter row:** status chips (Tous / To do / In progress / To validate / To analyze / Done /
  Blocked) + owner/level chips + a text search. Filters the task board below.
- **Task board:** collapsible phase sections (title · mini progress · count) with enriched task cards
  (id badge, title, level/status chips, owner, tags, comment count) → the existing drawer on click.
- **Right sidebar:**
  - **À demander** — tasks in `to_validate` / `to_analyze` (what awaits the human, per D4), each a
    compact row linking to its drawer.
  - **Journal** — the group-chat message log (`runtime.messages`) as a reverse-chronological activity
    feed (role · agent · kind · text), live over SSE.

**Workflow / Agents & Skills tabs:** restyled to the new card system; no structural change.

**Chat widget + orchestrator:** unchanged behaviour; restyled to match.

## Data flow (no server change for charts)

Everything the Overview needs is already in `GET /api/project` (`store.readProject`): plans/tasks
(statuses, phases, owners), `runtime.messages` (Journal), `runtime.agents`/`orchestration` (running /
last run), `workflow` (the strip). All aggregates are computed **client-side**. SSE `change`/`message`
already drive live updates. **No new endpoints.** The one code addition is a pure, testable
`stats(project)` helper (see Testability).

## Components (all hand-rolled, zero-dep)

- `donut(segments, size)` → inline SVG (stroke-dasharray arcs) + centre label.
- `ring(pct)` → a single-value progress ring for a KPI card.
- `bars(rows)` → horizontal progress bars (phase progress).
- `sparkline(points)` → a tiny inline-SVG line (optional, for a KPI trend if a cheap series exists).
- `kpiCard`, `chip`, `phaseSection`, `taskCard`, `sidebarItem`, `journalEntry` — CSS components.

## Testability

The dashboard has no unit tests (consistent with the codebase). To give the new aggregation logic
coverage, extract the pure math into a small module **`templates/dashboard/public/stats.js`** (browser
+ Node friendly, `module.exports` guarded) exposing `stats(project) → { total, done, pct, byStatus,
phases:[{title,done,total,pct}], toAsk:[…], running }`. Unit-test it with `node --test`
(`test/dashboard-stats.test.js`) against a synthetic project. The rendering (SVG/DOM) is verified
**live in Chrome** (screenshots), as with the widget/orchestrator work.

## Constraints

- Zero runtime deps; inline SVG only; theme-aware (dark + light, both defined via tokens).
- Responsive: the two-column Board collapses to one column on narrow widths; charts scale.
- No change to `/api/*` contracts or `store`/`runner`/`orchestrator` behaviour.
- Everything English (output language stays `config.language`).

## Out of scope (this pass)

The reference's extra tabs that don't fit spectoflow's model — Planning quotidien, Points de
vigilance, Fichiers, Déploiement, Settings — are **not** added. A Files/Settings tab could come later.
No new data model; no time-series snapshots.

## Resolved decisions (from review)

- **O1 → RESOLVED:** the 4th KPI card is *Running / last orchestration* (agents running + last run
  status). A Tests card is deferred.
- **O2 → RESOLVED:** the area-chart slot is the **workflow-at-a-glance strip** (reuses the existing
  flow animation), not a Tests panel.
- **O3 → RESOLVED:** aggregation math lives in a shared browser+Node module
  `templates/dashboard/public/stats.js` (guarded `module.exports`), imported by `app.js` in the
  browser and by `test/dashboard-stats.test.js` under `node --test`.
