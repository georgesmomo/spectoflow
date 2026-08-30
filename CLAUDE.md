# CLAUDE.md — developing spectoflow

This repository is the **source of spectoflow**, an agent-agnostic spec-driven development (SDD)
framework with a real-time local control plane. This file orients you to **build spectoflow itself**
(it is not a spectoflow-managed project). Read `docs/` before making changes:
`docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (the full rationale, D1–D15), `docs/ROADMAP.md` (what's next).

## What exists (v0.5.0)

- `bin/spectoflow.js` — CLI: `init` (scaffold a project), `update [--dry-run]` (refresh framework
  files to this kit version, preserving user edits), `dashboard`, `status`.
- `lib/adapters.js` — generates per-agent shims (CLAUDE.md, AGENTS.md, `.claude/commands/`).
- `lib/ownership.js` · `lib/manifest.js` · `lib/update.js` — the update subsystem: framework/user
  ownership split (derived from `templates/`), the sha256 install manifest, and the update matrix.
- `test/` — native `node --test` suite (`npm test`). No test framework, zero deps.
- `templates/` — the **canonical framework**, copied into a project's `.spectoflow/` by `init`:
  - `AGENTS.md` (the brain: intent router, modes, rules) · `workflow.md` (single source) ·
    `capabilities.md` · `policy.md` · `config.json` (mode, language, agent, runners) ·
    `agents/` (stable team personas) · `skills/` (evolving procedures) ·
    `lib/store.js` (markdown storage engine) · `dashboard/` (SSE server + UI).
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
