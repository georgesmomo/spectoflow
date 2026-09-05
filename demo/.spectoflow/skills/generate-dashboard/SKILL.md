---
name: generate-dashboard
description: Turn a description (or an auto-analysis) into a new custom dashboard page, as a declarative block spec that automatically matches every design the dashboard ships.
capability: customization
inputs: A description of what the dashboard should show (from the Customize page or chat), or a chosen candidate from propose-customizations; the project's specs/plans/code as source material.
outputs: A validated block-spec JSON file at .spectoflow/dashboards/<id>.json, live in the dashboard's nav on the next tick.
standard: declarative UI generation; Few's dashboard design principles
---
# Generate dashboard

Turn a described need into a new dashboard page for *this* project — added to the dashboard's own
navigation, rendered by the dashboard's own components, so it looks and behaves like it shipped with
the framework, not like a plugin bolted on.

## When to use

Whenever the user asks (from the Customize page, or directly in chat) to **add a dashboard** —
"I want a dashboard that shows my architecture", "add a page tracking API endpoint coverage", "show me
a dashboard of open security findings" — or when `propose-customizations` proposed a dashboard
candidate the user picked.

## Method

### 1. Never generate raw markup — only the declarative block vocabulary

The dashboard renders a custom page from a **JSON block spec**, using the exact same components the
built-in Board uses (`kpiCard`, `ocard`, `bars`, `donut`, a table builder, `mdLite` for markdown —
see `dashboard/public/app.js`). This is not a stylistic preference: it is the mechanism that makes the
result correct.

- Every block type is styled entirely through the active design's CSS custom properties
  (`--signal`, `--surface`, `--line`, `--s-done`, …). Nothing in a block spec ever sets a literal
  color, font, radius, or shadow.
- Because of that, a dashboard generated under one design (say, the default Spectral Console) renders
  correctly, unmodified, under every other shipped design (Orbit, Control Room, Obsidian Ops, Neon
  Command, Mission Control) — including any the user switches to **after** this dashboard was
  generated. There is nothing design-specific to regenerate or maintain.
- It is also the safety boundary: a block spec is data, never executable code, so nothing this skill
  writes can run arbitrary script in the user's dashboard.

**Never** write HTML, CSS, or JS for a custom dashboard, and never suggest doing so "for more
flexibility" — if the vocabulary genuinely can't express what's needed, say so explicitly (raise a
`need`) rather than stepping outside it.

### 2. Clarify before generating

A one-line ask ("add a dashboard for my project") is under-specified — you don't yet know what it
should show. Use `.spectoflow/skills/clarify`'s reflex: reflect the ask back, then ask one targeted
question at a time, each with a recommended default, until you know:
- **What it should show** (which data/content — an architecture overview, security posture, a
  specific spec's status, custom KPIs…).
- **Static or live.** Does it need to update as the project changes (task counts, phase progress), or
  is a point-in-time snapshot the actual intent (e.g. "show my chosen architecture" — a design
  decision doesn't change every time a task ships)?

Skip clarification only when the ask is already unambiguous, or the user picked a fully-specified
candidate from `propose-customizations`.

### 3. Gather the source material

Read what the dashboard needs to show from the project itself — `specs/*.md`, `plans/*.md`, ADRs,
`.spectoflow/agents/`, `.spectoflow/skills/`, or the codebase, as the ask requires. For "my
architecture", that typically means reading a spec/ADR that documents it and turning its structure
into `markdown` blocks (rendered as-is) plus maybe a `list`/`table` block for components or decisions.
For "task/security/coverage tracking", that typically means **live-bound** blocks reading the same
computed stats the Board already uses (see step 5).

### 4. Choose blocks — the vocabulary

Pick from exactly these block types (anything else is invisible to the renderer — the block schema
documented below is enforced by `spectoflow dashboard validate`):

| `type` | Shape | Use for |
|---|---|---|
| `markdown` | `{ type, content }` — content is the markdown text to render (via the dashboard's own light markdown renderer: headings, lists, `code`, **bold**) | Explaining, documenting, an architecture write-up, a decision summary |
| `kpi-row` | `{ type, items: [{ label, value?, bind?, sub?, color? }] }` | A row of big-number stat cards (mirrors the Board's own KPI row) |
| `chart-bars` | `{ type, title, rows: [{ label, pct?, bind?, sub? }] }` | Progress or comparison bars (mirrors "Phase progress") |
| `chart-donut` | `{ type, title, segments: [{ key, value?, bind?, colorVar }] }` | A status/category breakdown + legend (mirrors "Status distribution") — `colorVar` is a design token name, e.g. `--s-done`, never a literal color |
| `table` | `{ type, title, columns: [string], rows: [[cell, ...]] }` | Structured tabular data |
| `list` | `{ type, title, items: [string] }` | A flat bullet list |
| `stat-tile-row` | `{ type, items: [{ value?, bind?, label, sub? }] }` | Compact stat tiles (mirrors the Info tab's counts) |

Apply Stephen Few's information-dashboard discipline while choosing: **one dashboard, one purpose** —
don't cram unrelated concerns onto the same page just because they were mentioned in the same request
(propose two dashboards instead, or ask which matters more); prefer the plainest block that carries
the point (a `stat-tile-row` over a `chart-donut` when there's nothing to compare); keep it scannable
in one screen — 4-8 blocks is a healthy page, not 20.

### 5. Static content vs. live bindings

- **Static**: give the block its content directly (`content`, `rows`, `items`, `value` fields) —
  baked in at generation time. This is the default, and the right choice whenever the ask is about a
  point-in-time view (architecture, a decision record, a written summary).
- **Live**: instead of `value`/`pct`, set `bind` to a dotted path into the same stats object the Board
  already computes (`SpectoStats.stats(P)` — see `dashboard/public/stats.js`). Allowed roots only:
  `pct`, `done`, `total`, `byStatus` (per-status counts, e.g. `byStatus.done`), `phases` (per-phase
  `{title,done,total,pct}`), `toAsk` (tasks awaiting review), `running` (active agents/orchestration),
  `statuses` (the status key list). Anything else is rejected — there is no free-form expression, only
  this fixed, safe set of paths. Use `bind` whenever the ask is explicitly about *tracking* something
  over time ("show my task progress", "how many findings are open").

### 6. Pick an id, a title, an icon

- `id`: lowercase kebab-case, unique among existing custom dashboards (list
  `.spectoflow/dashboards/*.json` first) — this becomes the URL segment and the file name.
- `title`: short, a few words, shown as the nav tab label.
- `icon`: one of `board`, `requests`, `backlog`, `workflow`, `agents`, `chat`, `info`, `attention`,
  `settings` (the same set the rest of the dashboard uses — pick the closest match; default to `info`
  when nothing fits well). An icon outside this set fails validation.

### 7. Write and verify

Write the spec to `.spectoflow/dashboards/<id>.json` (pretty-printed, 2-space indent). Then
**verify it, don't assume it's valid** — run:
```
spectoflow dashboard validate .spectoflow/dashboards/<id>.json
```
(use `npx spectoflow …` if spectoflow isn't on PATH)

If the output shows errors, fix them and re-run before reporting done — a spec the dashboard's own
validator rejects is never a finished deliverable, it would simply be skipped and the user would see
nothing.

## Output contract

- One file: `.spectoflow/dashboards/<id>.json`, valid against the block schema
  (verified per step 7 with `spectoflow dashboard validate`, not assumed).
- Progress and completion reported to the orchestrator and group chat:

```
::spectoflow role=customization kind=progress msg=Drafting dashboard "<title>" — <n> blocks
::spectoflow role=customization kind=need msg=<what's missing and why generation can't proceed>
::spectoflow role=customization kind=done msg=Dashboard "<title>" added — open it from the nav (<id>)
```

## Quality bar

- [ ] Every block's `type` is one of the seven documented types — nothing else.
- [ ] No block, anywhere, sets a literal color/font/size — `colorVar` values are design-token names
      (`--s-*`, `--signal`, `--cool`, …), never hex/rgb literals.
- [ ] Every `bind` path's root is one of `pct`/`done`/`total`/`byStatus`/`phases`/`toAsk`/`running`/`statuses`.
- [ ] The generated file passes `validateSpec` — actually run, not assumed (step 7).
- [ ] `id` is unique, kebab-case; `icon` is one of the nine allowed keys.
- [ ] The page has a clear, single purpose — not an unrelated grab-bag of blocks.
- [ ] If the ask was ambiguous, it was clarified one question at a time before any file was written.

## References

- Stephen Few, *Information Dashboard Design* (O'Reilly/Analytics Press) — one purpose per dashboard,
  the plainest chart that carries the point, single-screen legibility.
  https://www.perceptualedge.com/library.php
- `spectoflow dashboard validate <file>` — the declarative block vocabulary's validator (in the
  spectoflow package; enforces the block schema and bind allow-list).
- `dashboard/public/stats.js` — the exact shape of the live stats object bindable via `bind`.
