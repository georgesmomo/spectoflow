# Roadmap

## Done

- **0.1–0.2** — bootstrapping: brain at project root, install flow (empty vs existing project,
  `CLAUDE.md.tomerge` merge), `/spectoflow` command, English throughout.
- **0.3** — markdown storage engine (parse + granular writes) + runtime sidecar; real-time dashboard
  (SSE + fs.watch) with Board / Workflow (editable diagram) / Agents & Skills; per-agent adapters
  (claude, codex); team-title agents + skills split; i18n config.
- **0.4** — agent launcher: `POST /api/run` spawns the configured agent headless with project memory,
  streams output over SSE, records the run; board updates live as the agent edits plans.

## Next (from user feedback, in priority order)

### 1. `spectoflow update` / `sync` — REQUIRED before npm publish
`init` is idempotent (never overwrites), so it can't refresh an installed project. Need a command that
refreshes **framework-owned** files while preserving **user-owned** ones.
- Framework-owned (refresh): `.spectoflow/lib/`, `.spectoflow/dashboard/`, `.spectoflow/AGENTS.md`,
  default `agents/` + `skills/` (only those the user hasn't modified), `capabilities.md`.
- User-owned (preserve): `config.json`, `specs/`, `plans/`, `workflow.md`, `runtime.json`, and any
  custom or edited `agents/`/`skills/` (detect via a content hash recorded at install).
- Design the owned/preserved split explicitly; add a `--dry-run`.

### 2. Agent auto-detection + multi-agent support
- At `init`, **detect the installed agent(s)** (probe PATH for `claude`, `codex`, `gemini`,
  `cursor-agent`, `opencode`, `kilocode`, …; and/or existing `.claude`/`.codex` dirs). Default the
  active agent to what's detected; still let the user switch (config + dashboard).
- Generalize `lib/adapters.js` to more agents (OpenSpec supports 6 via adapters — same pattern).
  Each adapter writes that agent's native entry file(s) pointing to `.spectoflow/AGENTS.md`.
- The Run tab / chat should show the detected agent by default — the user shouldn't have to pick it.

### 3. Floating chat widget (replaces the empty Run panel)
- A small chat launcher icon fixed at **bottom-right**; click to open a compact chat window (standard
  pattern). This is the entry point to the group-chat (item 4). Remove the big empty Run panel.

### 4. Agent group-chat (per-agent identity)
Model the runtime with a **message log** that both the user and running agents post to:
```
runtime.messages: [ { id, at, role, agent, runId, text, kind } ]
```
- `role` = the workflow role speaking (analyst / architect / developer / qa / …); `kind` =
  message | status | question | handoff.
- The dashboard renders it as a **group chat**, live over SSE. Example flow for "add login":
  analyst posts its findings → developer posts "finished T-023, status updated" → qa posts "taking
  over, running tests" — each identified, while the board updates in parallel.
- **How agents post:** two options, pick one (recommend the MCP tool for cleanliness):
  (a) a tiny **MCP server** exposing `post_message`, `update_task`, `report_test`, `heartbeat`, that the
      headless agent calls as it works; or
  (b) the runner **parses structured stdout** (e.g. lines like `::spectoflow role=developer msg=…`).

### 5. Orchestrator runtime (the big one)
A supervisor that, given a request, **walks the enabled workflow steps and wakes the right agent per
step**, posting each to the group-chat and updating plans/tasks.
- Loop: classify → for each enabled step, resolve capability → agent → run it (headless run or
  sub-agent) → collect output → post to chat → advance. Respect mode (autopilot/semi/manual) and
  policy gates. Handle concurrency, failures, and resume.
- Prior art to study: BMAD autonomous mode, amux (headless fleet + dashboard + kanban). This is where
  spectoflow becomes an orchestrator, not just a control plane — build it incrementally, gated by tests.

### 6. Design pass
Redesign the dashboard once a visual reference is chosen (control-room direction so far; avoid
AI-default looks). Tighten the Run/chat, add the animated workflow diagram polish.

## Open naming decision
Package `spectoflow` is free on npm. Short alias deferred (`stf` taken = DeviceFarmer; `spkt` free but
cryptic). Decide at publish time.
