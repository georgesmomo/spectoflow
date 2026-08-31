# CLAUDE.md — developing spectoflow

This repository is the **source of spectoflow**, an agent-agnostic spec-driven development (SDD)
framework with a real-time local control plane. This file orients you to **build spectoflow itself**
(it is not a spectoflow-managed project). Read `docs/` before making changes:
`docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (the full rationale, D1–D23), `docs/ROADMAP.md` (what's next).

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
