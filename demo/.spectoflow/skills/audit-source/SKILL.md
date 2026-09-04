---
name: audit-source
description: Audit spec ↔ code ↔ tests alignment; surface drift as advisory findings, never auto-fix.
capability: governance
inputs: The specs/, plans/, code and tests; optionally the recent change set (git diff).
outputs: A drift report + Attention items; a verdict (aligned / drift).
standard: spec-anchored traceability
---
# Audit source-of-truth

Scoped audit that keeps the **spec (intent)** and the **code/tests (reality)** coherent by flagging
drift in both directions. Advisory — it reports, it never edits or auto-syncs.

## When to use
- Before a Major or a `done` (the governance gate in `policy.md`).
- After a batch of changes, to catch drift early (a `Stop` hook can trigger it — see `hooks/`).
- On demand: "is the spec still the source of truth for what's built?"

## Method
1. **Build the trace.** For each spec section/decision, find the plan task(s), the code, and the
   test(s) that carry it; for each plan task and code change, find the spec section it serves.
2. **Flag both directions.**
   - *Orphan work* — code or a task with no spec/decision backing → the decision is undocumented.
   - *Dead spec* — a requirement with no implementation or no test → intent that will rot.
3. **Check the enforcer.** Confirm the new/changed behaviour has **acceptance criteria** (EARS /
   Given-When-Then) and that a **test actually encodes them** — tests are what bind intent to reality.
4. **Run the deterministic helper** (optional, zero-dep): `node .spectoflow/lib/spec-drift.js` — it
   inspects the git working tree + specs/plans and prints coupling/coverage signals (e.g. "code
   changed but no specs/ or plans/ updated"). Treat its output as signals to judge, not verdicts.
5. **Judge, don't auto-apply.** Where intent is ambiguous, raise a `need` rather than guess. Never
   regenerate code from the spec or rewrite the spec from the code.

## Output contract
Write findings as a report / task comment (granular, one line at a time), each carrying: the drift
direction, the spec/plan/code/test involved, and why it matters. End with a verdict: **aligned** or
**drift**. Surface to the orchestrator, group chat, and the **Attention tab** with:

```
::spectoflow role=governance kind=review msg=<verdict + counts>
::spectoflow attention msg=Source-of-truth: <one drift finding, actionable>
```

The `attention` line becomes an item in the dashboard's Attention tab (the user can edit, resolve, or
**validate → task**). Do not edit the spec or the code to reconcile drift — that is the owner's call.

## Quality bar
- [ ] Trace built **both directions** (orphan work *and* dead spec), not just one.
- [ ] Each new/changed behaviour has testable acceptance criteria **and** a test that encodes them.
- [ ] Findings are actionable (name the spec section / task / file, and the resolution owner).
- [ ] Nothing was auto-fixed, regenerated, or silently reconciled.
- [ ] A clear verdict (aligned / drift) is stated; unresolved *warn* drift is surfaced to Attention.

## References
- Thoughtworks — spec-driven development (code as source of truth, tests as enforcer) —
  https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices
- Augment Code — spec-anchored vs spec-as-source, drift & traceability —
  https://www.augmentcode.com/guides/spec-as-source-of-truth-rebuildable-codebase
