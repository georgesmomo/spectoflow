# Workflow fitted to the project — design

**Status:** approved by the user and implemented, 2026-09-17 (v0.31.0, DECISIONS D75). Added during
implementation: the same rule, in three lines, in the root entry files — a live test showed Claude Code, on a
direct "just do it" request, wrote the code without enabling *Develop* until the reminder was there.

## Problem

`init` copies the same `workflow.md` into every project: Brainstorm, Analysis, Spec, Plan, Develop, Unit tests
and Review on, integration and E2E tests off. Real case: a project still in analysis/design got *Unit tests*,
*Develop* and *Review* enabled. `capabilities.md` describes an adaptation per project type, but nothing applies
it.

Two different things drive which steps make sense:

- the **project type** (app, infra, data) — which steps will ever apply; stable;
- the **phase** (design before any code, then build) — which steps apply *now*; it changes, so a step switched
  off at `init` must be able to come back.

## Decisions taken with the user

1. **Both:** `init` runs a deterministic detection (instant, no agent), then the agent refines it with the user
   at the first session (it can tell, from the docs, that a project with a prototype is still in design).
2. **When the project moves on:** by default the agent **proposes** enabling a step a request needs; a project
   setting lets it **enable the step itself** (and say so).
3. **Existing projects:** a re-analysis the user applies or not — `spectoflow workflow suggest` and a button in
   the Workflow tab. `workflow.md` is never changed without the user (or the setting).
4. The user can still enable or disable any step by hand, as today.

## Detection (`lib/workflow-detect.js`, zero dependency, pure)

A bounded scan of the project (depth ≤ 4, ≤ 5,000 entries; skips `.git`, `node_modules`, `.spectoflow`,
`vendor`, `dist`, `build`, `target`, `.venv`/`venv`, `__pycache__`, `coverage`, `.next`), collecting:

| Signal | Counts as present when |
|---|---|
| code | a source file (`.js .ts .tsx .jsx .mjs .cjs .py .go .rs .java .kt .cs .rb .php .swift .c .cpp .h .vue .svelte .dart .scala .ex`), or a manifest (`package.json` with dependencies or a real script, `pyproject.toml`, `setup.py`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle(.kts)`, `*.csproj`, `Gemfile`, `composer.json`, `pubspec.yaml`, `mix.exs`) |
| unit tests | test files (`*.test.*`, `*_test.go`, `test_*.py`, `*Test.java`, code under `test/`, `tests/`, `__tests__/`) or a test runner in `package.json` (a `test` script other than npm's placeholder) |
| E2E | `playwright.config.*`, `cypress.config.*`, `cypress.json`, an `e2e/` folder with code, or a `@playwright/test` / `cypress` / `puppeteer` dependency |
| integration tests | an `integration/` folder with code under a test folder |
| infra | `*.tf`, `Pulumi.yaml`, `Chart.yaml`, `kustomization.yaml`, `ansible.cfg` — with little application code (< 10 source files) |
| data | `dbt_project.yml`, `*.ipynb`, an Airflow `dags/` folder |

→ **type** `infra` / `data` / `app` (the default — a project with only documents is not guessed to be "content":
that is exactly the kind of call the agent makes better), and **phase** `design` (no code) or `build`.

| Step | design (no code) | build — app | build — infra | build — data |
|---|---|---|---|---|
| Brainstorm, Analysis, Spec, Plan | on | on | on | on |
| Develop | **off** — nothing to build yet | on | on | on |
| Unit tests | **off** | on | on only if tests exist | on (data quality) |
| Integration tests | off | on only if integration tests exist | same | same |
| End-to-end tests | off | on only if an E2E setup exists | off | off |
| Review | **off** — no code to review | on | on | on |

Every decision carries a reason code (e.g. `design-no-code`, `e2e-setup`), shown to the user. Steps the user
added to `workflow.md` themselves are never touched. `config.json → projectType` is set from the detection.

## At `init`

Only when `init` just created `workflow.md` (an existing one is never touched): apply the detection, set
`projectType`, set `workflowReview: "pending"`, and print what was switched off and why:

```
! Workflow fitted to the project (design phase — no code yet): Develop, Unit tests, Review off.
  Your agent will review it with you; change it anytime in the dashboard's Workflow tab.
```

The hub's *Add project* auto-init goes through the same `runInit`, so it gets it too.

## The agent refines it, and keeps it in step (`templates/SPECTOFLOW.md` + root entry files)

- **First session** (`workflowReview` is `"pending"`): look at the project (docs, specs, plans, code maturity),
  compare with `workflow.md`, and propose the changes that fit, with a one-line reason each; apply what the user
  accepts; then set `workflowReview` to `"done"`.
- **As the project moves on:** when a request needs a step that is disabled (asked to implement while *Develop*
  is off; writing code while *Unit tests* is off…):
  - `workflowAutoEnable: false` (default) → say so and ask before doing that part;
  - `workflowAutoEnable: true` → enable the step in `workflow.md` and tell the user.
- The setting only ever lets the agent **enable** a step. **Disabling** always goes through the user.

## The setting

`workflowAutoEnable` in the project's `config.json`, default `false`. In the dashboard: Personalize → *Agent &
automation* → "Let the agent enable workflow steps when needed" (whitelisted in `writeConfig`).

## Re-analysis for existing projects

- **CLI:** `spectoflow workflow suggest` prints, per step, current → suggested with the reason, and the detected
  type/phase; `spectoflow workflow suggest --apply` applies them.
- **Dashboard:** Workflow tab → **Analyze the project** → a panel listing each proposed change with its reason,
  pre-ticked; **Apply** writes only the ticked ones; "Your workflow already matches the project" when nothing
  differs.
- **API:** `GET /api/workflow/suggest` → `{ projectType, phase, changes: [{ name, from, to, reason }] }` ·
  `POST /api/workflow/apply` `{ names }` (recomputed server-side, only the listed steps written). Online: `suggest`
  needs `project.read`, `apply` needs `project.write` (added to the relay's `OP_PERMISSIONS`).
- Writes stay granular: only the checkbox of a changed line.

## Out of scope

- Detecting "content/study" projects automatically (left to the agent).
- Changing `update`: it never touches `workflow.md` (user-owned); re-analysis is the path for existing projects.

## Tests

- Detection on fixture trees: empty, documents only, Node app with and without Jest, npm placeholder test
  script, Playwright/Cypress setups, integration folder, Go/Python projects, Terraform, dbt/notebooks,
  `node_modules` ignored, scan bounds.
- Writer: only checkboxes change, annotations and user-added steps untouched.
- `init`: empty folder → design; existing code → build; pre-existing `workflow.md` untouched; config fields set.
- CLI `workflow suggest [--apply]`; ops `workflow.suggest`/`workflow.apply`; relay permissions.
- Real browser QA of the Workflow tab panel and the Personalize toggle.
