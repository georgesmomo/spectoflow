# Orchestrator v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A thin deterministic sequencer that walks the enabled workflow, resolves each step to an agent + skill, runs it, posts to the group-chat, and honours mode + policy gates.

**Architecture:** `workflow.md` carries `{cap:… skill:… [policy]}` per step (parsed by `store.readWorkflow`). A new `templates/dashboard/orchestrator.js` resolves each step (capability→agent, skill→file) and runs the loop with **injectable** `runStep`/`confirm` (so it is unit-testable without agents or HTTP). State lives in `runtime.orchestration`. `server.js` exposes `/api/orchestrate` + `/api/orchestrate/approve`; the widget gets an **Orchestrate** button and Approve/Cancel affordances.

**Tech Stack:** Node ≥18, zero runtime deps, native `node:test`. Windows dev shell (Git Bash + PowerShell).

**Spec:** `docs/orchestrator-design.md` (approved; O1–O3 resolved).

## Global Constraints

- **Zero runtime dependencies** — native Node `fs`/`http`/`child_process`/`crypto` only.
- **Everything in English**, including code comments. Output language stays `config.language`.
- **Artifacts stay markdown; granular writes.** `runtime.orchestration` is volatile JSON (gitignored).
- **The orchestrator never does a step's work** — it sequences, gates, and posts status/handoff only.
- **Tests are native** `node --test`; run with `npm test`. No test framework, no jsdom.
- **Semver:** feature → minor. This ships as **0.9.0**.
- **Policy-gated step rule (v1):** a step is policy-sensitive iff its workflow annotation carries the
  `policy` flag **or** its `cap` is `security`. (Fills a detail the spec left to implementation.)
- **Widget/UI is verified live in Chrome**, not unit-tested (consistent with the rest of the dashboard).

---

### Task 1: Parse `{cap:… skill:… [policy]}` in `workflow.md`

**Files:**
- Modify: `templates/lib/store.js` (`readWorkflow`)
- Modify: `templates/workflow.md` (add annotations)
- Test: `test/workflow-parse.test.js` (create)

**Interfaces:**
- Produces: `store.readWorkflow(root) → [{ name, enabled, optional, cap, skill, policy }]`
  (`cap`/`skill` are `string|null`; `policy` is `boolean`). Backward compatible: a line with no
  annotation yields `cap:null, skill:null, policy:false`.

- [ ] **Step 1: Write the failing test**

```js
// test/workflow-parse.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../templates/lib/store');

function wf(lines) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-wf-'));
  fs.mkdirSync(path.join(d, '.spectoflow'));
  fs.writeFileSync(path.join(d, '.spectoflow', 'workflow.md'), lines.join('\n'));
  return d;
}

test('readWorkflow parses cap/skill/policy annotations', () => {
  const d = wf(['- [x] Spec {cap:analysis skill:write-spec}',
                '- [x] Deploy {cap:implementation skill:deploy policy}']);
  const steps = store.readWorkflow(d);
  assert.deepStrictEqual(steps[0], { name: 'Spec', enabled: true, optional: false, cap: 'analysis', skill: 'write-spec', policy: false });
  assert.strictEqual(steps[1].policy, true);
  assert.strictEqual(steps[1].skill, 'deploy');
});

test('readWorkflow stays backward compatible for un-annotated + optional lines', () => {
  const d = wf(['- [ ] Integration tests (optional)', '- [x] Review']);
  const steps = store.readWorkflow(d);
  assert.deepStrictEqual(steps[0], { name: 'Integration tests', enabled: false, optional: true, cap: null, skill: null, policy: false });
  assert.strictEqual(steps[1].name, 'Review');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/workflow-parse.test.js`
Expected: FAIL — current `readWorkflow` returns objects without `cap/skill/policy`.

- [ ] **Step 3: Extend `readWorkflow`**

Replace the body of `readWorkflow` in `templates/lib/store.js` with:

```js
function readWorkflow(projectRoot) {
  try {
    const text = fs.readFileSync(path.join(projectRoot, '.spectoflow', 'workflow.md'), 'utf8');
    const steps = [];
    text.split('\n').forEach((l) => {
      const m = l.match(/^\s*- \[( |x|X)\]\s+(.*?)\s*$/);
      if (!m) return;
      let rest = m[2], cap = null, skill = null, policy = false;
      const ann = rest.match(/\{([^}]*)\}\s*$/);
      if (ann) {
        rest = rest.slice(0, ann.index).trim();
        cap = (ann[1].match(/\bcap:(\S+)/) || [])[1] || null;
        skill = (ann[1].match(/\bskill:(\S+)/) || [])[1] || null;
        policy = /\bpolicy\b/.test(ann[1]);
      }
      const optional = /\(optional\)/i.test(rest);
      const name = rest.replace(/\s*\(optional\)\s*$/i, '').trim();
      steps.push({ name, enabled: m[1].toLowerCase() === 'x', optional, cap, skill, policy });
    });
    return steps;
  } catch { return []; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/workflow-parse.test.js` → Expected: PASS. Then `npm test` (the existing
`store`/dashboard tests still pass — the shape only gained fields).

- [ ] **Step 5: Annotate the default workflow template**

Replace the step list in `templates/workflow.md` with:

```markdown
- [x] Brainstorm {cap:intake skill:brainstorm}
- [x] Analysis {cap:analysis skill:analyze-requirements}
- [x] Spec {cap:analysis skill:write-spec}
- [x] Plan {cap:planning skill:write-plan}
- [x] Develop {cap:implementation}
- [x] Unit tests {cap:testing skill:write-tests}
- [ ] Integration tests (optional) {cap:testing skill:write-tests}
- [ ] End-to-end tests (optional) {cap:testing skill:write-tests}
- [x] Review {cap:quality skill:code-review}
```

- [ ] **Step 6: Commit**

```bash
git add templates/lib/store.js templates/workflow.md test/workflow-parse.test.js
git commit -m "feat(orchestrator): parse {cap/skill/policy} in workflow.md"
```

---

### Task 2: Resolve a step to an agent + skill

**Files:**
- Modify: `templates/lib/store.js` (add `readAgents`)
- Create: `templates/dashboard/orchestrator.js` (`resolveStep`)
- Test: `test/resolve-step.test.js` (create)

**Interfaces:**
- Produces: `store.readAgents(root) → [{ name, capability, title, description }]` (agent front-matter).
- Produces: `orchestrator.resolveStep(root, step) → { agent, skill } | { error }`. `step` is a
  workflow step object from Task 1. `agent` is the agent `name`; `skill` is `string|null`.

- [ ] **Step 1: Write the failing test**

```js
// test/resolve-step.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveStep } = require('../templates/dashboard/orchestrator');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-res-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  return d;
}

test('resolveStep maps a capability to its agent and finds the skill file', () => {
  const d = project();
  const r = resolveStep(d, { name: 'Spec', cap: 'analysis', skill: 'write-spec' });
  assert.strictEqual(r.agent, 'business-analyst');
  assert.strictEqual(r.skill, 'write-spec');
});

test('resolveStep allows a step with no skill (e.g. Develop)', () => {
  const d = project();
  const r = resolveStep(d, { name: 'Develop', cap: 'implementation', skill: null });
  assert.strictEqual(r.agent, 'developer');
  assert.strictEqual(r.skill, null);
});

test('resolveStep errors when the capability has no agent', () => {
  const d = project();
  const r = resolveStep(d, { name: 'X', cap: 'nonexistent', skill: null });
  assert.match(r.error, /no agent/i);
});

test('resolveStep errors when the skill file is missing', () => {
  const d = project();
  const r = resolveStep(d, { name: 'X', cap: 'analysis', skill: 'ghost-skill' });
  assert.match(r.error, /skill/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/resolve-step.test.js`
Expected: FAIL — `Cannot find module '../templates/dashboard/orchestrator'`.

- [ ] **Step 3: Add `store.readAgents`**

In `templates/lib/store.js`, add (reuse the existing `frontmatter` helper and `listMd` pattern):

```js
function readAgents(projectRoot) {
  const dir = path.join(projectRoot, '.spectoflow', 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const fm = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { name: fm.name || f.replace(/\.md$/, ''), capability: fm.capability || null,
      title: fm.title || '', description: fm.description || '' };
  });
}
```

Add `readAgents` to `module.exports`.

- [ ] **Step 4: Create `orchestrator.js` with `resolveStep`**

```js
// templates/dashboard/orchestrator.js
'use strict';
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');

// step (from store.readWorkflow) -> { agent, skill } or { error }
function resolveStep(root, step) {
  if (!step.cap) return { error: `step "${step.name}" has no capability annotation` };
  const agent = (store.readAgents(root).find((a) => a.capability === step.cap) || {}).name;
  if (!agent) return { error: `step "${step.name}": no agent for capability "${step.cap}"` };
  if (step.skill) {
    const sp = path.join(root, '.spectoflow', 'skills', step.skill, 'SKILL.md');
    if (!fs.existsSync(sp)) return { error: `step "${step.name}": skill "${step.skill}" not found` };
  }
  return { agent, skill: step.skill || null };
}

module.exports = { resolveStep };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/resolve-step.test.js` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add templates/lib/store.js templates/dashboard/orchestrator.js test/resolve-step.test.js
git commit -m "feat(orchestrator): resolve step -> agent + skill"
```

---

### Task 3: The orchestration loop — happy path (autopilot) + state + messages

**Files:**
- Modify: `templates/dashboard/orchestrator.js` (`runOrchestration`, `saveState`, `post`)
- Test: `test/orchestrate-loop.test.js` (create)

**Interfaces:**
- Produces: `orchestrator.runOrchestration({ root, request, mode, runStep, confirm }, emit) → Promise<orchestration>`.
  - `runStep({ root, step, agent, skill, request }, emit) → Promise<number>` (exit code). Injectable.
  - `confirm(step, { policy }) → Promise<{ decision: 'approve'|'cancel'|'modify', note? }>`. Injectable.
  - `emit(event)` publishes SSE events (`{type:'change'}`, `{type:'message', message}`).
- Writes `runtime.orchestration` after every transition (via `store`).

- [ ] **Step 1: Write the failing test**

```js
// test/orchestrate-loop.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const store = require('../templates/lib/store');
const { runOrchestration } = require('../templates/dashboard/orchestrator');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-loop-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  return d;
}
const okStep = () => Promise.resolve(0);          // every step succeeds
const approve = () => Promise.resolve({ decision: 'approve' });

test('autopilot runs every enabled step in order and finishes done', async () => {
  const d = project();
  const calls = [];
  const runStep = ({ step }) => { calls.push(step.name); return Promise.resolve(0); };
  const o = await runOrchestration({ root: d, request: 'add login', mode: 'autopilot', runStep, confirm: approve }, () => {});
  assert.strictEqual(o.status, 'done');
  // enabled default steps, in order (optional integration/e2e are disabled)
  assert.deepStrictEqual(calls, ['Brainstorm', 'Analysis', 'Spec', 'Plan', 'Develop', 'Unit tests', 'Review']);
  assert.ok(o.steps.every((s) => s.status === 'done'));
});

test('autopilot does not call confirm for ordinary steps', async () => {
  const d = project();
  let confirms = 0;
  const confirm = () => { confirms++; return Promise.resolve({ decision: 'approve' }); };
  await runOrchestration({ root: d, request: 'x', mode: 'autopilot', runStep: okStep, confirm }, () => {});
  assert.strictEqual(confirms, 0);
});

test('the orchestration state is persisted to runtime.orchestration', async () => {
  const d = project();
  await runOrchestration({ root: d, request: 'add login', mode: 'autopilot', runStep: okStep, confirm: approve }, () => {});
  const o = store.readRuntime(d).orchestration;
  assert.strictEqual(o.status, 'done');
  assert.strictEqual(o.request, 'add login');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orchestrate-loop.test.js`
Expected: FAIL — `runOrchestration is not a function`.

- [ ] **Step 3: Implement the loop (autopilot path)**

Append to `templates/dashboard/orchestrator.js` (before `module.exports`):

```js
function saveState(root, o, emit) {
  const rt = store.readRuntime(root); rt.orchestration = o; store.writeRuntime(root, rt);
  emit({ type: 'change' });
}
function post(root, role, kind, text, emit) {
  const m = store.appendMessage(root, { role, agent: role, kind, text });
  emit({ type: 'message', message: m });
}

async function runOrchestration({ root, request, mode, runStep, confirm }, emit) {
  const enabled = store.readWorkflow(root).filter((s) => s.enabled);
  const o = {
    id: 'o' + Date.now().toString(36), request, mode, status: 'running', currentStep: 0,
    startedAt: new Date().toISOString(),
    steps: enabled.map((s) => ({ name: s.name, cap: s.cap, skill: s.skill, policy: !!s.policy, agent: null, status: 'pending' })),
  };
  saveState(root, o, emit);

  for (let i = 0; i < enabled.length; i++) {
    o.currentStep = i; const step = enabled[i], st = o.steps[i];
    const r = resolveStep(root, step);
    if (r.error) { st.status = 'failed'; o.status = 'failed'; saveState(root, o, emit); post(root, 'orchestrator', 'status', '⚠ ' + r.error, emit); return o; }
    st.agent = r.agent;

    const policyGated = !!step.policy || step.cap === 'security';
    const needConfirm = mode === 'manual' || policyGated;   // v1: semi == autopilot + policy (spec O2)
    if (needConfirm) {
      st.status = 'awaiting_approval'; o.status = 'awaiting_approval'; saveState(root, o, emit);
      post(root, 'orchestrator', 'question', `Approve step "${step.name}" (${r.agent})${policyGated ? ' — policy gate' : ''}?`, emit);
      const dec = await confirm(step, { policy: policyGated });
      post(root, 'orchestrator', 'status', `decision: ${dec.decision}${dec.note ? ' — ' + dec.note : ''}`, emit);
      if (dec.decision === 'cancel') { st.status = 'skipped'; o.status = 'cancelled'; saveState(root, o, emit); return o; }
      o.status = 'running'; saveState(root, o, emit);
    }

    st.status = 'running'; saveState(root, o, emit);
    post(root, 'orchestrator', 'status', `→ ${step.name} (${r.agent})`, emit);
    const exit = await runStep({ root, step, agent: r.agent, skill: r.skill, request }, emit);
    if (exit !== 0) { st.status = 'failed'; o.status = 'failed'; saveState(root, o, emit); post(root, 'orchestrator', 'status', `⚠ ${step.name} failed (exit ${exit})`, emit); return o; }
    st.status = 'done'; saveState(root, o, emit);
  }
  o.currentStep = enabled.length; o.status = 'done'; saveState(root, o, emit);
  post(root, 'orchestrator', 'status', '■ workflow complete', emit);
  return o;
}
```

Update the export: `module.exports = { resolveStep, runOrchestration };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orchestrate-loop.test.js` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/dashboard/orchestrator.js test/orchestrate-loop.test.js
git commit -m "feat(orchestrator): sequential loop + state + messages (autopilot)"
```

---

### Task 4: Gates — manual confirms each step; policy confirms even in autopilot; cancel stops

**Files:**
- Test: `test/orchestrate-gates.test.js` (create) — the loop code from Task 3 already implements this;
  this task proves it and pins the behaviour.

**Interfaces:**
- Consumes: `runOrchestration` from Task 3 (unchanged).

- [ ] **Step 1: Write the failing test**

```js
// test/orchestrate-gates.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runOrchestration } = require('../templates/dashboard/orchestrator');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function projectWithPolicyStep() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-gate-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  // append a policy-gated step so a policy gate is exercised
  const wf = path.join(d, '.spectoflow', 'workflow.md');
  fs.appendFileSync(wf, '\n- [x] Deploy {cap:implementation skill:write-tests policy}\n');
  return d;
}
const okStep = () => Promise.resolve(0);

test('manual mode calls confirm before every step', async () => {
  const d = projectWithPolicyStep();
  let confirms = 0;
  const confirm = () => { confirms++; return Promise.resolve({ decision: 'approve' }); };
  const o = await runOrchestration({ root: d, request: 'x', mode: 'manual', runStep: okStep, confirm }, () => {});
  assert.strictEqual(o.status, 'done');
  assert.strictEqual(confirms, o.steps.length, 'one confirm per step');
});

test('autopilot still confirms a policy-gated step', async () => {
  const d = projectWithPolicyStep();
  const confirmed = [];
  const confirm = (step) => { confirmed.push(step.name); return Promise.resolve({ decision: 'approve' }); };
  await runOrchestration({ root: d, request: 'x', mode: 'autopilot', runStep: okStep, confirm }, () => {});
  assert.deepStrictEqual(confirmed, ['Deploy'], 'only the policy step is confirmed in autopilot');
});

test('cancel at a gate stops the run as cancelled', async () => {
  const d = projectWithPolicyStep();
  const cancel = () => Promise.resolve({ decision: 'cancel' });
  const ran = [];
  const runStep = ({ step }) => { ran.push(step.name); return Promise.resolve(0); };
  const o = await runOrchestration({ root: d, request: 'x', mode: 'manual', runStep, confirm: cancel }, () => {});
  assert.strictEqual(o.status, 'cancelled');
  assert.strictEqual(ran.length, 0, 'no step runs after a cancel on the first gate');
});
```

- [ ] **Step 2: Run test to verify it passes (behaviour already implemented in Task 3)**

Run: `node --test test/orchestrate-gates.test.js`
Expected: PASS. If any assertion fails, fix the gate logic in `runOrchestration` (do **not** weaken
the test). This is the one task that legitimately goes green immediately — it pins Task 3's gates.

- [ ] **Step 3: Commit**

```bash
git add test/orchestrate-gates.test.js
git commit -m "test(orchestrator): pin mode + policy gate behaviour"
```

---

### Task 5: Failure stops the run; resume continues from persisted state

**Files:**
- Modify: `templates/dashboard/orchestrator.js` (`runOrchestration` gains a `resume` path)
- Test: `test/orchestrate-resume.test.js` (create)

**Interfaces:**
- Produces: `runOrchestration({ …, resume: true })` — when `resume` is set and
  `runtime.orchestration` exists with a non-terminal status, continue from `currentStep` instead of
  starting a fresh orchestration.

- [ ] **Step 1: Write the failing test**

```js
// test/orchestrate-resume.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('../templates/lib/store');
const { runOrchestration } = require('../templates/dashboard/orchestrator');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');
function project() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-rez-')); execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' }); return d; }
const approve = () => Promise.resolve({ decision: 'approve' });

test('a failing step stops the run and leaves later steps pending', async () => {
  const d = project();
  const failOnPlan = ({ step }) => Promise.resolve(step.name === 'Plan' ? 1 : 0);
  const o = await runOrchestration({ root: d, request: 'x', mode: 'autopilot', runStep: failOnPlan, confirm: approve }, () => {});
  assert.strictEqual(o.status, 'failed');
  const plan = o.steps.find((s) => s.name === 'Plan');
  assert.strictEqual(plan.status, 'failed');
  assert.ok(o.steps.slice(o.steps.indexOf(plan) + 1).every((s) => s.status === 'pending'));
});

test('resume continues from the persisted currentStep', async () => {
  const d = project();
  // first run fails on Plan (index 3)
  await runOrchestration({ root: d, request: 'x', mode: 'autopilot', runStep: ({ step }) => Promise.resolve(step.name === 'Plan' ? 1 : 0), confirm: approve }, () => {});
  // resume with a runStep that now succeeds; it must NOT re-run the done steps before Plan
  const ran = [];
  await runOrchestration({ root: d, resume: true, runStep: ({ step }) => { ran.push(step.name); return Promise.resolve(0); }, confirm: approve }, () => {});
  assert.ok(!ran.includes('Brainstorm'), 'done steps are not re-run');
  assert.strictEqual(ran[0], 'Plan', 'resumes at the failed step');
  assert.strictEqual(store.readRuntime(d).orchestration.status, 'done');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orchestrate-resume.test.js`
Expected: the failure test PASSES (Task 3 behaviour) but the **resume** test FAILS (no `resume` path
yet — a fresh orchestration re-runs from Brainstorm).

- [ ] **Step 3: Add the resume path**

At the top of `runOrchestration`, before building a fresh `o`, insert:

```js
async function runOrchestration({ root, request, mode, runStep, confirm, resume }, emit) {
  const enabled = store.readWorkflow(root).filter((s) => s.enabled);
  let o, startAt = 0;
  if (resume) {
    const prev = store.readRuntime(root).orchestration;
    if (!prev || ['done', 'cancelled'].includes(prev.status)) return prev || null;
    o = prev; o.status = 'running'; mode = o.mode;
    startAt = o.steps.findIndex((s) => s.status !== 'done');   // first not-done step
    if (startAt < 0) startAt = enabled.length;
  } else {
    o = { id: 'o' + Date.now().toString(36), request, mode, status: 'running', currentStep: 0,
      startedAt: new Date().toISOString(),
      steps: enabled.map((s) => ({ name: s.name, cap: s.cap, skill: s.skill, policy: !!s.policy, agent: null, status: 'pending' })) };
  }
  saveState(root, o, emit);

  for (let i = startAt; i < enabled.length; i++) {
    // …unchanged loop body…
  }
```

Change the loop header from `for (let i = 0; …)` to `for (let i = startAt; …)`. Everything else in
the body is unchanged. (When resuming, a `failed` step is re-entered as the first not-done step.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orchestrate-resume.test.js` → Expected: PASS. Then `npm test` (all green).

- [ ] **Step 5: Commit**

```bash
git add templates/dashboard/orchestrator.js test/orchestrate-resume.test.js
git commit -m "feat(orchestrator): stop on failure + resume from persisted state"
```

---

### Task 6: Default `runStep` (wraps `runner.startRun`) + `confirm`/`submitDecision`

**Files:**
- Modify: `templates/dashboard/orchestrator.js` (default `runStep`, `defaultConfirm`, `submitDecision`, `buildPrompt`)
- Test: `test/orchestrate-defaults.test.js` (create) — exercises the default `runStep` against the
  chat-agent fixture, and the confirm/submitDecision pairing.

**Interfaces:**
- Produces: `orchestrator.defaultRunStep({ root, step, agent, skill, request }, emit) → Promise<number>`
  (spawns via `runner.startRun`; resolves with the run's exit code).
- Produces: `orchestrator.defaultConfirm(step, reason) → Promise<decision>` and
  `orchestrator.submitDecision(decision, note?)` (the server's `/approve` calls the latter).

- [ ] **Step 1: Write the failing test**

```js
// test/orchestrate-defaults.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const orch = require('../templates/dashboard/orchestrator');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const FIXTURE = path.join(KIT, 'test', 'fixtures', 'chat-agent.js').split(path.sep).join('/');
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-def-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const cfgP = path.join(d, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
  cfg.runners = { developer: `node ${FIXTURE}` };   // resolve agent name -> runner
  fs.writeFileSync(cfgP, JSON.stringify(cfg, null, 2) + '\n');
  return d;
}

test('defaultRunStep spawns the resolved agent and resolves with its exit code', async () => {
  const d = project();
  const code = await orch.defaultRunStep({ root: d, step: { name: 'Develop' }, agent: 'developer', skill: null, request: 'add login' }, () => {});
  assert.strictEqual(code, 0);
});

test('submitDecision resolves a pending defaultConfirm', async () => {
  const p = orch.defaultConfirm({ name: 'Spec' }, { policy: false });
  orch.submitDecision('approve', 'looks good');
  const dec = await p;
  assert.deepStrictEqual(dec, { decision: 'approve', note: 'looks good' });
});
```

Note: `defaultRunStep` uses `config.runners[agent]`. The run pipeline already looks up
`config.runners[which]` where `which = agent`; so a per-agent runner key works. If no per-agent
runner exists, `startRun` falls back — for v1 the fixture sets `runners.developer` explicitly.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orchestrate-defaults.test.js`
Expected: FAIL — `defaultRunStep`/`defaultConfirm`/`submitDecision` are not exported.

- [ ] **Step 3: Implement the defaults**

Append to `templates/dashboard/orchestrator.js` (above `module.exports`), and require the runner at top:

```js
// at the top, with the other requires:
const { startRun } = require('./runner');

// …

function buildPrompt({ step, agent, skill, request }) {
  const skillLine = skill
    ? `Run the "${skill}" skill (.spectoflow/skills/${skill}/SKILL.md) for this request.`
    : `Apply your role's mandate for this request.`;
  return [
    `You are the ${agent} (capability: ${step.cap}). ${skillLine}`,
    `Request: ${request}`,
    `Context: the current specs/ and plans/ in this project.`,
    `Work to the project standard and post progress as ::spectoflow role=${step.cap} kind=… msg=… lines.`,
  ].join('\n');
}

function defaultRunStep({ root, step, agent, skill, request }, emit) {
  return new Promise((resolve) => {
    const prompt = buildPrompt({ step, agent, skill, request });
    const r = startRun(root, { prompt, agent }, (e) => { emit(e); if (e.type === 'run-end') resolve(e.code); });
    if (r.error) { emit({ type: 'message', message: { role: 'orchestrator', kind: 'status', text: r.error } }); resolve(1); }
  });
}

let pending = null;
function defaultConfirm(step, reason) { return new Promise((resolve) => { pending = { resolve }; }); }
function submitDecision(decision, note) {
  if (!pending) return false;
  const p = pending; pending = null; p.resolve({ decision, note }); return true;
}
```

Export them: `module.exports = { resolveStep, runOrchestration, defaultRunStep, defaultConfirm, submitDecision };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orchestrate-defaults.test.js` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/dashboard/orchestrator.js test/orchestrate-defaults.test.js
git commit -m "feat(orchestrator): default runStep (via runner) + confirm/submitDecision"
```

---

### Task 7: Server endpoints — `/api/orchestrate` + `/api/orchestrate/approve`

**Files:**
- Modify: `templates/dashboard/server.js`
- Test: `test/orchestrate-server.test.js` (create) — starts the real server against a stub-runner
  project and drives the endpoints over HTTP.

**Interfaces:**
- Produces: `POST /api/orchestrate { request } → { orchestrationId } | { error }` (409 if one is
  already active/non-terminal).
- Produces: `POST /api/orchestrate/approve { decision, note? } → { ok } | { error }`.

- [ ] **Step 1: Write the failing test**

```js
// test/orchestrate-server.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const store = require('../templates/lib/store');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const SERVER = path.join(KIT, 'templates', 'dashboard', 'server.js');
const FIXTURE = path.join(KIT, 'test', 'fixtures', 'chat-agent.js').split(path.sep).join('/');

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-srv-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const cfgP = path.join(d, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
  cfg.mode = 'autopilot';
  // one runner per agent name the default workflow resolves to
  const r = `node ${FIXTURE}`;
  cfg.runners = { 'product-manager': r, 'business-analyst': r, 'tech-lead': r, developer: r, 'qa-engineer': r, 'code-reviewer': r };
  fs.writeFileSync(cfgP, JSON.stringify(cfg, null, 2) + '\n');
  return d;
}
function post(port, p, obj) {
  return new Promise((resolve) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); });
    req.end(data);
  });
}
function startServer(root, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [SERVER], { env: { ...process.env, SPECTOFLOW_ROOT: root, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/dashboard →/.test(d.toString())) resolve(srv); });
  });
}

test('POST /api/orchestrate runs the workflow to done in autopilot', async () => {
  const d = project();
  const port = 4400 + Math.floor(Math.random() * 200);
  const srv = await startServer(d, port);
  try {
    const r = await post(port, '/api/orchestrate', { request: 'add login' });
    assert.strictEqual(r.status, 200); assert.ok(r.body.orchestrationId);
    // poll runtime until terminal
    for (let i = 0; i < 60; i++) {
      const o = store.readRuntime(d).orchestration;
      if (o && ['done', 'failed', 'cancelled'].includes(o.status)) { assert.strictEqual(o.status, 'done'); return; }
      await new Promise((s) => setTimeout(s, 100));
    }
    assert.fail('orchestration did not finish in time');
  } finally { srv.kill(); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orchestrate-server.test.js`
Expected: FAIL — `/api/orchestrate` returns 404 (endpoint absent).

- [ ] **Step 3: Wire the endpoints in `server.js`**

Add `const orchestrator = require('./orchestrator');` near the other requires. Add, next to the
`/api/run` block:

```js
// ---- orchestrator ----
if (p === '/api/orchestrate' && req.method === 'POST') {
  const { request } = await body(req);
  if (!request || !String(request).trim()) return sendJSON(res, 400, { error: 'Empty request.' });
  const active = store.readRuntime(ROOT).orchestration;
  if (active && ['running', 'awaiting_approval'].includes(active.status))
    return sendJSON(res, 409, { error: 'An orchestration is already active.' });
  const mode = store.readConfig(ROOT).mode || 'semi';
  // fire and forget; state + messages stream over SSE
  orchestrator.runOrchestration({ root: ROOT, request: String(request).trim(), mode,
    runStep: orchestrator.defaultRunStep, confirm: orchestrator.defaultConfirm }, emit)
    .catch((e) => emit({ type: 'message', message: { role: 'orchestrator', kind: 'status', text: 'orchestration error: ' + e.message } }));
  const o = store.readRuntime(ROOT).orchestration;
  return sendJSON(res, 200, { orchestrationId: o && o.id });
}
if (p === '/api/orchestrate/approve' && req.method === 'POST') {
  const { decision, note } = await body(req);
  const ok = orchestrator.submitDecision(decision, note);
  return sendJSON(res, ok ? 200 : 409, ok ? { ok: true } : { error: 'No pending approval.' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orchestrate-server.test.js` → Expected: PASS. Then `npm test` (all green).

- [ ] **Step 5: Commit**

```bash
git add templates/dashboard/server.js test/orchestrate-server.test.js
git commit -m "feat(orchestrator): /api/orchestrate + /approve endpoints"
```

---

### Task 8: Widget — Orchestrate button + Approve/Cancel affordances (live-verified)

**Files:**
- Modify: `templates/dashboard/public/index.html` (Orchestrate button)
- Modify: `templates/dashboard/public/app.js` (doOrchestrate, approval buttons, render orchestration)
- Modify: `templates/dashboard/public/styles.css` (button + approval-row styles)

**Interfaces:**
- Consumes: `runtime.orchestration` (from `store.readProject`), SSE `message` + `change`, and the
  endpoints from Task 7.

- [ ] **Step 1: Add the Orchestrate button** (in the `.chat-input` row of `index.html`, after Send):

```html
<button id="orchBtn" class="btn chat-send" title="Walk the enabled workflow">Orchestrate</button>
```

- [ ] **Step 2: Wire it in `app.js`** — add near `doRun`:

```js
async function doOrchestrate(){
  const prompt=$('#runPrompt').value.trim(); if(!prompt) return;
  await fetch('/api/orchestrate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:prompt})});
  $('#runPrompt').value='';
}
async function approve(decision){ await fetch('/api/orchestrate/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})}); }
```

Bind it near the other listeners: `$('#orchBtn').addEventListener('click',doOrchestrate);`

- [ ] **Step 3: Render the approval row** — in `renderChat()`, after appending messages, reflect the
orchestration gate:

```js
function renderApproval(){
  const o=(P.runtime&&P.runtime.orchestration)||null;
  let row=$('#approvalRow'); if(row) row.remove();
  if(!o || o.status!=='awaiting_approval') return;
  row=el('div','approval'); row.id='approvalRow';
  row.append(el('div','msg-role','orchestrator · awaiting approval'));
  const a=el('button','btn primary','Approve'); a.addEventListener('click',()=>approve('approve'));
  const c=el('button','btn','Cancel'); c.addEventListener('click',()=>approve('cancel'));
  const acts=el('div','c-actions'); acts.append(a,c); row.append(acts);
  $('#chatLog').append(row); scrollChat();
}
```

Call `renderApproval()` at the end of `renderChat()`.

- [ ] **Step 4: Style it** — append to `styles.css`:

```css
.approval { display:flex; flex-direction:column; gap:6px; padding:8px 10px; border:1px solid color-mix(in srgb,var(--signal) 40%,var(--line)); border-radius:10px; }
.approval .c-actions { display:flex; gap:8px; }
#orchBtn { background:var(--cool); color:#04202a; border-color:transparent; font-weight:600; }
```

- [ ] **Step 5: Verify live in Chrome**

Start a preview against a stub-runner project (mode `manual` so a gate fires), open the widget, click
**Orchestrate**, confirm: the orchestrator posts `→ <step>` status messages, identified step messages
stream, an **Approve/Cancel** row appears at each gate, Approve advances, and the run reaches
"■ workflow complete". Reload mid-run to confirm the log + gate re-render from `runtime.orchestration`.
Capture a screenshot.

- [ ] **Step 6: Commit**

```bash
git add templates/dashboard/public/index.html templates/dashboard/public/app.js templates/dashboard/public/styles.css
git commit -m "feat(orchestrator): Orchestrate button + approval affordances in the widget"
```

---

### Task 9: Docs + version bump

**Files:**
- Modify: `docs/DECISIONS.md` (D20), `docs/ROADMAP.md` (item done → 0.9), `docs/ARCHITECTURE.md`
  (orchestrator paragraph), `CLAUDE.md` (version + orchestrator.js), `README.md` (header + a line),
  `package.json` (0.9.0), `docs/orchestrator-design.md` (status → implemented).

- [ ] **Step 1: DECISIONS D20** — record: workflow.md `{cap/skill/policy}` resolution; the thin
sequencer honouring mode (v1 `semi` == autopilot+policy, O2); policy rule = annotation `policy` or
`cap:security`; `orchestrator.js` with injectable `runStep`/`confirm`; endpoints; resume = restart
from first not-done step; Orchestrate button. Reference `docs/orchestrator-design.md`.

- [ ] **Step 2: ROADMAP** — move "Orchestrator runtime" into Done as **0.9** (one paragraph); leave
"Design pass" as the last remaining item; renumber it to `### 1`.

- [ ] **Step 3: ARCHITECTURE** — add an "Orchestrator (v0.9)" paragraph: enabled steps → resolve
(workflow.md annotations) → gate (mode + policy) → `runner.startRun` per step → group-chat;
`dashboard/orchestrator.js` in the folder map.

- [ ] **Step 4: CLAUDE.md** — bump "What exists" to v0.9.0; add `dashboard/orchestrator.js` (the
sequencer) to the dashboard line.

- [ ] **Step 5: README** — header → v0.9; one line under Dashboard: the 💬 widget can **Orchestrate**
the enabled workflow (each step runs its agent, gated by mode + policy).

- [ ] **Step 6: package.json** — `"version": "0.9.0"`; set `docs/orchestrator-design.md` status to
**implemented**.

- [ ] **Step 7: Run full suite + commit**

```bash
npm test    # all green
git add -A
git commit -m "spectoflow 0.9.0 — orchestrator (docs + version)"
```

---

## Self-Review

**Spec coverage:** §1 resolution → Task 1+2; §2 state → Task 3; §3 loop+gates → Task 3+4; §4 approval
protocol → Task 6 (confirm/submitDecision) + Task 7 (/approve) + Task 8 (UI); §5 trigger+module →
Task 6/7/8; §6 testability → Tasks 1–7 tests; §7 server surface → Task 7. Resolved O1 (Develop no
skill) → Task 1 template + Task 2 null-skill test. O2 (semi == autopilot+policy) → Task 3 `needConfirm`
+ Task 4 tests. O3 (Cancel + start over) → Task 4 cancel test + Task 8 Cancel button (resume via Task 5
covers "start over from where it stopped").

**Placeholder scan:** none — every code step carries real code. UI task is live-verified by design
(consistent with the dashboard's no-DOM-test convention), not a placeholder.

**Type consistency:** `runOrchestration({root,request,mode,runStep,confirm,resume}, emit)`,
`runStep({root,step,agent,skill,request}, emit)→Promise<number>`, `confirm(step,{policy})→Promise<{decision,note?}>`,
`resolveStep(root,step)→{agent,skill}|{error}`, `submitDecision(decision,note)`, `store.readAgents`,
`store.readWorkflow`→adds `{cap,skill,policy}` — names are consistent across Tasks 1–8.
