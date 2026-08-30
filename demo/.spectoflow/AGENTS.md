# spectoflow — project brain (read fully at session start)

> Agent-agnostic. Any agent reading this — Claude Code (`CLAUDE.md` points here), Codex/Cursor
> (`AGENTS.md`), etc. — knows how to behave. Keep it lean; details live in the files it points to.

## What spectoflow is

A spec-driven development (SDD) framework. The user speaks in **plain language**; **you classify the
intent and run the right workflow.** Simplicity stays on the user's side — no ceremonial command to start.

## Language

Read `.spectoflow/config.json` → `language` (default `en`). Produce **all output in that language**:
specs, plans, comments, and **code comments**. English is the default standard.

## Where things live

- **Artifacts (markdown, versioned, source of truth):** `specs/*.md` (specifications), `plans/*.md`
  (plans whose tasks are checkbox lines). These are what humans read and git tracks.
- **Task line convention** in `plans/*.md`:
  `- [ ] T-012 Add login form @owner ~level %status`
  `[x]` = done · `~level` = quick|standard|major · `%status` = in_progress|to_validate|to_analyze|blocked
  (absent → todo) · comments = indented `- note: …` sub-bullets.
- **Volatile execution state (JSON, gitignored, never for humans):** `.spectoflow/runtime.json`
  (running agents, heartbeats, test results). The dashboard reads it for live status.
- **Framework internals:** `.spectoflow/{workflow.md, policy.md, capabilities.md, agents/, skills/}`.

**Update artifacts granularly:** change one task line, or add one comment sub-bullet. Never rewrite a
whole file. This lets the dashboard and you co-edit without clobbering. Reflect work as you go
(status + comment) — nothing silently.

## The Router (run internally on every request)

1. **Intake** — known task ("develop T-012") → load it from `plans/*.md`. New request or tweak → classify.
   Explicit override ("just do it quick" / "full change") → forced level, **policy still applies**.
2. **Classify** — Quick / Standard / Major. Highest signal wins: **scope · risk/reversibility ·
   ambiguity · novelty**. Risk can force the level up even for tiny effort.
3. **Gate** — by `mode` (`.spectoflow/config.json`): **autopilot** proceeds · **semi** (default)
   confirms if ambiguous/borderline/risky **and always for a Major** · **manual** confirms each step.
4. **Load** — read the enabled steps from `.spectoflow/workflow.md` (single source of truth), plus the
   `.spectoflow/skills/` needed for those steps. Load only what this task needs.
5. **Run** — execute. A **policy gate** (`.spectoflow/policy.md`) can interrupt at any point, any mode.

## New / empty project → Intake

If `plans/` and `specs/` are empty: greet the user, state the mode, and **ask what they want to build**.
Then run **brainstorm → analysis → spec → plan** (write `specs/*.md`, then `plans/*.md` with tasks)
before any implementation.

## Workflow, capabilities, agents, skills

- The **active workflow** is `.spectoflow/workflow.md` — a checklist of enabled steps, editable (also
  from the dashboard). It is the single source; do not restate workflows elsewhere.
- **Capabilities** (`.spectoflow/capabilities.md`) are a palette; the project type selects the active ones.
- **Agents** (`.spectoflow/agents/`) are stable team personas (Developer, QA Engineer, …). **Skills**
  (`.spectoflow/skills/`) are the evolving procedures. A workflow step → a capability → its agent →
  runs a skill. Improve a skill without touching the agent.

## Policy

`.spectoflow/policy.md` lists acts requiring explicit approval **regardless of mode** (production,
destructive migration, security). Mode sets routine friction; policy is non-negotiable.

## Dashboard

`node .spectoflow/dashboard/server.js` → http://localhost:4319 (zero deps, live via SSE).
