<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/georgesmomo/spectoflow/main/logo-spectoflow-white.png">
    <img src="https://raw.githubusercontent.com/georgesmomo/spectoflow/main/logo-spectoflow.png" alt="spectoflow" width="112">
  </picture>
</p>

<h1 align="center">spectoflow</h1>

<p align="center"><em>Agent-agnostic spec-driven development with a real-time local control plane.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/spectoflow"><img src="https://img.shields.io/npm/v/spectoflow.svg?color=e6a54b" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-5fb2cc" alt="node >= 22">
  <img src="https://img.shields.io/badge/dependencies-0-4caf72" alt="zero dependencies">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/georgesmomo/spectoflow/main/docs/screenshot-board.png" alt="spectoflow dashboard — Board overview" width="880">
</p>

An **agent-agnostic** spec-driven development framework with a **real-time local control plane**.
You speak in plain language; the framework classifies your intent and runs the right workflow. No
ceremonial command to start.

## Quick start

```bash
npm install -g spectoflow
cd my-project && spectoflow init     # fits the workflow to your project, detects your agents
spectoflow dashboard                 # → http://localhost:4319
```

Then just tell your coding agent what you want to build. Optional, once per machine:
`spectoflow brain setup` so your agents remember you across projects.

**Works with whichever coding agent you have.** `init` auto-detects what's installed; the dashboard's
topbar always shows the **active agent**, front and center, with a switcher — pick another and it's
verified as genuinely installed before activating (a red **"No agent found"** if none is), never
silently activating something that isn't there.

> Note the terminology: "agent" is overloaded here on purpose, matching how the ecosystem uses the
> word. The table below is about **coding-agent CLIs** — the tool you already run in your terminal
> (Claude Code, Copilot CLI, …). spectoflow's own **team personas** (developer, qa-engineer, …) are a
> different, unrelated use of "agent" — see [Agents vs skills](#agents-vs-skills) further down.

## Supported coding agents

| Coding agent | Headless run | Docs |
|---|---|---|
| Claude Code | ✓ | [code.claude.com/docs/en/cli-reference](https://code.claude.com/docs/en/cli-reference) |
| Codex | ✓ | [developers.openai.com/codex/cli/reference](https://developers.openai.com/codex/cli/reference) |
| Cursor CLI | ✓ | [cursor.com/docs/cli/overview](https://cursor.com/docs/cli/overview) |
| Gemini CLI | ✓ | [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| OpenCode | ✓ | [opencode.ai/docs/cli](https://opencode.ai/docs/cli/) |
| Kiro CLI | ✓ | [kiro.dev/docs/cli/headless](https://kiro.dev/docs/cli/headless/) |
| Antigravity | ✓ | [antigravity.google/docs/cli/headless](https://antigravity.google/docs/cli/headless/) |
| GitHub Copilot CLI | ✓ | [docs.github.com/copilot/…/about-copilot-cli](https://docs.github.com/copilot/concepts/agents/about-copilot-cli) |
| Amazon Q Developer CLI | ✓ | [docs.aws.amazon.com/amazonq/…/command-line-chat](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-chat.html) |
| Factory Droid CLI | ✓ | [docs.factory.ai/droid-exec/overview](https://docs.factory.ai/droid-exec/overview) |
| Auggie CLI (Augment Code) | ✓ | [docs.augmentcode.com/cli/overview](https://docs.augmentcode.com/cli/overview) |
| Goose CLI (Block) | ✓ | [block.github.io/goose](https://block.github.io/goose/) |
| Kimi CLI | detectable, manual only | [github.com/MoonshotAI/kimi-cli](https://github.com/MoonshotAI/kimi-cli) |

"Headless run" means spectoflow can actually spawn it non-interactively (`Run`/`Orchestrate`/
`Summarize` work). Kimi CLI has no confirmed one-shot mode as of this writing — spectoflow still
detects it and lets you set it as the active agent, it just won't try to spawn it (the pickers that
launch a run grey it out rather than hide it); drive it yourself in its own terminal meanwhile. The
same live table, with your own install status, is in the dashboard's **Documentation** tab. Missing
one you use? `config.json → runners` still takes any custom command by hand — see
[`templates/README.md`](templates/README.md) — or open an issue.

## Install

```bash
# npm (recommended)
npm install -g spectoflow
spectoflow init /path/to/project

# or use it straight from a clone, no global install
git clone https://github.com/georgesmomo/spectoflow
node spectoflow/bin/spectoflow.js init /path/to/project
```

Every command works both ways — `spectoflow <cmd>` when installed globally, or `node
/path/to/spectoflow/bin/spectoflow.js <cmd>` from a clone.

### CLI

```
spectoflow init [dir] [--agent=claude,codex]   scaffold a project (auto-detects agents; wires Playwright MCP)
spectoflow update [--dry-run] [--force|-f]     refresh framework files to this kit version
spectoflow status                              progress + whether the dashboard is running

spectoflow dashboard [--port=NNNN]             start the control plane in the background (hands the prompt back)
spectoflow dashboard status                    is it running? (url + pid)
spectoflow dashboard stop   (or: stop)         stop the running dashboard
spectoflow dashboard restart                   stop then start
spectoflow dashboard create "..." | --auto     generate a custom dashboard
spectoflow dashboard init [--path=<dir>]       create/move the dashboard workspace (default ~/.spectoflow/dashboard)
spectoflow dashboard validate <file>           check a custom-view JSON against the block schema
spectoflow config [get|set <key> [<value>]]    global defaults + dashboard URL/path (~/.spectoflow/config.json)

spectoflow brain                               your second brain: entries, and which agents can reach it
spectoflow brain setup [--dry-run]             connect your installed agents to it (once per machine)

spectoflow skill create "..." | --auto         generate a project skill
spectoflow agent create "..." | --auto         generate a project agent

spectoflow list                                agents, skills and the workflow at a glance
spectoflow agents                              list the team personas
spectoflow skills                              list the procedures
spectoflow workflow                            show the enabled pipeline steps
spectoflow workflow suggest [--apply]          which steps fit the project now (code yet? tests? E2E? infra/data?)

spectoflow --version   (-v)                    print the version
spectoflow --help      (-h)                    show help   (append -h to any command for its help)
```

`init` scaffolds:
- `.spectoflow/` — the framework (brain, `workflow.md`, `agents/`, `skills/`, `policy.md`, `config.json`, engine). The dashboard itself ships in the spectoflow package, not in your project.
- `specs/` and `plans/` — **markdown artifacts**, your versioned source of truth.
- per-agent shims: `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex/Cursor), `GEMINI.md` (Gemini),
  `.claude/commands/spectoflow.md`.
- `.spectoflow/runtime.json` is gitignored (volatile execution state).

`init` **auto-detects your installed agent(s)** (probes PATH for each of the 13 supported CLIs above,
and existing `.claude`/`.codex`/… dirs): it writes shims for each, sets the active agent in
`config.json`, and seeds the runner commands. Override with `--agent=claude,codex`; if nothing is
detected it falls back to claude + codex.

**Empty project** → your agent asks what to build and runs Intake (brainstorm → analysis → spec → plan).
**Existing project** → an existing `CLAUDE.md` is preserved as `CLAUDE.md.tomerge` (merged on first run);
an existing `AGENTS.md` or `GEMINI.md` is kept as-is and gets a short, delimited spectoflow section
appended (`<!-- spectoflow:start -->` … `<!-- spectoflow:end -->`) pointing to `.spectoflow/SPECTOFLOW.md` —
`spectoflow update` adds it too to a project installed before that; existing `plans/*.md` tasks are given
stable ids.

**Entry files vs. the brain.** `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` at your project root are thin
pointers, in the place each agent reads natively. The real brain (intent router, workflow, rules) is
`.spectoflow/SPECTOFLOW.md`, owned by the framework and refreshed by `spectoflow update`. (Before 0.28 it
was named `.spectoflow/AGENTS.md`, easy to confuse with the root one — `update` renames it, keeping any
edits you made, and rewrites the old path in your entry files.)

## Update

`init` is idempotent (it never overwrites), so it can't refresh an installed project. `spectoflow
update` refreshes **framework-owned** files (engine, `SPECTOFLOW.md`, `capabilities.md`, `policy.md`,
default agents & skills) to the CLI's version — retiring the project's own vendored dashboard folder
along the way for anyone updating from before v0.24 — while **preserving your work** —
`config.json`, `workflow.md`, `specs/`, `plans/`, and any agent/skill you created or edited are never
touched. A file you edited is preserved and its new version is written next to it as `<file>.new`
for you to merge by hand. Add `--dry-run` to preview, or `--force`/`-f` to overwrite a diverged file
in place instead of dropping a `.new` — use it once you're sure you have no local edits worth keeping
in that file (e.g. it's been stuck diverged since an earlier update); it still never touches
`config.json`, `workflow.md`, `specs/` or `plans/`.

**Coming from before v0.24?** The dashboard used to be vendored into every project; now it ships once
in the package. `npm install -g spectoflow@0.24`, then `spectoflow dashboard` anywhere — the dashboard
workspace is created automatically and any project you'd already registered is carried over. Your
project already opens in the new dashboard at this point, whether or not you've run `update` in it
yet; running `spectoflow update` inside it retires its now-obsolete `.spectoflow/dashboard/` folder
(only if you never edited anything in it — an edited file is kept and reported, never deleted) and
moves any custom dashboard views you generated to `.spectoflow/dashboards/`.

First refresh the kit, then run update from your project — the flow is the same whichever way you
installed:

```bash
# npm global
npm update -g spectoflow  &&  spectoflow update

# manual (cloned repo)
git -C /path/to/spectoflow pull  &&  node /path/to/spectoflow/bin/spectoflow.js update

# npx (no install)
npx spectoflow@latest update
```

`update` resolves the framework version from the CLI you run and the project from the current
directory, so it behaves identically across all three. `init` records a hashed baseline in
`.spectoflow/.manifest.json` (committed) that lets update tell an untouched framework file from one
you've edited; installs made before this file existed degrade safely (a matching file is adopted, a
divergent one gets a `.new`).

## Storage is markdown

Plans are plain markdown with checkbox tasks — human-readable, git-diffable, standard:

```
## Phase 1 — Login
- [ ] T-001 Add login form @dev ~standard %in_progress
  - note: waiting on design tokens
- [x] T-002 Set up auth routes @dev
```

`[x]` done · `~level` quick|standard|major · `%status` in_progress|to_validate|to_analyze|blocked ·
`@owner`. The dashboard parses these and writes back **one line at a time** (granular), so it and your
agent never clobber each other.

## Dashboard (real-time)

```bash
spectoflow dashboard                     # → http://localhost:4319 (or --port=NNNN)
# manual (no global install): node /path/to/spectoflow/bin/spectoflow.js dashboard
```

`spectoflow dashboard` is the simple way — it prints the URL and won't double-start (it detects a
dashboard already running on the port). `spectoflow status` tells you whether one is up. Zero
dependencies, updates live via SSE + file watching.

**It only answers this machine.** The hub can launch agents and write your project files, so it listens
on the loopback interfaces only (`127.0.0.1`, `::1`) and refuses any request whose `Host` isn't local or
that another website sent — a malicious page, a DNS-rebinding trick, or a tunnel/proxy you run on the same
machine can't drive it. Clicking a link to it from another site still opens it. To reach your projects from
another device, use the online dashboard ([below](#going-online-optional-local-hub-vs-relay-server)).

**A custom agent command needs your OK.** `config.json → runners` sets the command that launches each agent,
and that file is committed — it can come from a cloned repository or a teammate's change. A command other than
the agent's default only runs once you allow it on this machine: Personalize → *Agent & automation* → **Allow
on this machine**, or `spectoflow runners allow <agent>`. Change the command and it asks again.

### One hub, every project

There is only ever **one dashboard process on your machine**, no matter how many projects you have.
`spectoflow dashboard`, run from *any* initialized project, does two things: it registers that
project, and it makes sure the hub is running — starting it if it's the first one to ask, or simply
joining an already-running hub otherwise. So the very first `spectoflow dashboard` you ever run
starts the hub; every one after that (from other projects) just adds a card to the same page.

```
  $ spectoflow dashboard              (in todo-list-v2/)
      no hub found → starts one → http://localhost:4319
                                          │
                                          └── card: "todo-list-v2"

  $ spectoflow dashboard              (in my-other-app/, later, or another day)
      hub already running → just joins it
                                          │
                                          └── card: "my-other-app"

  → open http://localhost:4319 in your browser: both projects, one page
```

That's the whole local setup — no login, no token, nothing to configure. **The rest of this section
is entirely optional.**

### Going online (optional): local hub vs. relay server

`spectoflow dashboard login/publish` are for one specific, separate need: opening a project's
dashboard from **another device**, or sharing it with someone else. They talk to `server/` — a
different application in this repo, not part of the local hub — that you (or someone) hosts
somewhere reachable (see [`server/docs/deploy-vps.md`](server/docs/deploy-vps.md), or run it
locally to try it, per [`server/README.md`](server/README.md)). Nothing about your local hub changes;
it grows one extra, optional connection outward:

```
  YOUR MACHINE                                    THE RELAY SERVER (server/)
  local hub · localhost:4319                      hosted by you or someone else

  [todo-list-v2]   ── published ──────────────►    only "published" projects
  [my-other-app]   ── NOT published, stays local    ever show up here

           ▲
           │  one-time, per machine:
           │  $ spectoflow dashboard login --url=<relay-url> --token=<spf_…>
           │
     the token is minted ON THE RELAY, not by you:
     $ node server/cli.js token create   (run by whoever administers it)

  once logged in and published → any browser, anywhere, can open it
```

| Command | Runs where | What it does |
| --- | --- | --- |
| `spectoflow dashboard` | your machine | start/join the local hub, register the current project |
| `node server/cli.js token create` | on the relay server | mint a login token for a machine |
| `spectoflow dashboard login --url=… --token=…` | your machine | link this machine to that relay (once) |
| `spectoflow dashboard publish` | your machine | make the *current* project visible through the relay |
| `spectoflow dashboard unpublish` | your machine | take it back offline |
| `spectoflow dashboard logout` | your machine | unlink the machine entirely |

The header bar always shows the brand, the **active agent**, autonomy mode, language, a global-progress
meter, a sync dot, and a **Run** quick-action. Fourteen tabs — and **which ones you see, and in what
order, is up to you** (Personalize → *Navigation tabs*: enable / disable / reorder; two of them ship
off by default):

- **Board** — the control-room Overview (compact KPI cards, a status donut, a **scope-vs-delivered
  area curve**, a workflow-at-a-glance strip, per-phase progress bars, filter chips + search) plus the
  phase board, as a **List** or a **Kanban** whose columns you can show/hide and that pages long
  columns instead of scrolling them.
- **Chat** — a full-height group-chat panel with **Summarize** / **Clear** and **slash commands** (see
  below).
- **Requests** — tasks awaiting you (`to_validate` / `to_analyze`).
- **Attention** — points the agent raised (a `::spectoflow attention msg=…` sentinel) or that you
  noted yourself — edit / resolve / delete, or **validate → task**.
- **Backlog** — a flat sortable/filterable, paginated table of every task, defaulting to open work.
- **Workflow** — the pipeline as step cards; click one to enable/disable it, which edits `workflow.md`.
  **Analyze the project** proposes the steps that fit it now, each with its reason — you apply the ones you
  tick (see [A workflow that fits the project](#a-workflow-that-fits-the-project)).
- **Agents & Skills** — enriched cards that open a full-body markdown drawer.
- **Files** — a project file tree with read / write / create, syntax-highlighted (self-hosted Prism.js).
- **Bloc note** *(off by default)* — a per-project post-it Markdown scratchpad.
- **Daily meeting** *(off by default)* — dated notes (`.spectoflow/meetings/<date>.md`), written by
  hand or generated by the active agent.
- **Info** — a project-at-a-glance summary.
- **Documentation** — the live supported-agents table (your own install status + links) plus the CLI
  command reference.
- **Second brain** — two sections: **You** (what spectoflow has learned about you, shared by all your projects,
  local only) and **This project** (the project memory, committed). Read, add, fix, confirm, move a fact to the
  other one (see [Second brain](#second-brain)).
- **Personalize** — autonomy mode, language, design, the active agent, **navigation tabs**, **slash
  commands**, and **Extend spectoflow** (see *Customize* below).

URLs are real routes (`/board`, `/backlog/T-012`, …). Charts are zero-dep, hand-rolled SVG in
`lib/dashboard/public/charts.js` (donut/area/bars/ring, animated, `prefers-reduced-motion`-aware), and
every aggregate is computed client-side.

### Designs & theme

The dashboard ships **switchable designs** (Personalize → *Dashboard design*): **Spectral Console**
(dark-first, ⌘K palette — the default), **Orbit** (light, circular radial menu), **Control Room**
(violet), **Obsidian Ops** (near-black lime/cyan, mono), **Neon Command** (glassmorphism aurora), and
**Mission Control** (indigo control panel). Each works in light and dark (the moon toggle). A design
is a `data-design` skin — a scoped CSS token block plus a one-line entry in
`lib/dashboard/public/designs.js`, so adding one is trivial. Fonts are **self-hosted**
(`lib/dashboard/public/fonts/*.woff2`), keeping the dashboard fully offline and dependency-free. Your
choice persists per viewer (localStorage) and as the project default (`config.design`).

### Chat

A floating **💬 chat widget** and the **Chat** tab render the same `runtime.messages` log via a shared
`renderChatLog()`, so they never drift. A running agent identifies itself by printing `::spectoflow
role=… kind=… msg=…` sentinels, which become labelled messages (analyst / developer / qa …); other
output streams raw. The board refreshes live as it edits plans. Either surface can also
**Orchestrate** the enabled workflow (each step runs its agent, gated by mode + policy), **Summarize**
the recent log into one digest via the active agent, or **Clear** it outright. The Agents & Skills
drawer is served by the one read-only endpoint, `GET /api/agentfile?path=` (scoped to
`.spectoflow/agents/**` + `.spectoflow/skills/**`, path-traversal-safe) — the framework's only other
server surface is unchanged.

### Isolated work on a task

In a git project, open a task and click **Work on it in isolation**. The agent works in its own copy of the
repository — a git worktree on the branch `spectoflow/<task>` — so your working tree stays untouched, and several
tasks can run at once without stepping on each other or blocking the chat.

```
  task T-012 ── Work on it in isolation ──►  its own copy, branch spectoflow/T-012   (task: in progress)
                                                    │  the agent finishes
                                                    ▼
                                   task drawer: what changed + the diff             (task: to validate)
                                   ├─ Merge          into your current branch, copy removed    → done
                                   ├─ Open a PR      push + gh pr create                        → link on the task
                                   ├─ Send feedback  the agent works again on the same copy
                                   └─ Discard        copy and branch removed — the rollback     → to do
```

- **Nothing to learn:** no command, no setting. Chat runs and orchestration keep working as before.
- **The agent's last message** shows in the drawer, so a run that changed nothing still says why.
- **Merge never half-happens:** on a conflict it is aborted, nothing changes, and the drawer shows git's reason —
  send feedback to the agent, or resolve it yourself.
- **Open a PR** appears when `gh` is installed and signed in and the repository has a remote.
- The copies live in `~/.spectoflow/worktrees/`, outside your project (no tool sees a second copy of the code) and
  outside `.git` (agents refuse to write there). Uncommitted changes in your working tree aren't in the copy; the
  drawer tells you how many.
- **Online:** members with write access can start, review, send feedback and discard; merging and opening a pull
  request stay on the owner's machine.

### Slash commands

Type `/` in either chat surface to open an autocomplete of reusable **prompt macros** — pick one,
type your text, send. Five ship built-in (`/spec`, `/plan`, `/revue`, `/resume`, `/rapport_jour`);
add your own from **Personalize → Commands** (a trigger, a short description, and the instruction the
agent receives — put `{{input}}` where your text should land, or it's appended). Expansion happens
**client-side**, so it's fully agent-agnostic: the agent never sees the `/`, it gets the full
instruction, while the chat log keeps the short `/rapport_jour focus bugs` you typed. Commands persist
in `config.json` (the DB online), so they survive a refresh and travel with the project.

### Customize

Personalize → **Extend spectoflow** lets you extend the project's own spectoflow install: add a
dashboard, a skill, or an agent by describing what you want (or hit **Auto** to have the agent survey
the project and propose candidates) — it clarifies first if the ask is ambiguous.

- Dashboards are never raw HTML — they're a small **declarative block spec** (`markdown`, `kpi-row`,
  `chart-bars`, `chart-donut`, `table`, `list`, `stat-tile-row`) rendered by the same components the
  built-in Board uses, so a generated dashboard automatically matches whatever design is active, in
  both themes, and keeps matching if you switch designs later. Blocks can bind live to project stats
  (`bind: "phases.0.pct"`) or hold a static value.
- Generated skills and agents follow the same gold-standard shape as the shipped ones, cite real
  domain standards (OWASP, WCAG, C4/ADR, …) instead of generic advice, and are marked `origin:
  user-generated` so they're easy to tell apart in the UI.

The same generators are available from the terminal — each streams the agent's run live and exits
with its status, the same pipeline the dashboard's Generate/Auto buttons use:

```bash
spectoflow skill create "reviews PRs for accessibility"      # or: --auto to propose candidates
spectoflow agent create "owns accessibility review"          # or: --auto
spectoflow dashboard create "a KPI overview for support"     # or: --auto
```

## Second brain

spectoflow learns about **you** as you work, and remembers it across all your projects: your role, your
preferences, how you like to work, what to avoid. Every agent session starts with it, whatever the agent.

```
  you work, in any project, with any agent
        │  "commit messages in English, always"
        ▼
  the agent records it ── brain_learn ──►  ~/.spectoflow/brain.md   (one file, yours, never in a repo)
                                                   │
        ┌──────────────────────────────────────────┼─────────────────────────────┐
        ▼                                          ▼                             ▼
  next session, any project:             dashboard → Second brain tab:   you can edit the file
  the agent starts with it               read, add, fix, confirm         by hand, too
```

**One-time setup, per machine:**

```bash
spectoflow brain setup --dry-run   # see what it would change
spectoflow brain setup             # connect every coding agent installed on this machine
```

It registers a small MCP server, `spectoflow mcp`, in each installed agent's **user-level** config (Claude
Code, Codex, Cursor, Gemini, OpenCode, Kiro, Antigravity, Copilot, Amazon Q, Droid, Auggie, Kimi; Goose
gets a snippet to paste). It never touches an existing entry and never rewrites a file it can't parse. The
agents then read and grow your second brain through that server: nothing is copied into your projects.

- **Four categories:** Profile, Preferences, Working style, Avoid.
- **Facts an agent records through MCP are added directly by default.** To review them first, untick *Add what the agent learns
  directly* on the page, or run `spectoflow config set brain.autoAdd false`: new facts then wait in
  *To confirm*.
- **What gets recorded:** durable facts only. Never secrets, credentials or sensitive personal data, never
  a one-off instruction. The rule is written in every agent's instructions and in the MCP tools themselves.
- **Runs launched from the dashboard:** non-interactive agents often refuse MCP tools, so the agent prints a
  `::spectoflow learn category=… msg=…` line instead. Those always wait in *To confirm*, whatever the setting:
  that output also carries command output and file contents, so a line hidden in a repository can't slip
  in unseen.
- **Private:** the *You* section and its API answer this machine only — not the online dashboard
  (`server/` refuses them for everyone, the project owner included), and not other machines or websites.
  A run started from either of those can't write into it, and a learned fact never goes into a project's chat
  log.

### Project memory

Some facts aren't about you but about **one project**: its conventions, what breaks, its vocabulary, its
constraints. Those go in `.spectoflow/memory.md`, **committed with the code**, so your team and their agents
share them — and your other projects don't inherit them.

```markdown
# Project memory

## Conventions
- Tests run with `npm test -- --runInBand` (shared DB fixtures)

## Glossary
- "Ticket" means a customer support case, never a Jira issue
```

- **Four categories:** Conventions, Pitfalls, Glossary, Constraints.
- **The agent reads and writes the file directly** — no setup. About you → second brain; about the project →
  this file. Never anything personal in it.
- **Facts the agent adds land directly by default.** To review them first, untick *Add what the agent learns
  directly* in the *This project* section: that sets `memoryAutoAdd: false` in `.spectoflow/config.json`, for
  the whole team.
- **Wrong memory?** *Move to…* on any fact sends it to the other one, in the category you pick (local dashboard
  only).
- Created on the first fact; `spectoflow update` never touches it.

## A workflow that fits the project

The workflow (`.spectoflow/workflow.md`) isn't one-size-fits-all anymore.

- **At `init`**, spectoflow looks at the files: is there code yet, tests, an end-to-end setup (Playwright,
  Cypress), infrastructure (Terraform, Helm) or data (dbt, notebooks)? A project still in design gets
  Brainstorm, Analysis, Spec and Plan — and *Develop*, *Unit tests* and *Review* stay off until there is code.
  Integration and end-to-end tests are switched on only if the project already has them. `init` tells you
  what it switched off and why. An existing `workflow.md` is never touched.
- **At the first session**, your agent reviews it with you: a file scan can't tell a prototype from a
  product, the agent can, from your docs, specs and plans.
- **As the project moves on**, when a request needs a step that is off (asked to write code while *Develop*
  is off…), the agent asks you first — or, with Personalize → *Let the agent enable workflow steps when
  needed* (`workflowAutoEnable` in `config.json`), it enables the step itself and tells you. It never
  disables a step on its own.
- **For a project initialized before this**, run `spectoflow workflow suggest` (add `--apply` to apply), or
  use Workflow → **Analyze the project** in the dashboard and tick the changes you want.

You can still switch any step on or off by hand, anytime.

## Agents vs skills

Agents (`.spectoflow/agents/`) are **stable team personas** (Product Manager, Developer, QA Engineer…).
Skills (`.spectoflow/skills/`) are **evolving procedures**. A workflow step → a capability → its agent →
runs a skill. Improve a skill without touching the agent.

Agents and skills follow real domain standards, cited in-file — TDD, OWASP ASVS/Top 10, C4/ADR,
INVEST, Playwright E2E, Conventional Commits, and more — not generic one-liners.

### Clarify before acting

spectoflow is an **expert analyst, not an order-taker**. When a request is vague ("login displays
badly, users can't sign in"), an always-on **Clarify reflex** — in the agent's memory (`SPECTOFLOW.md`)
and backed by the `clarify` skill — reflects it back and asks **one targeted question at a time**,
each with a recommendation anchored in the project's goals and best practices, until the need is
crisp; then it runs the normal workflow. It's additive: it feeds the router, never replaces it, and
it's mode-aware.

### End-to-end tests run headed, in the real browser, by default

`write-e2e-tests` defaults to **Playwright lib, `--headed`** for its own local runs — the browser
window is visible so a flow that "passes" for the wrong reason gets caught, not just a bare pass/fail
line. `--ui` mode is used for authoring a flow or chasing a failure interactively. It only steps down
when you asked for something else or headed genuinely can't launch — and it **always says why** via
the `::spectoflow` sentinel, never a silent switch:

1. Playwright lib, headed (default)
2. `--ui` (interactive authoring/debugging)
3. Playwright lib, headless
4. **Playwright MCP**
5. the client's native browser tooling (e.g. Claude Code's Chrome extension)
6. write the spec and raise a `need`

CI keeps running the committed suite headless — that's the pipeline's job, not a fallback. `init`
idempotently wires a `playwright` entry into the target project's `.mcp.json` (and
`.cursor/mcp.json` for Cursor) so the MCP rung works out of the box — `npx` fetches the server on
first use, so spectoflow stays zero-dep (the config lives in *your* project). The durable artifact is
always the committed `*.spec.ts`; the Workflow tab's End-to-end step shows this policy in its
dashboard popover.

### Keeping spec and code honest

A `governance` capability adds a **Spec Source Guardian** (skill `audit-source`): it keeps the spec
(intent) and the code/tests (reality) coherent — flagging drift in both directions, never auto-fixing,
surfacing findings to the Attention tab, and gating only at `done`/Major. It ships with a zero-dep
drift helper (`lib/spec-drift.js`) and an opt-in Claude Code `Stop` hook (`hooks/spec-drift.js`).

## Language

`.spectoflow/config.json` → `language` (default `en`, incl. code comments). Switchable from the CLI
(`config.json`), the dashboard's **Personalize** tab, or the topbar's language select directly.

## Studied, not copied

spectoflow's design was informed by three open-source projects worth knowing about in their own
right — credit where it's due:

- **[GitHub spec-kit](https://github.com/github/spec-kit)** — the spec-driven workflow itself
  (spec → plan → tasks) and its own multi-agent integration list, which shaped how spectoflow thinks
  about agent-agnosticism.
- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** by Fission AI — markdown as the source of
  truth and the per-agent adapter pattern (a thin native entry file per coding agent, pointing back
  to one canonical brain) that `lib/adapters.js` is built on.
- **[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)** — stable, named agent personas
  (PM, Architect, Developer, QA, …) as the right way to give an AI coding agent a consistent role,
  rather than one undifferentiated prompt.

spectoflow keeps what worked, drops the ceremony each of those needs from you, and adds what none of
them had: a real-time local dashboard (board, chat, live agent-run tracking) and a genuinely
exhaustive, individually-verified agent-CLI compatibility list — see [Supported coding
agents](#supported-coding-agents) above.

If you use spec-kit, OpenSpec, or BMAD-METHOD today, spectoflow is worth a look; if you're evaluating
spectoflow, those three are worth a look too.

## License & author

MIT © 2026 [Georges MOMO](https://github.com/georgesmomo).
