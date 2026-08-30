---
description: spectoflow — spec-driven control (init / status / or just a request)
---

Read `.spectoflow/AGENTS.md` and `.spectoflow/config.json` first.

Argument: `$ARGUMENTS`

- `init`: verify setup. If `CLAUDE.md.tomerge` exists, merge it into `CLAUDE.md` and delete it. If
  `specs/` and `plans/` are empty, greet me, state the mode, and start Intake (brainstorm → analysis
  → spec → plan) by asking what I want to build.
- `status`: summarize progress from `plans/*.md` and `.spectoflow/runtime.json`.
- otherwise: treat `$ARGUMENTS` as a request and run the Router in `.spectoflow/AGENTS.md`.
