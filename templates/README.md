# `.spectoflow/` — what this folder is

You're looking at the **spectoflow** framework for this project. spectoflow is an **agent-agnostic,
spec-driven development (SDD)** framework with a **real-time local control plane** (a dashboard). You
talk to your AI coding agent in plain language; spectoflow classifies the intent, runs the right
workflow, and tracks everything as **markdown artifacts** you can diff and own.

Everything the framework needs lives here in `.spectoflow/`, so your project root stays clean and the
framework is swappable/updatable. Your per-agent entry files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`)
sit at the project root and just point back here.

## How you use it

- **Just say what you want** to your agent ("add a login feature", "fix T-042"). The router in
  `AGENTS.md` classifies it (quick / standard / major), gates it by your **mode** and **policy**, and
  runs the matching workflow — no ceremonial command.
- **When your ask is vague, it clarifies first.** spectoflow behaves like an expert analyst, not an
  order-taker: on an ambiguous request ("login displays badly") it reflects it back and asks **one
  targeted question at a time** (each with a recommendation) until the need is crisp, then executes
  (skill `clarify`, wired into the agent's memory in `AGENTS.md`).
- **Watch it live** in the dashboard (it starts in the background and hands the prompt back):
  ```
  spectoflow dashboard          # → http://localhost:4319   (or: node .spectoflow/dashboard/server.js)
  spectoflow dashboard status   # is it running? (url + pid)
  spectoflow dashboard stop     # stop it        (alias: spectoflow stop)
  spectoflow dashboard restart  # stop then start
  spectoflow status             # progress + whether the dashboard is running
  ```
- **See what you got:** `spectoflow list` (agents, skills & workflow at a glance), or `spectoflow
  agents` / `spectoflow skills` / `spectoflow workflow`. Append `-h` to any command for its help.
- **Change how it runs** in the dashboard's **Settings** tab (autonomy mode, output language, and the
  dashboard **design**), or by editing `config.json`.
- **Update the framework** to a newer kit: `spectoflow update` (preserves your edits; a file you
  changed is kept and its new version is written next to it as `*.new`).

## Where your work lives

Your **artifacts are markdown, and they live at the project root, not in here**:

- `specs/` — the specifications (intent, decisions, acceptance criteria) — your source of truth.
- `plans/` — checkbox task plans (`- [ ] T-001 Title @owner ~level %status`). The dashboard parses
  these and writes back **one line at a time** (granular), so your agent and the dashboard never
  clobber each other.

## What each file/folder here is

| Path | What it is |
|------|------------|
| `AGENTS.md` | **The brain** — the intent router, the modes, and the standing rules your agent follows. |
| `workflow.md` | The **single** workflow definition (the pipeline steps and their capability/skill). |
| `capabilities.md` | The capability palette (intake, analysis, planning, implementation, testing, quality, security, governance…) and how it adapts to the project type. |
| `policy.md` | **Non-negotiable gates** — actions that need explicit human approval regardless of mode (prod deploy, destructive migration, security change, spend, source-of-truth drift at done/Major). |
| `config.json` | Your settings: `mode`, `language`, active `agent`, `runners`, `design`, plans/specs dir. **Yours to edit** — `update` never overwrites it. |
| `agents/` | **Stable team personas** (product-manager, developer, qa-engineer, code-reviewer, spec-source-guardian…) — the *who*. |
| `skills/` | **Evolving procedures** (clarify, brainstorm, write-spec, write-plan, implement, write-e2e-tests, code-review, audit-source…) — the *how*. A workflow step → a capability → its agent → runs a skill. |
| `dashboard/` | The zero-dependency control plane: `server.js` (SSE + file-watch), `runner.js`, `orchestrator.js`, and `public/` (the UI, charts, designs, fonts). |
| `lib/` | The markdown storage engine (`store.js`) and helpers (e.g. `spec-drift.js` for the spec-source-guardian). |
| `hooks/` | Optional Claude Code hooks you can wire in yourself (e.g. `spec-drift.js`, a `Stop` hook that surfaces source-of-truth drift to the Attention tab). |
| `runtime.json` | **Volatile execution state** (running agents, orchestration, group-chat messages, attention items, history). Gitignored — safe to delete; it's rebuilt. |
| `.dashboard.lock` | Ephemeral pidfile so `spectoflow stop` can find the running dashboard. Gitignored. |
| `.manifest.json` | Hashes of the framework files at install time, so `update` can tell an untouched file from one you edited. |

## Principles (why it's shaped this way)

- **Artifacts are markdown** in `specs/`/`plans/`; volatile state is `runtime.json`. Writes are granular.
- **The framework lives here**; per-agent entry files are thin shims that point back — never duplicate
  framework content per agent.
- **Agents are stable personas; skills are the evolving procedures.** Workflow → capability → agent → skill.
- **Mode ≠ policy.** Mode is routine friction; policy is approvals required regardless of mode.
- **Spec-anchored:** the spec is the intent of record; the code and tests are the enforced reality; the
  `spec-source-guardian` keeps them from drifting apart (it flags, it never silently auto-fixes).
- **Zero runtime dependencies** — native Node only. The dashboard works offline.

## More

Project & docs: https://github.com/georgesmomo/spectoflow · installed via `npm i -g spectoflow`.
