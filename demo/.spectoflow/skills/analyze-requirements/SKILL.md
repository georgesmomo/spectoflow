---
name: analyze-requirements
description: Turn a need into testable acceptance criteria in Given/When/Then, with edge cases enumerated.
capability: analysis
inputs: The raw need (a request, ticket, or user story) and any known constraints or existing spec.
outputs: A list of testable acceptance criteria (Given/When/Then) plus an edge-case checklist.
standard: BDD / acceptance criteria
---
# Analyze requirements

Turn an ambiguous need into a set of unambiguous, testable acceptance criteria before design or code
starts.

## When to use
Whenever a need arrives that isn't yet expressed as testable criteria — a new feature, a change
request, a bug that implies a missing behavior — or whenever the workflow reaches the Analysis step.

## Method
Apply Behavior-Driven Development's Given/When/Then structure (Cucumber/Gherkin) to state each
criterion as a concrete example, then stress it with a standard edge-case taxonomy
(ISTQB equivalence partitioning + boundary value analysis):

1. **Restate the need in one sentence.** If it takes more than one sentence, split it into multiple
   needs — each gets its own criteria.
2. **Write acceptance criteria as Given/When/Then.** For each distinct behavior:
   - `Given` the initial context/state (3-5 steps max per scenario — more and it stops reading as a
     spec and becomes an implementation).
   - `When` the triggering action.
   - `Then` the expected, observable outcome (behavior/contract level — no implementation detail).
   One criterion = one behavior. If it needs "and" to describe, it is probably two criteria.
3. **Enumerate edge cases per input**, using equivalence partitioning + boundary value analysis:
   - Valid equivalence class(es) — one representative example, not every value in the class.
   - Invalid equivalence class(es) — what must be rejected and how.
   - Boundaries — min, max, min-1, max+1, empty, zero, null/missing.
   - Error paths — what happens on failure (timeout, denial, malformed input), not just success.
4. **Flag gaps as `need`s, don't fill them in.** Any requirement gap that depends on a third party, a
   business decision, or information you don't have is raised as a `need` per `policy.md` — never
   guessed at to keep moving.
5. **Hand off** the criteria list to `write-spec` to be shaped into a reviewable spec document.

## Output contract
Acceptance criteria (Given/When/Then) and the edge-case checklist are recorded in `specs/<feature>.md`
(or the plan, if no spec exists yet), written with granular, one-line-at-a-time updates. Report progress
with the `::spectoflow` sentinel:

```
::spectoflow role=analysis kind=progress msg=<N> acceptance criteria drafted for <feature>
::spectoflow role=analysis kind=need msg=<what is missing and who must resolve it>
::spectoflow role=analysis kind=report msg=<N> criteria, <M> edge cases enumerated, ready for write-spec
```

## Quality bar
- [ ] Every acceptance criterion is a concrete Given/When/Then example, not a vague statement.
- [ ] Each criterion covers exactly one behavior (splittable by "and" is a sign it's really two).
- [ ] Edge cases cover valid + invalid equivalence classes, boundaries, and error paths — not just the
      happy path.
- [ ] No criterion states implementation detail (class names, frameworks, algorithms).
- [ ] Every gap that isn't this role's to answer is raised as a `need`, not silently assumed.

## References
- Cucumber, "Gherkin Syntax" — https://cucumber.netlify.app/docs/gherkin/
- SmartBear, "Writing scenarios with Gherkin syntax" —
  https://support.smartbear.com/cucumberstudio/docs/bdd/write-gherkin-scenarios.html
- ISTQB Foundation Level — Boundary Value Analysis white paper —
  https://istqb.org/wp-content/uploads/2025/10/Boundary-Value-Analysis-white-paper.pdf
- SoftwareTestingHelp, "Boundary Value Analysis & Equivalence Partitioning Examples" —
  https://www.softwaretestinghelp.com/what-is-boundary-value-analysis-and-equivalence-partitioning/
