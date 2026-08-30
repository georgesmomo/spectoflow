---
name: write-adr
description: Record an architecturally significant decision as a short, durable ADR.
capability: architecture
inputs: The design under discussion (components/boundaries, framed by C4 views) and the options weighed.
outputs: An ADR file recording context, decision, and consequences.
standard: "ADR (Nygard/MADR) + C4"
---
# Write ADR

Capture one architecturally significant decision — the forces behind it, what was chosen, and what it
costs — so the reasoning survives past the conversation that produced it.

## When to use
Whenever a decision has lasting consequence: it constrains a boundary, an interface, a technology
choice, or a trade-off that would be expensive to reverse. Not for routine implementation choices a
developer can freely change later.

## Method
Frame the decision against the relevant C4 view first — is this a System Context decision (an external
dependency or actor), a Container decision (a new service, store, or protocol between them), or a
Component decision (internal structure of one container)? Naming the level keeps the ADR scoped to one
decision instead of drifting into a general design doc. Then record it using Nygard's four-part
structure (default) or MADR's fuller field set when the trade-off between options needs to be visible:

1. **Title.** A short noun phrase naming the decision, numbered — `NNNN-title.md`.
2. **Status.** `proposed`, `accepted`, `deprecated`, or `superseded by NNNN`.
3. **Context.** The forces and constraints in play, stated as fact, not argument for the decision.
   (MADR: also list **Decision drivers** explicitly if more than one competing force is at play.)
4. **Decision.** What was decided, in full sentences, active voice: "We will …".
   (MADR: list the **Considered options**, and for each, brief pros/cons, before naming the outcome —
   this is what makes a later "why not X" answerable without re-litigating.)
5. **Consequences.** What becomes easier or harder as a result — positive, negative, and neutral. Name
   what was rejected and why, not just what was chosen.

## Output contract
Write one file per decision to the project's ADR location — `docs/adr/NNNN-title.md` if the project has
no other convention, else the location the project already uses (check for an existing `docs/adr/` or
`specs/adr/` directory before creating a new one). Use granular writes (one section at a time). Report
via the `::spectoflow` sentinel:

```
::spectoflow role=architecture kind=progress msg=ADR drafted: docs/adr/NNNN-title.md
::spectoflow role=architecture kind=report msg=ADR accepted: NNNN-title (<N> options considered)
```

A decision that supersedes an earlier ADR updates that ADR's Status line (`superseded by NNNN`) and is
reported as its own event, never a silent edit.

## Quality bar
- [ ] Framed at the right C4 level — the ADR states which boundary/container/component it constrains.
- [ ] Context is stated as fact (forces/constraints), not as an argument for the chosen option.
- [ ] Considered options are named with their trade-offs, not only the winner.
- [ ] Consequences cover positive, negative, and neutral — not just the upside.
- [ ] Status is current; a reversed or replaced decision points to its successor, it isn't deleted.

## References
- Michael Nygard, "Documenting Architecture Decisions" (2011), the original ADR format —
  https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- MADR (Markdown Any Decision Records) template — https://adr.github.io/madr/
- Simon Brown, "The C4 model for visualising software architecture" — https://c4model.com/
