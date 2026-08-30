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
- **0.9** — orchestrator runtime: a thin deterministic sequencer that walks the **enabled** workflow
  steps in order, honouring `mode` and `policy` gates. `workflow.md` now carries a per-step `{cap:…
  skill:… [policy]}` annotation (backward-compatible; resolves step → agent via `agents/*.md`
  front-matter `capability`, step → skill file). The pipeline lives in `templates/dashboard/
  orchestrator.js` (`runOrchestration`) with **injectable** `runStep`/`confirm`, unit-testable without
  agents or HTTP — same split as `runner.js`. Server gains `POST /api/orchestrate` and `POST
  /api/orchestrate/approve`; the 💬 widget gains an **Orchestrate** button and **Approve/Cancel**
  affordances on a pending step. `semi` v1 == autopilot + policy (only policy-gated steps confirm);
  `manual` confirms every step; a step is policy-gated iff its annotation carries `policy` or
  `cap:security`. Resume restarts from the first not-`done` step; `modify` is deferred. See DECISIONS
  D20 and `docs/orchestrator-design.md`.
- **0.10** — agents & skills upgrade: the 10 agents and 8 skills, previously one-line stubs, are now
  best-in-class, sourced, domain-standard playbooks. Two gold-standard shapes (agent:
  Mandate/Operating standards/Definition of done/Handoff/Guardrails; skill: When to
  use/Method/Output contract/Quality bar/References) are pinned in `docs/agents-skills-standard.md`
  and applied to every component, with the source cited in-file (OWASP ASVS/Top 10 for security, TDD
  + xUnit for unit tests, Playwright for E2E, BDD + spec-kit/OpenSpec for analysis, Conventional
  Commits/YAGNI/DRY for implementation, C4 + ADR for architecture, INVEST for planning, a Google-style
  rubric for code review, structured product discovery for intake, Nielsen heuristics for design,
  DORA/CI-CD/IaC for operations). Front-matter gains `standards`/`priority` (agents) and
  `capability`/`inputs`/`outputs`/`standard` (skills); the sentinel syntax (`::spectoflow role=…
  kind=… msg=…`) is now owned solely by each skill's Output contract, agents only reference it. New
  `operations` capability (moved off `implementation`, fixing a `devops`/`developer` collision) and
  two new skills, `implement` and `write-e2e-tests`. E2E strategy: Playwright is the durable,
  agent-agnostic committed suite; native browser tooling (Playwright-headed fallback) is for
  live/exploratory verification only, never the committed suite. `test/roster-integrity.test.js`
  guards capability/skill/workflow consistency going forward. See DECISIONS D21 and
  `docs/agents-skills-upgrade-design.md`.
- **0.11** — control-room dashboard redesign: spectoflow's amber `--signal` identity kept, the
  reference's card system / warm neutrals / status-colour mapping adopted. The Board tab gains an
  **Overview** (4 KPI cards, a status donut, a workflow-at-a-glance strip reusing the workflow
  animation, per-phase progress bars), filter chips + search, and a right sidebar (**À demander** =
  `to_validate`/`to_analyze` tasks, **Journal** = the group-chat message log, live over SSE). Charts
  are hand-rolled inline SVG (zero-dep). All aggregates are computed client-side via the shared,
  unit-tested `templates/dashboard/public/stats.js`. No server/API change; orchestrator, chat widget,
  workflow engine, and SSE realtime are unchanged. Collapsible phase sections persist in
  `localStorage`; a unified card system now spans Board/Workflow/Agents & Skills. See DECISIONS D22
  and `docs/dashboard-redesign-design.md`.
- **0.12** — dashboard navigation, chat & dynamism: the header is denser — brand + subtitle + a slim
  global-progress meter, icon tabs (**Board · Requests · Backlog · Workflow · Agents & Skills · Chat ·
  Info**), agent/lang/mode chips, a pulsing sync dot, and a **Run** quick-action. The old sidebar's
  "À demander" block becomes the **Requests** tab, translated to English (UI is English-only); two new
  tabs — **Info** (project/config summary, client-side) and **Backlog** (a flat sortable/filterable
  table of every task across all plans). **Agents & Skills** cards now show `capability`/`standards`/
  `uses` and open a full-body **drawer** rendering the file's markdown via a tiny hand-rolled `mdLite`
  renderer, fed by the one new read-only endpoint `GET /api/agentfile?path=` (scoped to
  `.spectoflow/agents/**` + `.spectoflow/skills/**`, path-traversal-safe). A full **Chat tab** joins the
  redesigned floating widget, both sharing `renderChatLog()` so they never drift. Dynamism returns: the
  Overview's scope-vs-delivered **area curve** (dropped in 0.11) is back, fed by a real
  `runtime.history` daily snapshot (`store.recordSnapshot`, write-guarded, re-read-before-write to
  avoid clobbering concurrent `runtime.messages`); charts move into a tested `dashboard/public/
  charts.js` module (`donut`/`area`/`bars`/`ring`); icons and reduced-motion-safe animations (card
  rise-in, staggered arc/bar draw, count-up, gradient progress ring, pulsing sync) are back throughout.
  Also fixed: the inverted phase-collapse chevron, and a single-source-of-truth `activeTab` so tab
  selection survives SSE-triggered re-renders. See DECISIONS D23 and `docs/dashboard-nav-design.md`.

## Next

Nothing queued — the roadmap's planned work is done. See "Before publish" below for what's left
before a public release.

## Before publish

- **Naming decision.** Package `spectoflow` is free on npm, but the name risks collision with
  "SpecFlow", a known .NET BDD tool (Tricentis / successor Reqnroll) — same semantic zone, confusable,
  hard to SEO. Short alias also deferred (`stf` taken = DeviceFarmer; `spkt` free but cryptic). Decide
  before publish. See DECISIONS DIFF3.
- **Real-agent shakedown.** Everything so far (agent launcher, group-chat, orchestrator) has been
  tested against **stub** agents (claude/codex not installed in the build environment). Run a full
  pass against real `claude`/`codex` installs before calling the framework production-ready.
