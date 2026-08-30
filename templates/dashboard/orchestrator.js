'use strict';
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const { startRun } = require('./runner');

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
    o = {
      id: 'o' + Date.now().toString(36), request, mode, status: 'running', currentStep: 0,
      startedAt: new Date().toISOString(),
      steps: enabled.map((s) => ({ name: s.name, cap: s.cap, skill: s.skill, policy: !!s.policy, agent: null, status: 'pending' })),
    };
  }
  saveState(root, o, emit);

  for (let i = startAt; i < enabled.length; i++) {
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
    const tool = store.readConfig(root).agent;
    const r = startRun(root, { prompt, agent: tool }, (e) => { emit(e); if (e.type === 'run-end') resolve(e.code); });
    if (r.error) { emit({ type: 'message', message: { role: 'orchestrator', kind: 'status', text: r.error } }); resolve(1); }
  });
}

let pending = null;
function defaultConfirm(step, reason) { return new Promise((resolve) => { pending = { resolve }; }); }
function submitDecision(decision, note) {
  if (!pending) return false;
  const p = pending; pending = null; p.resolve({ decision, note }); return true;
}

// Boot-time reconcile: a process restart loses any in-flight orchestration (the runOrchestration
// call stack, and the in-memory `pending` approval) even though runtime.json still records it as
// 'running' or 'awaiting_approval'. That stale non-terminal status wedges the /api/orchestrate 409
// guard forever. This does NOT resume execution — it just marks the stale run (and any of its
// in-flight steps) 'failed' so the dashboard is unwedged and the user can start a fresh run.
function reconcileOnBoot(root) {
  const rt = store.readRuntime(root);
  const o = rt.orchestration;
  if (!o || !['running', 'awaiting_approval'].includes(o.status)) return false;
  o.status = 'failed';
  (o.steps || []).forEach((s) => { if (['running', 'awaiting_approval'].includes(s.status)) s.status = 'failed'; });
  store.writeRuntime(root, rt);
  return true;
}

module.exports = { resolveStep, runOrchestration, defaultRunStep, defaultConfirm, submitDecision, reconcileOnBoot };
