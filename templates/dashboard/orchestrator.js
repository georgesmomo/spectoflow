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
