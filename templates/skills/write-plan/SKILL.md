---
name: write-plan
description: Break an approved, designed spec into small, dependency-ordered, checkbox tasks.
capability: planning
inputs: A signed-off spec (specs/<feature>.md) and its architecture/ADRs, if any.
outputs: plans/<feature>.md — dependency-ordered checkbox tasks.
standard: INVEST
---
# Write plan

Decompose an approved spec into tasks small and independent enough to execute one at a time, ordered so
nothing starts before what it depends on exists.

## When to use
Once a spec is signed off (and, when the change is architecturally significant, once the architect has
defined boundaries/ADRs), or whenever the workflow reaches the Plan step.

## Method
1. **Slice to INVEST size.** Break the spec's requirements into tasks that are each Independent,
   Negotiable, Valuable, Estimable, Small, and Testable (Bill Wake). A task that can't be estimated or
   tested on its own is still too big — split it again before it goes in the plan.
2. **Order by dependency.** Group into phases (`##` headings) and sequence tasks so every dependency
   appears before what needs it — data/schema before the services that read it, services before the UI
   that calls them, cross-cutting infra before the features built on it. State a cross-task dependency
   explicitly in the task line or a short note, never leave it implicit.
3. **Write each task as a checkbox line** using the repo's task convention exactly:
   `- [ ] T-012 Title @owner ~level %status`
   - `T-012` — a stable, sequential task ID (never reused, never renumbered after creation).
   - `Title` — outcome-phrased, short enough to scan.
   - `@owner` — who/what role picks it up (`@dev`, `@qa`, agent name, or a person).
   - `~level` — size signal, one of `~quick` / `~standard` / `~major` — keep it Small by this skill's
     standard; a task that only fits `~major` is a candidate to split further.
   - `%status` — current status, one of `%in_progress` / `%to_validate` / `%to_analyze` / `%blocked`.
     A task not yet started carries **no** `%status` tag at all (todo = absent, not `%todo`). A finished
     task is marked by checking the box (`- [x]`), never by a `%done` tag.
4. **Check INVEST before closing the plan.** Re-scan the list: any task not independent, not small, or
   not testable gets split or re-scoped before the plan is handed off.

## Output contract
Write `plans/<feature>.md` with phase headings (`##`) grouping dependency-ordered checkbox tasks in the
exact line format above. Use granular writes (one task/line at a time, not one giant dump — the
dashboard tracks each line). Report via the `::spectoflow` sentinel:

```
::spectoflow role=planning kind=progress msg=plan drafted: plans/<feature>.md (<N> tasks)
::spectoflow role=planning kind=report msg=plan ready: <feature> (<N> tasks, <M> phases)
```

A plan revised after a task reveals a missing dependency is reported again, not silently edited.

## Quality bar
- [ ] Every task line matches `- [ ] T-xxx Title @owner ~level %status` exactly, with `~level` from
      `{quick, standard, major}` and `%status` from `{in_progress, to_validate, to_analyze, blocked}` —
      never invented tags.
- [ ] A not-yet-started task carries no `%status` tag (todo = absent); a finished task is `- [x] …` with
      no `%status` tag, never `%done`.
- [ ] Every task is Independent, Small, and Testable enough to be picked up and closed on its own
      (INVEST); nothing in the plan is a disguised multi-task epic.
- [ ] Tasks are grouped into phases and ordered so no task precedes a dependency it needs.
- [ ] Task IDs are stable and sequential; none are reused or skipped without reason.
- [ ] The plan traces back to the spec's requirements — no task exists that isn't grounded in one.

## References
- Bill Wake, "INVEST in Good Stories, and SMART Tasks" (2003) —
  https://xp123.com/invest-in-good-stories-and-smart-tasks/
- Agile Alliance, "What does INVEST Stand For?" — https://agilealliance.org/glossary/invest/
