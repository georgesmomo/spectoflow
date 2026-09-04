---
name: code-review
description: Review a deliverable against its requirements, findings graded by severity.
capability: quality
inputs: The deliverable under review and its acceptance criteria/spec.
outputs: A severity-graded findings report with a ready / rework verdict.
standard: Google code-review guide
---
# Code review

Scoped review of a deliverable against its requirements to catch defects before it is marked done.

## When to use
When a `plans/*.md` task or deliverable is reported complete and needs an independent check before
its status flips to done — or whenever the workflow reaches a quality step.

## Method
Read the deliverable and its acceptance criteria/spec first; review against them, not against
personal preference. Following Google's "How to do a code review", walk each category and read every
line the author expects reviewed:

1. **Correctness / Functionality** — does the code behave as the spec and the author intended; are
   edge cases and error paths handled.
2. **Tests** — does the change have correct, well-designed automated tests covering the new behavior
   (not just the happy path)?
3. **Readability / Naming / Comments** — clear names, comments that explain *why* not *what*, no
   dead code or leftover debug output.
4. **Design / Complexity** — is the change well-designed for the system it lands in; could it be
   simpler; would another developer understand and reuse it later?
5. **Security** — obvious injection, auth/authz, secrets, or input-validation issues on the touched
   surface (defer a full pass to the `security-review` skill when the change is security-sensitive).
6. **Consistency / Documentation** — matches existing style/conventions; docs updated if behavior or
   interface changed.

Grade each finding by severity: **Critical** (breaks correctness/security, blocks), **Important**
(real defect or gap, should block), **Minor** (worth fixing, not blocking), **Nit** (polish, author's
choice — the guide's own "Nit:" convention for non-blocking points). Favor approving once the change
demonstrably improves the codebase, even if imperfect; don't hold it to a standard of perfection.

## Output contract
Write findings as a report / task comment alongside the deliverable (granular, one line at a time),
each carrying: severity, file:line, and the issue. End with an explicit verdict: **ready** or
**rework**. Report to the orchestrator and group chat with:

```
::spectoflow role=quality kind=review msg=<verdict + counts by severity>
::spectoflow role=quality kind=finding msg=<severity> <file:line> — <issue>
```

Do not modify the deliverable — report only. A discrepancy with the spec is raised as a `need`, not
silently patched.

## Quality bar
- [ ] Reviewed against the deliverable's stated acceptance criteria/spec, not personal taste.
- [ ] Every finding has a severity (Critical/Important/Minor/Nit) and a file:line.
- [ ] Tests checked for real coverage of new behavior, not just the presence of a test file.
- [ ] Design/complexity and naming/readability both considered, not just correctness.
- [ ] Obvious security issues on the touched surface flagged (or routed to security-review).
- [ ] A clear verdict (ready/rework) is stated; no open Critical/Important left unacknowledged.

## References
- Google Engineering Practices, "How to do a code review" —
  https://google.github.io/eng-practices/review/reviewer/
- Google Engineering Practices, "What to look for in a code review" —
  https://google.github.io/eng-practices/review/reviewer/looking-for.html
- Google Engineering Practices, "The Standard of Code Review" —
  https://google.github.io/eng-practices/review/reviewer/standard.html
