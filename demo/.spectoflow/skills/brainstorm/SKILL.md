---
name: brainstorm
description: Frame a need — problem, users, scope, risks, success metric — before committing to a spec.
capability: intake
inputs: The raw ask/request from the user or requester.
outputs: A framed brief (problem, users, scope, risks, success metric) ready for analysis.
standard: product discovery
---
# Brainstorm

Frame a raw need into an agreed problem statement before any solution gets designed.

## When to use
When a new ask arrives — a feature request, a bug report reframed as a need, or any item without an
agreed problem/scope yet — or whenever the workflow reaches an intake step.

## Method
Frame the need *before* reaching for solutions, in this order:

1. **Problem** — what user-facing or business problem is this, stated as an outcome, not a feature
   ("users can't X" not "add a button").
2. **Users** — who specifically is affected; which segment, not "everyone".
3. **Scope** — what's in scope for a first useful version.
4. **Out of scope** — what is explicitly excluded, so nobody assumes it's included later.
5. **Risks** — name the risk(s) most likely to kill or derail this: value (will users want it),
   usability (can they use it), feasibility (can it be built with what we have), business viability
   (does it fit constraints/compliance/cost) — per SVPG's four big risks.
6. **Success metric** — one metric that will tell us the outcome was achieved.

Offer 2-3 directions with trade-offs once the problem is framed; let the user react and converge on a
shared understanding. Do not write code or a full spec at this stage — that belongs to the next
capability.

## Output contract
Write the framed brief as a granular note/task comment (one line at a time): problem statement,
users, scope, out-of-scope, top risk(s), success metric. Report to the orchestrator and group chat
with:

```
::spectoflow role=intake kind=brief msg=<one-line problem + scope summary>
```

The brief feeds the next analysis/spec-writing step; it is not itself a spec or an implementation
plan.

## Quality bar
- [ ] Problem is stated as an outcome/user pain, not pre-decided as a solution/feature.
- [ ] Users are named specifically, not "everyone" or left implicit.
- [ ] Scope and out-of-scope are both stated explicitly.
- [ ] At least one risk (value/usability/feasibility/business viability) is named.
- [ ] Exactly one success metric is stated and agreed with the requester.
- [ ] No code or full spec was written during this step.

## References
- Teresa Torres, *Continuous Discovery Habits* (Product Talk, 2021) —
  https://www.producttalk.org/continuous-discovery-habits-book/
- Marty Cagan, "The Four Big Risks" — Silicon Valley Product Group —
  https://www.svpg.com/four-big-risks/
