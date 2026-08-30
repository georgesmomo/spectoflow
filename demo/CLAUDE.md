# CLAUDE.md — spectoflow

This project uses **spectoflow**. **Read `.spectoflow/AGENTS.md` and follow it** as your operating
instructions (intent router, workflow, standing rules).

> If `CLAUDE.md.tomerge` exists next to this file, it is your previous CLAUDE.md, preserved on
> install. Merge its project-specific content into this file, then delete `CLAUDE.md.tomerge`,
> before anything else.

- Command: `/spectoflow` (`init` / `status` / or just a request).
- Dashboard: `node .spectoflow/dashboard/server.js` → http://localhost:4319
- Artifacts are markdown in `specs/` and `plans/`; volatile state in `.spectoflow/runtime.json`.
