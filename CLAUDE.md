# CLAUDE.md — developing spectoflow

This repository is the **source of spectoflow**, an agent-agnostic spec-driven development (SDD)
framework with a real-time local control plane. This file orients you to **build spectoflow itself**
(it is not a spectoflow-managed project). Read `docs/` before making changes:
`docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (the full rationale, D1–D23), `docs/ROADMAP.md` (what's next).

## What exists (v0.18.0 — see DECISIONS D46)

**Customize** — a project's dashboard user can now extend spectoflow itself from **Settings →
Customize**: add a project-specific **dashboard**, **skill**, or **agent** by describing it (or hit
**Auto** to have the agent propose candidates from the project). Dashboards are never raw HTML — they
are a declarative **7-block JSON spec** (`templates/lib/custom-dashboard.js`, zero-dep, unit-tested)
rendered by the *same* components the built-in Board uses (`kpiCard`/`ocard`/`bars`/`donut`/
`statTile`/`mdLite`), so a generated dashboard matches whatever design is active — and stays matched if
the user switches designs later — **by construction**. Blocks bind live to `SpectoStats.stats(P)` via a
strict dotted-path allow-list (`bind: "phases.0.pct"`) or hold a static value. Generation needs zero new
server surface: it reuses the existing `/api/run` + group-chat pipeline. New capability
`customization` (not a workflow step, like `governance`/`clarify`), new agent `framework-curator`, four
new skills — `generate-dashboard`, `generate-skill`, `generate-agent` (both ground their output in a
real cited domain standard — OWASP/WCAG/C4-ADR/… — never a fabricated one), `propose-customizations`
(the Auto path). Generated skills/agents are marked `origin: user-generated` in front-matter.
Bonus fix found in QA: `index.html`'s local asset references were relative, breaking on any 2-segment
route on a direct page load (`/custom/<id>`, and the pre-existing `/backlog/T-012`) — now absolute.

## What exists (v0.17.4 — see DECISIONS D44)

Two Orbit logo fixes from real-browser QA. A stray `display:block` on the hub's logo clone outranked
the theme-toggle rule (`.brand-logo-img.is-dark/.is-light`) and forced both light/dark logo variants
visible at once — a ghosted double mark, most visible in dark mode. Removed; the theme toggle is back
in control. And the dial's center button, which used to cram logo + % + "Delivered" into 76px, now
shows **the logo alone**, bigger (34px) and well-centered — the ring around it already carries the
progress reading, so nothing is lost by dropping the repeated text.

## What exists (v0.17.5 — see DECISIONS D45)

**The dashboard UI now translates, not just the agent's output.** `config.json → language` used to
govern only what the agent writes (specs/plans/comments, per AGENTS.md) — the dashboard chrome itself
stayed English regardless. New `templates/dashboard/public/i18n.js`: a 179-key dictionary across all
6 languages (en/fr/es/de/pt/it, verified key-complete), `t(key, vars)` with `{placeholder}`
substitution and an en → raw-key fallback, `applyI18nStatic()` walking `data-i18n*` attributes. Fully
reactive through the existing `render()` pipeline — `i18nSetLang()`/`updateStatusLabels()` at the top,
`applyI18nStatic()` at the end — so a language change applies on the next SSE tick, no extra wiring.
`openDrawer`'s local task variable was renamed `t`→`task` (it would have shadowed the new global `t()`
translation function). Also: the sidebar **Journal is capped to 5 entries** by default with a "See
more/less" toggle; and **Chat moved to the 2nd nav position** (right after Board).

## What exists (v0.17.3 — see DECISIONS D43)

Three fixes to the shared bar (all designs, unless noted): the **project's real folder name** is now
shown (`server.js` adds `projectName`; the client no longer falls back to the generic `projectType`);
**mode and language are editable right from the bar** via two compact selects (`#topMode`/`#topLang`)
kept in sync with the Settings tab; and, **Orbit only**, the hub button that opens the radial menu is
now **the logo itself** (theme-aware, ringed with a live conic-gradient progress indicator) — the
original header logo is hidden, the "spectoflow" name becomes the dashboard link in its place, and the
dial's center also shows the logo above the % / "Delivered" caption.

## What exists (v0.17.2, cont'd — see DECISIONS D42)

Two more Console fixes from real-project visual QA: the header brand logo (26px base) reads too small
against this design's darker, denser topbar — bumped to 34px, scoped to `.topbar` only. And the footer
was losing its left edge ("ctoflow" instead of "spectoflow") because `.app-footer` is a sibling of
`.stage`, not a child — the icon rail is `position:fixed` to the viewport, so `.stage`'s `margin-left`
never reached it. `.app-footer` now gets the same rail-width margin (reset under 820px).

## What exists (v0.17.2)

**v0.17.2 (see DECISIONS D41):** `write-e2e-tests` now states an explicit hierarchy between Playwright
lib, Playwright MCP and native browser tooling. **Default: Playwright lib, `--headed`** — local runs
happen directly in a visible browser (`--ui` for interactive authoring/debugging); it steps down (to
headless, then MCP, then native tooling, then write-and-raise-a-need) only when the user asked
otherwise or headed can't launch, **always announcing why** via the `::spectoflow` sentinel. CI stays
headless — that's the pipeline's job, not a fallback. `qa-engineer.md` and both READMEs updated to
match; the skill's frontmatter `description` (shown in the dashboard's Workflow popover and the Agents
& Skills card) now summarizes this policy.

## What exists (v0.17.1)

**v0.17.1 (see DECISIONS D40):** real-browser QA pass of both templates (all views, light + dark, ⌘K,
radial menu). Fixes: the Console rail was clipped to the header because the topbar's `backdrop-filter`
is the containing block of a fixed descendant → `console.js` now **docks `#tabs` under `<body>`**
while the design is on (and restores it on leave); the chat FAB uses the solid brand accent so it
reads on the light sets; Orbit's pipeline connectors are tinted so the line stays visible in dark.

## What exists (v0.17.0)

**v0.17.0 — dashboard redesign, 2 new templates (see DECISIONS D39):** two prototypes were validated
by the user, then shipped as skins in the existing multi-design system, each in its own
`dashboard/public/designs/<id>.css` + `<id>.js` (active only when its design is on; live-switchable).
**`console` — Spectral Console (default, dark by default):** deep blue-slate console, amber brand accent
+ cyan "flow" for everything live, **left icon rail** (the existing tabs re-docked), **⌘K palette**,
bento overview, reveals/counters/pulses/pipeline particles. **`orbit` — Orbit:** light, airy, circular;
a **radial menu opens on click** of a teal hub button (shows % delivered) — items in orbit, segmented
ring (teal = progress, amber marker = current view), chevrons, Esc/`m`; content full width. Defaults:
`data-design="console"`, `data-theme="dark"`, `config.design: "console"`. Old 4 skins still selectable.
Zero-dep/offline kept (self-hosted fonts only); routing/SSE/API untouched.

## What exists (v0.16.4)

**v0.16.4 (see DECISIONS D37):** the brand welcome now shows **on `npm install -g spectoflow`** too,
via a **`postinstall` script** (`bin/postinstall.js`) — guarded to a global, interactive (TTY) install
and wrapped so it can never fail an install (npm may still buffer the output). The ASCII brand is
factored into **`lib/brand.js`** (shared by the CLI and the welcome) so all surfaces render the exact
same art.

## What exists (v0.16.3)

**v0.16.3 (see DECISIONS D36):** two logo surfaces. **`init` and `update`** show the **white hexagon**
brand mark (left edge thickened to 4 `#`, symmetric) with a **compact amber figlet wordmark**
(`spectoflow`, ~half size) **centred under the mark's true midpoint**. **`help` and the explore
commands** (`list`/`agents`/`skills`/`workflow`) show the **amber wordmark alone** (no hexagon). White
mark + amber name; `nameBlock()` centres the wordmark, `logo()`/`wordmark()` render the two surfaces.

## What exists (v0.16.2)

**v0.16.2 (see DECISIONS D34):** the ASCII logo is the **real brand mark** — the actual spectoflow
hexagon-with-flowing-"S" art, taken from the user's own logo and **downsampled 2× to 41×23** to fit a
terminal (faithful shape, not a redraw). Shown on `init`, `help` and `list`.

## What exists (v0.16.0)

**v0.16.0 — CLI UX pass (see DECISIONS D33):** an ASCII **logo banner** on `init`, `help` and `list`; **new explore commands** — `spectoflow list`
(agents + skills + workflow at a glance), `agents`, `skills`, `workflow` (read from the project's
`.spectoflow/`, or the bundled kit when run outside one, via a tiny zero-dep frontmatter reader);
**per-command help** — appending `-h`/`--help` to any command prints that command's help instead of
running it; **`spectoflow dashboard` now starts detached and hands the prompt back** (spawn
`detached+unref`), printing a commands panel, with new **`dashboard status`** and **`dashboard
restart`** subcommands beside the existing `stop`; and a **redesigned, grouped, coloured help**
(Project · Dashboard · Explore · Options). The **clarify** skill's tone is refined to be natural and
immersive (acknowledge → reflect → one question), explicitly **not** a fixed template, and to flow a
complex/new-build request into the normal path instead of over-questioning.

## What exists (v0.15.0)

**v0.15.0 — Clarify reflex + Playwright MCP (see DECISIONS D31/D32):** two additions.
**(1) Clarify** — spectoflow now behaves like an **expert analyst, not an order-taker**. A new
always-on **Clarify reflex** lives in the agent's memory (`templates/AGENTS.md` Router step 0 + a
"Stance" block, reinforced by one line in every root shim), backed by a new **`clarify` skill**
(capability `intake`, `product-manager`): on any ambiguous request it reflects it back and asks **one
targeted question at a time** (each with a recommendation, anchored in the project's goals + best
practices) until the need is crisp — then executes. It is **additive** (feeds the existing
Router/workflow, replaces nothing) and mode-aware.
**(2) Playwright MCP** — `init` **idempotently wires** a `playwright` entry into the target project's
`.mcp.json` (+`.cursor/mcp.json` when Cursor is selected) so the E2E agent (`qa-engineer`) can drive a
real browser and generate/run tests. Zero-dep-safe (`npx` fetches the server; it's the user's project,
not spectoflow). Backed by unit-tested `lib/mcp.js`; `write-e2e-tests` documents the full fallback
ladder (MCP → native browser tooling → local Playwright → write-spec-and-raise-a-need).

## What exists (v0.14.3)

**v0.14.3:** `init` now drops a detailed **`.spectoflow/README.md`** into every project — it explains
what spectoflow is, what each file/folder in `.spectoflow/` does, the day-to-day commands, and the
core principles, so anyone opening the folder is oriented. (Framework-owned, refreshed by `update`.)

## What exists (v0.14.2)

**v0.14.2:** the Board Overview's **Phase progress** is redesigned for big projects — it now shows
**only phases that hold tasks** (a `##` heading with no checkbox tasks isn't a phase, it's noise) and
**caps the list height** with an internal scroll, so dozens of phases can't stretch the page. With
phases collapsed by default (0.13.5), the dashboard stays compact even on a large plan.

## What exists (v0.14.1)

**v0.14.1:** `spectoflow dashboard stop` (alias `spectoflow stop`) stops the running dashboard — the
server writes a pidfile (`.spectoflow/.dashboard.lock`) on start and clears it on exit; `stop` reads
it, verifies the port responds, terminates the process, and removes the lock (safe against a stale
lock). Complements `spectoflow dashboard` / `status`.

## What exists (v0.14.0)

**v0.14.0 — Spec Source Guardian (see DECISIONS D29):** a new **`governance` capability** and agent
**`spec-source-guardian`** (skill `audit-source`) that keeps the spec (intent) and the code/tests
(reality) coherent — it flags drift in both directions (orphan work / dead spec), never auto-fixes,
posts findings to the **Attention** tab, and gates only at `done`/Major (`policy.md`). Backed by a
zero-dep, unit-tested drift helper (`.spectoflow/lib/spec-drift.js`) and an **opt-in** Claude Code
`Stop` hook (`.spectoflow/hooks/spec-drift.js`) you can wire into `.claude/settings.json`.

**v0.13.5:** the Board opens **compact on big projects** — phases are **collapsed by default** (just
headers + progress), with an **Expand all / Collapse all** button; and Kanban columns scroll
internally (capped height). Fixes the "dashboard is too long" problem when every phase was expanded.

## What exists (v0.13.4)

**v0.13.4:** the Board's task list gains a **List / Kanban** view toggle — *List* keeps the
phase-grouped collapsible sections; *Kanban* shows one column per status (To do / In progress / To
validate / To analyze / Done / Blocked) with the same task cards. The choice persists per viewer
(`localStorage`), and the status chips hide in Kanban (the columns already are the statuses).

**v0.13.3:** a **4th design — Mission Control** (indigo control panel); the Workflow step **popover**
now caps its height to the viewport and keeps the enable/disable button reachable (sticky footer, no
truncation); and the dashboard server sends **`Cache-Control: no-store`** so the browser never serves a
stale `app.js`/`styles.css` (fonts stay cached).

**v0.13.2 — design pass (see DECISIONS D25):** violet re-skin of the default; a **multi-design system**
(`data-design` skins registered in `dashboard/public/designs.js`, switchable in Settings, persisted per
viewer + as `config.design`) shipping **Control Room / Obsidian Ops / Neon Command / Mission Control**
(each light+dark);
**self-hosted `.woff2` fonts** (offline, zero-dep intact); a decluttered header with the framework
**version** shown; a **Settings** tab + pro **footer**; a redesigned **Workflow** (horizontal icon
pipeline with arrows + a click **popover** of step details); mobile **hamburger** nav + responsive
fixes; and CLI `--version`/`--help` + coloured `update`. **v0.13.1** hardened `GET /api/agentfile`
against symlink escape.

## What exists (v0.13.0)

**v0.13 — "real-use" pass (see DECISIONS D24):** configurable/auto-detected plans & specs dir
(`config.plansDir`/`specsDir`, resolvers in `store.js`); clearer post-init onboarding; `spectoflow
dashboard` as the single launch command with running-state probe + agent auto-start; the orchestrator
no longer echoes its "You are the …" priming prompt as a chat bubble (`startRun({logPrompt:false})`);
a **settings** popover (`POST /api/settings` → `config.json`, mode + language); an **Attention** tab
(agent raises points via the `::spectoflow attention msg=…` sentinel, or the user adds notes — CRUD via
`/api/attention*`, **validate → task** via `/promote`); Backlog defaults to **Open** + **pagination**;
flicker fix (debounced SSE reload + entry animations scoped to `body.booting`); the real **logo** in the
header (theme-swapped); a redesigned **Workflow** (numbered step cards + connectors); and client-side
**routing** (`/<tab>[/<taskId>]` via the History API + a server SPA fallback).

## What exists (v0.12.0)

- `bin/spectoflow.js` — CLI: `init` (scaffold a project; auto-detects installed agents), `update
  [--dry-run]` (refresh framework files to this kit version, preserving user edits), `dashboard`,
  `status`.
- `lib/adapters.js` — declarative REGISTRY of per-agent shims + default runners + detection specs
  (claude, codex, cursor, gemini); `lib/detect.js` probes PATH + agent dirs.
- `lib/ownership.js` · `lib/manifest.js` · `lib/update.js` — the update subsystem: framework/user
  ownership split (derived from `templates/`), the sha256 install manifest, and the update matrix.
- `test/` — native `node --test` suite (`npm test`). No test framework, zero deps.
- `templates/` — the **canonical framework**, copied into a project's `.spectoflow/` by `init`:
  - `AGENTS.md` (the brain: intent router, modes, rules) · `workflow.md` (single source) ·
    `capabilities.md` · `policy.md` · `config.json` (mode, language, agent, runners) ·
    `agents/` (stable team personas) · `skills/` (evolving procedures) ·
    `lib/store.js` (markdown storage engine + group-chat message log: `parseAgentLine`,
    `appendMessage`) · `dashboard/` (SSE server + `runner.js` run pipeline + `orchestrator.js` workflow
    sequencer (resolve → gate by mode/policy → run → collect, injectable for tests) + UI: Board /
    Workflow / Agents & Skills + a floating 💬 group-chat where running agents post identified messages
    and an **Orchestrate** button drives the whole enabled workflow).
  - `agents/` and `skills/` are now sourced, domain-standard playbooks (TDD, OWASP ASVS/Top 10, C4/ADR,
    INVEST, Playwright E2E, Conventional Commits, …), not one-line stubs — the gold-standard shape for
    both is pinned in `docs/agents-skills-standard.md`.
  - The dashboard's Board tab has a control-room **Overview** (KPI cards, a status donut, a
    workflow-at-a-glance strip, per-phase progress bars, and the **scope-vs-delivered area curve**
    fed by a `runtime.history` daily snapshot). All aggregation is client-side, in the pure,
    unit-tested `dashboard/public/stats.js`; charts (`donut`/`area`/`bars`/`ring`) live in the tested
    `dashboard/public/charts.js`. See `docs/dashboard-redesign-design.md`, `docs/dashboard-nav-design.md`
    and DECISIONS D22/D23.
  - Seven tabs: **Board · Requests · Backlog · Workflow · Agents & Skills · Chat · Info** — a denser
    icon-tab header (subtitle, progress meter, sync dot, **Run** quick-action). Requests is the
    to-validate/to-analyze list (English UI); Backlog is a flat sortable/filterable task table; Info is
    a project-summary panel; **Chat** is a full-height panel over `runtime.messages`, sharing
    `renderChatLog()` with the redesigned floating widget. Agents & Skills cards are enriched
    (`capability`/`standards`/`uses`, `inputs`/`outputs`) with a full-body markdown **drawer** (tiny
    hand-rolled `mdLite` renderer) fed by the one read-only endpoint `GET /api/agentfile?path=`
    (scoped to `.spectoflow/agents/**` + `.spectoflow/skills/**`, path-traversal-safe) — the only
    server/API addition in v0.12.
- `demo/` — a real inited project used to preview the dashboard (spectoflow tracking itself).

## Core invariants (do not break — see DECISIONS.md)

- **Artifacts are markdown** in `specs/` and `plans/` (checkbox tasks). Volatile execution state is
  `.spectoflow/runtime.json` (gitignored). Writes are **granular** (one line at a time).
- **Canonical framework lives in `.spectoflow/`**; per-agent entry files are **generated shims** that
  point back to it. Never require the user to duplicate framework content per agent.
- **Agents are stable personas; skills are the evolving procedures.** Workflow → capability → agent → skill.
- **Workflow has one source** (`.spectoflow/workflow.md`). Don't restate workflows elsewhere.
- **Mode ≠ policy.** Mode = routine friction; policy = approvals required regardless of mode.
- **Zero runtime dependencies** for the installed framework (native Node http/fs only).
- **Everything in English**, including code comments. Output language is configurable (`config.language`).
- **Semver** (MAJOR.MINOR.PATCH).

## Run & test

```bash
node bin/spectoflow.js init /tmp/try     # scaffold a project
node /tmp/try/.spectoflow/dashboard/server.js   # dashboard → http://localhost:4319
cd demo && node .spectoflow/dashboard/server.js # or preview with the demo
```
The storage engine is unit-testable directly (parse/serialize/granular write) — see how `store.js`
round-trips in `docs/ARCHITECTURE.md`. Add real tests as part of the next milestones.

## How to work here

Spec-driven, in plan mode: pick the next item from `docs/ROADMAP.md`, propose a plan, get approval,
implement, test, keep `docs/DECISIONS.md` updated when a decision is made or changed.
