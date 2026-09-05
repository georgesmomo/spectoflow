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
