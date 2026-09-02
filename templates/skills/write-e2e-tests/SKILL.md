---
name: write-e2e-tests
description: Author durable, CI-runnable Playwright end-to-end tests — run headed, directly in the browser, by default; falls back to MCP, native browser tooling or headless, always telling the user why.
capability: testing
inputs: The user-visible flow(s) under test (spec acceptance criteria or a plan task), the running app under test, and its existing `tests/e2e/` suite and Playwright config if any.
outputs: Committed Playwright spec files under `tests/e2e/*.spec.ts`, runnable in CI.
standard: Playwright
---
# Write end-to-end tests

Author a durable, CI-runnable Playwright suite that exercises real user-visible flows — the committed
artifact the project can re-run forever, distinct from one-off live/exploratory checks.

## When to use
When the workflow reaches an Integration or End-to-end tests step for a flow that spans multiple pages,
services, or a full user journey, and the result needs to live in the repo and run again in CI on every
change — not just be eyeballed once.

## Method
Practices below are current Playwright guidance (see References for exact source pages).
1. **Test user-visible behavior, not implementation.** Assert on what an end user actually sees and does
   — text, roles, visible state — never internal state or private methods. This keeps tests resilient
   to refactors.
2. **Locate elements the way a user would find them.** Prefer `page.getByRole()`, `getByText()`,
   `getByLabel()`, `getByTestId()` over CSS/XPath selectors — user-facing locators survive DOM churn that
   breaks structural selectors. Reserve `getByTestId()` for elements with no meaningful role/text.
3. **Use web-first assertions, never manual polling.** Write `await expect(locator).toBeVisible()`,
   `.toHaveText(...)`, etc. — these auto-retry until the condition holds or the timeout expires. Never
   use `page.waitForTimeout()` in a committed test: it is a fixed sleep, is explicitly documented as
   debug-only, and is the single biggest source of flakiness. If a wait is genuinely needed, wait for a
   specific state/locator/response, never a clock duration.
4. **Lean on built-in test isolation.** Each `test()` gets a fresh `page` / `BrowserContext` for free —
   do not share mutable state between tests. For data that must be unique per run, use worker-scoped
   fixtures (e.g. keyed by `test.info().workerIndex`) rather than global setup that couples tests
   together.
5. **Extend fixtures instead of repeating setup.** When multiple specs need the same login, seeded data,
   or page object, define it once via `test.extend()` and consume it as a fixture parameter — do not
   copy-paste setup code across spec files.
6. **Configure `projects` for the matrix you actually need** (browsers, smoke vs. full suite, retries per
   project) in the project's `playwright.config.ts` — this skill authors specs against that config, and
   proposes config changes only when a task requires a new project/browser target.
7. **Turn on `trace: 'on-first-retry'`** (with `retries` set for CI) so a flaky/failing run leaves a
   debuggable trace without paying the cost of tracing every green run.
8. **Keep specs scoped to one flow each**, named for the behavior under test, and placed under
   `tests/e2e/*.spec.ts` in the user's project.

## Running the tests — headed, in the real browser, by default

**Default: Playwright lib, headed.** When this skill's own agent runs the suite — while authoring it,
verifying a flow, or investigating a failure — run it **directly in a visible browser window**:
`npx playwright test --headed`. Watching the browser act out the flow, rather than reading a bare
pass/fail line, is the whole point: it is how you (and the user, if watching) catch a flow that
"passes" for the wrong reason. This is the default **local run mode** — not a suggestion to try once
in a while.

**`--ui` mode for authoring and debugging.** Reach for `npx playwright test --ui` when writing a new
flow or chasing a failure: it steps through each action with time-travel, showing the DOM/network at
every point, and is the fastest way to build a flow interactively before locking it into a spec.

**CI stays headless — that is not a fallback, it is a different job.** The committed suite still runs
`npx playwright test` (no `--headed`) in the project's CI pipeline, per the Quality bar below: most CI
runners have no real display, and headless is faster and the industry-standard way to gate a merge.
The headed-by-default rule governs *this skill's own local run loop*, not the CI config it authors.

**Switch away from headed only when:**
- **the user explicitly asked for something else** (headless, `--ui`, a specific project/browser) —
  honor it, no need to justify; or
- **headed genuinely cannot run** (no display / sandboxed or remote environment / browsers not
  installed) — then step down the ladder below.

Whenever you step down for the second reason, **say so** — don't silently swap to a quieter mode:

```
::spectoflow role=testing kind=progress msg=Running headless — no display available in this environment (would default to --headed)
```

or, if it blocks the task entirely, raise it as a `need` (see Output contract).

### The fallback ladder
1. **Playwright lib, headed** (default) — `npx playwright test --headed`. Needs `@playwright/test` as
   the project's devDependency and `npx playwright install` for the browsers.
2. **Playwright lib, `--ui`** — for interactively authoring or debugging one flow before committing it.
3. **Playwright lib, headless** — same lib, just invisible: use when headed can't launch, or the user
   asked for headless. Still the lib — nothing else changes.
4. **Playwright MCP** (`@playwright/mcp`, wired into the project's `.mcp.json` by `spectoflow init`):
   the **agent-agnostic** way to drive a real browser and **generate** a spec from a recorded flow —
   reach for this to explore an unfamiliar app or reproduce a bug, or when the project has no
   Playwright lib set up yet. Works in any MCP client (Claude Code, Codex, Cursor, …); `npx` fetches
   the server on first use — nothing to install; if it isn't wired, add it or re-run `spectoflow init`
   (idempotent).
5. **The client's native browser tooling** (for Claude Code, the Chrome extension / `claude-in-chrome`)
   for live/exploratory checks when neither the local lib nor MCP is usable.
6. **If no browser can run at all** (restricted CI, no browsers installed, nothing wired): still
   **write the durable spec** (the artifact that lasts), then raise a `need` / Attention item with the
   exact commands to enable it — never report a pass you couldn't actually observe.

**Live/exploratory verification is not this skill's output.** Whichever rung you're on, the durable,
CI-runnable artifact this skill produces is always the Playwright **spec file**, not the live session —
the live browser (headed, `--ui`, MCP, or the extension) is only the means to write and check it.

**Playwright is a dependency of the user's project, never of spectoflow.** This skill authors tests
against whatever Playwright version the target project has (or proposes adding `@playwright/test` as a
project devDependency when none exists) — spectoflow itself stays at zero runtime dependencies per
`CLAUDE.md`.

## Output contract
- One or more `tests/e2e/*.spec.ts` files committed to the user's project, each runnable via the
  project's Playwright config (`npx playwright test`) in CI with no manual step.
- No `waitForTimeout` / fixed sleeps; assertions are web-first (`expect(locator)...`); locators are
  role/text/label/testid based, not brittle CSS/XPath.
- Progress and completion reported to the orchestrator and group chat with:

```
::spectoflow role=testing kind=progress msg=<flow name> — spec drafted
::spectoflow role=testing kind=result msg=<spec file> <pass|fail> (<n> tests)
::spectoflow role=testing kind=done msg=<flow name> e2e suite committed at tests/e2e/<file>
```
- Any step down the fallback ladder away from **Playwright lib, headed** (the default) is reported the
  moment it happens, with the reason — never a silent switch:

```
::spectoflow role=testing kind=progress msg=Running headless — <reason> (would default to --headed)
::spectoflow role=testing kind=progress msg=Falling back to Playwright MCP — <reason>
::spectoflow role=testing kind=need msg=No browser can run here — spec written, needs <exact command> to verify
```

## Quality bar
- [ ] Each spec asserts user-visible behavior (text/role/state), not internal implementation.
- [ ] Locators use `getByRole`/`getByText`/`getByLabel`/`getByTestId`, not CSS/XPath selectors.
- [ ] All assertions are web-first (`await expect(...)`); zero `waitForTimeout` calls in committed specs.
- [ ] Tests are isolated — no shared mutable state between tests; per-worker data via fixtures where
      parallel runs need unique data.
- [ ] Repeated setup (login, seed data, page objects) lives in a shared fixture, not copy-pasted.
- [ ] Suite is committed under `tests/e2e/` and runs headless in CI via the project's Playwright config.
- [ ] `trace: 'on-first-retry'` (or equivalent) is set so a CI failure is debuggable without tracing
      every run.
- [ ] No spectoflow file declares Playwright as a dependency — only the user project's `package.json`.
- [ ] The local run defaulted to **Playwright lib, headed** (`--headed`), not headless, unless the user
      asked otherwise or headed genuinely could not launch.
- [ ] Any step away from the headed default (headless, MCP, native browser tooling) was **announced**
      with its reason via the `::spectoflow` sentinel — never a silent switch.

## References
- Playwright — Best Practices — https://playwright.dev/docs/best-practices (test user-visible behavior;
  prefer user-facing locators over XPath/CSS; use web-first assertions).
- Playwright — Locators — https://playwright.dev/docs/locators (`getByRole`, `getByText`, `getByLabel`,
  `getByTestId`).
- Playwright — Auto-waiting / web-first assertions — https://playwright.dev/docs/actionability and
  https://playwright.dev/docs/api/class-frame (`waitForTimeout` documented as debug-only; never use in
  production tests).
- Playwright — Test fixtures — https://playwright.dev/docs/test-fixtures (`test.extend()`, worker-scoped
  fixtures for per-worker isolation).
- Playwright — Test isolation — https://playwright.dev/docs/writing-tests (each test gets its own
  `page`/`BrowserContext`).
- Playwright — Projects — https://playwright.dev/docs/test-projects (per-project browser/retry/file
  matching configuration).
- Playwright — Trace viewer — https://playwright.dev/docs/trace-viewer (`trace: 'on-first-retry'` for
  CI).
- Playwright — Running and debugging tests — https://playwright.dev/docs/running-tests (headed mode is
  the default way to watch a run locally).
- Playwright — UI Mode — https://playwright.dev/docs/test-ui-mode (`--ui`, time-travel debugging for
  authoring and chasing failures).
- Playwright MCP — https://github.com/microsoft/playwright-mcp (agent-driven browser automation and
  spec generation, agent-agnostic via MCP).
