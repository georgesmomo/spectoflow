---
name: generate-agent
description: Turn a description (or an auto-analysis) into a new agent persona, grounded in real named methods and matching the framework's gold-standard shape.
capability: customization
inputs: A description of the role needed (from the Customize page or chat), or a chosen candidate from propose-customizations; the project's existing agents as worked examples.
outputs: A new .spectoflow/agents/<slug>.md matching docs/agents-skills-standard.md's shape, listed in the dashboard's Agents & Skills tab on the next tick.
standard: docs/agents-skills-standard.md gold-standard shape
---
# Generate agent

Turn a described role into a real agent persona — a stable team member with a clear mandate, named
operating standards, and guardrails, that reads like it shipped with the framework's own roster.

## When to use

Whenever the user asks (from the Customize page, or directly in chat) to **add an agent** — "I want a
data-migration specialist", "add an accessibility reviewer", "create an agent for API contract
reviews" — or when `propose-customizations` proposed an agent candidate the user picked.

## Method

### 1. Clarify before generating

A one-line ask ("add a data agent") is under-specified. Use `.spectoflow/skills/clarify`'s reflex —
one targeted question at a time, each with a recommended default — until you know:
- **What this role owns that no existing agent already owns.** Read `.spectoflow/agents/*.md` first —
  a new agent for a capability an existing one already covers is redundant; either the existing agent
  should gain a skill instead (see `generate-skill`), or this really is a distinct capability.
- **Which capability it serves.** Pick the closest match from `.spectoflow/capabilities.md`'s palette,
  or note that this genuinely needs a new capability name (rare — most real needs fit the existing
  palette; propose adding to the palette only when nothing fits).
- **What skill(s) it runs.** An agent without at least one skill in `uses` has no procedure to
  execute — either an existing skill fits, or this request also needs `generate-skill` (sequence the
  two: skill first, so the agent's `uses` list is accurate from the start).

### 2. Remember the agent/skill split

Per the framework's own core invariant: **agents are stable personas (the who); skills are the
evolving procedures (the how).** This agent's file should describe *who* the role is and what it's
accountable for — the actual step-by-step method belongs in its skill(s), referenced via `uses`, not
duplicated here. An agent file heavy with procedural detail has blurred the split; move that content
into a skill instead.

### 3. Ground the operating standards in named, real methods

Per `docs/agents-skills-standard.md`, `## Operating standards` names **cited methods**, each with a
one-line *why* — the same discipline every shipped agent already follows (open a couple as worked
examples: `qa-engineer` cites Kent Beck's TDD and Meszaros's xUnit Test Patterns; `security-engineer`
cites OWASP ASVS and the Top 10; `architect` cites C4 and ADRs). Identify the real, current, named
authority for this role's domain the same way `generate-skill`'s Method (step 2 there) describes —
verify it with your environment's research tools rather than relying purely on memory for a
fast-moving domain, and if no real standard exists for the role's specific angle, say so explicitly
and reason from first principles instead of fabricating a citation.

### 4. Write the agent in the gold-standard shape

Follow `docs/agents-skills-standard.md`'s agent shape exactly:

```yaml
---
name: <slug>
title: <Team title>
capability: <the palette capability chosen in step 1>
uses: [<skill-slug>, ...]
description: <one line>
standards: [<named method or source>, ...]
---
# <Title>
<1-2 line intro naming the persona and the capability it serves>

## Mandate
<who/why, 1-2 lines — what this role owns>

## Operating standards
<named, cited methods this role applies, each with a one-line why — from step 3>

## Definition of done
<concrete, checkable exit criteria for this role's contribution>

## Handoff
<what it produces and to whom — feeds the group-chat identity + orchestrator>

## Guardrails
<what it must never do — ties to .spectoflow/policy.md where relevant>

## References
<the real, verified sources from step 3, as titled links>
```

### 5. Mark it as user-generated

Add `origin: user-generated` to the front-matter (an extra key — never remove or rename the required
ones: `name`, `title`, `capability`, `uses`, `description`). This is how the dashboard's Customize
page distinguishes what the user added from the shipped roster; omitting it hides the agent from that
list.

### 6. Resolve capability collisions explicitly

`.spectoflow/AGENTS.md`'s routing assumes one agent per capability unless a `priority` is set (see the
front-matter rules in `docs/agents-skills-standard.md`). If the chosen capability already has an
agent, either pick a different, more precise capability for this role, or set `priority` deliberately
and tell the user which agent now wins ties — never leave two agents silently competing for the same
capability with no way to tell which runs.

## Output contract

- One file: `.spectoflow/agents/<slug>.md`, matching the gold-standard shape, with
  `origin: user-generated` in its front-matter.
- Progress and completion reported to the orchestrator and group chat:

```
::spectoflow role=customization kind=progress msg=Drafting agent "<title>" (capability <capability>)
::spectoflow role=customization kind=need msg=<what's missing, e.g. no skill yet for this agent to use>
::spectoflow role=customization kind=done msg=Agent "<title>" added — see it in Agents & Skills
```

## Quality bar

- [ ] Front-matter matches the gold-standard shape exactly, plus `origin: user-generated`.
- [ ] Body has exactly the five required `##` headings, in order.
- [ ] `uses` lists at least one real, existing (or just-generated) skill — never an empty list.
- [ ] `## Operating standards` names real, verified, cited methods — or explicitly says none exist for
      this angle and reasons from first principles instead. Never a fabricated citation.
- [ ] No capability collision left unresolved (step 6) — or the `priority` tie-break is explicit and
      explained to the user.
- [ ] The role is genuinely distinct from every existing agent — not a duplicate the user could have
      gotten by adding a skill to one that already exists.
- [ ] If the ask was ambiguous, it was clarified one question at a time before any file was written.

## References

- `docs/agents-skills-standard.md` — the gold-standard shape this agent's output must match exactly.
- Any shipped agent under `.spectoflow/agents/` (e.g. `qa-engineer`, `security-engineer`,
  `spec-source-guardian`) — worked examples of real citation density in `## Operating standards`.
- `.spectoflow/capabilities.md` — the capability palette a new agent's `capability` must fit.
