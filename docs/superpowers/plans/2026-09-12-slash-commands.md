# Slash Commands for the Dashboard Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/slash-command` system to the dashboard chat — built-in + user-defined prompt macros, surfaced by a `/` autocomplete, expanded client-side into a full instruction sent to the agent.

**Architecture:** A new zero-dependency pure module (`commands.js`, same UMD-ish pattern as `stats.js`) owns the command logic and the built-in set, unit-tested in `node --test`. Commands persist through the existing `writeConfig()`/`config.json` mechanism (local file / online DB via the relay). Expansion is client-side and agent-agnostic: the agent receives a normal prompt; the chat log shows the short invocation via a new optional `display` field on the runner.

**Tech Stack:** Node ≥ 22, native `node:test`, vanilla browser JS (no framework, no build step), the existing dashboard SSE/ops layer.

**Spec:** `docs/superpowers/specs/2026-09-12-slash-commands-design.md`

## Global Constraints

- **Zero runtime dependencies** for the installed framework (native Node http/fs only). No npm packages.
- **Everything in English**, including code comments. UI strings go through `i18n.js` (6 languages: en/fr/es/de/pt/it), never hard-coded.
- **No CSS gradients** anywhere under `lib/dashboard/public/` — guarded by `test/dashboard-no-gradients.test.js`. New CSS must be flat.
- **No native `alert()`/`confirm()`/`prompt()`** in the dashboard — they block the SSE event loop. Use inline forms and non-blocking buttons.
- **`[hidden]{display:none!important}`** is already in styles.css — toggle visibility with `el.hidden`, and it beats `display:flex`.
- `ops.js` is shared verbatim between the local hub and the online relay — a change to `writeConfig()` works in both with no extra wiring.
- Pure browser modules that need unit tests use the `stats.js` pattern: an IIFE that does `module.exports = api` under Node and `root.SpectoX = api` in the browser, loaded via `<script>` in `index.html`.
- Command trigger format is exactly `^[a-z0-9][a-z0-9_-]{0,39}$`; `description` clamps to 120 chars; `instruction` is non-empty and clamps to 4000 chars; triggers are unique case-insensitively.
- Run the full suite with `npm test` from the repo root (`D:\projet_tmp\spectoflow`). A running hub caches old code — `spectoflow dashboard restart` is required before browser QA of client changes.

---

### Task 1: Pure module `commands.js` (logic + built-ins) with unit tests

**Files:**
- Create: `lib/dashboard/public/commands.js`
- Create: `test/commands.test.js`
- Modify: `lib/dashboard/public/index.html:476-480` (add a `<script>` tag)

**Interfaces:**
- Consumes: nothing.
- Produces (browser global `SpectoCommands`, Node `module.exports`):
  - `BUILTIN_COMMANDS: Array<{trigger, description, instruction, enabled}>`
  - `effectiveCommands(config) → Array` — `config.commands` if it is an array, else `BUILTIN_COMMANDS.slice()`.
  - `validateTrigger(trigger, existingTriggers) → {ok:true} | {ok:false, error:'invalidTrigger'|'duplicateTrigger'}` (`existingTriggers` is an array of trigger strings, compared case-insensitively).
  - `matchCommands(query, commands) → Array` — enabled commands whose trigger starts with `query` (case-insensitive), array order preserved.
  - `parseInvocation(text) → {trigger, rest} | null` — matches `^/<trigger>(\s+<rest>)?$` on the trimmed text.
  - `expandCommand(text, commands) → {prompt, display} | null` — null when `text` is not an invocation of a known **enabled** command with a non-empty instruction.

- [ ] **Step 1: Write the failing test**

Create `test/commands.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../lib/dashboard/public/commands.js');

test('BUILTIN_COMMANDS ships the five defaults, all valid', () => {
  const triggers = C.BUILTIN_COMMANDS.map((c) => c.trigger);
  assert.deepStrictEqual(triggers, ['spec', 'plan', 'revue', 'resume', 'rapport_jour']);
  for (const c of C.BUILTIN_COMMANDS) {
    assert.match(c.trigger, /^[a-z0-9][a-z0-9_-]{0,39}$/);
    assert.ok(c.instruction.trim().length > 0);
    assert.strictEqual(c.enabled, true);
  }
});

test('effectiveCommands falls back to builtins when config.commands is absent or not an array', () => {
  assert.strictEqual(C.effectiveCommands({}).length, C.BUILTIN_COMMANDS.length);
  assert.strictEqual(C.effectiveCommands({ commands: 'nope' }).length, C.BUILTIN_COMMANDS.length);
  assert.notStrictEqual(C.effectiveCommands({}), C.BUILTIN_COMMANDS, 'returns a copy, not the shared array');
});

test('effectiveCommands returns the stored array as-is when present, including empty', () => {
  const mine = [{ trigger: 'x', description: '', instruction: 'do x', enabled: true }];
  assert.deepStrictEqual(C.effectiveCommands({ commands: mine }), mine);
  assert.deepStrictEqual(C.effectiveCommands({ commands: [] }), []);
});

test('validateTrigger enforces format and case-insensitive uniqueness', () => {
  assert.strictEqual(C.validateTrigger('rapport_jour', []).ok, true);
  assert.strictEqual(C.validateTrigger('has space', []).ok, false);
  assert.strictEqual(C.validateTrigger('-bad', []).ok, false);
  assert.strictEqual(C.validateTrigger('', []).ok, false);
  assert.deepStrictEqual(C.validateTrigger('Dup', ['dup']), { ok: false, error: 'duplicateTrigger' });
});

test('matchCommands prefix-filters, is case-insensitive, and excludes disabled', () => {
  const cmds = [
    { trigger: 'spec', enabled: true }, { trigger: 'plan', enabled: true },
    { trigger: 'special', enabled: false }, { trigger: 'resume', enabled: true },
  ];
  assert.deepStrictEqual(C.matchCommands('sp', cmds).map((c) => c.trigger), ['spec']);
  assert.deepStrictEqual(C.matchCommands('', cmds).map((c) => c.trigger), ['spec', 'plan', 'resume']);
  assert.deepStrictEqual(C.matchCommands('RE', cmds).map((c) => c.trigger), ['resume']);
});

test('parseInvocation extracts trigger and tail, or returns null', () => {
  assert.deepStrictEqual(C.parseInvocation('/rapport_jour focus bugs'), { trigger: 'rapport_jour', rest: 'focus bugs' });
  assert.deepStrictEqual(C.parseInvocation('/spec'), { trigger: 'spec', rest: '' });
  assert.strictEqual(C.parseInvocation('hello world'), null);
  assert.strictEqual(C.parseInvocation('/'), null);
  assert.strictEqual(C.parseInvocation('/ leading space'), null);
});

test('expandCommand substitutes {{input}} everywhere and returns the short display', () => {
  const cmds = [{ trigger: 'tr', description: '', instruction: 'Translate to EN: {{input}} (twice: {{input}})', enabled: true }];
  const r = C.expandCommand('/tr bonjour', cmds);
  assert.strictEqual(r.prompt, 'Translate to EN: bonjour (twice: bonjour)');
  assert.strictEqual(r.display, '/tr bonjour');
});

test('expandCommand appends the tail when there is no placeholder', () => {
  const cmds = [{ trigger: 'revue', description: '', instruction: 'Review the diff.', enabled: true }];
  assert.strictEqual(C.expandCommand('/revue focus perf', cmds).prompt, 'Review the diff.\n\nfocus perf');
  assert.strictEqual(C.expandCommand('/revue', cmds).prompt, 'Review the diff.');
});

test('expandCommand returns null for unknown, disabled, or empty-instruction commands', () => {
  const cmds = [
    { trigger: 'off', instruction: 'x', enabled: false },
    { trigger: 'empty', instruction: '   ', enabled: true },
  ];
  assert.strictEqual(C.expandCommand('/nope hi', cmds), null);
  assert.strictEqual(C.expandCommand('/off hi', cmds), null);
  assert.strictEqual(C.expandCommand('/empty hi', cmds), null);
  assert.strictEqual(C.expandCommand('plain text', cmds), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/commands.test.js` (or `node --test test/commands.test.js`)
Expected: FAIL — `Cannot find module '../lib/dashboard/public/commands.js'`.

- [ ] **Step 3: Write the module**

Create `lib/dashboard/public/commands.js`:

```js
'use strict';
/*
 * Slash-command logic for the dashboard chat. A command is a saved prompt macro: the user types
 * "/trigger <text>" and it expands, client-side, into the command's full `instruction` (with an
 * optional {{input}} placeholder for the trailing text). The agent never sees the "/" — expansion
 * happens before /api/run, so this is fully agent-agnostic.
 *
 * Zero-dependency, loaded both in the browser (via <script> — exposes window.SpectoCommands) and in
 * node --test (via require — module.exports), the same pattern as stats.js / charts.js. This is the
 * single source of truth for the built-in command set and for trigger validation.
 */
(function (root) {
  const TRIGGER_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

  // Shipped defaults. Kept ONLY here (not duplicated into templates/config.json): a project with no
  // config.commands field uses these; the first user edit persists the full list into config.json.
  const BUILTIN_COMMANDS = [
    { trigger: 'spec', description: 'Write or update a spec',
      instruction: "Write or update the specification for the following. Follow the project's spec conventions under .spectoflow (specs/ markdown: clear goals, non-goals, acceptance criteria). Focus: {{input}}",
      enabled: true },
    { trigger: 'plan', description: 'Break work into a task plan',
      instruction: "Break the following work into an ordered plan of small, independently testable checkbox tasks, following the project's plan conventions (plans/ markdown). Work: {{input}}",
      enabled: true },
    { trigger: 'revue', description: 'Code-review the current diff',
      instruction: 'Review the current working-tree diff for correctness bugs and quality issues (reuse, simplification, efficiency). Report findings most-severe first. {{input}}',
      enabled: true },
    { trigger: 'resume', description: 'Summarize progress',
      instruction: 'Give a concise summary of the current project progress: what is done, what is in progress, and what is next. {{input}}',
      enabled: true },
    { trigger: 'rapport_jour', description: 'Structured daily report',
      instruction: "Write today's daily report with these sections: 1) Highlights (what was accomplished), 2) Blockers, 3) Next steps. Keep it concise and factual. {{input}}",
      enabled: true },
  ];

  function effectiveCommands(config) {
    config = config || {};
    return Array.isArray(config.commands) ? config.commands : BUILTIN_COMMANDS.slice();
  }

  function validateTrigger(trigger, existingTriggers) {
    if (typeof trigger !== 'string' || !TRIGGER_RE.test(trigger)) return { ok: false, error: 'invalidTrigger' };
    const lc = trigger.toLowerCase();
    if ((existingTriggers || []).some((t) => String(t).toLowerCase() === lc)) return { ok: false, error: 'duplicateTrigger' };
    return { ok: true };
  }

  function matchCommands(query, commands) {
    const q = String(query || '').toLowerCase();
    return (commands || []).filter((c) => c && c.enabled !== false
      && typeof c.trigger === 'string' && c.trigger.toLowerCase().startsWith(q));
  }

  function parseInvocation(text) {
    const m = String(text == null ? '' : text).trim().match(/^\/([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
    if (!m) return null;
    return { trigger: m[1], rest: m[2] || '' };
  }

  function expandCommand(text, commands) {
    const inv = parseInvocation(text);
    if (!inv) return null;
    const cmd = (commands || []).find((c) => c && c.enabled !== false
      && typeof c.trigger === 'string' && c.trigger.toLowerCase() === inv.trigger.toLowerCase()
      && typeof c.instruction === 'string' && c.instruction.trim());
    if (!cmd) return null;
    const rest = inv.rest.trim();
    const prompt = cmd.instruction.indexOf('{{input}}') !== -1
      ? cmd.instruction.split('{{input}}').join(rest)
      : (rest ? cmd.instruction + '\n\n' + rest : cmd.instruction);
    return { prompt: prompt.trim(), display: String(text).trim() };
  }

  const api = { BUILTIN_COMMANDS, effectiveCommands, validateTrigger, matchCommands, parseInvocation, expandCommand };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpectoCommands = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/commands.test.js`
Expected: PASS (all cases green).

- [ ] **Step 5: Load the module in the browser**

In `lib/dashboard/public/index.html`, add the script tag next to the other public modules (right after `<script src="/stats.js"></script>` at line 476, before `app.js` at line 508):

```html
  <script src="/commands.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/public/commands.js test/commands.test.js lib/dashboard/public/index.html
git commit -m "feat(dashboard): commands.js — pure slash-command logic + built-in set"
```

---

### Task 2: Persist `config.commands` through `writeConfig()`

**Files:**
- Modify: `lib/dashboard/ops.js:86-95` area (add a `commands` branch after the `navTabs` branch, before the `agent` branch at line 96)
- Test: `test/ops.test.js` (extend)

**Interfaces:**
- Consumes: nothing from Task 1 (server-side validation is independent; the regex is duplicated verbatim, matching how `KANBAN_STATUSES`/`NATIVE_TABS` are server-side sources of truth).
- Produces: `writeConfig(root, {commands: [...]})` persists a validated `config.commands` array; a malformed patch leaves the stored value untouched.

- [ ] **Step 1: Write the failing test**

Add to `test/ops.test.js` (follow the file's existing `writeConfig`/settings test style — look at how the `navTabs`/`kanbanColumns` tests set up a temp project and call `writeConfig`; reuse that exact harness). Add these cases:

```js
test('writeConfig persists a valid commands array (trimmed, clamped, enabled coerced, deduped)', () => {
  const root = makeProject(); // existing helper in this file that inits a temp project
  const cfg = writeConfig(root, { commands: [
    { trigger: 'rapport_jour', description: '  daily  ', instruction: '  do it  ' },
    { trigger: 'Rapport_Jour', description: 'dupe', instruction: 'ignored' }, // case-insensitive dupe → dropped
    { trigger: 'off', description: 'x', instruction: 'y', enabled: false },
  ] });
  assert.strictEqual(cfg.commands.length, 2);
  assert.deepStrictEqual(cfg.commands[0], { trigger: 'rapport_jour', description: 'daily', instruction: 'do it', enabled: true });
  assert.strictEqual(cfg.commands[1].enabled, false);
});

test('writeConfig accepts an empty commands array', () => {
  const root = makeProject();
  assert.deepStrictEqual(writeConfig(root, { commands: [] }).commands, []);
});

test('writeConfig rejects the whole commands patch when structurally malformed', () => {
  const root = makeProject();
  writeConfig(root, { commands: [{ trigger: 'ok', description: '', instruction: 'x' }] });
  // not an array
  assert.strictEqual(writeConfig(root, { commands: 'nope' }).commands.length, 1);
  // bad trigger
  assert.strictEqual(writeConfig(root, { commands: [{ trigger: 'bad space', instruction: 'x' }] }).commands.length, 1);
  // empty instruction
  assert.strictEqual(writeConfig(root, { commands: [{ trigger: 'good', instruction: '   ' }] }).commands.length, 1);
});

test('writeConfig clamps description to 120 and instruction to 4000 chars', () => {
  const root = makeProject();
  const cfg = writeConfig(root, { commands: [
    { trigger: 'big', description: 'd'.repeat(200), instruction: 'i'.repeat(5000) },
  ] });
  assert.strictEqual(cfg.commands[0].description.length, 120);
  assert.strictEqual(cfg.commands[0].instruction.length, 4000);
});
```

> Note: if `test/ops.test.js` does not already expose a `makeProject()`/`writeConfig` import, mirror exactly what the existing `navTabs` tests in that file do to obtain a temp project root and the `writeConfig` reference. Do not invent a new harness.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/ops.test.js`
Expected: FAIL — `commands` is undefined on the returned config (no branch persists it yet).

- [ ] **Step 3: Add the `commands` branch to `writeConfig`**

In `lib/dashboard/ops.js`, immediately after the `navTabs` branch (closes at line 95) and before the `agent` branch (line 96), insert:

```js
  // commands: the dashboard's slash-command macros. Same "reject the whole patch" safety as
  // kanbanColumns/navTabs above — if it isn't an array, or ANY entry is structurally malformed (a
  // trigger that fails the format, or an empty instruction), the stored list is left untouched rather
  // than partially applied. A valid array (including an empty one) replaces it: triggers are deduped
  // case-insensitively (first wins), description/instruction are trimmed and clamped, enabled coerced.
  if (patch.commands !== undefined) {
    const arr = patch.commands;
    const okShape = Array.isArray(arr) && arr.every((c) => c && typeof c === 'object'
      && typeof c.trigger === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(c.trigger)
      && typeof c.instruction === 'string' && c.instruction.trim().length > 0);
    if (okShape) {
      const seen = new Set(); const out = [];
      for (const c of arr) {
        const lc = c.trigger.toLowerCase();
        if (seen.has(lc)) continue;
        seen.add(lc);
        out.push({
          trigger: c.trigger,
          description: (typeof c.description === 'string' ? c.description.trim() : '').slice(0, 120),
          instruction: c.instruction.trim().slice(0, 4000),
          enabled: c.enabled !== false,
        });
      }
      cfg.commands = out;
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/ops.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/ops.js test/ops.test.js
git commit -m "feat(dashboard): persist config.commands through writeConfig (validated, deduped)"
```

---

### Task 3: Runner `display` field — readable chat bubble, full prompt to the agent

**Files:**
- Modify: `lib/dashboard/runner.js:63-77` (accept + use `display`)
- Modify: `lib/dashboard/ops.js:160-165` (`run.start` passes `display` through)
- Test: `test/runner.test.js` (extend)

**Interfaces:**
- Consumes: nothing (independent).
- Produces: `startRun(root, {prompt, agent, logPrompt, display}, emit)` — when `display` is a non-empty string, the logged user chat bubble uses it while the spawned child still receives `prompt`. `run.start` op forwards `display` from the request body.

- [ ] **Step 1: Write the failing test**

Add to `test/runner.test.js` (reuse the existing `installWithStub()` helper; add a `display`-aware variant of `runOnce`):

```js
function runOnceWithDisplay(proj, prompt, display) {
  return new Promise((resolve) => {
    const events = [];
    const emit = (e) => { events.push(e); if (e.type === 'run-end') resolve(events); };
    const r = startRun(proj, { prompt, agent: 'claude', display }, emit);
    if (r.error) resolve([{ type: 'error', error: r.error }]);
  });
}

test('display, when given, is what the user bubble shows (the agent still gets the full prompt)', async () => {
  const proj = installWithStub();
  await runOnceWithDisplay(proj, 'FULL EXPANDED INSTRUCTION', '/rapport_jour focus bugs');
  const msgs = store.readRuntime(proj).messages;
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[0].text, '/rapport_jour focus bugs');
  assert.ok(!msgs.some((m) => m.role === 'user' && m.text === 'FULL EXPANDED INSTRUCTION'),
    'the long expanded prompt is never shown as the user bubble');
});

test('without display, the user bubble is the prompt (unchanged behavior)', async () => {
  const proj = installWithStub();
  await runOnceWithDisplay(proj, 'add login', undefined);
  assert.strictEqual(store.readRuntime(proj).messages[0].text, 'add login');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/runner.test.js`
Expected: FAIL — the first test sees `msgs[0].text === 'FULL EXPANDED INSTRUCTION'` (display is ignored today).

- [ ] **Step 3: Implement**

In `lib/dashboard/runner.js`, change the signature and the bubble log (lines 63-75):

```js
function startRun(root, { prompt, agent, logPrompt = true, display }, emit) {
  const cfg = store.readConfig(root);
  const which = agent || cfg.agent || 'claude';
  const cmdStr = resolveRunnerCommand(root, cfg, which);
  if (!cmdStr) return { error: `No runner configured for "${which}".` };
  const parts = cmdStr.split(/\s+/).filter(Boolean);
  const runId = 'r' + Date.now().toString(36);
  const p = String(prompt).trim();
  // The chat bubble can show a shorter, friendlier text than what the agent actually receives — e.g.
  // a slash-command invocation "/rapport_jour focus bugs" instead of the full expanded instruction.
  // The child (line ~84) always spawns with `p`, the real prompt.
  const shown = (typeof display === 'string' && display.trim()) ? display.trim() : p;

  if (logPrompt) {
    const um = store.appendMessage(root, { role: 'user', kind: 'message', text: shown, agent: which, runId });
    emit({ type: 'message', message: um });
  }
```

(The rest of `startRun` is unchanged — `p` is still what `spawn(...)` receives and what `run.prompt` records.)

In `lib/dashboard/ops.js`, thread `display` through `run.start` (line 160):

```js
  'run.start': async (root, { prompt, agent, display }, ctx) => {
    text(prompt, 'Empty request.');
    const r = startRun(root, { prompt, agent, display }, ctx.emit);
    if (r.error) bad(r.error);
    return { runId: r.runId };
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/runner.test.js`
Expected: PASS (both new tests + the four existing runner tests still green).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/runner.js lib/dashboard/ops.js test/runner.test.js
git commit -m "feat(dashboard): runner display field — short chat bubble, full prompt to agent"
```

---

### Task 4: Chat input — `/` autocomplete menu + send-path expansion

**Files:**
- Modify: `lib/dashboard/public/index.html` (add one global `#cmdMenu` container near the chat surfaces, ~after line 462, the floating widget block)
- Modify: `lib/dashboard/public/app.js` (`doRun`/`doOrchestrate` expansion at 328-342; new input/keydown listeners near 2319/2329; a new `cmdMenu` module of small functions near the other chat helpers)
- Modify: `lib/dashboard/public/styles.css` (`.cmd-menu` and item styles)

> **Testing note:** `app.js` is browser code with no unit-test harness in this repo (like all of `app.js`). The expansion *logic* is already unit-tested in Task 1 (`commands.js`). This task is verified by real browser QA (Step 6) and by keeping `dashboard-no-gradients.test.js` green.

**Interfaces:**
- Consumes: `SpectoCommands.{effectiveCommands, matchCommands, expandCommand}` (Task 1); the runner `display` field (Task 3); `P.config` (the live config object app.js already holds).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the menu container to `index.html`**

After the floating chat widget block (the `#chatDock`/widget region ends ~line 462), add a single reused menu element at that same top level:

```html
  <div id="cmdMenu" class="cmd-menu" role="listbox" aria-label="Commands" hidden></div>
```

- [ ] **Step 2: Add the send-path expansion in `app.js`**

Replace `doRun` (328-335) and `doOrchestrate` (336-342) so they expand a slash command before posting. Add a shared helper just above `doRun`:

```js
// If `raw` is a slash-command invocation of a known enabled command, return the expanded
// { prompt, display }; otherwise null (the raw text is sent unchanged). Uses the live config.
function expandForSend(raw){
  try { return SpectoCommands.expandCommand(raw, SpectoCommands.effectiveCommands((P&&P.config)||{})); }
  catch(_){ return null; }
}
async function doRun(promptEl,agentEl){
  if(isChatBusy()) return;
  promptEl=promptEl||$('#runPrompt'); agentEl=agentEl||$('#runAgent');
  const raw=promptEl.value.trim(); if(!raw) return;
  const agent=agentEl.value;
  const ex=expandForSend(raw);
  const body=ex ? {prompt:ex.prompt, display:ex.display, agent} : {prompt:raw, agent};
  await fetch(withProject('/api/run'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  promptEl.value=''; hideCmdMenu(); // the prompt renders as a bubble from the message log
}
async function doOrchestrate(promptEl){
  if(isChatBusy()) return;
  promptEl=promptEl||$('#runPrompt');
  const raw=promptEl.value.trim(); if(!raw) return;
  const ex=expandForSend(raw);
  await fetch(withProject('/api/orchestrate'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request: ex?ex.prompt:raw})});
  promptEl.value=''; hideCmdMenu();
}
```

- [ ] **Step 3: Add the autocomplete menu module in `app.js`**

Add these functions near the chat helpers (e.g. just after `doOrchestrate`). `hideCmdMenu` is referenced above, so define it here:

```js
// ---- slash-command autocomplete: a single reused #cmdMenu popover, anchored above whichever chat
// textarea is active. Shows while the input is exactly "/word" (no space yet); hides once args begin.
// Keyboard (menu open only): ↑/↓ move, Enter/Tab select, Esc close — plain Enter in a textarea is a
// newline (send is Ctrl/Cmd+Enter), so intercepting it here doesn't change send behavior. ----
let _cmdMenuInput=null, _cmdMenuItems=[], _cmdMenuSel=-1;
function cmdMenuEl(){ return $('#cmdMenu'); }
function hideCmdMenu(){ const m=cmdMenuEl(); if(m){ m.hidden=true; m.innerHTML=''; } _cmdMenuInput=null; _cmdMenuItems=[]; _cmdMenuSel=-1; }
function slashQuery(v){ const m=String(v||'').match(/^\/([a-z0-9_-]*)$/i); return m?m[1]:null; }
function openCmdMenu(inputEl){
  const q=slashQuery(inputEl.value);
  if(q===null){ hideCmdMenu(); return; }
  const cmds=SpectoCommands.matchCommands(q, SpectoCommands.effectiveCommands((P&&P.config)||{}));
  const m=cmdMenuEl(); if(!m) return;
  _cmdMenuInput=inputEl; _cmdMenuItems=cmds; _cmdMenuSel=cmds.length?0:-1;
  m.innerHTML='';
  if(!cmds.length){ m.append(el('div','cmd-empty', t('commands.menuEmpty'))); }
  else cmds.forEach((c,i)=>{
    const it=el('div','cmd-item'+(i===0?' is-sel':'')); it.setAttribute('role','option'); it.dataset.i=String(i);
    it.append(el('span','cmd-trigger','/'+c.trigger));
    if(c.description) it.append(el('span','cmd-desc',c.description));
    it.addEventListener('mousedown',(e)=>{ e.preventDefault(); pickCmd(i); });
    m.append(it);
  });
  m.hidden=false; positionCmdMenu(inputEl);
}
function positionCmdMenu(inputEl){
  const m=cmdMenuEl(); if(!m||m.hidden) return;
  const r=inputEl.getBoundingClientRect();
  m.style.left=Math.round(r.left)+'px';
  m.style.width=Math.round(r.width)+'px';
  // place above the input; if it would clip the top, place below instead
  const h=m.offsetHeight||160;
  const top = r.top-h-6 >= 8 ? r.top-h-6 : r.bottom+6;
  m.style.top=Math.round(top)+'px';
}
function moveCmdSel(d){
  if(!_cmdMenuItems.length) return;
  _cmdMenuSel=(_cmdMenuSel+d+_cmdMenuItems.length)%_cmdMenuItems.length;
  $$('.cmd-item',cmdMenuEl()).forEach((n,i)=>n.classList.toggle('is-sel',i===_cmdMenuSel));
}
function pickCmd(i){
  const c=_cmdMenuItems[i]; const inp=_cmdMenuInput;
  if(!c||!inp) { hideCmdMenu(); return; }
  inp.value='/'+c.trigger+' ';
  hideCmdMenu();
  inp.focus(); inp.selectionStart=inp.selectionEnd=inp.value.length;
}
// Returns true if it handled the key (caller should preventDefault + stop).
function cmdMenuKey(e){
  const m=cmdMenuEl(); if(!m||m.hidden) return false;
  if(e.key==='ArrowDown'){ moveCmdSel(1); return true; }
  if(e.key==='ArrowUp'){ moveCmdSel(-1); return true; }
  if(e.key==='Enter'||e.key==='Tab'){ if(_cmdMenuSel>=0){ pickCmd(_cmdMenuSel); return true; } }
  if(e.key==='Escape'){ hideCmdMenu(); return true; }
  return false;
}
```

- [ ] **Step 4: Wire the listeners in `app.js`**

Near the existing chat keydown wiring (2319 for `#runPrompt`, 2329 for `#tabRunPrompt`), add `input` + `keydown` handlers for both inputs. Keep the existing Ctrl/Cmd+Enter lines. Add:

```js
['#runPrompt','#tabRunPrompt'].forEach((sel)=>{
  const inp=$(sel); if(!inp) return;
  inp.addEventListener('input',()=>openCmdMenu(inp));
  inp.addEventListener('keydown',(e)=>{ if(cmdMenuKey(e)){ e.preventDefault(); e.stopPropagation(); } }, true); // capture: run before the Ctrl/Cmd+Enter handler
  inp.addEventListener('blur',()=>setTimeout(hideCmdMenu,120)); // let a menu mousedown win first
});
document.addEventListener('click',(e)=>{ const m=cmdMenuEl(); if(m&&!m.hidden&&!m.contains(e.target)&&!/^(runPrompt|tabRunPrompt)$/.test(e.target.id)) hideCmdMenu(); });
window.addEventListener('resize',()=>{ if(_cmdMenuInput) positionCmdMenu(_cmdMenuInput); });
```

Also call `hideCmdMenu()` inside `navigateTab()` (find its definition — it already closes the workflow popover; add `hideCmdMenu();` alongside) so switching tabs closes the menu.

- [ ] **Step 5: Style the menu in `styles.css`**

Add (flat, theme-token driven, **no gradients**; reuse the thin/themed scrollbar pattern already used by `.wf-pipeline`/`.nav-tabs-list`):

```css
.cmd-menu{ position:fixed; z-index:120; background:var(--surface); border:1px solid var(--line);
  border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,.28); max-height:260px; overflow-y:auto;
  padding:4px; scrollbar-width:thin; scrollbar-color:var(--line) transparent; }
.cmd-menu::-webkit-scrollbar{ width:8px; }
.cmd-menu::-webkit-scrollbar-thumb{ background:var(--line); border-radius:8px; }
.cmd-menu::-webkit-scrollbar-track{ background:transparent; }
.cmd-item{ display:flex; align-items:baseline; gap:8px; padding:7px 10px; border-radius:7px; cursor:pointer; }
.cmd-item.is-sel{ background:var(--hover, rgba(127,127,127,.14)); }
.cmd-item .cmd-trigger{ font-family:var(--mono); color:var(--signal); font-weight:600; white-space:nowrap; }
.cmd-item .cmd-desc{ color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cmd-empty{ padding:9px 10px; color:var(--muted); font-size:12.5px; }
```

> If `--hover` is not a defined token in this codebase, use the literal `rgba(127,127,127,.14)` alone (drop the `var(--hover, …)` wrapper). Verify against the token set in `styles.css`.

- [ ] **Step 6: Verify with real browser QA**

Add the `commands.menuEmpty` i18n key now if Task 5 hasn't run yet — a minimal English entry so `t()` doesn't show a raw key (Task 5 fills all 6 languages): in `i18n.js` `en` block add `'commands.menuEmpty':'No command — add one in Personalize',`.

Restart the hub (`spectoflow dashboard restart`), open a project, and confirm on **both** the floating widget and the Chat tab:
1. Typing `/` shows the 5 built-ins; typing `/rap` narrows to `/rapport_jour`.
2. ↑/↓ moves the highlight; Enter/Tab inserts `/rapport_jour ` and closes the menu; Esc closes; clicking a row inserts it; typing a space closes the menu.
3. Type `/rapport_jour focus bugs` and send (Ctrl/Cmd+Enter): the chat shows the short bubble `/rapport_jour focus bugs`, and the agent run receives the expanded instruction (check the run — the agent acts on the daily-report instruction, not the literal slash text).
4. A non-command message (`hello`) still sends verbatim.

- [ ] **Step 7: Run the guard test + commit**

Run: `npm test -- test/dashboard-no-gradients.test.js`
Expected: PASS.

```bash
git add lib/dashboard/public/index.html lib/dashboard/public/app.js lib/dashboard/public/styles.css lib/dashboard/public/i18n.js
git commit -m "feat(dashboard): / autocomplete menu + client-side command expansion in chat"
```

---

### Task 5: Personalize — "Commands" editor card + i18n

**Files:**
- Modify: `lib/dashboard/public/index.html` (a new `.settings-card--wide` "Commands" card inside `.settings-groups`, ~after line 404)
- Modify: `lib/dashboard/public/app.js` (`renderCommandsSettings()` + add/edit/delete/toggle/restore handlers; call from `renderSettings()` at line 1110-1111)
- Modify: `lib/dashboard/public/styles.css` (`.cmd-row`, `.cmd-form`, `.cmd-error`)
- Modify: `lib/dashboard/public/i18n.js` (new keys across all 6 languages)

> **Testing note:** browser-QA verified (app.js UI). The persistence path is unit-tested in Task 2; the pure validators in Task 1.

**Interfaces:**
- Consumes: `SpectoCommands.{effectiveCommands, validateTrigger, BUILTIN_COMMANDS}` (Task 1); `saveSetting({commands})` (existing, app.js:93); the read-only pattern (`#settingsReadonly`).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the card markup to `index.html`**

Inside the Personalize `.settings-groups` (after the "Navigation tabs" card that closes ~line 403), add:

```html
      <div class="settings-card settings-card--wide">
        <h3 data-i18n="settings.commands.title">Commands</h3>
        <p class="settings-card-note" data-i18n="settings.commands.note">Slash commands you can type in the chat. Use {{input}} in the instruction to place your text.</p>
        <div class="cmd-editor" id="commandsList"></div>
        <div class="cmd-editor-actions">
          <button type="button" id="cmdAddBtn" data-i18n="settings.commands.add">+ Add command</button>
          <button type="button" id="cmdRestoreBtn" class="ghost" data-i18n="settings.commands.restore">Restore defaults</button>
        </div>
      </div>
```

- [ ] **Step 2: Implement `renderCommandsSettings()` and handlers in `app.js`**

Add near `renderNavTabsSettings()` (after line 219). This mirrors that function's structure (rows with a checkbox + label + action buttons) and uses an inline form instead of a native `prompt()`:

```js
// Personalize → "Commands" card. Lists the effective commands (built-ins until the user edits, then
// the persisted config.commands); each row toggles enabled, or opens an inline edit form. Add opens a
// blank form. All mutations write the WHOLE array via saveSetting({commands}) — the contract
// writeConfig() expects — mirroring toggleNavTab()/toggleKanbanColumn(). No native prompt/confirm
// (they block SSE): delete asks for a second click ("Confirm") inline.
let _cmdEditIndex=null; // index being edited, -1 = adding, null = form closed
function currentCommands(){ return SpectoCommands.effectiveCommands((P&&P.config)||{}).map((c)=>({trigger:c.trigger,description:c.description||'',instruction:c.instruction||'',enabled:c.enabled!==false})); }
function saveCommands(list){ if(P&&P.config) P.config.commands=list; renderCommandsSettings(); saveSetting({commands:list}); }
function toggleCommand(i){ const list=currentCommands(); if(!list[i])return; list[i].enabled=!list[i].enabled; saveCommands(list); }
function deleteCommand(i){ const list=currentCommands(); list.splice(i,1); saveCommands(list); }
function restoreCommands(){ saveCommands(SpectoCommands.BUILTIN_COMMANDS.map((c)=>({...c}))); }
function openCmdForm(i){ _cmdEditIndex=i; renderCommandsSettings(); }
function closeCmdForm(){ _cmdEditIndex=null; renderCommandsSettings(); }
function submitCmdForm(){
  const trg=$('#cmdFormTrigger').value.trim().toLowerCase();
  const desc=$('#cmdFormDesc').value.trim();
  const instr=$('#cmdFormInstr').value.trim();
  const errEl=$('#cmdFormErr'); errEl.textContent='';
  const list=currentCommands();
  const others=list.filter((_,idx)=>idx!==_cmdEditIndex).map((c)=>c.trigger);
  const v=SpectoCommands.validateTrigger(trg, others);
  if(!v.ok){ errEl.textContent=t('settings.commands.err.'+v.error); return; }
  if(!instr){ errEl.textContent=t('settings.commands.err.emptyInstruction'); return; }
  const entry={trigger:trg, description:desc, instruction:instr, enabled: _cmdEditIndex>=0 ? list[_cmdEditIndex].enabled : true};
  if(_cmdEditIndex>=0) list[_cmdEditIndex]=entry; else list.push(entry);
  _cmdEditIndex=null; saveCommands(list);
}
function renderCommandsSettings(){
  const box=$('#commandsList'); if(!box) return;
  const ro=!!(P&&P.config&&P.config.readonly); // relay read-only; mirror how other settings check it
  box.innerHTML='';
  const list=currentCommands();
  list.forEach((c,i)=>{
    const row=el('div','cmd-row');
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=c.enabled; cb.disabled=ro;
    cb.setAttribute('aria-label',c.trigger); cb.addEventListener('change',()=>toggleCommand(i));
    const lab=el('span','cmd-row-label'); lab.append(el('span','cmd-trigger','/'+c.trigger));
    if(c.description) lab.append(el('span','cmd-desc',c.description));
    const acts=el('div','cmd-row-acts');
    const edit=el('button',null,t('action.edit')); edit.type='button'; edit.disabled=ro; edit.addEventListener('click',()=>openCmdForm(i));
    const del=el('button','danger',t('action.delete')); del.type='button'; del.disabled=ro; del.addEventListener('click',()=>deleteCommand(i));
    acts.append(edit,del); row.append(cb,lab,acts); box.append(row);
  });
  if(_cmdEditIndex!==null && !ro){
    const editing = _cmdEditIndex>=0 ? list[_cmdEditIndex] : {trigger:'',description:'',instruction:''};
    const form=el('div','cmd-form');
    const mk=(id,ph,val,tag)=>{ const f=document.createElement(tag||'input'); f.id=id; f.placeholder=ph; f.value=val||''; return f; };
    const tr=mk('cmdFormTrigger', t('settings.commands.ph.trigger'), editing.trigger);
    const de=mk('cmdFormDesc', t('settings.commands.ph.desc'), editing.description);
    const ins=mk('cmdFormInstr', t('settings.commands.ph.instruction'), editing.instruction, 'textarea'); ins.className='chat-ta';
    const err=el('div','cmd-error'); err.id='cmdFormErr';
    const save=el('button',null,t('action.save')||'Save'); save.type='button'; save.addEventListener('click',submitCmdForm);
    const cancel=el('button','ghost',t('action.cancel')); cancel.type='button'; cancel.addEventListener('click',closeCmdForm);
    const btns=el('div','cmd-form-btns'); btns.append(save,cancel);
    form.append(el('label',null,t('settings.commands.ph.trigger')),tr,el('label',null,t('settings.commands.ph.desc')),de,el('label',null,t('settings.commands.ph.instruction')),ins,err,btns);
    box.append(form);
  }
  const addBtn=$('#cmdAddBtn'), resBtn=$('#cmdRestoreBtn');
  if(addBtn){ addBtn.disabled=ro; addBtn.onclick=()=>openCmdForm(-1); }
  if(resBtn){ resBtn.disabled=ro; resBtn.onclick=restoreCommands; }
}
```

> The read-only flag: check how the existing settings detect relay read-only mode (look for how `#settingsReadonly` is shown / where the offline banner sets a flag) and use that exact condition instead of `P.config.readonly` if it differs. Do not invent a new flag.

- [ ] **Step 3: Call it from `renderSettings()`**

In `renderSettings()` (line 1110-1111), add the call next to the others:

```js
  renderNavTabsSettings();
  renderCommandsSettings();
  renderCustomize();
```

- [ ] **Step 4: Style the editor in `styles.css`**

```css
.settings-card-note{ color:var(--muted); font-size:12.5px; margin:2px 0 10px; }
.cmd-editor{ display:flex; flex-direction:column; gap:6px; }
.cmd-row{ display:flex; align-items:center; gap:10px; padding:6px 8px; border:1px solid var(--line); border-radius:8px; }
.cmd-row-label{ display:flex; align-items:baseline; gap:8px; flex:1; min-width:0; }
.cmd-row-label .cmd-trigger{ font-family:var(--mono); color:var(--signal); font-weight:600; }
.cmd-row-label .cmd-desc{ color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cmd-row-acts{ display:flex; gap:6px; }
.cmd-editor-actions{ display:flex; gap:8px; margin-top:10px; }
.cmd-form{ display:flex; flex-direction:column; gap:6px; margin-top:8px; padding:10px; border:1px dashed var(--line); border-radius:8px; }
.cmd-form label{ font-size:12px; color:var(--muted); }
.cmd-form textarea.chat-ta{ min-height:90px; }
.cmd-form-btns{ display:flex; gap:8px; }
.cmd-error{ color:#e5484d; font-size:12.5px; min-height:1em; }
```

> `#e5484d` is a status/error red, not an accent gradient — allowed. If the codebase already has an error-color token, prefer it.

- [ ] **Step 5: Add i18n keys across all 6 languages**

In `lib/dashboard/public/i18n.js`, add these keys to **each** language block (en/fr/es/de/pt/it), key-complete. English values (translate the rest faithfully; French shown as the reference second language):

```js
// en
'settings.commands.title':'Commands',
'settings.commands.note':'Slash commands you can type in the chat. Use {{input}} in the instruction to place your text where you want it.',
'settings.commands.add':'+ Add command',
'settings.commands.restore':'Restore defaults',
'settings.commands.ph.trigger':'Trigger (e.g. rapport_jour)',
'settings.commands.ph.desc':'Short description (shown in the menu)',
'settings.commands.ph.instruction':'Instruction sent to the agent (use {{input}} for your text)',
'settings.commands.err.invalidTrigger':'Invalid trigger: lowercase letters, digits, - and _ only (max 40).',
'settings.commands.err.duplicateTrigger':'A command with this trigger already exists.',
'settings.commands.err.emptyInstruction':'The instruction cannot be empty.',
'commands.menuEmpty':'No command — add one in Personalize',
```

```js
// fr
'settings.commands.title':'Commandes',
'settings.commands.note':'Des commandes slash à taper dans le chat. Utilisez {{input}} dans l\'instruction pour placer votre texte où vous voulez.',
'settings.commands.add':'+ Ajouter une commande',
'settings.commands.restore':'Restaurer les commandes par défaut',
'settings.commands.ph.trigger':'Déclencheur (ex. rapport_jour)',
'settings.commands.ph.desc':'Courte description (affichée dans le menu)',
'settings.commands.ph.instruction':'Instruction envoyée à l\'agent (utilisez {{input}} pour votre texte)',
'settings.commands.err.invalidTrigger':'Déclencheur invalide : minuscules, chiffres, - et _ uniquement (40 max).',
'settings.commands.err.duplicateTrigger':'Une commande avec ce déclencheur existe déjà.',
'settings.commands.err.emptyInstruction':'L\'instruction ne peut pas être vide.',
'commands.menuEmpty':'Aucune commande — ajoutez-en une dans Personalize',
```

Provide es/de/pt/it translations for the same 11 keys. Verify key-completeness (the same 11 keys present in every language block).

- [ ] **Step 6: Verify with real browser QA**

Restart the hub, open Personalize:
1. The "Commands" card lists the 5 built-ins with enable checkboxes and Edit/Delete.
2. "+ Add command" opens the inline form; an invalid trigger (`Bad Space`) shows the invalid-trigger error; a duplicate shows the duplicate error; an empty instruction shows its error; a valid command saves and appears in the list.
3. Edit pre-fills the form and saves changes; Delete removes a row; the enable checkbox disables a command (it then disappears from the `/` menu — cross-check with Task 4).
4. "Restore defaults" brings back the 5 built-ins.
5. Reload the page: the custom command persists. Run `spectoflow dashboard restart` and reload: it still persists (proves `config.json` round-trip).
6. Switch language to Français: all labels/buttons/errors translate.

- [ ] **Step 7: Run the full suite + commit**

Run: `npm test`
Expected: no new failures (pre-existing Windows skip aside).

```bash
git add lib/dashboard/public/index.html lib/dashboard/public/app.js lib/dashboard/public/styles.css lib/dashboard/public/i18n.js
git commit -m "feat(dashboard): Personalize Commands editor — add/edit/delete/toggle/restore + i18n"
```

---

## Self-Review

**Spec coverage:**
- Command model `{trigger, description, instruction, enabled}` → Task 1 (module) + Task 2 (persistence). ✓
- `config.commands` semantics (absent → builtins; present → source of truth; empty allowed) → `effectiveCommands` (Task 1) + `writeConfig` (Task 2). ✓
- Client-side agent-agnostic expansion → `expandCommand` (Task 1) + `doRun`/`doOrchestrate` (Task 4). ✓
- `{{input}}` + append fallback → `expandCommand` (Task 1). ✓
- Readable chat bubble (`display`) → Task 3. ✓
- `/` autocomplete on both surfaces, keyboard + mouse → Task 4. ✓
- Personalize editor, inline form, no native prompt, read-only aware, restore defaults → Task 5. ✓
- Built-in set `/spec /plan /revue /resume /rapport_jour` → Task 1 `BUILTIN_COMMANDS`. ✓
- i18n 6 languages → Task 5 (menu-empty key seeded early in Task 4). ✓
- Tests: `commands.test.js` (Task 1), `ops.test.js` (Task 2), `runner.test.js` (Task 3), no-gradients guard (Tasks 4/5). ✓
- No `templates/config.json` change (builtins in code) → honored (no task touches it). ✓

**Placeholder scan:** No TBD/TODO. Every code step carries real code. Built-in instruction strings are final. The two "verify against the codebase" notes (the `--hover` token; the read-only flag) are explicit fallback instructions, not placeholders — each names the concrete default to use.

**Type consistency:** `SpectoCommands` is the browser global (Task 1) used verbatim in Tasks 4 & 5. `expandCommand → {prompt, display}` matches `doRun`'s `ex.prompt`/`ex.display` (Task 4) and the runner's `display` param (Task 3). `writeConfig` output shape `{trigger, description, instruction, enabled}` (Task 2) matches `currentCommands()`'s normalization (Task 5) and `effectiveCommands` consumers. `saveSetting({commands})` (Task 5) posts to the same `settings.save` op `writeConfig` validates (Task 2). Consistent.
