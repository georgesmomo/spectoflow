# Agents & Skills upgrade — design

> Status: **implemented** (O1–O3 resolved by review, 2026-08-30). Target: spectoflow **0.10**. Turns the
> framework's personas and procedures from one-line stubs into best-in-class, domain-standard
> playbooks. Graduates to `DECISIONS.md` (D21) once implemented.

## Purpose & problem

The agents (`.spectoflow/agents/*.md`) and skills (`.spectoflow/skills/*/SKILL.md`) **are** the
framework's intelligence — the invariant is that spectoflow's "brain" is *instructions an agent
reads*, not a runtime engine. Today those files are stubs: a persona is one mandate line; a skill is
three bullets. That is the weakest part of the product: the orchestrator now walks a real workflow,
but each step hands the agent a thin prompt.

**Goal:** every component encodes the **best standards, methods and techniques of its domain**, by
default, with the source cited — so an agent executing a step behaves like a strong practitioner of
that role, on any agent runtime.

## Decisions (from brainstorming)

- **Rubric/template first.** Define the gold-standard shape of an agent file and a skill file, prove
  it on a pilot, then bring every component up to it. Consistency over ad-hoc rewrites.
- **Strong, opinionated, sourced, current.** Each component encodes ONE strong default method drawn
  from a named authoritative source, **refreshed via live research** (context7 / web) at build time,
  with the source cited in the file. Not a neutral menu.
- **Upgrade the 18 + fill known gaps.** 10 agents + 8 skills raised to standard, PLUS: a new
  `write-e2e-tests` skill (Playwright), a new `implement` skill (the `Develop` step has none), and a
  fix for the ambiguous `implementation` capability. No casting rethink.
- **Pilot:** `security-engineer` + `security-review` (exercises external-standard research best —
  OWASP ASVS / Top 10).

## Gold standard — agent file (persona)

**Front-matter** (machine-readable; existing keys MUST stay — the orchestrator resolves on them):
```yaml
name: <slug>
title: <Team title>
capability: <one palette capability>
uses: [<skill-slug>, ...]
description: <one line>
standards: [<named method/source>, ...]   # NEW — the methods this persona upholds
priority: <int>                            # NEW, optional — tie-break when a capability has >1 agent
```
**Body sections** (in order):
1. **Mandate** — the who/why, 1–2 lines.
2. **Operating standards** — the named, **cited** best-practice methods this role applies (the
   best-in-class core). Each with a one-line "why".
3. **Definition of done** — concrete, checkable exit criteria for this role's contribution.
4. **Handoff** — what it produces and to whom (feeds the group-chat identity + orchestrator).
5. **Guardrails** — what it must never do (ties to `policy.md`).

Kept focused — an agent file is loaded when a step resolves to it, so it is lazy, but it is a
persona, not a manual: depth lives in the skills it `uses`.

## Gold standard — skill file (procedure)

**Front-matter:**
```yaml
name: <slug>
description: <one line — shown always in the skill index, so it must read as a trigger>
capability: <palette capability>   # NEW
inputs: <what it needs>            # NEW
outputs: <what it produces>        # NEW
standard: <named source>          # NEW
```
**Body sections** (in order):
1. **When to use** — the trigger (the router/orchestrator loads the body only on demand — O1).
2. **Method** — the opinionated, numbered, **sourced** procedure. The domain standard lives here.
3. **Output contract** — the exact artifact + where it is written (e.g. `specs/<feature>.md` with
   sections X/Y/Z), and how the agent reports (granular writes; `::spectoflow role=… kind=… msg=…`).
4. **Quality bar** — a checkable gate: what "good" looks like, as a checklist.
5. **References** — the cited sources.

Skills are lazy-loaded, so rich bodies are fine and do not bloat the always-on core.

## Per-component standard map (the cited default to research & encode)

| Capability | Agent | Skill(s) | Default standard (source) |
|---|---|---|---|
| intake | product-manager | brainstorm | structured product discovery (problem / users / constraints / risks) |
| analysis | business-analyst | analyze-requirements | testable acceptance criteria, **Given/When/Then (BDD)**, edge-case taxonomy |
| analysis | business-analyst | write-spec | spec template (purpose / requirements / scenarios / out-of-scope), spec-kit / OpenSpec conventions |
| architecture | architect | write-adr | **C4** model views + **ADR** (MADR / Nygard) |
| planning | tech-lead | write-plan | **INVEST** task slicing, dependency-ordered decomposition |
| implementation | developer | implement (NEW) | small commits, **Conventional Commits**, YAGNI / DRY, boy-scout rule |
| testing | qa-engineer | write-tests | **TDD** red-green-refactor, xUnit patterns, one behaviour per test |
| testing | qa-engineer | write-e2e-tests (NEW) | **Playwright** — role-based locators, web-first assertions, fixtures, trace-on-retry, no hard waits |
| quality | code-reviewer | code-review | concrete review rubric (correctness / tests / readability / security) + severity levels |
| security | security-engineer | security-review | **OWASP ASVS** + **Top 10**, scoped to the diff |
| design | ux-designer | — | (agent only for now; a design skill is out of scope this pass) |
| operations | devops | — | (see capability fix below) |

## E2E strategy (answers the cross-agent question)

Two distinct activities, kept separate:
- **The durable E2E suite** — committed, re-runnable, CI, **agent-agnostic** → **Playwright is the
  standard** the `write-e2e-tests` skill produces. The test files are durable artifacts, like
  `specs/`/`plans/`. Any agent can write and run them.
- **Live/exploratory verification** during dev → use the agent's **native** browser tooling (e.g.
  Claude Code's Chrome extension), **falling back to Playwright headed / codegen** when it is absent
  or errors. This fallback belongs to *verification*, never to the committed suite.

Zero-dep is preserved: the skill is markdown instructions; Playwright is a dependency of the **user's
project** only when the E2E step runs — never of spectoflow.

## Capability-resolution fix (`implementation` ambiguity)

Today both `developer` and `devops` declare `capability: implementation`, so
`orchestrator.resolveStep` (first front-matter match) is `readdir`-order dependent. Fix by data, not
code: **`devops` → `capability: operations`**; add `operations` to the `capabilities.md` palette (and
the project-type rows where infra/ops applies). `developer` keeps `implementation` → the `Develop`
step resolves deterministically. `resolveStep` is unchanged. (A `priority:` front-matter tie-break is
the fallback if two agents must ever share a capability.)

## Workflow (how we build it)

1. Write this design + the two gold-standard templates (a short `references` note the builders reuse).
2. **Pilot:** upgrade `security-engineer` (agent) + `security-review` (skill) to the gold standard,
   with real OWASP ASVS/Top-10 research and citations. Review it; confirm the shape and the
   research-and-cite pattern hold. Adjust the templates if the pilot exposes gaps.
3. **Batches by capability** (each a coherent, reviewable unit; **subagent-driven** like the
   orchestrator build, with live research per component):
   - testing (qa-engineer, write-tests, write-e2e-tests)
   - analysis (business-analyst, analyze-requirements, write-spec)
   - implementation (developer, implement) + the `operations`/devops capability fix
   - architecture + planning (architect/write-adr, tech-lead/write-plan)
   - quality + intake + design (code-reviewer/code-review, product-manager/brainstorm, ux-designer)
4. Each batch: research → write to the gold standard → review (spec + quality) → commit.

## Constraints (must hold)

- **Machine-readable front-matter intact** — never break `name`/`capability`/`uses`; only add keys.
- **Lazy-loading (O1)** — the always-on core stays lean; rich content lives in on-demand skill bodies.
- **Zero runtime dependencies** for the framework; everything markdown. Playwright etc. are
  user-project deps only.
- **English** content (output language stays `config.language`).
- **Cite sources** in-file; keep each file self-contained and readable.

## Out of scope (this pass)

Rethinking which agents/capabilities exist (casting); a design/UX skill; the dashboard design pass;
turning skills into executable code. Those are separate efforts.

## Resolved decisions (from review)

- **O1 → RESOLVED: add the `operations` capability.** `devops` becomes `capability: operations`
  (data-only, no `resolveStep` change); `operations` is added to the `capabilities.md` palette and the
  infra/ops project-type rows. `developer` alone holds `implementation`.
- **O2 → RESOLVED: split unit vs E2E.** `write-tests` stays unit-only; a new `write-e2e-tests`
  (Playwright) is added; the workflow's Integration/End-to-end steps annotate `skill:write-e2e-tests`.
- **O3 → RESOLVED: no hard cap.** Skill bodies may be as long as needed (lazy-loaded), but each stays
  a *procedure + checklist + references*, never a tutorial — the reviewer flags any that reads like one.
