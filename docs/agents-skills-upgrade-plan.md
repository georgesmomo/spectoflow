# Agents & Skills Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise every persona (`.spectoflow/agents/*.md`) and procedure (`.spectoflow/skills/*/SKILL.md`) from a one-line stub to a best-in-class, domain-standard, **sourced** playbook — and fill the known roster gaps.

**Architecture:** A shared reference (`docs/agents-skills-standard.md`) defines the gold-standard shape of an agent file and a skill file. A pilot proves it. A `test/roster-integrity.test.js` guard keeps the roster machine-resolvable throughout. Then each capability is upgraded in a reviewed batch, with **live research** (context7 / WebSearch / WebFetch) of the domain standard per component, cited in the file.

**Tech Stack:** Markdown content (zero runtime deps); native `node:test` for the integrity guard; the framework's own front-matter conventions consumed by `templates/lib/store.js` (`readWorkflow`, `readAgents`) and `templates/dashboard/orchestrator.js` (`resolveStep`).

**Spec:** `docs/agents-skills-upgrade-design.md` (approved; O1–O3 resolved).

## Global Constraints

- **Content is inherently generative.** For each content component the implementer MUST do live research (context7 for library/tool docs — e.g. Playwright; WebSearch/WebFetch for standards — e.g. OWASP ASVS, MADR, C4, Conventional Commits, INVEST), then write to the gold standard and **cite the source in the file's References**. The plan pins the shape, the sources, and the acceptance bar — not the final prose.
- **Machine-readable front-matter MUST stay valid.** Never remove or rename `name`, `capability`, `uses`, `description` (agents) or `name`, `description` (skills). Only ADD keys. `templates/lib/store.js:readAgents` and `frontmatter` parse simple `key: value` and `uses: [a, b]` — keep that exact YAML-ish shape (no nested blocks, no multi-line values in front-matter).
- **Zero runtime dependencies** for the framework — everything is markdown. Playwright and any other tool named in a skill is a dependency of the USER's project only, invoked when that step runs; never added to spectoflow's package.json.
- **English** content; comments/instructions in English. (Output language stays `config.language`.)
- **Lazy-loading (O1):** rich content lives in skill bodies (loaded on demand); do not bloat `AGENTS.md` (the always-on core). Agent files stay persona-focused; depth lives in the skills they `uses`.
- **Semver:** feature → minor. Ships as **0.10.0**.

### GOLD STANDARD — agent file (`.spectoflow/agents/<slug>.md`)

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

### GOLD STANDARD — skill file (`.spectoflow/skills/<slug>/SKILL.md`)

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

### Per-component source map (the cited default to research & encode)

| Capability | Agent | Skill(s) | Source(s) to research & cite |
|---|---|---|---|
| security | security-engineer | security-review | OWASP ASVS + OWASP Top 10 |
| testing | qa-engineer | write-tests | TDD (Beck) red-green-refactor; xUnit Test Patterns; one-behaviour-per-test |
| testing | qa-engineer | write-e2e-tests (NEW) | Playwright docs (locators, web-first assertions, fixtures, trace, projects) via context7 |
| analysis | business-analyst | analyze-requirements | BDD Given/When/Then (Gherkin); acceptance-criteria + edge-case taxonomy |
| analysis | business-analyst | write-spec | spec-kit / OpenSpec spec conventions (purpose / requirements / scenarios / out-of-scope) |
| implementation | developer | implement (NEW) | Conventional Commits; YAGNI/DRY; small-commit / trunk hygiene; boy-scout rule |
| architecture | architect | write-adr | C4 model; ADR (MADR / Michael Nygard) |
| planning | tech-lead | write-plan | INVEST; dependency-ordered decomposition |
| quality | code-reviewer | code-review | a concrete review rubric (correctness/tests/readability/security) + severity levels; Google eng-practices code review |
| intake | product-manager | brainstorm | product discovery (problem / users / constraints / risks / success metric) |
| design/operations | ux-designer / devops | — | persona-only this pass (devops capability → `operations`) |

---

### Task 1 (PILOT): Gold-standard reference + security-engineer & security-review

**Files:**
- Create: `docs/agents-skills-standard.md` (the two gold-standard shapes above, verbatim, as the builders' reusable reference)
- Modify: `templates/agents/security-engineer.md`
- Modify: `templates/skills/security-review/SKILL.md`

**Interfaces:**
- Produces: the reference doc other tasks cite; the proven shape of an upgraded agent + skill.

- [ ] **Step 1: Write the reference doc**

Create `docs/agents-skills-standard.md` containing the two "GOLD STANDARD" blocks from this plan's Global Constraints verbatim (agent shape + skill shape + front-matter rules), plus a 3-line preamble ("Every agent/skill file conforms to these shapes; cite sources in References; keep front-matter machine-valid").

- [ ] **Step 2: Research OWASP**

Use WebSearch + WebFetch to gather the current OWASP ASVS (verification requirements, level structure) and OWASP Top 10 (2021) categories. Note exact titles/URLs for citation.

- [ ] **Step 3: Rewrite `security-engineer.md` to the gold standard**

Keep front-matter keys `name/title/capability/uses/description`; add `standards: [OWASP ASVS, OWASP Top 10]`. Fill the 6 body sections. Operating standards must name ASVS/Top-10 and how the persona applies them to a diff; Definition of done = a security sign-off with findings by severity; Guardrails tie to `policy.md` (never approve a security-sensitive change without explicit human approval).

- [ ] **Step 4: Rewrite `security-review/SKILL.md` to the gold standard**

Front-matter add `capability: security`, `inputs`, `outputs`, `standard: OWASP ASVS + Top 10`. Method = a scoped review procedure over the change (authn/authz, secrets, input validation, injection, sensitive data, dependencies) mapped to ASVS/Top-10; Output contract = findings written as task comments / a report with severity, reported via `::spectoflow role=security kind=… msg=…`; Quality bar = a checklist (each Top-10 category considered or explicitly N/A); References cite the OWASP sources.

- [ ] **Step 5: Structural self-check**

Confirm both files: front-matter still parses (keys intact, `uses` still a flat list), all required `##` headings present, References cite the researched sources. Run `node -e "const s=require('./templates/lib/store'); console.log(s.readAgents(process.cwd().replace(/[^]*$/,'.')) && 'front-matter OK')"` is not reliable here — instead just verify by eye + Task 2's guard will enforce it.

- [ ] **Step 6: Commit**

```bash
git add docs/agents-skills-standard.md templates/agents/security-engineer.md templates/skills/security-review/SKILL.md
git commit -m "feat(roster): gold-standard reference + upgrade security-engineer & security-review (OWASP)"
```

> Review focus for this task: does the shape work in practice; is the OWASP content real, current, and cited (not generic); is front-matter still machine-valid. If the pilot exposes a gap in the gold-standard shape, fix `docs/agents-skills-standard.md` and this plan's Global Constraints before proceeding.

---

### Task 2: Capability fix + roster-integrity guard

**Files:**
- Modify: `templates/agents/devops.md` (capability → operations)
- Modify: `templates/capabilities.md` (add `operations` to palette + infra row)
- Create: `test/roster-integrity.test.js`

**Interfaces:**
- Produces: a deterministic roster (only `developer` holds `implementation`) and a test asserting the roster stays machine-resolvable. The guard is kept green by every later task.

- [ ] **Step 1: Fix the capability collision (so the guard is green on commit)**

In `templates/agents/devops.md` front-matter: change `capability: implementation` → `capability: operations`. In `templates/capabilities.md`: add `operations` to the `Palette:` line, and to the `infra / IaC` row's active capabilities. Keep everything else. (Now no capability is shared by two agents.)

- [ ] **Step 2: Write the guard test**

```js
// test/roster-integrity.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TPL = path.resolve(__dirname, '..', 'templates');
// Read the kit templates directly (they ARE an installed project's .spectoflow layout).
function agents() {
  return fs.readdirSync(path.join(TPL, 'agents')).filter(f => f.endsWith('.md')).map(f => {
    const text = fs.readFileSync(path.join(TPL, 'agents', f), 'utf8');
    const g = (k) => (text.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1];
    const uses = (g('uses') || '[]').replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
    return { file: f, capability: g('capability'), uses };
  });
}
const skillExists = (slug) => fs.existsSync(path.join(TPL, 'skills', slug, 'SKILL.md'));
function palette() {
  const m = fs.readFileSync(path.join(TPL, 'capabilities.md'), 'utf8').match(/Palette:\s*(.+)/);
  return m ? m[1].split('·').map(s => s.replace(/[^a-z]/gi, '').trim()).filter(Boolean) : [];
}
function workflowSteps() {
  const steps = [];
  fs.readFileSync(path.join(TPL, 'workflow.md'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*- \[[ xX]\]\s+(.*?)\s*$/); if (!m) return;
    const ann = m[1].match(/\{([^}]*)\}/);
    steps.push({
      cap: (ann && (ann[1].match(/cap:(\S+)/) || [])[1]) || null,
      skill: (ann && (ann[1].match(/skill:(\S+)/) || [])[1]) || null,
    });
  });
  return steps;
}

test('every agent capability is in the capabilities palette', () => {
  const pal = palette();
  for (const a of agents()) if (a.capability) assert.ok(pal.includes(a.capability), `${a.file}: capability "${a.capability}" not in palette [${pal}]`);
});
test('every skill an agent uses exists on disk', () => {
  for (const a of agents()) for (const u of a.uses) assert.ok(skillExists(u), `${a.file}: uses missing skill "${u}"`);
});
test('every workflow step resolves to an existing agent + skill', () => {
  const ag = agents();
  for (const s of workflowSteps()) {
    if (!s.cap) continue; // un-annotated legacy line
    assert.ok(ag.some(a => a.capability === s.cap), `workflow step cap "${s.cap}" has no agent`);
    if (s.skill) assert.ok(skillExists(s.skill), `workflow step skill "${s.skill}" missing`);
  }
});
test('no capability is shared by two agents without a priority tie-break', () => {
  const byCap = {};
  for (const a of agents()) if (a.capability) (byCap[a.capability] = byCap[a.capability] || []).push(a.file);
  for (const [cap, files] of Object.entries(byCap)) if (files.length > 1)
    for (const f of files)
      assert.match(fs.readFileSync(path.join(TPL, 'agents', f), 'utf8'), /^priority:\s*\d+/m,
        `capability "${cap}" shared by ${files} but ${f} has no priority`);
});
```

- [ ] **Step 3: Run — all four green**

Run: `node --test test/roster-integrity.test.js` → Expected: PASS (all four; the collision is fixed in Step 1). Then `npm test` (full suite green).

- [ ] **Step 4: Commit**

```bash
git add templates/agents/devops.md templates/capabilities.md test/roster-integrity.test.js
git commit -m "feat(roster): operations capability (devops) + roster-integrity guard"
```

---

### Task 3: New skills (implement, write-e2e-tests) + workflow annotations

**Files:**
- Create: `templates/skills/implement/SKILL.md`
- Create: `templates/skills/write-e2e-tests/SKILL.md`
- Modify: `templates/agents/developer.md` (`uses:` add implement; keep `capability: implementation`)
- Modify: `templates/agents/qa-engineer.md` (`uses:` add write-e2e-tests)
- Modify: `templates/workflow.md` (Develop → `{cap:implementation skill:implement}`; Integration/E2E → `skill:write-e2e-tests`)

**Interfaces:**
- Consumes: the `operations` fix + guard from Task 2.
- Produces: the two new gold-standard skills wired into the roster + workflow; the guard stays green.

- [ ] **Step 1: Create the `implement` skill (gold standard)**

Research Conventional Commits + small-commit/trunk hygiene (WebSearch/WebFetch). Create `templates/skills/implement/SKILL.md` per the skill gold standard: front-matter `name: implement`, `capability: implementation`, `standard: Conventional Commits + YAGNI/DRY`; Method = implement to the plan with small, conventional commits, red-green if a test exists, boy-scout rule; Output contract = code + updated `plans/*.md` task status via granular writes + `::spectoflow role=implementation …`; Quality bar checklist; References.

- [ ] **Step 2: Create the `write-e2e-tests` skill (gold standard, Playwright)**

Use context7 to fetch current Playwright guidance (locators/getByRole, web-first assertions/expect, fixtures, `projects`, trace-on-first-retry, avoiding `waitForTimeout`). Create `templates/skills/write-e2e-tests/SKILL.md`: front-matter `capability: testing`, `standard: Playwright`; Method = author Playwright specs following those practices; Output contract = committed `tests/e2e/*.spec.ts` (durable, CI-runnable) + a note that LIVE verification uses the agent's native browser tooling with a Playwright-headed fallback; Quality bar; References (Playwright docs). Explicitly state Playwright is a user-project dev-dependency, never a spectoflow dependency.

- [ ] **Step 3: Wire uses + workflow**

`developer.md`: `uses: [implement, write-tests, code-review]`. `qa-engineer.md`: `uses: [write-tests, write-e2e-tests]`. In `templates/workflow.md`: `Develop {cap:implementation skill:implement}`; `Integration tests (optional) {cap:testing skill:write-e2e-tests}`; `End-to-end tests (optional) {cap:testing skill:write-e2e-tests}`.

- [ ] **Step 4: Run the integrity guard — all four tests stay green**

Run: `node --test test/roster-integrity.test.js` → Expected: PASS (all four). Then `npm test` (full suite green — the workflow-parse and orchestrator tests must still pass with the new annotations).

- [ ] **Step 5: Commit**

```bash
git add templates/skills/implement templates/skills/write-e2e-tests templates/agents/developer.md templates/agents/qa-engineer.md templates/workflow.md
git commit -m "feat(roster): implement & write-e2e-tests skills + workflow wiring"
```

---

### Task 4: Testing capability — qa-engineer + write-tests

**Files:** Modify `templates/agents/qa-engineer.md`, `templates/skills/write-tests/SKILL.md`

- [ ] **Step 1: Research** TDD (Beck red-green-refactor), xUnit Test Patterns, test naming / one-behaviour-per-test (WebSearch/WebFetch).
- [ ] **Step 2: Upgrade `qa-engineer.md`** to the agent gold standard (`standards: [TDD, xUnit patterns]`; keep `uses: [write-tests, write-e2e-tests]`). Mandate/Operating standards/DoD (coverage of behaviours + edge cases, tests green before done)/Handoff/Guardrails/References.
- [ ] **Step 3: Upgrade `write-tests/SKILL.md`** to the skill gold standard, unit-scoped: Method = red-green-refactor, one behaviour per test, arrange/act/assert, no logic in tests; Output contract = test files + `::spectoflow role=testing …`; Quality bar; References cite Beck/xUnit.
- [ ] **Step 4: Verify** `node --test test/roster-integrity.test.js` green; `npm test` green.
- [ ] **Step 5: Commit** — `feat(roster): upgrade qa-engineer + write-tests (TDD/xUnit)`

---

### Task 5: Analysis capability — business-analyst + analyze-requirements + write-spec

**Files:** Modify `templates/agents/business-analyst.md`, `templates/skills/analyze-requirements/SKILL.md`, `templates/skills/write-spec/SKILL.md`

- [ ] **Step 1: Research** BDD Given/When/Then (Gherkin), acceptance-criteria patterns, edge-case taxonomies; spec-kit / OpenSpec spec structure (WebSearch/WebFetch; context7 if a library).
- [ ] **Step 2: Upgrade `business-analyst.md`** (`standards: [BDD, acceptance criteria]`; `uses: [analyze-requirements, write-spec]` — add write-spec to uses so the Spec step's skill has an owning persona).
- [ ] **Step 3: Upgrade `analyze-requirements/SKILL.md`** — Method = turn need into testable acceptance criteria in Given/When/Then + an edge-case checklist; Output/Quality bar/References.
- [ ] **Step 4: Upgrade `write-spec/SKILL.md`** — Method = the spec template (purpose / requirements / scenarios / out-of-scope / open questions); Output contract = `specs/<feature>.md` with those sections, sign-off loop; References cite spec-kit/OpenSpec.
- [ ] **Step 5: Verify** integrity + `npm test` green. **Commit** — `feat(roster): upgrade business-analyst + analyze-requirements + write-spec (BDD, spec template)`

---

### Task 6: Implementation persona — developer

**Files:** Modify `templates/agents/developer.md`

- [ ] **Step 1: Research** Conventional Commits, YAGNI/DRY, boy-scout rule, small-commit hygiene (if not already gathered in Task 3).
- [ ] **Step 2: Upgrade `developer.md`** to the agent gold standard (`standards: [TDD, Conventional Commits, YAGNI/DRY]`; `uses: [implement, write-tests, code-review]`). Operating standards = ships production-grade code red-green-refactor, small conventional commits; DoD = tests green + reviewed + task status updated; Guardrails (no unreviewed prod-affecting change; policy gates). References.
- [ ] **Step 3: Verify** integrity + `npm test` green. **Commit** — `feat(roster): upgrade developer persona (TDD, Conventional Commits, YAGNI)`

---

### Task 7: Architecture + Planning — architect/write-adr + tech-lead/write-plan

**Files:** Modify `templates/agents/architect.md`, `templates/skills/write-adr/SKILL.md`, `templates/agents/tech-lead.md`, `templates/skills/write-plan/SKILL.md`

- [ ] **Step 1: Research** C4 model, ADR (MADR + Nygard); INVEST + dependency-ordered decomposition (WebSearch/WebFetch).
- [ ] **Step 2: Upgrade `architect.md`** (`standards: [C4, ADR]`) and **`write-adr/SKILL.md`** (Method = capture context/decision/consequences in MADR/Nygard format; Output = an ADR file; C4 views for structure; References).
- [ ] **Step 3: Upgrade `tech-lead.md`** (`standards: [INVEST]`) and **`write-plan/SKILL.md`** (Method = INVEST slicing, dependency ordering, checkbox tasks in `plans/*.md`; Output contract = `plans/<feature>.md` with the task convention; References).
- [ ] **Step 4: Verify** integrity + `npm test` green. **Commit** — `feat(roster): upgrade architect/write-adr (C4/ADR) + tech-lead/write-plan (INVEST)`

---

### Task 8: Quality + Intake + Design — code-reviewer/code-review + product-manager/brainstorm + ux-designer

**Files:** Modify `templates/agents/code-reviewer.md`, `templates/skills/code-review/SKILL.md`, `templates/agents/product-manager.md`, `templates/skills/brainstorm/SKILL.md`, `templates/agents/ux-designer.md`

- [ ] **Step 1: Research** a concrete code-review rubric + severity levels (e.g. Google engineering-practices code review); product discovery framing (problem/users/constraints/risks/success metric) (WebSearch/WebFetch).
- [ ] **Step 2: Upgrade `code-reviewer.md`** (`standards: [review rubric]`) and **`code-review/SKILL.md`** (Method = review against requirements across correctness/tests/readability/security with severity levels; Output = findings with severity + file:line; Quality bar; References).
- [ ] **Step 3: Upgrade `product-manager.md`** (`standards: [product discovery]`) and **`brainstorm/SKILL.md`** (Method = frame problem/users/scope/out-of-scope/risks/success metric before solutions; Output = a framed brief feeding analysis; References).
- [ ] **Step 4: Upgrade `ux-designer.md`** to the agent gold standard (persona only; `standards` = usability heuristics e.g. Nielsen; no skill this pass; DoD/Handoff/Guardrails).
- [ ] **Step 5: Verify** integrity + `npm test` green. **Commit** — `feat(roster): upgrade code-reviewer/code-review, product-manager/brainstorm, ux-designer`

---

### Task 9: Docs + version

**Files:** Modify `docs/DECISIONS.md` (D21), `docs/ROADMAP.md`, `CLAUDE.md`, `README.md`, `package.json`, `docs/agents-skills-upgrade-design.md` (status → implemented)

- [ ] **Step 1: DECISIONS D21** (French, matching that file) — record: agents/skills raised to gold-standard sourced playbooks; the two gold-standard shapes (ref `docs/agents-skills-standard.md`); the per-component standards; the `operations` capability + `implement` & `write-e2e-tests` skills; the E2E strategy (Playwright durable + native-with-fallback live verify); the roster-integrity guard. Reference `docs/agents-skills-upgrade-design.md`.
- [ ] **Step 2: ROADMAP** — add a Done entry **0.10** summarising the upgrade; note the remaining "Design pass" item.
- [ ] **Step 3: CLAUDE.md** — bump "What exists (vX)" to v0.10.0; note that agents/skills are now sourced playbooks and `docs/agents-skills-standard.md` defines their shape.
- [ ] **Step 4: README.md** — header → v0.10; one line: agents & skills follow domain standards (TDD, OWASP, C4/ADR, Playwright E2E, …).
- [ ] **Step 5: package.json** → `"version": "0.10.0"`; set `docs/agents-skills-upgrade-design.md` status to **implemented**.
- [ ] **Step 6: Run + commit** — `npm test` green; `git add -A`; commit `spectoflow 0.10.0 — agents & skills upgraded to domain standards`.

---

## Self-Review

**Spec coverage:** gold-standard shapes → Global Constraints + Task 1 reference doc. Strong+sourced+current → every content task's research step + References requirement. Upgrade 18 + gaps → Tasks 1,4,5,6,7,8 (all 10 agents + 8 skills) + new implement/write-e2e-tests (Task 3). Capability fix (`operations`) → Task 2 (self-guarded by the integrity test in the same commit). E2E strategy → Task 3 write-e2e-tests + its live-verify note. Pilot security → Task 1. Constraints (front-matter, zero-dep, English, lazy) → Global Constraints + integrity guard.

**Placeholder scan:** the integrity test is verbatim code. Content tasks are intentionally generative (research → write to a pinned shape + pinned sources + acceptance bar); this is not a placeholder but the correct spec for a research-and-write deliverable — the reviewer judges content quality against the named source.

**Type/roster consistency:** capabilities used across files — intake, analysis, architecture, planning, implementation, testing, security, quality, design, **operations** — all must be in `capabilities.md`'s palette after Task 3 (asserted by the integrity guard). `uses:` lists reference only skills that exist after Task 3 (implement, write-e2e-tests created there; asserted by the guard). Workflow annotations reference caps/skills that resolve (asserted by the guard).

**Note on Task 2:** the capability collision (developer/devops both `implementation`) is fixed in Task 2 Step 1 *before* the guard test is written, so all four assertions are green on commit and the suite is never red between tasks.

**Capability fix guarded:** Task 2's first assertion (capability ∈ palette) only holds after `operations` is added to the palette in Task 2 Step 1 — same task, same commit.
