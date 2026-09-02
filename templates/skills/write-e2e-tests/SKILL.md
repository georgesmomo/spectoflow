---
name: write-e2e-tests
description: Author durable, CI-runnable end-to-end tests with Playwright — locators over selectors, web-first assertions, no hard waits.
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

**Driving the browser (live repro + test generation) — use the best available, in this order:**
1. **Playwright MCP** (`@playwright/mcp`, wired into the project's `.mcp.json` by `spectoflow init`):
   the **agent-agnostic** way to drive a real browser and **generate** a spec from a recorded flow.
   Works in any MCP client (Claude Code, Codex, Cursor, …). `npx` fetches it on first use — nothing to
   install; if it isn't wired yet, add it or run `spectoflow init` again (idempotent).
2. **The client's native browser tooling** (for Claude Code, the Chrome extension / `claude-in-chrome`)
   for live/exploratory checks when MCP isn't wired.
3. **Local Playwright** — `npx playwright codegen` / headed mode for a quick, throwaway look;
   `npx playwright install` provides the browsers. Needs `@playwright/test` as the project's devDependency.
4. **If no browser can run at all** (restricted CI, no browsers installed): still **write the durable
   spec** (the artifact that lasts), then raise a `need` / Attention item with the exact commands to
   enable it — never report a pass you couldn't actually observe.

**Live/exploratory verification is not this skill's output.** Whichever rung above you're on, the
durable, CI-runnable artifact this skill produces is always the Playwright **spec file**, not the live
session — the live drive is only the means to write and check it.

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
