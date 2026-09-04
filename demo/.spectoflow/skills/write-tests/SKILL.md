---
name: write-tests
description: Write unit/integration tests test-first, one behaviour per test, red-green-refactor.
capability: testing
inputs: Acceptance criteria or a spec section, and the code under test (or the stub it will be written against).
outputs: Test files (red then green) plus a pass/fail report for the covered behaviours.
standard: TDD (Beck) + xUnit Test Patterns
---
# Write tests

Test-first authoring of unit and integration tests, one behaviour at a time. End-to-end tests are a
separate scope — use the `write-e2e-tests` skill for those; do not duplicate that work here.

## When to use
Whenever a piece of behaviour (a function, method, module, or the interaction of a few collaborators
without crossing a real network/DB/UI boundary) needs to be implemented or changed, or when the
workflow reaches a testing step for unit/integration coverage.

## Method
Apply Kent Beck's red-green-refactor loop per behaviour, structuring each test per Meszaros's
xUnit Test Patterns:

1. **Pick one behaviour.** Take the next acceptance criterion or edge case not yet covered. If it
   needs more than one sentence to describe, it is more than one test — split it.
2. **Red.** Write a test that fails for the right reason (the behaviour doesn't exist yet, not a typo
   or setup bug). Give it a descriptive name stating the behaviour and condition, e.g.
   `returns_empty_list_when_input_is_empty` or `throws_when_amount_is_negative` — not `test1` or
   `testFoo`.
3. **Structure with Arrange-Act-Assert** (Bill Wake / Beck): set up inputs and collaborators (Arrange),
   invoke exactly the one thing under test (Act), check the outcome (Assert). No conditionals, loops,
   or try/catch-as-control-flow inside a test — a test with logic in it is itself untested code
   (Meszaros, *Obscure Test*). Prefer one focused assertion or a tight cluster checking one outcome;
   avoid *Assertion Roulette* (many unrelated asserts with no way to tell which one failed) and
   *Eager Test* (one test exercising several behaviours at once).
4. **Green.** Write the minimum production code to pass the test — resist adding behaviour the test
   doesn't require yet.
5. **Refactor.** With the test green, remove duplication and improve naming in both test and production
   code, in small steps, re-running the test after each. Never refactor and add behaviour in the same
   step.
6. **Repeat** for the next behaviour, including edge cases (empty/null/zero, boundary values, invalid
   input, error/exception paths) — not just the happy path — until every acceptance criterion is
   covered. Keep each test independent: no shared mutable fixture state and no ordering dependency
   between tests (Meszaros, *Interacting Tests* / *Test Run Wars*).
7. Choose the lowest level that gives honest confidence: unit-test pure logic in isolation; use a thin
   integration test only for the seam where two real collaborators must be checked together (e.g. a
   repository against a real schema). If the behaviour requires a live UI, network, or full-stack
   boundary, hand off to `write-e2e-tests` instead of stretching a unit test to cover it.

## Output contract
Test files committed alongside the code, one file per unit under test following the project's test
naming convention, red commit(s) allowed only transiently before the corresponding green commit. Report
progress with granular, one-line-at-a-time writes and the `::spectoflow` sentinel:

```
::spectoflow role=testing kind=progress msg=<behaviour> red
::spectoflow role=testing kind=progress msg=<behaviour> green
::spectoflow role=testing kind=report msg=<N passed>/<N total>, 0 failed, 0 skipped
```

A suite left red or with a skipped test is reported as such, never silently marked done.

## Quality bar
- [ ] Every acceptance criterion has at least one test; meaningful edge cases (empty/null, boundary,
      error paths) are covered, not just the happy path.
- [ ] Each test covers exactly one behaviour and is named for that behaviour and its condition.
- [ ] Each test follows Arrange-Act-Assert with no branching/looping logic inside the test body.
- [ ] No Assertion Roulette (unrelated asserts bundled) and no Eager Test (one test, many behaviours).
- [ ] Tests are independent — no shared mutable state, no required run order, no real secrets or live
      external endpoints.
- [ ] The full suite is green before reporting done; nothing is skipped or commented out to get there.

## References
- Kent Beck, *Test-Driven Development: By Example* (Addison-Wesley, 2002) — red/green/refactor.
- Kent Beck, "Canon TDD" — https://tidyfirst.substack.com/p/canon-tdd
- Martin Fowler, "Test Driven Development" — https://www.martinfowler.com/bliki/TestDrivenDevelopment.html
- Gerard Meszaros, *xUnit Test Patterns: Refactoring Test Code* (Addison-Wesley, 2007) —
  http://xunitpatterns.com/ ; "Assertion Roulette" http://xunitpatterns.com/Assertion%20Roulette.html ;
  "Obscure Test" http://xunitpatterns.com/Obscure%20Test.html ; test smell catalog
  http://xunitpatterns.com/TestSmells.html
- Bill Wake, "3A – Arrange, Act, Assert" (2001) — https://xp123.com/3a-arrange-act-assert/
