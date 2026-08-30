# Roadmap

## Done

- **0.1–0.2** — bootstrapping: brain at project root, install flow (empty vs existing project,
  `CLAUDE.md.tomerge` merge), `/spectoflow` command, English throughout.
- **0.3** — markdown storage engine (parse + granular writes) + runtime sidecar; real-time dashboard
  (SSE + fs.watch) with Board / Workflow (editable diagram) / Agents & Skills; per-agent adapters
  (claude, codex); team-title agents + skills split; i18n config.
- **0.4** — agent launcher: `POST /api/run` spawns the configured agent headless with project memory,
  streams output over SSE, records the run; board updates live as the agent edits plans.
- **0.5** — `spectoflow update` (+ `--dry-run`): refreshes framework-owned files to the current kit
  while preserving user-owned ones. `init` writes `.spectoflow/.manifest.json` (sha256 baseline);
  update refreshes untouched files, drops a `<file>.new` next to edited ones, never touches
  `config.json`/`workflow.md`. Ownership derived from `templates/`, not hard-coded. Native `node --test`
  suite added. See DECISIONS D16.
- **0.6** — agent auto-detection + multi-agent: `lib/adapters.js` is now a declarative REGISTRY
  (claude, codex, cursor, gemini) of native entry-file shims + default runners + detection specs;
  `lib/detect.js` probes PATH (PATHEXT-aware) and existing agent dirs. `init` writes shims for every
  detected agent, sets `config.agent` to the top-priority one, and seeds `config.runners`; `--agent=`
  still overrides; nothing detected → claude + codex fallback. The dashboard already defaults to
  `config.agent`. See DECISIONS D17.
- **0.7** — floating chat widget: the empty Run tab/panel is gone. A bottom-right 💬 launcher opens a
  compact chat that runs the configured agent (`/api/run`, unchanged) and renders the stream as a
  chat — user bubble + a monospace agent block + ▶/■ meta lines. Open/closed state persists in
  `localStorage`. Front-only (`index.html`/`styles.css`/`app.js`); it's the entry point to the
  group-chat. See DECISIONS D18.
- **0.8** — agent group-chat (per-agent identity): `runtime.messages: [{id,at,role,agent,runId,text,
  kind}]` (volatile). A running agent identifies itself by printing sentinels
  (`::spectoflow role=developer kind=status msg=…`); the run pipeline — extracted to
  `dashboard/runner.js` — logs the user prompt, turns sentinels into structured messages, and streams
  other output raw. The widget renders the log as a group chat: identified bubbles coloured by kind
  (message/status/question/handoff), persisted across reloads; raw output stays an ephemeral block.
  Mechanism chosen = **structured stdout**; MCP stays the planned upgrade (same log). See DECISIONS D19.

## Next (from user feedback, in priority order)

### 1. Orchestrator runtime (the big one)
A supervisor that, given a request, **walks the enabled workflow steps and wakes the right agent per
step**, posting each to the group-chat and updating plans/tasks.
- Loop: classify → for each enabled step, resolve capability → agent → run it (headless run or
  sub-agent) → collect output → post to chat → advance. Respect mode (autopilot/semi/manual) and
  policy gates. Handle concurrency, failures, and resume.
- Prior art to study: BMAD autonomous mode, amux (headless fleet + dashboard + kanban). This is where
  spectoflow becomes an orchestrator, not just a control plane — build it incrementally, gated by tests.

### 2. Design pass
Redesign the dashboard once a visual reference is chosen (control-room direction so far; avoid
AI-default looks). Tighten the Run/chat, add the animated workflow diagram polish.

## Open naming decision
Package `spectoflow` is free on npm. Short alias deferred (`stf` taken = DeviceFarmer; `spkt` free but
cryptic). Decide at publish time.
