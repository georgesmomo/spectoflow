# Slash Commands for the Dashboard Chat — Design

**Date:** 2026-09-12
**Status:** Approved (approach), pending spec review
**Author:** Georges MOMO + Claude

## Problem

The dashboard chat sends the user's raw text straight to the agent. There is no way
to save a reusable prompt macro. A user who repeatedly asks the agent to "write the
daily report structured as A/B/C" must retype that framing every time. Coding agents
(Claude Code, etc.) solve this with `/slash` commands: type `/`, pick a command,
type arguments, and a saved instruction is expanded into the real prompt.

We want the same in the spectoflow dashboard: a set of built-in commands, plus
user-defined commands managed from **Personalize**, surfaced by a `/` autocomplete in
the chat input, expanded into a full instruction sent to the agent.

## Goals

- Type `/` in either chat input (floating widget + Chat tab) → an autocomplete menu of
  available commands (filtered as you type), keyboard- and mouse-selectable.
- A command carries three fields: **trigger**, **description** (menu subtitle),
  **instruction** (the prompt body the agent receives).
- Ship a curated set of built-in commands (`/spec`, `/plan`, `/revue`, `/resume`,
  `/rapport_jour`), each editable and disable-able.
- Add / edit / delete custom commands from a **Commands** card in Personalize.
- Commands persist through the **existing** `writeConfig()` mechanism → `config.json`
  locally, → DB via the relay online. No new storage subsystem, no DB schema.
- Expansion is **client-side and agent-agnostic**: the agent never sees the `/`; it
  receives a normal, rich prompt, so any agent (Claude/Codex/Gemini/…) works unchanged.
- The chat log stays readable: it shows the short invocation (`/rapport_jour focus bugs`),
  while the agent receives the expanded instruction.

## Non-goals

- No server-side command parsing/execution. Commands are prompt macros, not RPC.
- No arguments beyond a single free-text tail. No flags, no multi-slot templates
  beyond one `{{input}}` placeholder.
- No commands in the CLI (`spectoflow ... create`). Scope is the dashboard chat only.
- No sharing of commands between projects (each project's `config.json` is its own).
- Built-in commands are not synced into `templates/config.json` (avoids duplication);
  they live in code and are the fallback when `config.commands` is absent.

## Data model

New optional field `config.commands`: an array of command objects.

```jsonc
{
  "trigger": "rapport_jour",                       // without the leading "/"
  "description": "Génère le rapport du jour",       // short, shown in the menu
  "instruction": "Rédige le rapport quotidien structuré ainsi : 1) faits marquants 2) blocages 3) prochaines étapes.",
  "enabled": true                                   // disable without deleting
}
```

Field rules (enforced by the pure `commands.js` validators AND by `writeConfig`):

| Field | Rule |
|---|---|
| `trigger` | string matching `^[a-z0-9][a-z0-9_-]{0,39}$` (1–40 chars, starts alphanumeric). Case-insensitive uniqueness within the array. |
| `description` | string, trimmed, clamped to 120 chars. May be empty. |
| `instruction` | non-empty string (after trim), clamped to 4000 chars. |
| `enabled` | boolean; missing/other coerces to `true`. |

`config.commands` semantics:
- **absent / not an array** → the dashboard uses `BUILTIN_COMMANDS` (the shipped set).
- **present (array, possibly empty)** → the single source of truth; used as-is. An
  empty array means the user removed everything and sees no commands.
- The first time the user edits anything, the full current list (built-ins + edits) is
  persisted via `saveSetting({ commands })`, so `config.commands` becomes present.
- A **"Restore default commands"** action re-seeds by saving a fresh copy of
  `BUILTIN_COMMANDS`.

## Components & file structure

### 1. Pure module — `lib/dashboard/public/commands.js` (new)

Zero-dependency, loaded in the browser via `<script>` and `require()`-able in
`node --test` (same UMD-ish pattern as `stats.js`/`charts.js`). Single source of truth
for the command logic and the built-in set.

Exports:
- `BUILTIN_COMMANDS` — the 5 shipped commands (see "Built-in commands" below).
- `effectiveCommands(config)` → returns `Array.isArray(config.commands) ? config.commands : BUILTIN_COMMANDS.slice()`.
- `validateTrigger(trigger, existingTriggers)` → `{ ok: true }` or `{ ok:false, error:"…" }`
  (format + uniqueness). `existingTriggers` is a lowercased array to check against.
- `matchCommands(query, commands)` → the enabled commands whose `trigger` starts with
  `query` (case-insensitive), in array order. `query` is the text typed after `/`.
- `parseInvocation(text)` → if `text` (after an optional leading space trim) matches
  `^/([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$`, returns `{ trigger, rest }` (rest may be
  `""`); else `null`. Used to decide whether a send is a command.
- `expandCommand(text, commands)` → given the raw input and the command list, if
  `parseInvocation(text)` matches an **enabled** command by trigger (case-insensitive),
  returns `{ prompt, display }` where:
    - `prompt` = instruction with `{{input}}` replaced by `rest.trim()` if the token is
      present; otherwise `rest.trim() ? instruction + "\n\n" + rest.trim() : instruction`.
      Every `{{input}}` occurrence is replaced (global). If `{{input}}` is present and
      `rest` is empty, it is replaced with an empty string.
    - `display` = the original `text` trimmed (the short invocation).
  If no command matches (unknown `/foo`, or plain text), returns `null` (caller sends
  the raw text unchanged).

### 2. Server persistence — `lib/dashboard/ops.js`

New branch in `writeConfig()` for `commands`, placed alongside the other whitelist
branches. Behavior (backstop; the client pre-validates):
- If `patch.commands` is present and **not** an array → reject the whole patch (return
  config unchanged), matching the `kanbanColumns`/`navTabs` reject-whole-patch pattern.
- If it is an array, validate each entry: coerce `enabled` to boolean; trim+clamp
  `description` (120) and `instruction` (4000); require `trigger` to match the regex and
  `instruction` to be non-empty after trim. If **any** entry is fundamentally malformed
  (bad/absent trigger, empty instruction) → reject the whole patch. Dedupe triggers
  case-insensitively (keep first). An empty array is valid and persists as `[]`.

`NATIVE_TABS`-style: no new op is needed — `settings.save` already carries arbitrary
config patches through `writeConfig`. The `commands` field flows through the local hub
and the online relay identically (shared `ops.js`).

`templates/config.json` is **not** changed (built-ins live in `commands.js`).

### 3. Runner display field — `lib/dashboard/runner.js` + `ops.js` `run.start`

`startRun(root, { prompt, agent, display }, emit)`: when `display` is a non-empty
string, log **that** as the user chat bubble (`store.appendMessage`) while spawning the
child with `prompt` (the expanded instruction). When `display` is absent, behavior is
exactly as today (`prompt` is both logged and spawned). `run.start` in `ops.js` passes
`display` through from the request body. Fully backward compatible.

`doOrchestrate` posts `{ request }` to `/api/orchestrate`; the orchestrator's
run-start message uses the request text. For orchestrate, expansion produces the
expanded `request` (no separate display needed for the orchestrate priming — it already
runs with `logPrompt:false` per D24, so the expanded request is not echoed as a bubble).

### 4. Client wiring — `lib/dashboard/public/app.js`

- **Expansion on send.** In `doRun()`, before the `fetch`: `const ex = expandCommand(raw, cmds)`;
  if `ex`, POST `{ prompt: ex.prompt, display: ex.display, agent }`; else POST `{ prompt: raw, agent }`
  as today. In `doOrchestrate()`, expand the request the same way (send `ex.prompt` as
  `request` when matched, else raw). `cmds` comes from `effectiveCommands(P.config)`.
- **Autocomplete menu.** One reused global menu element (not design-scoped). An `input`
  listener on `#runPrompt` and `#tabRunPrompt`: if the value matches
  `^/([a-z0-9_-]*)$` (a slash then command chars, no space yet), show the menu filtered
  by the captured query via `matchCommands`; otherwise hide it. The menu is anchored
  above the active textarea (reuse the viewport-aware `positionWfPop` approach or a
  simple absolute placement above the input; must not overflow the viewport).
  - Rows: `/trigger` + description. Empty state: "No command — add one in Personalize".
  - Keyboard (only while the menu is open): ↑/↓ move highlight, `Enter`/`Tab` select and
    `preventDefault`, `Esc` closes. Plain `Enter` in a textarea is a newline today (send
    is Ctrl/Cmd+Enter), so intercepting `Enter` while the menu is open does not change
    the send behavior. When the menu is closed, all key handling is unchanged.
  - Select → set the textarea value to `/trigger ` (trailing space), keep focus, cursor
    at end, hide the menu. The user then types arguments and sends normally.
  - Close on: outside click, `Esc`, blur (with a small delay so a click on a row wins),
    tab switch, resize (reuse existing close-on-* wiring at app.js ~2111).
  - Accessibility: `role="listbox"`/`role="option"`, `aria-activedescendant`.
- **Settings render.** `renderCommandsSettings()` mirrors `renderNavTabsSettings()`:
  builds rows into a new container, each with an enable checkbox, the `/trigger`, the
  description, and Edit/Delete buttons; a "+ Add command" control opens an inline form
  (trigger input, description input, instruction textarea, Save/Cancel); Edit reuses the
  form pre-filled. Client-side validation with inline error text (bad trigger, duplicate,
  empty instruction). All mutations call `saveSetting({ commands })`. A
  "Restore default commands" button re-seeds `BUILTIN_COMMANDS`. Disabled entirely in
  read-only (relay-offline) mode, like the other settings. Called from `renderSettings()`.

### 5. Markup — `lib/dashboard/public/index.html`

- A new `.settings-card.settings-card--wide` "Commands" card inside `.settings-groups`
  in the Personalize panel, containing `<div id="commandsList">` and the add/edit form
  scaffold (hidden by default), plus the Restore-defaults button.
- One global autocomplete menu container appended near the chat surfaces (e.g. a single
  `<div id="cmdMenu" class="cmd-menu" hidden role="listbox">` at body level), reused by
  both inputs.

### 6. Styles — `lib/dashboard/public/styles.css`

- `.cmd-menu` (absolute, themed surface, `var(--line)` border, shadow, `max-height` with
  internal scroll using the existing thin/themed scrollbar pattern), `.cmd-item`,
  `.cmd-item.is-sel`, `.cmd-item .cmd-trigger` (mono, `var(--signal)`), `.cmd-item .cmd-desc`
  (muted), `.cmd-empty`. **No gradients** (guarded by `dashboard-no-gradients.test.js`).
- Command editor rows/form: reuse `.nav-tabs-row`/settings-card conventions; add
  `.cmd-row`, `.cmd-form`, `.cmd-error` as needed. `[hidden]{display:none!important}`
  already present to beat `display:flex`.

### 7. i18n — `lib/dashboard/public/i18n.js`

New keys across all 6 languages (en/fr/es/de/pt/it), key-complete: card title
("Commands"), add/edit/delete/save/cancel/restore labels, form field labels
(trigger/description/instruction), the `{{input}}` hint, validation messages
(invalid trigger, duplicate trigger, empty instruction), autocomplete empty state.

## Built-in commands (shipped defaults)

All instructions written in a neutral, agent-directing tone. `description` is the menu
subtitle; `instruction` is the expanded prompt. Language of the instruction text
follows the project (English source; the user edits freely).

1. `spec` — "Write or update a spec" — instruction directs the agent to draft/update a
   spec markdown for `{{input}}` (or the current focus) following the project's spec
   conventions.
2. `plan` — "Break work into a task plan" — instruction directs decomposition into
   checkbox tasks under the plan conventions.
3. `revue` — "Code-review the current diff" — instruction directs a review of the
   working-tree diff for correctness and quality.
4. `resume` — "Summarize progress" — instruction directs a concise status summary.
5. `rapport_jour` — "Structured daily report" — instruction directs a dated daily
   report with fixed sections (highlights / blockers / next steps).

Exact instruction strings are fixed in the implementation plan.

## Data flow

```
user types "/rapp"          → input listener → matchCommands("rapp") → menu shows /rapport_jour
user selects                → textarea = "/rapport_jour "  (menu hides)
user types "focus bugs"     → textarea = "/rapport_jour focus bugs"
user sends (Ctrl/Cmd+Enter) → doRun:
    raw = "/rapport_jour focus bugs"
    expandCommand(raw, cmds) → { prompt: "<instruction, {{input}}→focus bugs or appended>",
                                 display: "/rapport_jour focus bugs" }
    POST /api/run { prompt, display, agent }
        → run.start → startRun({prompt, display})
            → chat bubble logs `display`   (short, readable)
            → spawn child with `prompt`     (full instruction to the agent)
```

## Error handling & robustness

- Unknown `/foo` or plain text → sent verbatim (never blocked).
- Disabled command → not offered in the menu; `expandCommand` ignores it (treated as
  unknown → verbatim).
- Malformed `config.commands` from a hand-edited file → `effectiveCommands` still
  returns it, but the menu/expansion tolerate missing fields (skip entries lacking a
  valid trigger or instruction). `writeConfig` never writes a malformed array.
- Empty/whitespace prompt → existing guard (`if(!prompt) return`) unchanged; a bare
  `/rapport_jour` with an empty-`{{input}}`/no-tail expands to the instruction alone.
- Read-only relay mode → editor disabled; expansion/menu still work (read paths).

## Testing

- **`test/commands.test.js` (new)** — pure-module unit tests:
  `validateTrigger` (format, uniqueness), `matchCommands` (prefix filter, disabled
  excluded, order), `parseInvocation` (matches, tail capture, non-matches),
  `expandCommand` (`{{input}}` single/multiple/absent, append when no placeholder, empty
  tail, unknown/disabled → null, display equals raw).
- **`test/ops.test.js` (extend)** — `writeConfig` commands branch: valid array persists;
  non-array rejects whole patch; malformed entry rejects whole patch; dedupe;
  length clamp; `enabled` coercion; empty array persists.
- **`test/runner.test.js` (extend or add)** — `startRun` logs `display` as the user
  bubble while spawning `prompt`; absent `display` preserves current behavior. (Use the
  existing runner test harness / injected spawn if present; otherwise assert via the
  emitted messages.)
- **`dashboard-no-gradients.test.js`** — remains green (new CSS adds no gradients).
- **Real browser QA** — `/` menu appears/filters/keyboards on both surfaces; select +
  args + send produces the expanded prompt to the agent and the short bubble in chat;
  add/edit/delete/disable/restore in Personalize persist across a reload; a custom
  command survives `spectoflow dashboard restart`.

## Rollout

Built across right-sized tasks via subagent-driven-development, each independently
reviewed, then a whole-branch review, then push to origin/main only after explicit user
confirmation — same workflow as sub-projects A/B/C.

## Open questions

None blocking. Exact built-in instruction wording is finalized in the plan.
