---
name: implement
description: Implement a plan task as small, conventional commits — red-green when a test exists, boy-scout cleanup on touched code, no scope creep.
capability: implementation
inputs: A `plans/*.md` task (checkbox item) with its linked spec section, and any failing test the testing capability already wrote for it.
outputs: Working code for the task, committed as one or more Conventional Commits, plus the task's checkbox and status flipped in `plans/*.md`.
standard: Conventional Commits + YAGNI/DRY
---
# Implement

Turn one plan task into shipped code through small, well-described commits — nothing more than the
task asks for, nothing left messier than it was found.

## When to use
When the workflow reaches the `implementation` capability for a task in `plans/*.md` that is not yet
checked off, or when the group chat routes work to the developer persona.

## Method
1. **Re-read the task's contract first.** Open the linked spec section and the plan task's acceptance
   criteria before writing any code. If a test already exists for this task (unit/integration/e2e),
   run it — it should fail (**red**). If no test exists, note that in the report; do not silently skip
   testing, escalate to the `testing` capability if the task needs one.
2. **Build the smallest change that satisfies the criteria (YAGNI).** You Aren't Gonna Need It: implement
   only what the current task requires — no speculative config, no unused abstraction, no extra endpoint
   "while we're in here". Extra scope is a separate task, not a freebie.
3. **Make it pass, then clean it up (green → refactor).** Get the existing/linked test green with the
   simplest correct code, then refactor for clarity and to remove duplication (DRY — Don't Repeat
   Yourself: extract only when a *third* real occurrence appears, not on the first hint of similarity).
4. **Apply the boy-scout rule to code you touch.** Leave the lines you had to open cleaner than you found
   them (naming, dead code, obvious lint issues) — but do not refactor unrelated files or modules just
   because you passed through the repo; that belongs to its own task.
5. **Commit in small, working, Conventional Commits.** Each commit:
   - Builds and (if a test exists) passes on its own — no "WIP" or broken intermediate commits on the
     shared branch (trunk-based hygiene: keep the branch always releasable).
   - Follows the Conventional Commits grammar:
     `<type>[optional scope]: <description>` header, optional body one blank line after, optional
     footer(s) one blank line after that.
   - Uses `feat:` for new capability, `fix:` for a bug fix, and other conventional types (`refactor:`,
     `test:`, `docs:`, `chore:`, …) for everything else — pick the type that matches what the commit
     actually does, not what the task was called.
   - Marks a breaking change with `!` before the colon (e.g. `feat(api)!: ...`) or a `BREAKING CHANGE:`
     footer — only when the task's contract says the change is breaking.
   - Stays scoped to one logical change; split a task into several commits rather than bundling unrelated
     edits into one.
6. **Flip the task's status as you go**, not in one batch at the end — granular, one line at a time, so
   the dashboard and other agents see live progress rather than a silent gap.

## Output contract
- Code changes committed with Conventional Commits messages as described above.
- The corresponding checkbox/status line in `plans/*.md` updated via a granular, one-line write
  (`- [ ]` → `- [x]`, or the task's status field) — never a full-file rewrite of the plan.
- Progress and completion reported to the orchestrator and group chat with:

```
::spectoflow role=implementation kind=progress msg=<task id> <what changed, one line>
::spectoflow role=implementation kind=commit msg=<commit type>(<scope>): <description>
::spectoflow role=implementation kind=done msg=<task id> done — <tests status: red→green | no test>
```

## Quality bar
- [ ] Task's acceptance criteria (from the spec/plan) are met — nothing more, nothing less.
- [ ] If a test existed for this task, it went red → green; if none existed, that is stated explicitly.
- [ ] No speculative code, config, or abstraction beyond what the task requires (YAGNI).
- [ ] No duplicated logic left behind that a third occurrence should have collapsed (DRY).
- [ ] Every commit builds/passes standalone and follows `<type>[scope]: <description>` grammar.
- [ ] Breaking changes are marked with `!` or a `BREAKING CHANGE:` footer, and only when real.
- [ ] Code the task touched is left cleaner (boy-scout), with no drive-by edits outside the task's scope.
- [ ] Plan status updated via a granular write, not a full-file rewrite.

## References
- Conventional Commits v1.0.0 — https://www.conventionalcommits.org/en/v1.0.0/ (message grammar: type,
  optional scope, description, body, footer; `feat`/`fix` as the baseline types; `!` and
  `BREAKING CHANGE:` footer for breaking changes).
- Trunk-Based Development — https://trunkbaseddevelopment.com/ (small, short-lived changes committed
  frequently to a shared branch that always stays releasable).
- Martin Fowler, "YAGNI" — https://martinfowler.com/bliki/Yagni.html (build capability only when it is
  actually needed, not because it might be useful later).
- "Don't repeat yourself" — https://en.wikipedia.org/wiki/Don%27t_repeat_yourself (every piece of
  knowledge should have a single, unambiguous representation; the classic "rule of three" for when to
  extract).
