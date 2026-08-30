# spectoflow (v0.7 — provisional name)

An **agent-agnostic** spec-driven development framework with a **real-time local control plane**.
You speak in plain language; the framework classifies your intent and runs the right workflow. No
ceremonial command to start.

## Install

```bash
npm install -g spectoflow        # (once published)
spectoflow init /path/to/project # or: node bin/spectoflow.js init .
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
node .spectoflow/dashboard/server.js   # → http://localhost:4319
```

Zero dependencies, updates live via SSE + file watching. Tabs: **Board** (plans/tasks, test results,
running agents), **Workflow** (the pipeline as a diagram — click a step to enable/disable it, which
edits `workflow.md`), **Agents & Skills**. A floating **💬 chat widget** (bottom-right) runs the
configured agent headless and streams its output as a conversation; the board refreshes live as it
edits plans.

## Agents vs skills

Agents (`.spectoflow/agents/`) are **stable team personas** (Product Manager, Developer, QA Engineer…).
Skills (`.spectoflow/skills/`) are **evolving procedures**. A workflow step → a capability → its agent →
runs a skill. Improve a skill without touching the agent.

## Language

`.spectoflow/config.json` → `language` (default `en`, incl. code comments). Switchable.

## Studied, not copied

Structure informed by spec-kit, OpenSpec (markdown + per-agent adapters), and BMAD (agent-personas).
spectoflow keeps the good ideas, removes the ceremony, and adds a real-time control plane. MIT.
