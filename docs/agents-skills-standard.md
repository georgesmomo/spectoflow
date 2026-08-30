# Agents & Skills — Gold-Standard Shape

Every agent file (`.spectoflow/agents/<slug>.md`) and skill file (`.spectoflow/skills/<slug>/SKILL.md`)
conforms to one of the two shapes below. Cite the domain standard you applied in the file's own
**References** section. Keep front-matter machine-valid — `templates/lib/store.js:readAgents` parses simple
`key: value` and `uses: [a, b]` flat lists only (no nested YAML, no multi-line values).

## GOLD STANDARD — agent file (`.spectoflow/agents/<slug>.md`)

Front-matter (existing keys required; `standards`/`priority` new & optional):
```yaml
---
name: <slug>
title: <Team title>
capability: <one palette capability>
uses: [<skill-slug>, ...]
description: <one line>
standards: [<named method or source>, ...]
priority: <int>            # optional; only when a capability must have >1 agent
---
```
Body, in this order, with these exact `##` headings:
```
# <Title>
1-2 line intro naming the persona and the capability it serves.

## Mandate            — who/why, 1-2 lines
## Operating standards — named, CITED methods this role applies, each with a one-line why
## Definition of done  — concrete, checkable exit criteria for this role's contribution
## Handoff             — what it produces and to whom (feeds the group-chat identity + orchestrator)
## Guardrails          — what it must never do (ties to policy.md)
## References          — the cited sources (links/titles)
```

## GOLD STANDARD — skill file (`.spectoflow/skills/<slug>/SKILL.md`)

Front-matter:
```yaml
---
name: <slug>
description: <one line — reads as a trigger; shown always in the skill index>
capability: <palette capability>
inputs: <what it needs>
outputs: <what it produces>
standard: <named source>
---
```
Body, in this order, with these exact `##` headings:
```
# <Skill name>
1-line purpose.

## When to use     — the trigger (body loads on demand)
## Method          — opinionated, numbered, SOURCED procedure; the domain standard lives here
## Output contract — exact artifact + where written (e.g. specs/<feature>.md sections X/Y/Z);
                     how the agent reports (granular writes; ::spectoflow role=… kind=… msg=…)
## Quality bar     — a checkable checklist: what "good" looks like
## References      — cited sources
```

## Front-matter rules (both shapes)

- Never remove or rename `name`, `capability`, `uses`, `description` (agents) or `name`, `description`
  (skills). Only ADD keys.
- `uses` stays a flat inline list: `uses: [a, b]`.
- Simple `key: value` per line; no nested blocks, no multi-line values in front-matter.
- Zero runtime dependencies — content is markdown only. Any tool a skill names is a dependency of the
  USER's project, invoked when that step runs; never added to spectoflow itself.
- English content and comments. (Output language stays `config.language`.)

## Conventions

- **Sentinel ownership.** The SKILL owns the exact `::spectoflow role=… kind=… msg=…` reporting syntax,
  written out in its Output contract. An AGENT file only *references* it (e.g. "reports via `::spectoflow`"
  in Handoff) — it never restates the full syntax. This keeps one source for the sentinel format and
  prevents drift across files.
