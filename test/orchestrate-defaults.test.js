'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const orch = require('../lib/dashboard/orchestrator');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const FIXTURE = path.join(KIT, 'test', 'fixtures', 'chat-agent.js').split(path.sep).join('/');
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-def-'));
  execFileSync('node', [BIN, 'init', d], { stdio: 'pipe' });
  const cfgP = path.join(d, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
  cfg.agent = 'claude';
  cfg.runners = { claude: `node ${FIXTURE}` };   // runners are keyed by TOOL, not by role
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

// D64 fix: `pending` is a Map keyed by project root — approving/rejecting one project's gate must
// never resolve, or clobber, another project's still-pending gate (a real cross-project safety leak
// when the hub shares one orchestrator.js instance across every project).
test('defaultConfirm/submitDecision are isolated per project root', async () => {
  const ROOT_A = '/fake/root/a';
  const ROOT_B = '/fake/root/b';
  const raceAgainstTimeout = (p, ms) => Promise.race([
    p.then((v) => ({ settled: true, value: v })),
    new Promise((r) => setTimeout(() => r({ settled: false }), ms)),
  ]);

  const pA = orch.defaultConfirm({ name: 'Spec A' }, { policy: false, root: ROOT_A });
  const pB = orch.defaultConfirm({ name: 'Spec B' }, { policy: false, root: ROOT_B });

  // Submitting for an unrelated, never-pending root must not touch A or B's entries.
  assert.strictEqual(orch.submitDecision('approve', 'noop', '/fake/root/unknown'), false);

  // Approving A must resolve ONLY A.
  assert.strictEqual(orch.submitDecision('approve', 'A approved', ROOT_A), true);
  const decA = await pA;
  assert.deepStrictEqual(decA, { decision: 'approve', note: 'A approved' });

  // B must still be genuinely pending after A resolved.
  const raceAfterA = await raceAgainstTimeout(pB, 100);
  assert.strictEqual(raceAfterA.settled, false, "B's pending decision must not have resolved when A was submitted");

  // Now resolve B with its own decision.
  assert.strictEqual(orch.submitDecision('reject', 'B rejected', ROOT_B), true);
  const decB = await pB;
  assert.deepStrictEqual(decB, { decision: 'reject', note: 'B rejected' });

  // A's root has nothing pending anymore (already consumed above).
  assert.strictEqual(orch.submitDecision('approve', 'late', ROOT_A), false);
});
