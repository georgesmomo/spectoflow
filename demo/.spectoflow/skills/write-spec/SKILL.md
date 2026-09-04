---
name: write-spec
description: Produce a clear, reviewable specification in markdown, signed off before design/code starts.
capability: analysis
inputs: Acceptance criteria and edge cases from analyze-requirements, plus any known constraints.
outputs: specs/<feature>.md — a reviewable, signed-off spec.
standard: spec-kit / OpenSpec conventions
---
# Write spec

Shape acceptance criteria into a single reviewable spec document, then drive it to explicit sign-off.

## When to use
Once `analyze-requirements` has produced acceptance criteria and edge cases for a feature or change, or
whenever the workflow reaches the Spec step.

## Method
Structure the document like GitHub `spec-kit`'s spec template and OpenSpec's requirement/scenario
format — behavior contract, not implementation plan:

1. **Purpose.** 1-2 sentences: what this capability provides and to whom. No design detail.
2. **Requirements.** Numbered (`REQ-001`, `REQ-002`, …), each phrased with RFC 2119 strength —
   **MUST** (mandatory), **SHOULD** (recommended, exceptions allowed), **MAY** (optional). One
   requirement = one testable statement, not a paragraph of intent.
3. **Scenarios.** Under each requirement, one or more concrete scenarios in Given/When/Then, sourced
   directly from `analyze-requirements`' criteria and edge cases (happy path + boundaries + error
   paths). Mark any unresolved detail inline as `[NEEDS CLARIFICATION: …]` rather than guessing.
4. **Out-of-scope.** What this spec deliberately does not cover — prevents silent scope creep during
   implementation.
5. **Open questions.** Anything still unresolved, each tagged as a `need` per `policy.md` if it blocks
   a decision this role can't make alone.
6. **Review loop.** Show the draft to the requester/stakeholders. Revise on feedback. The spec is only
   "done" once it has explicit sign-off recorded — never inferred from silence.

## Output contract
Write `specs/<feature>.md` with exactly these sections, in order: Purpose, Requirements, Scenarios,
Out-of-scope, Open questions. Use granular writes (one line/section at a time, not one giant dump).
Report via the `::spectoflow` sentinel:

```
::spectoflow role=analysis kind=progress msg=spec draft written: specs/<feature>.md
::spectoflow role=analysis kind=review msg=spec sent for sign-off: <feature>
::spectoflow role=analysis kind=report msg=spec signed off: <feature> (<N> requirements, <M> scenarios)
```

A spec revised after feedback is reported again, not silently overwritten.

## Quality bar
- [ ] All five sections present, in order: Purpose, Requirements, Scenarios, Out-of-scope, Open
      questions.
- [ ] Every requirement uses MUST/SHOULD/MAY and is independently testable.
- [ ] Every requirement has at least one Given/When/Then scenario grounded in real acceptance criteria
      (not invented after the fact).
- [ ] No implementation detail (class names, frameworks, data schemas) leaks into Requirements or
      Scenarios.
- [ ] Explicit sign-off is recorded before the spec is treated as done; unresolved items are tagged
      `[NEEDS CLARIFICATION: …]` or raised as a `need`, never silently dropped.

## References
- GitHub, `spec-kit` spec template (User Scenarios & Testing, Requirements FR-NNN, Success Criteria) —
  https://github.com/github/spec-kit/blob/main/templates/spec-template.md
- GitHub, `spec-kit` — Spec-Driven Development methodology —
  https://github.com/github/spec-kit/blob/main/spec-driven.md
- Fission-AI, OpenSpec concepts (Purpose / Requirements / Scenarios, RFC 2119 strength keywords) —
  https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md
- Cucumber, "Gherkin Syntax" — https://cucumber.netlify.app/docs/gherkin/
