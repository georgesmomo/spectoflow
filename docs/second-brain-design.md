# Second brain — design

**Status:** approved by the user and implemented, 2026-09-16 (v0.29.0, DECISIONS D73). Revision 2: MCP instead of a per-project copy.

## Goal

A page that holds what spectoflow has learned about **the user** — facts, preferences, working style,
things to avoid. It grows as the user works (the agent learns), the user can open it and add or fix
things by hand, and it reaches every agent session, whatever the agent.

## Decisions taken with the user

1. **One personal second brain, shared by all the user's projects.** Private, a single file in
   `~/.spectoflow/`, never committed to any repository.
2. **No copy of the file anywhere.** Rejected: a read-only copy per project (revision 1).
3. **Agents reach it through an MCP server shipped by spectoflow** (`spectoflow mcp`), not by reading
   or writing files themselves.
4. **Learned facts are added directly by default.** A setting switches to "the agent proposes, I
   confirm". Facts the user adds by hand are always confirmed.
5. **A few fixed categories**, so the page stays readable and the agent knows where a fact goes.

## Why MCP

- Many agents can't write outside the project (Codex's default sandbox), and reading outside it can
  prompt for permission every session. An MCP server is a separate process started by the agent's
  host, outside that restriction: it reads and writes `~/.spectoflow/brain.md` freely.
- It covers terminal sessions, not only runs launched from the dashboard (`::spectoflow` lines are only
  parsed for those).
- Nothing lands in the project: no copy, no inbox, no sync loop.
- `init` already registers an MCP server (Playwright, `lib/mcp.js`), so the wiring pattern exists.

## Design

### The file

`~/.spectoflow/brain.md` (`$SPECTOFLOW_HOME/brain.md`), next to the global `config.json`. Plain
markdown, readable and editable by hand. One `##` per category, one bullet per entry, metadata in a
trailing HTML comment (invisible when rendered):

```markdown
# Second brain

## Profile
- Scrum master and full-stack developer <!-- id:b7k2 by:agent at:2026-09-16 -->

## Preferences
- Always answers in French, technical terms in English <!-- id:b7k3 by:user at:2026-09-16 -->

## Working style
- Wants a short recommendation, not a list of options <!-- id:b7k4 by:agent at:2026-09-16 -->

## Avoid
- Never push or publish without being asked <!-- id:b7k5 by:user at:2026-09-16 -->

## To confirm
- [preferences] Prefers ASCII diagrams in READMEs <!-- id:b7k6 by:agent at:2026-09-16 -->
```

Category ids: `profile`, `preferences`, `workflow` (*Working style*), `avoid`; labels are translated in
the UI. A line the parser can't read is kept as-is, never dropped (the file may be edited by hand).
Every line spectoflow doesn't change is written back byte for byte (title, blank lines, comments, code
blocks, unknown sections and their order, hand-written entries — ids of hand-written lines are derived and
stable). Writers in different processes take a lock file, then write-then-rename.

### The setting

`brain.autoAdd` in the global config (`~/.spectoflow/config.json`), default `true`. `true`: a learned
fact becomes a confirmed entry. `false`: it lands in "To confirm". Editable from the page and with
`spectoflow config set brain.autoAdd false`.

### The MCP server — `spectoflow mcp`

Zero-dependency stdio server (JSON-RPC 2.0, one message per line; stdout carries only protocol,
diagnostics go to stderr). Methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`,
`tools/call`; anything else answers `-32601`.

- **`initialize`** returns `capabilities: { tools: {} }`, `serverInfo: { name: 'spectoflow', version }`,
  and **`instructions`**: how to use the two tools **plus the current confirmed entries**. Clients that
  inject server instructions into the model's context therefore load the brain at session start with no
  tool call (which clients do: see the wiring table).
- **Tools:**
  - `brain_read` — no input. Returns the confirmed entries as markdown, grouped by category.
  - `brain_learn` — `{ category, text }`. Adds one durable fact (confirmed or "to confirm", per the
    setting). Unknown category → `preferences`. Text trimmed, capped at 500 characters, exact duplicates
    (case-insensitive) ignored and reported as such.
- **Tool descriptions carry the rules**: record only durable facts about the user (a stated preference,
  a correction of how you work, their role, a habit); never secrets, credentials, tokens or sensitive
  personal data (health, finances, third parties); never a one-off instruction as a preference; one fact
  per call.

### What the agent is told (`templates/SPECTOFLOW.md` + the root entry files)

A short **Second brain** section: at session start, if the brain wasn't already given to you (server
instructions), call `brain_read` and apply it; when you learn something durable about the user, call
`brain_learn` — and if that tool is unavailable or refused, print the `::spectoflow learn …` line
instead (see *Headless runs*); the rules above.

**Added during implementation:** the same rule, in four lines, in the root entry files (`CLAUDE.md`,
`AGENTS.md`, `GEMINI.md`) — the way the Clarify reflex is reinforced (D31). A live test showed why: on a
short, non-interactive answer, Claude Code did not open `.spectoflow/SPECTOFLOW.md` and recorded nothing;
with the reminder in `CLAUDE.md`, the same run printed the `::spectoflow learn` line and the fact was
recorded.

### Wiring the server into each agent

Researched against each agent's own docs (and source code where the docs were silent), 2026-09-16.

**Scope: user level, once per machine.** The brain is personal; and in practice project-level
registration is unreliable or absent for several agents — Codex only reads a *trusted* project's
`.codex/config.toml`, Antigravity ignores its project file (open bug, antigravity-cli#60), Goose and
Kimi have no project scope, Gemini and Copilot need folder trust. User-level config works for all.

| Agent | User-level config | Entry | Server `instructions` used |
|---|---|---|---|
| Claude Code | `~/.claude.json` — written through `claude mcp add --scope user` (Claude Code rewrites this file constantly; never edited directly) | `command`, `args` | **yes** (verified live: the brain was in context with no tool call) |
| Codex | `~/.codex/config.toml` | TOML `[mcp_servers.spectoflow]` `command`, `args` | **yes** (documented) |
| Cursor | `~/.cursor/mcp.json` | JSON `mcpServers` | unverified |
| Gemini CLI | `~/.gemini/settings.json` | JSON `mcpServers` | **yes** (documented) |
| OpenCode | `~/.config/opencode/opencode.json` | JSON `mcp.spectoflow: {type:"local", command:[…], enabled:true}` | unverified |
| Kiro CLI | `~/.kiro/settings/mcp.json` | JSON `mcpServers` | unverified |
| Antigravity | `~/.gemini/config/mcp_config.json` | JSON `mcpServers` | unverified |
| Copilot CLI | `~/.copilot/mcp-config.json` | JSON `mcpServers` (`type:"local"`) | **yes** (changelog; flag for all servers) |
| Amazon Q | `~/.aws/amazonq/mcp.json` (legacy global file, the one the default agent loads) | JSON `mcpServers` | unverified |
| Factory Droid | `~/.factory/mcp.json` | JSON `mcpServers` | unverified |
| Auggie | `~/.augment/settings.json` | JSON `mcpServers` | unverified |
| Goose | `~/.config/goose/config.yaml` | YAML `extensions.spectoflow` | **yes** (verified in source) |
| Kimi CLI | `~/.kimi/mcp.json` | JSON `mcpServers` | unverified |

**How it gets registered: an explicit command, `spectoflow brain setup`** (`--dry-run` supported). It
edits files in the user's home, outside any project, so it is never a silent side effect of `init`;
`init` and the page point to it. For each agent detected on the machine: add the `spectoflow` entry if
absent, leave an existing entry alone, never rewrite a file it can't parse (JSONC with comments, invalid
JSON), and report what it did per agent. Two exceptions, reported with the exact snippet to paste
instead of an automatic edit: **Goose** (YAML — no safe zero-dependency editing) and any file skipped as
unparseable. The page shows which agents are wired.

Command written into each entry: `spectoflow mcp` when `spectoflow` is on `PATH` (global install), else
`node <absolute path to bin/spectoflow.js> mcp` (running from a clone); `SPECTOFLOW_HOME` passed in `env`
when it is set.

### Headless runs launched by the dashboard

The real obstacle found in the research is **tool approval in non-interactive mode**: `claude -p` needs
the tool explicitly allowed, `codex exec` cancels MCP tool calls without approval (open bug
openai/codex#24135), `agy -p` soft-denies, `droid exec` is read-only by default. In an interactive
terminal the agent simply asks, so this only concerns runs launched from the dashboard.

- **Reading** still works where the client uses server `instructions` (Codex, Gemini, Goose, Copilot,
  likely Claude Code): the brain is in context with no tool call.
- **Learning** gets a fallback that needs no permission: when `brain_learn` is unavailable or refused,
  the agent prints `::spectoflow learn category=<id> msg=<text>`. The dashboard's run pipeline already
  parses `::spectoflow` lines (`runner.js`, like `attention`); it records the fact through the same
  `lib/brain.js` code. In a terminal that line is just printed — but there the tool call works.
- *Changed after the independent review:* a fact from such a line **always lands in "To confirm"**,
  whatever `brain.autoAdd` says — the runner reads the child's raw stdout/stderr, which also carries
  command output and file contents, so a line planted in a repository must not become a standing
  instruction unseen. It is **never written into the chat log** (that log is part of `project.read`, which a
  published project sends to the relay); the page learns about it from the hub's local-only watcher. And a
  run started by a remote caller (the relay, or another machine on the network) ignores learn lines.
- Runner commands in `config.json` are not changed.

### The page

A new **Second brain** tab (`brain`), enabled by default, in the configurable nav (`config.navTabs`;
`NATIVE_TABS` mirrored in `ops.js`, `app.js` and the client routes), all 6 designs, i18n in the 6
languages:

- At the top, the **"Add what the agent learns directly"** toggle (the setting), and an entry count.
- If there are entries to confirm: a **To confirm** block first — each with **Confirm**, **Edit**,
  **Reject**, and a **Confirm all**.
- One card per category: its entries (edit inline, delete), and an **Add** field at the bottom of each
  card (the category is implied).
- Empty state explaining what the page is and that the agent fills it as you work.
- No native `prompt()`/`confirm()` (they block SSE); inline forms, like the other tabs.
- Past ~60 entries, a discreet notice suggests pruning (the brain is loaded every session). Nothing is
  ever truncated silently.
- Live: the hub watches `~/.spectoflow/brain.md`, so a fact learned through MCP during a session appears
  on an open page without a reload.

### API

Routes in `lib/dashboard/routes.js`, ops in `lib/dashboard/ops.js`, logic in a new zero-dependency
`lib/brain.js` (parse, serialize, add, update, remove, confirm, learn), shared with the MCP server:

| Route | Op |
|---|---|
| `GET /api/brain` | `brain.read` → `{ entries, pending, autoAdd }` |
| `POST /api/brain` | `brain.add` `{ category, text }` |
| `PATCH /api/brain/:id` | `brain.update` `{ text?, category? }` |
| `DELETE /api/brain/:id` | `brain.remove` |
| `POST /api/brain/:id/confirm` | `brain.confirm` |
| `POST /api/brain/settings` | `brain.settings` `{ autoAdd }` |

The brain is **not** added to `project.read` (whose payload is also sent to the relay as a snapshot).

### Privacy online

- `brain.*` ops are deliberately **absent** from the relay's `OP_PERMISSIONS` → refused online (it
  fails closed on unknown ops).
- Defense in depth: the connector's `execOp` passes `ctx.remote = true`, and `brain.*` ops refuse when
  it is set.
- The tab is hidden when the dashboard is served by the relay.
- No brain file inside any project, so the Files tab can't expose it.
- A request to the local hub is **local only if** its socket is loopback, its `Host` is local, and its
  `Origin` (when the browser sends one) is that same host — otherwise it is treated like a relay request
  (`ctx.remote`, `handlers.js`). The hub listens on every interface (LAN), and a loopback socket alone isn't
  enough: a DNS-rebinding page, a cross-site POST, or a tunnel/proxy on the same machine all arrive from
  127.0.0.1. *(Found in the independent review and its re-verification.)*
- A run started online (or from the LAN) can't write into the brain: `run.start` and `orchestrate.start`
  pass `learn: false` to the runner.
- The MCP `instructions` frame the entries as data about the user, never commands that override safety
  rules, host permissions or the current request.
- **Known limit, documented rather than solved:** a member allowed to launch a run online runs the agent
  on the owner's machine, where the MCP server serves the owner's brain. What the agent answers can
  reflect it.

## Out of scope (v1)

- A per-project or team-shared brain (the user chose personal only).
- Syncing the brain between several machines.
- Automatic summarizing/merging of entries.
- MCP tools to edit or delete entries (the page does it; the agent only reads and learns).

## Tests

- `lib/brain.js`: parse ↔ serialize round-trip (unknown lines kept), add/update/remove/confirm, learn
  with `autoAdd` on and off, category fallback, dedup, cap.
- MCP server: spawn `spectoflow mcp` against a temporary `SPECTOFLOW_HOME`, drive `initialize`
  (instructions contain the brain), `tools/list`, `tools/call` for both tools, an unknown method, a
  malformed line (doesn't crash).
- `brain setup`: each config format (JSON `mcpServers`, OpenCode `mcp`, Codex TOML) created / added /
  left alone when present / never rewritten when unparseable; Goose reported as a snippet; `--dry-run`
  writes nothing; only detected agents touched. Always against a temporary `HOME`.
- Runner: a `::spectoflow learn` line records the fact and isn't shown as raw output.
- Ops: every `brain.*` op, refusal with `ctx.remote`.
- Relay (`server/`): a `brain.*` route answers 404 online.
- A real session: an actual agent learns a fact through MCP, it appears on the page live.
- Real browser QA of the page (add, edit, confirm, delete, toggle) in at least 2 designs.
