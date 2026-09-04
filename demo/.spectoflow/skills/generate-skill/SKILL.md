---
name: generate-skill
description: Turn a description (or an auto-analysis) into a new skill file, grounded in a real, cited domain standard and matching the framework's gold-standard shape.
capability: customization
inputs: A description of the procedure needed (from the Customize page or chat), or a chosen candidate from propose-customizations; the project's existing skills as worked examples.
outputs: A new .spectoflow/skills/<slug>/SKILL.md matching docs/agents-skills-standard.md's shape, listed in the dashboard's Agents & Skills tab on the next tick.
standard: docs/agents-skills-standard.md gold-standard shape
---
# Generate skill

Turn a described need for a new procedure into a real `SKILL.md` — one that reads like it shipped
with the framework: grounded in a named, current, cited standard for its domain, not generic advice
dressed up as a procedure.

## When to use

Whenever the user asks (from the Customize page, or directly in chat) to **add a skill** — "create a
skill for security review grounded in OWASP", "I want a skill for accessibility audits", "add a skill
for database migration reviews" — or when `propose-customizations` proposed a skill candidate the
user picked.

## Method

### 1. Clarify before generating

A one-line ask ("add a security skill") is under-specified. Use `.spectoflow/skills/clarify`'s
reflex — one targeted question at a time, each with a recommended default — until you know:
- **The exact procedure's scope.** "Security review" could mean a dozen different things (dependency
  vulnerabilities? authn/authz review? secrets scanning? infra hardening?) — narrow it before writing
  a method for the wrong one.
- **Which capability it belongs to** — pick the closest match from `.spectoflow/capabilities.md`'s
  palette (security, quality, architecture, testing, operations, …); propose one, don't leave it open.
- **Who runs it** — an existing agent whose capability matches, or does this need a new agent too
  (if so, this request also needs `generate-agent` — say so and sequence the two).

### 2. Identify the real domain standard — don't skip this, and don't fabricate it

This is the step that separates a real skill from a plausible-sounding one. For the procedure's
domain, identify the **actual, named, current authority** practitioners in that field defer to, the
same way the framework's own shipped skills already do (open a couple as worked examples —
`write-e2e-tests` cites Playwright's own docs page-by-page; `security-review` cites OWASP ASVS and the
OWASP Top 10; `write-adr` cites the ADR/C4 literature). Concretely:

| Domain | Look for | 2026-current example anchors |
|---|---|---|
| Security (general) | OWASP's current flagship guides | OWASP Top 10, OWASP ASVS, OWASP Cheat Sheet Series |
| Web app auth/session | OWASP-specific cheat sheets | Authentication/Session-Management Cheat Sheets |
| Accessibility | The current W3C recommendation | WCAG (check the current version — 2.2 at last knowledge, verify) |
| Architecture / ADRs | The established literature | C4 model (Simon Brown), Michael Nygard's ADR format |
| API design | A widely-adopted style guide | Google API Design Guide, Microsoft REST API Guidelines |
| Testing (any level) | The tool's own official docs | e.g. Playwright's own best-practices pages, not a blog summary of them |
| Performance | Vendor/W3C measurement standards | Core Web Vitals (web.dev), the relevant runtime's own profiling docs |
| Database/migrations | The database's own official docs + a recognized migration-safety pattern | e.g. "expand/contract" schema migration pattern |
| Accessibility, i18n, privacy, or any domain not listed here | Whatever is genuinely the field's own authority — never a generic listicle | — |

**Verify the standard is real and current before citing it** — use whatever research tool your
environment provides (web search/fetch) to confirm the standard's name, current version, and a real
URL; do not rely purely on training-time memory for a fast-moving domain (security guidance, W3C
specs, and vendor docs all revise). If you cannot verify a specific standard exists for the requested
domain, **say so explicitly and generate the method from first principles instead**, clearly flagged
in the skill's own body as "no single authoritative standard identified; method reasoned from
[whatever sound engineering principles apply]" — never invent a citation to fill the References
section. A skill honestly grounded in reasoned first principles is worth more than one dressed up with
a fabricated source.

### 3. Write the skill in the gold-standard shape

Follow `docs/agents-skills-standard.md`'s skill shape exactly:

```yaml
---
name: <slug>
description: <one line — reads as a trigger>
capability: <the palette capability chosen in step 1>
inputs: <what it needs>
outputs: <what it produces>
standard: <the named standard from step 2>
---
# <Skill name>
<1-line purpose>

## When to use
<the trigger — when does the workflow, or a direct request, reach for this>

## Method
<opinionated, numbered, SOURCED procedure — this is where the domain standard actually lives, applied
step by step, not just name-dropped in the References section>

## Output contract
<the exact artifact produced and where it's written; how progress is reported — see step 4>

## Quality bar
<a checkable checklist of what "good" looks like for this skill's output>

## References
<the real, verified sources from step 2, as titled links>
```

Match the depth and citation density of the framework's own shipped skills — a Method section that
just says "follow best practices" has failed this step; one that names the specific technique
(e.g. "apply OWASP ASVS V2 Authentication requirements, specifically…") has succeeded.

### 4. Own the `::spectoflow` sentinel

Per the gold standard's conventions: **the skill owns the exact reporting syntax** — write out real
`::spectoflow role=<capability> kind=progress|need|done msg=…` lines in the new skill's Output
contract, matching the pattern every other skill uses (see any shipped skill for the exact grammar).
Do not leave this section vague or reference "the standard sentinel format" without spelling it out.

### 5. Mark it as user-generated

Add `origin: user-generated` to the front-matter (an extra key — never remove or rename the required
ones). This is how the dashboard's Customize page distinguishes what the user added from what shipped
with the framework; omitting it hides the skill from that list.

### 6. Wire it up if it belongs to the workflow

If the new skill is meant to run as part of the delivery pipeline (not just on-demand), tell the user
it can be added as a step in `.spectoflow/workflow.md` (or from the dashboard's Workflow tab) — but do
**not** edit `workflow.md` yourself without being asked; a new skill existing is not the same decision
as it being wired into every request's pipeline.

## Output contract

- One file: `.spectoflow/skills/<slug>/SKILL.md`, matching the gold-standard shape, with
  `origin: user-generated` in its front-matter.
- Progress and completion reported to the orchestrator and group chat:

```
::spectoflow role=customization kind=progress msg=Researching the standard for "<domain>" — checking <source>
::spectoflow role=customization kind=need msg=<what's missing, e.g. no authoritative standard found for X>
::spectoflow role=customization kind=done msg=Skill "<slug>" added (capability <capability>) — grounded in <standard>
```

## Quality bar

- [ ] Front-matter matches the gold-standard shape exactly, plus `origin: user-generated`.
- [ ] Body has exactly the five required `##` headings, in order.
- [ ] `## Method` names and applies a real, verified, current standard — or explicitly says none was
      found and reasons from first principles instead. Never a fabricated citation.
- [ ] `## References` links are real and were verified (not assumed from memory) when the domain is
      fast-moving (security, web standards, vendor APIs).
- [ ] The `::spectoflow` sentinel syntax is spelled out in full in the Output contract, not just
      referenced.
- [ ] If the ask was ambiguous, it was clarified one question at a time before any file was written.
- [ ] `.spectoflow/workflow.md` was left untouched unless the user explicitly asked to enable this
      skill as a pipeline step.

## References

- `docs/agents-skills-standard.md` — the gold-standard shape this skill's output must match exactly.
- Any shipped skill under `.spectoflow/skills/` (e.g. `security-review`, `write-e2e-tests`,
  `write-adr`) — worked examples of real citation density and Method-section depth to match.
