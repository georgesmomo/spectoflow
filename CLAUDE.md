# CLAUDE.md — developing spectoflow

This repository is the **source of spectoflow**, an agent-agnostic spec-driven development (SDD)
framework with a real-time local control plane. This file orients you to **build spectoflow itself**
(it is not a spectoflow-managed project). Read `docs/` before making changes:
`docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (the full rationale, D1–D23), `docs/ROADMAP.md` (what's next).

## What exists (v0.23.4 — see DECISIONS D62)

Found in real use: adding a real host project (`georgesmomo.com`, an Astro site) to the hub showed
"dashboard code failed to load". Its own root `package.json` declares `"type":"module"`, and
`.spectoflow/` shipped no `package.json` of its own to reset that for its subtree — Node resolved
every vendored CommonJS file (`require()`/`module.exports`) as an ES module by walking up to the
host's setting, breaking `require()` with a misleading "Cannot find module" error unrelated to the
real cause. Fixed with a new `templates/package.json` (`{"type":"commonjs"}`), copied into
`.spectoflow/package.json` by `init`/`update` like any other framework file — pins the whole
`.spectoflow/` subtree to CommonJS regardless of the host project's own module type. Two new
regression tests confirmed failing before the fix (reproducing the user's exact error) and passing
after; applied live to the real broken project, Board confirmed loading correctly by screenshot.

## What exists (v0.23.3 — see DECISIONS D61)

Direct user feedback after dogfooding the hub (D59/D60): the project-list page "isn't styled at all,
not really structured", and the back-to-hub link on a project's dashboard (a lone 26px "⌂" icon) was
"not very clear" — plus a request for a clear, unambiguous "hub mode" indicator. Shipped as one
combined element per the user's own choice between two options: `.hub-pill` replaces
`.hub-back-link` — a `--signal`-colored badge reading "⬡ Hub", hidden unless `PROJECT_ID` is set (so
it never appears for the legacy single-project server), that IS both the mode indicator and the
clickable way back (paired `[hidden]{display:none}` override, avoiding the CSS-vs-native-hidden
bug this session already hit once). The hub landing page (`hub.html`/`hub.js`) gets its own
typographic identity (Sora + IBM Plex Sans + JetBrains Mono — self-hosted fonts already shipped for
the design skins, previously unused here since the page set no `data-design` and fell back to plain
system-ui) plus restructured cards (name + stage pill + progress + a structured stat/last-opened
footer row) and a dynamic project-count subtitle. QA: real Chrome-headless screenshots (dark, served
live by the hub on the user's real `todo-list-v2` project; light, via a patched local copy pointing
at the same assets) confirm both pages and the badge render correctly; full suite 232/233 (1
pre-existing Windows skip), 0 failures — a client-only HTML/CSS/JS change, no existing test affected.

## What exists (v0.23.2 — see DECISIONS D60)

Found continuing to dogfood the hub on a real project: clicking "Activer l'étape" in the Workflow
tab's popover silently did nothing. `/api/workflow/toggle`'s handler stripped a trailing `(optional)`
marker before checking for a `{cap:... skill:... policy}` annotation (added in D29) — but every step
in the default `workflow.md` template carries one of these annotations, so this had been broken for
every single step of every single project since D29 shipped, with zero test coverage on this endpoint
until now. Fixed by mirroring `store.js`'s `readWorkflow()` exact strip order (annotation first, then
`(optional)`) in the handler.

## What exists (v0.23.1 — see DECISIONS D59)

Found dogfooding the hub on a real, existing user project (still on v0.22.3): opening a registered
project whose `.spectoflow/dashboard/handlers.js` doesn't exist yet (any project that predates D58,
until it runs `spectoflow update`) showed a bare "Unknown project." — indistinguishable from "never
registered at all". `lib/hub-server.js` now has `projectErrorMessage(id)`, called only after
`getProject()` fails, which tells these apart and points the actionable case ("needs an update") at
`spectoflow update` by name instead of a silent generic 404.

## What exists (v0.23.0 — see DECISIONS D58)

**The multi-project hub.** `spectoflow dashboard` used to bind one server process to one project
(`SPECTOFLOW_ROOT`). It now registers the current folder in a global registry
(`lib/registry.js` → `~/.spectoflow/projects.json`) and joins — or starts — the one global hub
process (`lib/hub-server.js`, ships under `lib/`, never vendored) that serves every registered
project concurrently, live-switchable per browser tab, no restart. Delivered as 5 sequenced
sub-projects (see DECISIONS D58 for the full breakdown): the registry + `spectoflow projects
[remove <id>]` CLI; `templates/dashboard/server.js`'s route logic extracted into vendored
`handlers.js` (`createHandlers(root) → {handleApi, watchDirs, onBoot}`); `lib/hub-server.js` made
genuinely registry-driven (`/p/<id>/...` for pages, `?p=<id>` for every `/api/*` call, including
`/api/events`); a real hub landing page (`hub.html`/`hub.js`) with a non-technical "+ Add project"
flow — a server-side folder browser (`GET /api/hub/browse`, since a browser cannot hand a page a
real absolute filesystem path) plus paste-a-path, either auto-initing via the newly-extracted
`lib/init.js`; and `spectoflow dashboard`/`status`/`stop`/`restart`/`update` all rewired to the
global `~/.spectoflow/hub.lock`, with `update` reloading only the project actually being updated
(`POST /api/hub/reload/<id>`, a surgical per-project `require.cache` purge) so it never disrupts
anyone else's project open in the same hub. `templates/dashboard/server.js` remains fully
functional and untouched for direct single-project invocation — migrating the existing test suite
and this file's own "Run & test" section to the hub-first model is a deliberate follow-up, not
required for the hub to be complete and usable today.

## What exists (v0.22.5 — see DECISIONS D57)

A single fix found via a full end-to-end browser QA audit of the dashboard (all tabs, all 6 designs,
explicitly requested by the user to confirm "everything is perfect" — not a user bug report this
time). The File Explorer's `===`/`!==` (any 3-char operator) rendered as an unreadable fused block in
both preview and edit mode, on any `.js` file. Root cause: the syntax-highlighting overlay (D53/D56 —
a colored `<pre><code>` backdrop under a transparent `<textarea>`) depends on pixel-perfect,
character-by-character alignment between its two layers; `--mono` resolves to `ui-monospace`/Cascadia
Code on Windows (and `'JetBrains Mono'` on the Obsidian Ops design) — both fonts fuse `===`/`!==`/`=>`
into a single ligature glyph by default (the `calt`/`liga` OpenType feature), which breaks that
alignment. Fixed with `font-variant-ligatures:none; font-feature-settings:"liga" 0,"calt" 0;` on both
layers (`.files-code-backdrop` and `.files-code-wrap .files-code-input` — disabling it on only one
would have just moved the misalignment, not fixed it). The rest of the dashboard (every tab on the
default Console design, plus a spot-check of Orbit/Control Room/Obsidian Ops) was audited in the same
pass and confirmed clean — no other functional or layout issues found. `demo/` refreshed via `update`
(0.22.4 → 0.22.5).

## What exists (v0.22.4 — see DECISIONS D56)

File Explorer follow-ups from real-usage feedback. **Bigger panel**: `.files-wrap`'s excess
padding/height cap (inherited from the normal-scrolling-page pattern, not appropriate for this
flex-constrained page) trimmed — the tree's own scrollbar now only appears once content genuinely
exceeds the taller area, not before. **Click a folder to target it**: `+ File`/`+ Folder` create
inside whichever folder is selected in the tree (`.is-target` highlight, a "project root" pseudo-row
to reset), the form now asks only for a name ("Creating in: <folder>") instead of a full path typed
by hand. **Syntax highlighting, still zero-dependency**: a transparent `<textarea>` sits exactly over
a highlighted `<pre><code>` backdrop (same font metrics, backdrop repainted on every keystroke, its
scroll position copied from the textarea) — `filesHighlight()` is one generic char-scanner tokenizer
(comments/strings/numbers/keywords, plus a light HTML-tag pass) shared across JS/TS/JSON/CSS/HTML/
Python/shell/YAML, falling back to plain text for anything unrecognized. Wired into all three text
editors (generic, Markdown-edit, HTML-edit); the Markdown toolbar's programmatic `.value=` changes now
dispatch a synthetic `input` event so the backdrop repaints (native `input` never fires on a
script-set `.value`). `demo/` refreshed via `update` (0.22.3 → 0.22.4).

## What exists (v0.22.3 — see DECISIONS D55)

Three real-usage Windows bugs. **No more console window on every agent launch**: `spawn()` in
`runner.js`/`summarize.js` now passes `windowsHide: true` — a globally-npm-installed CLI agent is a
`.cmd` shim on Windows, and spawning one without this flag pops a real (and pointless — stdout/stderr
were already piped) console window on top of the dashboard. `orchestrator.js` and the CLI's
`skill/agent/dashboard create` commands reuse `runner.js#startRun`, so they're fixed for free.
**A loading indicator now fills the gap that window used to (accidentally) signal**: `summarize.js`
gained the `run-start`/`run-end` SSE events `runner.js` already had; the client combines that with
`runtime.orchestration.status` to disable Send/Orchestrate/Summarize and show a spinner +
"Agent running…" for as long as a run is actually in flight (also guards the Ctrl/Cmd+Enter shortcut,
which bypasses the disabled button). **File Explorer's tree scrollbar** now uses the app's existing
thin/themed scrollbar pattern (previously only on `.wf-pipeline`) instead of the OS-native one.
`demo/` refreshed via `update` (0.22.2 → 0.22.3).

## What exists (v0.22.2 — see DECISIONS D54)

Real-usage feedback on the Board's Kanban view: 6 status columns at a 228px minimum each need
~1368px, and the fixed 300px right sidebar (Journal/Specs/Running) was eating into that on top,
forcing horizontal scroll. New `#sideToggle` button in the Board's filter bar toggles a `side-hidden`
class on the panel (grid collapses to one column, sidebar hides) — persisted per viewer, same
pattern as the List/Kanban switch and Console's own rail toggle. Shared markup (`.main`/`.side`),
so it applies uniformly across all 6 designs with no per-design code. Doesn't claim to eliminate
scroll entirely at every width (6×228px columns are still ~1368px) — it's the capability to reclaim
the sidebar's space, which was the actual ask.

## What exists (v0.22.1 — see DECISIONS D53)

Two bugs from real-usage feedback right after upgrading to 0.22.0 — both directly caused by the new
Files tab pushing the total tab count from 10 to 11. **Orbit's radial menu items were overlapping**:
the per-item angle was already computed from the real item count, but the ring's radius was a
constant tuned by eye for ~9 items — past that the chord distance between adjacent items becomes
smaller than the item's own diameter. `orbit.js` now computes the radius needed to keep a minimum
gap (accounting for the label text, which can be wider than the icon circle) whenever the menu
opens, never below the original tuned radius; `--ob-r` is set inline on `.ob-dial` and both
`orbit.css` call sites (the open keyframe, the reduced-motion rule) read `var(--ob-r, …)` instead of
a hardcoded px value. **Personalize was invisible on the horizontal-tab designs** (Control Room,
Obsidian Ops, Neon Command, Mission Control): a single fixed `@media (max-width:1180px)` breakpoint
decided icon-only mode, tuned once for a stale tab count and blind to how many tabs actually exist —
adding a tab can overflow the row at widths that used to fit, and since `overflow-x:auto` hides its
own scrollbar there was zero visual hint that more tabs existed. Replaced with a real measurement:
`fitTabs()` in `app.js` compares `#tabs`'s `scrollWidth`/`clientWidth` and only adds `.tabs-compact`
when the row genuinely overflows — correct at any tab count and any viewport width — called from
`applyActiveTab()` (every render tick, including when custom dashboards change the tab count) and on
a debounced `resize`. Deliberately skipped for Console (its own rail, see D52) and Orbit (`#tabs` is
never shown natively there). `demo/` refreshed via `update` (0.22.0 → 0.22.1).

## What exists (v0.22.0 — see DECISIONS D52)

Seven chantiers from real-usage feedback, shipped one at a time with live verification between
each. **Route rename**: `/settings` → `/personalize` (matched the tab's own "Personalize" label;
old bookmarks redirect). **Personalize redesigned**: two thematic cards ("Agent & automation" /
"Appearance & language") in a responsive grid instead of one narrow stacked column; the "Extend
spectoflow" generator grid collapses to one column while a block's form is open (`#czRoot.has-open`)
to avoid the exact auto-fit empty-cell trap this round was fixing elsewhere. **Whitespace fixed**
on Info/Backlog/Requests/Agents & Skills (uncentered fixed-width wraps widened; `.info-grid` stays a
fixed 2 columns on purpose — an `auto-fit` grid with 5 sections and one forced full-span item leaves
genuinely empty cells in 2-item rows). **Console sidebar now expand/collapse-able** (icon-only stays
default; a rail-bottom chevron toggles labels visible, persisted per viewer). **Manual task
creation** in Backlog (`store.addTask()`/`nextTaskId()`, `POST /api/task`, inline form) — bonus fix:
`promoteAttention()`'s hand-rolled file path was wrong for a project with existing plans (invisible
because the only test exercised a fresh project); now delegates to `store.addTask()`. **"Ultra pro"
design pass**: decorative gradients removed (Console's corner glow, Neon Command's whole
aurora/glass-card/gradient-button/gradient-text look — its "glassmorphism" identity toned down too,
by explicit user choice) while functional gradients (progress bars, workflow flow lines, Orbit's
progress ring) stay; 3 icons redrawn (`board` read as a bar chart, now reads as kanban columns;
`agents` was a generic two-people glyph, now a bot head; `settings`/Personalize's leftover gear is
now preference sliders). **File Explorer** (new "Files" tab): project tree + read/write/create,
`templates/dashboard/files.js` (own module, `/api/files/{tree,read,write,mkdir}`, same
traversal/symlink guard shape as `/api/agentfile` extended to the whole root, `.git` write-blocked),
Markdown via the existing `mdLite`, HTML in a sandboxed iframe, plain text elsewhere — deliberately
zero-dependency (no CodeMirror/Monaco), and deliberately **no native `prompt()`/`confirm()`/`alert()`**
(they block the whole tab including SSE) — inline forms and a non-blocking "Discard" button instead.
The three previously-reported bugs (Summarize leaving old messages, a refresh-loses-messages doubt,
the floating widget's "No agent found") are confirmed fixed. Two more bugs found and fixed while
building the File Explorer itself: a mixed-separator project root being rejected as invalid, and the
MD/HTML editor not filling its available height (a `flex:1` textarea whose direct parent wasn't a
flex container). QA: 187 tests (185 pass; the one failure is the already-documented
full-suite-only flake, green in isolation), real end-to-end browser QA across all 6 designs
including a full Orchestrate run (7 workflow steps, no dupes, nothing lost). `demo/` refreshed via
`update` (0.21.0 → 0.22.0).

## What exists (v0.21.1 — see DECISIONS D51)

Docs-and-housekeeping pass, no functional code changes. README restructured (the dense "Agents vs
skills"/"Dashboard" sections split into `###` subsections and real lists; a proper "Studied, not
copied" with actual links + credit to spec-kit/OpenSpec/BMAD-METHOD, for both attribution and SEO; a
real dashboard screenshot up top). `demo/` — this repo's own dogfooding project — turned out to have
never been through `spectoflow update` since a very early version (no `.manifest.json` at all); fixed
with `update --force` (43 created, 26 forced), which is exactly the scenario that flag exists for.
GitHub repo metadata (description/homepage/topics) filled in via `gh repo edit` — was blank. GitHub's
"Packages" tab showing empty is expected, not a bug — it lists packages published to GitHub's *own*
registry, which this project doesn't use (npm-only, via OIDC trusted publishing).

## What exists (v0.21.0 — see DECISIONS D50)

**13 agents (was 8), a Documentation tab with links, compact KPI cards.** Five more coding agents
researched and added to `lib/adapters.js`/`templates/lib/agents-registry.js`, each independently
verified against its own primary docs (never guessed): GitHub Copilot CLI, Amazon Q Developer CLI,
Factory Droid CLI, Auggie CLI, Goose CLI. Cross-checked against OpenSpec's and spec-kit's published
tool lists for *names* — neither documents headless CLI support, so that part was still verified
per-agent. Every entry (all 13) now carries a `docsUrl`, surfaced by a new dashboard **Documentation**
tab: a live "supported agents" table (install status + a clickable link to each one's own docs) plus
the CLI command reference — the direct answer to "which agent is this and where do I read about it".
`mdLite` gained real link support (`[text](url)` and auto-linked bare `https://…`), so every existing
agent/skill's References section is clickable now too, for free. The four KPI overview cards
(Progress/In progress/To validate/Running) are meaningfully smaller across every design at once (one
shared CSS block, no per-design overrides to touch).

## What exists (v0.20.1 — see DECISIONS D49)

Four corrections after real-usage feedback on v0.20.0's agent work. **Kimi CLI added** to the
registry (`bin: kimi`) but marked `headless: false` (`runner: null`) — no confirmed one-shot mode, so
it's detectable and selectable as the active agent, just never spawned; every entry now declares
`headless` explicitly (drift-guard test extended to match). New `runner.js` export
`resolveRunnerCommand(root, cfg, which, opts)` falls back to the registry's default runner for an
installed, headless-capable agent that was never seeded into `config.json → runners` — the per-message
agent pickers (`#runAgent`/`#tabRunAgent`/Customize's) now list every known agent (disabled unless
installed *and* headless) instead of only whatever `config.runners` happened to already have, via the
same `fillAgentSelect()` the topbar switcher uses. Chat's Summarize/Clear moved from the header down
into a toolbar strip right above the input (in **both** the floating widget and the Chat tab, not just
the tab) — closer to where you're actually looking. Opening the chat (either surface) now scrolls to
the bottom and focuses the input every time, instead of trusting whatever position it was left at.

## What exists (v0.20.0 — see DECISIONS D48)

**7 agents, an always-visible verified switcher, Personalize, nav tooltips, chat Summarize/Clear,
`update --force`.** `lib/adapters.js` now knows **OpenCode**, **Kiro CLI**, and **Antigravity**
(researched and cited headless invocations — never guessed), alongside claude/codex/cursor/gemini;
Kimi CLI and DeepSeek Harness were deliberately left out (no confirmed one-shot headless mode as of
this research pass — a comment in the registry explains why). New `templates/lib/agents-registry.js`
gives the *running dashboard* its own self-contained view of the same roster (id/label/bin/dirs/
runner) — duplicated from `lib/adapters.js` on purpose (`.spectoflow/` must be self-contained) and
kept in sync by a drift-guard test. The topbar's `#topAgent` select — first in the bar, ahead of mode
and language — always shows the active agent; switching is verified server-side against what's
genuinely installed (PATH or the project's own config dir) before it activates, and a project with
nothing installed shows **"No agent found"** in red instead of a dead selector. **Settings → 
Personalize** (the tab now hosts the active agent too, not just mode/language/design); the inner
generator section is **"Extend spectoflow"** to avoid colliding with the new tab name. Every nav tab
gets a hover tooltip reusing its own i18n label key (zero new strings). Chat tab: **Summarize**
(condenses the recent log into one digest via the active agent, `templates/dashboard/summarize.js`,
deliberately separate from `runner.js`) and **Clear**. `spectoflow update --force`/`-f` overwrites a
diverged file in place instead of dropping a `.new` — resolves the "stuck diverging forever" case a
real user hit (five dashboard files silently never refreshing across several prior updates).

## What exists (v0.19.0 — see DECISIONS D47)

**Customize from the terminal.** `spectoflow skill create "<description>"`, `spectoflow agent create
"<description>"`, and `spectoflow dashboard create "<description>"` (a new `dashboard` subcommand,
alongside `status`/`stop`/`restart`) are the CLI mirror of Settings → Customize — each also takes
`--auto` (propose candidates instead of describing) and `--agent=name` (override the configured
runner). No reimplementation: the CLI calls `templates/dashboard/runner.js`'s `startRun` directly — the
same function `POST /api/run` calls — so a terminal-triggered run streams the same sentinel-derived
chat messages and behaves identically to a dashboard click, just blocking in the foreground and exiting
with the run's own exit code. The prompt text itself lives in one place, `templates/lib/
customize-prompts.js`, mirrored by hand in `app.js`'s `CZ_KINDS` (no build step to share a Node module
with the browser) and guarded by a test that greps `app.js` for drift.

## What exists (v0.18.0 — see DECISIONS D46)

**Customize** — a project's dashboard user can now extend spectoflow itself from **Settings →
Customize**: add a project-specific **dashboard**, **skill**, or **agent** by describing it (or hit
**Auto** to have the agent propose candidates from the project). Dashboards are never raw HTML — they
are a declarative **7-block JSON spec** (`templates/lib/custom-dashboard.js`, zero-dep, unit-tested)
rendered by the *same* components the built-in Board uses (`kpiCard`/`ocard`/`bars`/`donut`/
`statTile`/`mdLite`), so a generated dashboard matches whatever design is active — and stays matched if
the user switches designs later — **by construction**. Blocks bind live to `SpectoStats.stats(P)` via a
strict dotted-path allow-list (`bind: "phases.0.pct"`) or hold a static value. Generation needs zero new
server surface: it reuses the existing `/api/run` + group-chat pipeline. New capability
`customization` (not a workflow step, like `governance`/`clarify`), new agent `framework-curator`, four
new skills — `generate-dashboard`, `generate-skill`, `generate-agent` (both ground their output in a
real cited domain standard — OWASP/WCAG/C4-ADR/… — never a fabricated one), `propose-customizations`
(the Auto path). Generated skills/agents are marked `origin: user-generated` in front-matter.
Bonus fix found in QA: `index.html`'s local asset references were relative, breaking on any 2-segment
route on a direct page load (`/custom/<id>`, and the pre-existing `/backlog/T-012`) — now absolute.

## What exists (v0.17.4 — see DECISIONS D44)

Two Orbit logo fixes from real-browser QA. A stray `display:block` on the hub's logo clone outranked
the theme-toggle rule (`.brand-logo-img.is-dark/.is-light`) and forced both light/dark logo variants
visible at once — a ghosted double mark, most visible in dark mode. Removed; the theme toggle is back
in control. And the dial's center button, which used to cram logo + % + "Delivered" into 76px, now
shows **the logo alone**, bigger (34px) and well-centered — the ring around it already carries the
progress reading, so nothing is lost by dropping the repeated text.

## What exists (v0.17.5 — see DECISIONS D45)

**The dashboard UI now translates, not just the agent's output.** `config.json → language` used to
govern only what the agent writes (specs/plans/comments, per AGENTS.md) — the dashboard chrome itself
stayed English regardless. New `templates/dashboard/public/i18n.js`: a 179-key dictionary across all
6 languages (en/fr/es/de/pt/it, verified key-complete), `t(key, vars)` with `{placeholder}`
substitution and an en → raw-key fallback, `applyI18nStatic()` walking `data-i18n*` attributes. Fully
reactive through the existing `render()` pipeline — `i18nSetLang()`/`updateStatusLabels()` at the top,
`applyI18nStatic()` at the end — so a language change applies on the next SSE tick, no extra wiring.
`openDrawer`'s local task variable was renamed `t`→`task` (it would have shadowed the new global `t()`
translation function). Also: the sidebar **Journal is capped to 5 entries** by default with a "See
more/less" toggle; and **Chat moved to the 2nd nav position** (right after Board).

## What exists (v0.17.3 — see DECISIONS D43)

Three fixes to the shared bar (all designs, unless noted): the **project's real folder name** is now
shown (`server.js` adds `projectName`; the client no longer falls back to the generic `projectType`);
**mode and language are editable right from the bar** via two compact selects (`#topMode`/`#topLang`)
kept in sync with the Settings tab; and, **Orbit only**, the hub button that opens the radial menu is
now **the logo itself** (theme-aware, ringed with a live conic-gradient progress indicator) — the
original header logo is hidden, the "spectoflow" name becomes the dashboard link in its place, and the
dial's center also shows the logo above the % / "Delivered" caption.

## What exists (v0.17.2, cont'd — see DECISIONS D42)

Two more Console fixes from real-project visual QA: the header brand logo (26px base) reads too small
against this design's darker, denser topbar — bumped to 34px, scoped to `.topbar` only. And the footer
was losing its left edge ("ctoflow" instead of "spectoflow") because `.app-footer` is a sibling of
`.stage`, not a child — the icon rail is `position:fixed` to the viewport, so `.stage`'s `margin-left`
never reached it. `.app-footer` now gets the same rail-width margin (reset under 820px).

## What exists (v0.17.2)

**v0.17.2 (see DECISIONS D41):** `write-e2e-tests` now states an explicit hierarchy between Playwright
lib, Playwright MCP and native browser tooling. **Default: Playwright lib, `--headed`** — local runs
happen directly in a visible browser (`--ui` for interactive authoring/debugging); it steps down (to
headless, then MCP, then native tooling, then write-and-raise-a-need) only when the user asked
otherwise or headed can't launch, **always announcing why** via the `::spectoflow` sentinel. CI stays
headless — that's the pipeline's job, not a fallback. `qa-engineer.md` and both READMEs updated to
match; the skill's frontmatter `description` (shown in the dashboard's Workflow popover and the Agents
& Skills card) now summarizes this policy.

## What exists (v0.17.1)

**v0.17.1 (see DECISIONS D40):** real-browser QA pass of both templates (all views, light + dark, ⌘K,
radial menu). Fixes: the Console rail was clipped to the header because the topbar's `backdrop-filter`
is the containing block of a fixed descendant → `console.js` now **docks `#tabs` under `<body>`**
while the design is on (and restores it on leave); the chat FAB uses the solid brand accent so it
reads on the light sets; Orbit's pipeline connectors are tinted so the line stays visible in dark.

## What exists (v0.17.0)

**v0.17.0 — dashboard redesign, 2 new templates (see DECISIONS D39):** two prototypes were validated
by the user, then shipped as skins in the existing multi-design system, each in its own
`dashboard/public/designs/<id>.css` + `<id>.js` (active only when its design is on; live-switchable).
**`console` — Spectral Console (default, dark by default):** deep blue-slate console, amber brand accent
+ cyan "flow" for everything live, **left icon rail** (the existing tabs re-docked), **⌘K palette**,
bento overview, reveals/counters/pulses/pipeline particles. **`orbit` — Orbit:** light, airy, circular;
a **radial menu opens on click** of a teal hub button (shows % delivered) — items in orbit, segmented
ring (teal = progress, amber marker = current view), chevrons, Esc/`m`; content full width. Defaults:
`data-design="console"`, `data-theme="dark"`, `config.design: "console"`. Old 4 skins still selectable.
Zero-dep/offline kept (self-hosted fonts only); routing/SSE/API untouched.

## What exists (v0.16.4)

**v0.16.4 (see DECISIONS D37):** the brand welcome now shows **on `npm install -g spectoflow`** too,
via a **`postinstall` script** (`bin/postinstall.js`) — guarded to a global, interactive (TTY) install
and wrapped so it can never fail an install (npm may still buffer the output). The ASCII brand is
factored into **`lib/brand.js`** (shared by the CLI and the welcome) so all surfaces render the exact
same art.

## What exists (v0.16.3)

**v0.16.3 (see DECISIONS D36):** two logo surfaces. **`init` and `update`** show the **white hexagon**
brand mark (left edge thickened to 4 `#`, symmetric) with a **compact amber figlet wordmark**
(`spectoflow`, ~half size) **centred under the mark's true midpoint**. **`help` and the explore
commands** (`list`/`agents`/`skills`/`workflow`) show the **amber wordmark alone** (no hexagon). White
mark + amber name; `nameBlock()` centres the wordmark, `logo()`/`wordmark()` render the two surfaces.

## What exists (v0.16.2)

**v0.16.2 (see DECISIONS D34):** the ASCII logo is the **real brand mark** — the actual spectoflow
hexagon-with-flowing-"S" art, taken from the user's own logo and **downsampled 2× to 41×23** to fit a
terminal (faithful shape, not a redraw). Shown on `init`, `help` and `list`.

## What exists (v0.16.0)

**v0.16.0 — CLI UX pass (see DECISIONS D33):** an ASCII **logo banner** on `init`, `help` and `list`; **new explore commands** — `spectoflow list`
(agents + skills + workflow at a glance), `agents`, `skills`, `workflow` (read from the project's
`.spectoflow/`, or the bundled kit when run outside one, via a tiny zero-dep frontmatter reader);
**per-command help** — appending `-h`/`--help` to any command prints that command's help instead of
running it; **`spectoflow dashboard` now starts detached and hands the prompt back** (spawn
`detached+unref`), printing a commands panel, with new **`dashboard status`** and **`dashboard
restart`** subcommands beside the existing `stop`; and a **redesigned, grouped, coloured help**
(Project · Dashboard · Explore · Options). The **clarify** skill's tone is refined to be natural and
immersive (acknowledge → reflect → one question), explicitly **not** a fixed template, and to flow a
complex/new-build request into the normal path instead of over-questioning.

## What exists (v0.15.0)

**v0.15.0 — Clarify reflex + Playwright MCP (see DECISIONS D31/D32):** two additions.
**(1) Clarify** — spectoflow now behaves like an **expert analyst, not an order-taker**. A new
always-on **Clarify reflex** lives in the agent's memory (`templates/AGENTS.md` Router step 0 + a
"Stance" block, reinforced by one line in every root shim), backed by a new **`clarify` skill**
(capability `intake`, `product-manager`): on any ambiguous request it reflects it back and asks **one
targeted question at a time** (each with a recommendation, anchored in the project's goals + best
practices) until the need is crisp — then executes. It is **additive** (feeds the existing
Router/workflow, replaces nothing) and mode-aware.
**(2) Playwright MCP** — `init` **idempotently wires** a `playwright` entry into the target project's
`.mcp.json` (+`.cursor/mcp.json` when Cursor is selected) so the E2E agent (`qa-engineer`) can drive a
real browser and generate/run tests. Zero-dep-safe (`npx` fetches the server; it's the user's project,
not spectoflow). Backed by unit-tested `lib/mcp.js`; `write-e2e-tests` documents the full fallback
ladder (MCP → native browser tooling → local Playwright → write-spec-and-raise-a-need).

## What exists (v0.14.3)

**v0.14.3:** `init` now drops a detailed **`.spectoflow/README.md`** into every project — it explains
what spectoflow is, what each file/folder in `.spectoflow/` does, the day-to-day commands, and the
core principles, so anyone opening the folder is oriented. (Framework-owned, refreshed by `update`.)

## What exists (v0.14.2)

**v0.14.2:** the Board Overview's **Phase progress** is redesigned for big projects — it now shows
**only phases that hold tasks** (a `##` heading with no checkbox tasks isn't a phase, it's noise) and
**caps the list height** with an internal scroll, so dozens of phases can't stretch the page. With
phases collapsed by default (0.13.5), the dashboard stays compact even on a large plan.

## What exists (v0.14.1)

**v0.14.1:** `spectoflow dashboard stop` (alias `spectoflow stop`) stops the running dashboard — the
server writes a pidfile (`.spectoflow/.dashboard.lock`) on start and clears it on exit; `stop` reads
it, verifies the port responds, terminates the process, and removes the lock (safe against a stale
lock). Complements `spectoflow dashboard` / `status`.

## What exists (v0.14.0)

**v0.14.0 — Spec Source Guardian (see DECISIONS D29):** a new **`governance` capability** and agent
**`spec-source-guardian`** (skill `audit-source`) that keeps the spec (intent) and the code/tests
(reality) coherent — it flags drift in both directions (orphan work / dead spec), never auto-fixes,
posts findings to the **Attention** tab, and gates only at `done`/Major (`policy.md`). Backed by a
zero-dep, unit-tested drift helper (`.spectoflow/lib/spec-drift.js`) and an **opt-in** Claude Code
`Stop` hook (`.spectoflow/hooks/spec-drift.js`) you can wire into `.claude/settings.json`.

**v0.13.5:** the Board opens **compact on big projects** — phases are **collapsed by default** (just
headers + progress), with an **Expand all / Collapse all** button; and Kanban columns scroll
internally (capped height). Fixes the "dashboard is too long" problem when every phase was expanded.

## What exists (v0.13.4)

**v0.13.4:** the Board's task list gains a **List / Kanban** view toggle — *List* keeps the
phase-grouped collapsible sections; *Kanban* shows one column per status (To do / In progress / To
validate / To analyze / Done / Blocked) with the same task cards. The choice persists per viewer
(`localStorage`), and the status chips hide in Kanban (the columns already are the statuses).

**v0.13.3:** a **4th design — Mission Control** (indigo control panel); the Workflow step **popover**
now caps its height to the viewport and keeps the enable/disable button reachable (sticky footer, no
truncation); and the dashboard server sends **`Cache-Control: no-store`** so the browser never serves a
stale `app.js`/`styles.css` (fonts stay cached).

**v0.13.2 — design pass (see DECISIONS D25):** violet re-skin of the default; a **multi-design system**
(`data-design` skins registered in `dashboard/public/designs.js`, switchable in Settings, persisted per
viewer + as `config.design`) shipping **Control Room / Obsidian Ops / Neon Command / Mission Control**
(each light+dark);
**self-hosted `.woff2` fonts** (offline, zero-dep intact); a decluttered header with the framework
**version** shown; a **Settings** tab + pro **footer**; a redesigned **Workflow** (horizontal icon
pipeline with arrows + a click **popover** of step details); mobile **hamburger** nav + responsive
fixes; and CLI `--version`/`--help` + coloured `update`. **v0.13.1** hardened `GET /api/agentfile`
against symlink escape.

## What exists (v0.13.0)

**v0.13 — "real-use" pass (see DECISIONS D24):** configurable/auto-detected plans & specs dir
(`config.plansDir`/`specsDir`, resolvers in `store.js`); clearer post-init onboarding; `spectoflow
dashboard` as the single launch command with running-state probe + agent auto-start; the orchestrator
no longer echoes its "You are the …" priming prompt as a chat bubble (`startRun({logPrompt:false})`);
a **settings** popover (`POST /api/settings` → `config.json`, mode + language); an **Attention** tab
(agent raises points via the `::spectoflow attention msg=…` sentinel, or the user adds notes — CRUD via
`/api/attention*`, **validate → task** via `/promote`); Backlog defaults to **Open** + **pagination**;
flicker fix (debounced SSE reload + entry animations scoped to `body.booting`); the real **logo** in the
header (theme-swapped); a redesigned **Workflow** (numbered step cards + connectors); and client-side
**routing** (`/<tab>[/<taskId>]` via the History API + a server SPA fallback).

## What exists (v0.12.0)

- `bin/spectoflow.js` — CLI: `init` (scaffold a project; auto-detects installed agents), `update
  [--dry-run]` (refresh framework files to this kit version, preserving user edits), `dashboard`,
  `status`.
- `lib/adapters.js` — declarative REGISTRY of per-agent shims + default runners + detection specs
  (claude, codex, cursor, gemini); `lib/detect.js` probes PATH + agent dirs.
- `lib/ownership.js` · `lib/manifest.js` · `lib/update.js` — the update subsystem: framework/user
  ownership split (derived from `templates/`), the sha256 install manifest, and the update matrix.
- `test/` — native `node --test` suite (`npm test`). No test framework, zero deps.
- `templates/` — the **canonical framework**, copied into a project's `.spectoflow/` by `init`:
  - `AGENTS.md` (the brain: intent router, modes, rules) · `workflow.md` (single source) ·
    `capabilities.md` · `policy.md` · `config.json` (mode, language, agent, runners) ·
    `agents/` (stable team personas) · `skills/` (evolving procedures) ·
    `lib/store.js` (markdown storage engine + group-chat message log: `parseAgentLine`,
    `appendMessage`) · `dashboard/` (SSE server + `runner.js` run pipeline + `orchestrator.js` workflow
    sequencer (resolve → gate by mode/policy → run → collect, injectable for tests) + UI: Board /
    Workflow / Agents & Skills + a floating 💬 group-chat where running agents post identified messages
    and an **Orchestrate** button drives the whole enabled workflow).
  - `agents/` and `skills/` are now sourced, domain-standard playbooks (TDD, OWASP ASVS/Top 10, C4/ADR,
    INVEST, Playwright E2E, Conventional Commits, …), not one-line stubs — the gold-standard shape for
    both is pinned in `docs/agents-skills-standard.md`.
  - The dashboard's Board tab has a control-room **Overview** (KPI cards, a status donut, a
    workflow-at-a-glance strip, per-phase progress bars, and the **scope-vs-delivered area curve**
    fed by a `runtime.history` daily snapshot). All aggregation is client-side, in the pure,
    unit-tested `dashboard/public/stats.js`; charts (`donut`/`area`/`bars`/`ring`) live in the tested
    `dashboard/public/charts.js`. See `docs/dashboard-redesign-design.md`, `docs/dashboard-nav-design.md`
    and DECISIONS D22/D23.
  - Seven tabs: **Board · Requests · Backlog · Workflow · Agents & Skills · Chat · Info** — a denser
    icon-tab header (subtitle, progress meter, sync dot, **Run** quick-action). Requests is the
    to-validate/to-analyze list (English UI); Backlog is a flat sortable/filterable task table; Info is
    a project-summary panel; **Chat** is a full-height panel over `runtime.messages`, sharing
    `renderChatLog()` with the redesigned floating widget. Agents & Skills cards are enriched
    (`capability`/`standards`/`uses`, `inputs`/`outputs`) with a full-body markdown **drawer** (tiny
    hand-rolled `mdLite` renderer) fed by the one read-only endpoint `GET /api/agentfile?path=`
    (scoped to `.spectoflow/agents/**` + `.spectoflow/skills/**`, path-traversal-safe) — the only
    server/API addition in v0.12.
- `demo/` — a real inited project used to preview the dashboard (spectoflow tracking itself).

## Core invariants (do not break — see DECISIONS.md)

- **Artifacts are markdown** in `specs/` and `plans/` (checkbox tasks). Volatile execution state is
  `.spectoflow/runtime.json` (gitignored). Writes are **granular** (one line at a time).
- **Canonical framework lives in `.spectoflow/`**; per-agent entry files are **generated shims** that
  point back to it. Never require the user to duplicate framework content per agent.
- **Agents are stable personas; skills are the evolving procedures.** Workflow → capability → agent → skill.
- **Workflow has one source** (`.spectoflow/workflow.md`). Don't restate workflows elsewhere.
- **Mode ≠ policy.** Mode = routine friction; policy = approvals required regardless of mode.
- **Zero runtime dependencies** for the installed framework (native Node http/fs only).
- **Everything in English**, including code comments. Output language is configurable (`config.language`).
- **Semver** (MAJOR.MINOR.PATCH).

## Run & test

```bash
node bin/spectoflow.js init /tmp/try     # scaffold a project
node /tmp/try/.spectoflow/dashboard/server.js   # dashboard → http://localhost:4319
cd demo && node .spectoflow/dashboard/server.js # or preview with the demo
```
The storage engine is unit-testable directly (parse/serialize/granular write) — see how `store.js`
round-trips in `docs/ARCHITECTURE.md`. Add real tests as part of the next milestones.

## How to work here

Spec-driven, in plan mode: pick the next item from `docs/ROADMAP.md`, propose a plan, get approval,
implement, test, keep `docs/DECISIONS.md` updated when a decision is made or changed.
