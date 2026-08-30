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

module.exports = { resolveStep, runOrchestration };
