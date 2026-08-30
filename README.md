<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/georgesmomo/spectoflow/main/logo-spectoflow-white.png">
    <img src="https://raw.githubusercontent.com/georgesmomo/spectoflow/main/logo-spectoflow.png" alt="spectoflow" width="112">
  </picture>
</p>

<h1 align="center">spectoflow</h1>

<p align="center"><em>Agent-agnostic spec-driven development with a real-time local control plane.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/spectoflow"><img src="https://img.shields.io/npm/v/spectoflow.svg?color=e6a54b" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-5fb2cc" alt="node >= 18">
  <img src="https://img.shields.io/badge/dependencies-0-4caf72" alt="zero dependencies">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

An **agent-agnostic** spec-driven development framework with a **real-time local control plane**.
You speak in plain language; the framework classifies your intent and runs the right workflow. No
ceremonial command to start.

## Install

```bash
# npm (recommended)
npm install -g spectoflow
spectoflow init /path/to/project

# or use it straight from a clone, no global install
git clone https://github.com/georgesmomo/spectoflow
node spectoflow/bin/spectoflow.js init /path/to/project
```

Every command works both ways — `spectoflow <cmd>` when installed globally, or `node
/path/to/spectoflow/bin/spectoflow.js <cmd>` from a clone.

### CLI

```
spectoflow init [dir] [--agent=claude,codex]   scaffold a project (auto-detects installed agents)
spectoflow update [--dry-run]                  refresh framework files to this kit version
spectoflow dashboard [--port=NNNN]             run the local control plane (default 4319)
spectoflow status                              progress + whether the dashboard is running
spectoflow --version   (-v)                    print the version
spectoflow --help      (-h)                    show help
```

`init` scaffolds:
- `.spectoflow/` — the framework (brain, `workflow.md`, `agents/`, `skills/`, `policy.md`, `config.json`, dashboard, engine).
- `specs/` and `plans/` — **markdown artifacts**, your versioned source of truth.
- per-agent shims: `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex/Cursor), `GEMINI.md` (Gemini),
  `.claude/commands/spectoflow.md`.
- `.spectoflow/runtime.json` is gitignored (volatile execution state).

`init` **auto-detects your installed agent(s)** (probes PATH for `claude`, `codex`, `cursor-agent`,
`gemini`, and existing `.claude`/`.codex`/… dirs): it writes shims for each, sets the active agent in
`config.json`, and seeds the runner commands. Override with `--agent=claude,codex`; if nothing is
detected it falls back to claude + codex.

**Empty project** → your agent asks what to build and runs Intake (brainstorm → analysis → spec → plan).
**Existing project** → an existing `CLAUDE.md` is preserved as `CLAUDE.md.tomerge` (merged on first run);
existing `plans/*.md` tasks are given stable ids.

## Update

`init` is idempotent (it never overwrites), so it can't refresh an installed project. `spectoflow
update` refreshes **framework-owned** files (engine, dashboard, `AGENTS.md`, `capabilities.md`,
`policy.md`, default agents & skills) to the CLI's version, while **preserving your work** —
`config.json`, `workflow.md`, `specs/`, `plans/`, and any agent/skill you created or edited are never
touched. A file you edited is preserved and its new version is written next to it as `<file>.new`
for you to merge by hand. Add `--dry-run` to preview.

First refresh the kit, then run update from your project — the flow is the same whichever way you
installed:

```bash
# npm global
npm update -g spectoflow  &&  spectoflow update

# manual (cloned repo)
git -C /path/to/spectoflow pull  &&  node /path/to/spectoflow/bin/spectoflow.js update

# npx (no install)
npx spectoflow@latest update
```

`update` resolves the framework version from the CLI you run and the project from the current
directory, so it behaves identically across all three. `init` records a hashed baseline in
`.spectoflow/.manifest.json` (committed) that lets update tell an untouched framework file from one
you've edited; installs made before this file existed degrade safely (a matching file is adopted, a
divergent one gets a `.new`).

## Storage is markdown

Plans are plain markdown with checkbox tasks — human-readable, git-diffable, standard:

```
## Phase 1 — Login
- [ ] T-001 Add login form @dev ~standard %in_progress
  - note: waiting on design tokens
- [x] T-002 Set up auth routes @dev
```

`[x]` done · `~level` quick|standard|major · `%status` in_progress|to_validate|to_analyze|blocked ·
`@owner`. The dashboard parses these and writes back **one line at a time** (granular), so it and your
agent never clobber each other.

## Dashboard (real-time)

```bash
spectoflow dashboard                     # → http://localhost:4319 (or --port=NNNN)
# manual (no global install): node .spectoflow/dashboard/server.js
```

`spectoflow dashboard` is the simple way — it prints the URL and won't double-start (it detects a
dashboard already running on the port). `spectoflow status` tells you whether one is up. Running the
`server.js` directly still works for a manual/embedded setup. Zero dependencies, updates live via SSE +
file watching. Eight tabs behind a dense icon-tab header (brand logo · subtitle · a slim
global-progress meter · a sync dot · a **Run** quick-action · a **settings** gear): **Board** (the
control-room Overview — KPI cards, a status donut, a **scope-vs-delivered area curve**, a
workflow-at-a-glance strip, per-phase progress bars, filter chips + search — plus the phase board),
**Requests** (tasks awaiting you — `to_validate`/`to_analyze`), **Attention** (points the agent raised
via a `::spectoflow attention msg=…` sentinel or that you noted — edit/resolve/delete, or **validate →
task**), **Backlog** (a flat sortable/filterable, paginated table of every task, defaulting to open
work), **Workflow** (the pipeline as step cards — click one to enable/disable it, which edits
`workflow.md`), **Agents & Skills** (enriched cards that open a full-body markdown drawer), **Chat** (a
full-height group-chat panel), and **Info** (a project-at-a-glance summary). URLs are real routes
(`/board`, `/backlog/T-012`, …). Charts are zero-dep, hand-rolled SVG in `dashboard/public/charts.js`
(donut/area/bars/ring, animated, `prefers-reduced-motion`-aware), and every aggregate is computed
client-side.

A floating **💬 chat widget** (bottom-right, redesigned) and the **Chat** tab render the same
`runtime.messages` log via a shared `renderChatLog()`, so they never drift. A running agent identifies
itself by printing `::spectoflow role=… kind=… msg=…` sentinels, which become labelled messages
(analyst / developer / qa …); other output streams raw. The board refreshes live as it edits plans.
Either surface can also **Orchestrate** the enabled workflow: each step runs its agent, gated by mode
+ policy. The Agents & Skills drawer is served by the one read-only endpoint, `GET
/api/agentfile?path=` (scoped to `.spectoflow/agents/**` + `.spectoflow/skills/**`,
path-traversal-safe) — the framework's only other server surface is unchanged.

## Agents vs skills

Agents (`.spectoflow/agents/`) are **stable team personas** (Product Manager, Developer, QA Engineer…).
Skills (`.spectoflow/skills/`) are **evolving procedures**. A workflow step → a capability → its agent →
runs a skill. Improve a skill without touching the agent.

Agents and skills follow real domain standards, cited in-file — TDD, OWASP ASVS/Top 10, C4/ADR,
INVEST, Playwright E2E, Conventional Commits, and more — not generic one-liners.

## Language

`.spectoflow/config.json` → `language` (default `en`, incl. code comments). Switchable from the CLI
(`config.json`) or the dashboard's **settings** gear (mode + language).

## Studied, not copied

Structure informed by spec-kit, OpenSpec (markdown + per-agent adapters), and BMAD (agent-personas).
spectoflow keeps the good ideas, removes the ceremony, and adds a real-time control plane.

## License & author

MIT © 2026 [Georges MOMO](https://github.com/georgesmomo).
