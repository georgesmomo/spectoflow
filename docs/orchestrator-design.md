# Orchestrator — design (v1)

> Status: **implemented** (O1–O3 resolved by review, 2026-08-30). Target: spectoflow **0.9**. Roadmap
> item "Orchestrator runtime". Decisions here graduate to `DECISIONS.md` (D20) once implemented.

## Purpose

Today a single agent reads `AGENTS.md` and drives the whole workflow itself. The orchestrator turns
that prose router into a **thin, deterministic sequencer**: given a request, it walks the enabled
workflow steps, resolves each step to an agent + skill, runs it, posts to the group-chat, and honours
the autonomy **mode** and the **policy** gates — while the per-step *thinking* stays in the agent+skill.

**Invariant it must not break** (ARCHITECTURE / D-series): *the framework's intelligence is
instructions an agent reads, not a runtime engine.* The orchestrator sequences and gates; it never
does the analysis/spec/code itself. It is deliberately dumb.

## Scope (v1)

**In:** run the **enabled** workflow steps **sequentially**, honouring `mode` (autopilot / semi /
manual) and `policy` gates; per-step agent+skill resolution from `workflow.md`; group-chat posting;
pause/approve protocol; persisted orchestration state with resume; failure stops the run.

**Out (later increments):** dynamic classification (auto Quick/Standard/Major + step subset),
concurrency / parallel steps, sub-agents, intra-step fine-grained resume, MCP channel. Each is its
own spec → plan.

## 1. Resolution model — `workflow.md` extended

Each step line may carry an annotation binding it to a capability and a skill:

```
- [x] Spec {cap:analysis skill:write-spec}
```

- `store.readWorkflow` is extended to parse an optional trailing `{cap:<capability> skill:<skill>}`.
  Backward compatible: a line without the annotation parses as today with `cap/skill = null`.
- The default `templates/workflow.md` gains annotations for every step. This also fills the current
  gap where **Spec** has no owning agent (it becomes `{cap:analysis skill:write-spec}`).
- Full resolution chain, computed by the orchestrator:
  - `step.cap → agent`: scan `agents/*.md` front-matter for `capability: <cap>` (first match).
  - `step.skill → skills/<skill>/SKILL.md` (the procedure text to hand the agent).
- A step whose `cap` resolves to **no agent**, or whose `skill` file is missing, is **unresolvable**:
  the run stops at that step with a clear error message in the chat. (No silent skips.)

Default step → {cap, skill} table shipped in `workflow.md`:

| Step | cap | skill |
|---|---|---|
| Brainstorm | intake | brainstorm |
| Analysis | analysis | analyze-requirements |
| Spec | analysis | write-spec |
| Plan | planning | write-plan |
| Develop | implementation | (none — codes directly; see note) |
| Unit tests | testing | write-tests |
| Integration tests | testing | write-tests |
| End-to-end tests | testing | write-tests |
| Review | quality | code-review |

Note: **Develop** has no single skill (the developer persona `uses: [write-tests, code-review]`).
For v1 the annotation may omit `skill` (`{cap:implementation}`); the orchestrator then hands the
agent the persona mandate + task context without a specific skill file. Open question O1.

## 2. Orchestration state (runtime, volatile)

Stored under `runtime.orchestration` (gitignored, D8):

```json
{
  "id": "o<base36>",
  "request": "add login",
  "mode": "semi",
  "status": "running",
  "currentStep": 3,
  "startedAt": "…",
  "steps": [
    { "name": "Spec", "cap": "analysis", "skill": "write-spec",
      "agent": "business-analyst", "status": "done", "runId": "r…" }
  ]
}
```

- Run `status`: `running | awaiting_approval | done | failed | cancelled`.
- Step `status`: `pending | running | awaiting_approval | done | failed | skipped`.
- Persisted after every transition → survives reload, drives the widget, enables **resume**.
- One active orchestration per project in v1 (starting a new one requires the previous to be
  terminal, or explicitly cancelled).

## 3. The loop + gates (the core)

For each enabled step, in order:

1. **Resolve** `step → agent → skill`. Unresolvable → step `failed`, run `failed`, post an error
   message, stop.
2. **Gate**:
   - **policy** (`policy.md`): if the step is policy-sensitive (deploy / destructive migration /
     security), require approval **regardless of mode**.
   - **mode** (`config.json`): `manual` → confirm **every** step; `semi` → confirm **nothing beyond
     policy** in v1 (see resolved O2); `autopilot` → no confirmation beyond policy.
   - If confirmation is required → step + run `status = awaiting_approval`, post a `kind:question`
     message describing the step and (for policy) the risk, then **wait** for a decision.
3. **Run**: launch the resolved agent via `runner.startRun` with a **focused prompt**:
   > "You are the <role> (<capability>). Run the <skill> for this request: <request>. Context:
   > current `specs/` and `plans/`. Work to the project standard and post your results using
   > `::spectoflow` messages."
   The agent runs, posts identified messages (sentinels), edits artifacts. `runId` recorded on the step.
4. **Collect**: agent exits `0` → step `done`, advance. Exit `≠ 0` → step `failed`, run `failed`, stop.

The orchestrator itself only posts **status/handoff** messages (e.g. "→ Spec (business-analyst)")
so the group-chat reads as a coordinated team; the substance comes from the agents.

## 4. Approval protocol (pause / resume)

- API `POST /api/orchestrate/approve { decision: "approve" | "cancel" | "modify", note? }`.
- When `orchestration.status == awaiting_approval`, the widget renders **Approve / Cancel / Modify**
  under the pending `question` message.
  - **approve** → clear the gate, run the step, continue.
  - **cancel** → run `status = cancelled`, stop.
  - **modify** → the `note` is appended (a message + injected into the step's prompt context), then
    re-confirm.
- Every decision is logged as a message (traceability — required by `policy.md`).
- Because state is persisted, an approval can arrive after a reload; the server resumes from
  `currentStep`.

## 5. Trigger & module

- **Widget**: a second action button **"Orchestrate"** next to **"Send"**. `Send` keeps the single
  ad-hoc agent run (0.4–0.8). `Orchestrate` starts the workflow loop → `POST /api/orchestrate
  { request }`. (Decision: separate button, so single-run stays available.)
- **Module**: new `templates/dashboard/orchestrator.js` exposing
  `runOrchestration({ root, request, mode, runStep, confirm }, emit)`:
  - `runStep(step, ctx)` defaults to `runner.startRun` (returns a promise resolving on the run's
    close with the exit code); **injectable** for tests.
  - `confirm(step, reason)` defaults to the real await-approval mechanism; **injectable** for tests.
  - `emit` publishes SSE events (`orchestration` state changes reuse `{type:'change'}` + the message
    stream).
  - `server.js` `/api/orchestrate` and `/api/orchestrate/approve` delegate here; the loop lives in
    the module, not the request handler (same split as `runner.js`).

## 6. Testability

Everything is unit-testable with `node --test`, no agents and no HTTP:

- Extended `store.readWorkflow` parses `{cap:… skill:…}` and stays backward compatible.
- Resolution: `step → agent` (front-matter scan), `step → skill` file; unresolvable → error.
- Loop, with injected `runStep`/`confirm` (scripted stubs):
  - `autopilot` runs every enabled step in order, no confirmation.
  - `manual` calls `confirm` before each step.
  - a **policy-sensitive** step calls `confirm` even under `autopilot`.
  - a step whose `runStep` returns a non-zero exit → run stops at `failed`, later steps `pending`.
  - resume: given a persisted state at step N, the loop continues from N.
- Front (Orchestrate button + Approve/Cancel) verified live in Chrome against a stub runner.

## 7. Server / SSE surface (delta)

- `POST /api/orchestrate { request }` → `{ orchestrationId }` (or `{ error }` if one is active).
- `POST /api/orchestrate/approve { decision, note? }` → `{ ok }`.
- `runtime.orchestration` is returned by `store.readProject` (already returns `runtime`), so the
  widget sees state + resumes on load. Live via existing `{type:'change'}` + `message` events.

## Resolved decisions (from review)

- **O1 — Develop step skill → RESOLVED: no skill in v1.** Ship `{cap:implementation}` with no skill;
  the developer persona mandate + task context is the prompt. Revisit only if it proves too thin.
- **O2 — `semi` gate in v1 → RESOLVED: policy-only.** Without dynamic classification, v1 `semi`
  confirms only **policy-gated** steps (so `semi` ≈ `autopilot` + policy). `manual` confirms every
  step; `autopilot` confirms nothing but policy. Per-step scope/risk confirmation waits for the
  classification increment. Section 3's "heavy step" heuristic is therefore **not** in v1.
- **O3 — Resume UX → RESOLVED: Cancel + start over in v1.** After a `failed` step the widget exposes
  Cancel and "start over"; Retry / Skip is a fast-follow increment.

## Not changing

Artifacts stay markdown; granular writes; workflow.md remains the single workflow source (now also
carrying the step→cap/skill binding); zero runtime dependencies; everything English; the agent, not
the orchestrator, performs each step.
