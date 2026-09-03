---
name: propose-customizations
description: The "Auto" mode — analyze the project and propose concrete, justified dashboard/skill/agent candidates instead of requiring a description upfront.
capability: customization
inputs: Which kind was requested (dashboard, skill, or agent), and the project's specs, plans, code, and existing agents/skills/dashboards.
outputs: A short, concrete, justified list of candidates posted to the group chat, each pickable to hand off to generate-dashboard/generate-skill/generate-agent.
standard: Continuous Discovery (opportunity framing) applied to framework tooling
---
# Propose customizations

Give a user who doesn't yet know exactly what to ask for a short, concrete, justified list of
dashboards/skills/agents worth adding to *this* project — instead of an empty text box.

## When to use

Whenever the Customize page's "Auto" button is used (for any of the three kinds), or the user asks
directly ("what dashboards should I have?", "what skills am I missing?", "suggest an agent"). Always
scoped to exactly **one kind** per run — dashboard, skill, or agent — never all three mixed into one
list; if the trigger doesn't say which, ask (one question, per the usual clarify discipline).

## Method

1. **Read the project as evidence, not as a checklist to fill.** Depending on the kind:
   - *Dashboards*: read `specs/*.md`, `plans/*.md`, and skim the codebase's shape (what kind of
     project — app/infra/data/study, per `.spectoflow/capabilities.md`'s project-type table) for
     things worth a dedicated view — an architecture doc with no visual summary, a security review
     skill producing findings nobody dashboards, a spec whose acceptance criteria aren't tracked
     anywhere visible.
   - *Skills*: read `.spectoflow/agents/*.md` and `.spectoflow/skills/*` for capability gaps — a
     capability the project type implies (per `.spectoflow/capabilities.md`) but has no matching
     skill, or a recurring need visible in `plans/*.md`'s task titles/comments that no current skill
     covers.
   - *Agents*: read the current roster for capabilities with no owner, or a distinct, recurring
     responsibility that keeps getting bolted onto an unrelated agent's plate.
2. **Frame each candidate as an opportunity, not a feature list.** For each one, state: what gap it
   fills, why it matters *for this project specifically* (cite the actual file/line/pattern that
   justifies it — never a generic "every project needs this"), and a one-line sketch of what it would
   contain/do. Three to five candidates is the right range — fewer if the project genuinely doesn't
   support more, never padded to hit a round number.
3. **Rank by leverage, not by ease.** Lead with the candidate that would most help *this* project's
   actual work, not the one that's fastest to generate.
4. **Post the list to the group chat**, one message per candidate plus a closing prompt, and wait —
   this skill's job ends at proposing; handing a picked candidate to `generate-dashboard`,
   `generate-skill`, or `generate-agent` is the next step, triggered by the user's choice.

## Output contract

- No file is written by this skill — it only posts to the group chat.
- Each candidate reported via the `::spectoflow` sentinel so the Customize page can render them as
  pickable cards:

```
::spectoflow role=customization kind=candidate msg=<kind>|<short id>|<title>|<one-line why, citing the actual project evidence>
::spectoflow role=customization kind=done msg=<n> <kind> candidates proposed — pick one to generate it
```

## Quality bar

- [ ] Every candidate cites concrete evidence from *this* project (a real file, pattern, or gap) —
      never a generic "every project needs X".
- [ ] Exactly one kind (dashboard, skill, or agent) proposed per run, matching the trigger.
- [ ] 3-5 candidates, ranked by leverage to this project, not by generation ease.
- [ ] No file was written — this skill only proposes; generation happens in a follow-up run of the
      matching `generate-*` skill once the user picks one.

## References

- Teresa Torres, *Continuous Discovery Habits* (Product Talk) — opportunity framing applied here to
  framework tooling instead of product features: name the gap, ground it in evidence, before jumping
  to a solution. https://www.producttalk.org/continuous-discovery-habits-book/
- `.spectoflow/capabilities.md` — the capability palette and project-type table this skill reads to
  spot gaps.
