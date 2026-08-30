# Architecture

## Three planes (the mental model)

- **Project Control** — the dashboard / collaboration surface (tasks, comments, decisions, chat, runs).
- **Project Memory** — the SDD artifacts: specs, plans, workflow, policy, ADRs.
- **Execution** — the local agent runtime (Claude Code / Codex / …), which reads memory and does work.

The framework's "intelligence" is **instructions an agent reads** (`.spectoflow/AGENTS.md` + workflow +
skills), not a runtime engine. That is what makes it agent-agnostic and low-token.

## Storage model (D8)

- **Artifacts = markdown, versioned, human source of truth:**
  - `specs/*.md` — specifications (Purpose / Requirements / Scenarios).
  - `plans/*.md` — plans; tasks are checkbox lines:
    `- [ ] T-012 Title @owner ~level %status` (`[x]`=done; `~`=quick|standard|major;
    `%`=in_progress|to_validate|to_analyze|blocked; comments = indented `- note:` sub-bullets).
- **Volatile execution state = JSON, gitignored, machine-only:** `.spectoflow/runtime.json`
  (running agents, heartbeats, test results, and — next — chat messages).
- **Granular writes:** the engine locates a task's line by id and rewrites only that line (or inserts a
  comment sub-bullet), leaving the rest byte-for-byte intact. This lets the dashboard and the agent
  co-edit safely. See `templates/lib/store.js`.

## Folder map

```
bin/spectoflow.js         CLI (init / dashboard / status)
lib/adapters.js           per-agent shim generation (CLI-only)
templates/                canonical framework → copied to <project>/.spectoflow/
  AGENTS.md               brain: router (intake→classify→gate→load→run), modes, rules
  workflow.md             single source of truth for the active pipeline
  capabilities.md policy.md config.json
  agents/  skills/         personas (stable) / procedures (evolving)
  lib/store.js            markdown parse + granular write + runtime + config/workflow readers
  dashboard/server.js     zero-dep HTTP + SSE(+fs.watch) + agent launcher (/api/run)
  dashboard/public/       UI (Board / Workflow / Agents&Skills / Run)
```

Installed into a user project, this becomes:
```
<project>/CLAUDE.md  AGENTS.md  .claude/commands/spectoflow.md   (generated shims → .spectoflow/AGENTS.md)
<project>/specs/  plans/                                         (markdown artifacts)
<project>/.spectoflow/{AGENTS.md,workflow.md,agents/,skills/,lib/,dashboard/,config.json,runtime.json}
```

## Dashboard data flow

`server.js` reads the project via `store.readProject(ROOT)` → `{config, plans, specs, workflow, agents,
skills, runtime}`. It watches `plans/ specs/ .spectoflow/` with `fs.watch` and pushes JSON events over
SSE (`/api/events`): `{type:'change'}` triggers a client refetch; run events stream agent output.
Granular mutations: `PATCH /api/task/:id`, `POST /api/task/:id/comment`, `POST /api/workflow/toggle`.

## Agent launcher (v0.4)

`POST /api/run {prompt, agent}` splits `config.runners[agent]` (e.g. `claude -p …`, `codex exec`),
spawns it in the project root (so project memory loads — never `--bare`), streams stdout/stderr as SSE
`run-line` events, and records the run in `runtime.json`. As the agent edits `plans/*.md`, the watch
fires and the board refreshes live.

## The router (in AGENTS.md)

Intake → Classify (Quick/Standard/Major on scope·risk·ambiguity·novelty, highest wins) → Gate (by mode;
semi always confirms Major) → Load (only the enabled workflow steps + needed skills) → Run (policy gates
can interrupt any time, any mode).
