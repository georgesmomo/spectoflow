'use strict';
// Builds the exact natural-language prompts the dashboard's Settings → Customize UI posts to
// /api/run (see templates/dashboard/public/app.js's CZ_KINDS) — the single source of truth so the
// CLI (`spectoflow skill/agent/dashboard create`) and the dashboard button never drift apart. The
// browser side can't require this Node module (no build step), so its literal strings are mirrored
// there by hand; test/customize-prompts.test.js guards against the two falling out of sync.
const PROMPTS = {
  dashboard: {
    add: (d) => `Add a custom dashboard: ${d}`,
    auto: 'Propose dashboard candidates for this project (Auto customize)',
  },
  skill: {
    add: (d) => `Create a new skill: ${d}`,
    auto: 'Propose skill candidates for this project (Auto customize)',
  },
  agent: {
    add: (d) => `Create a new agent: ${d}`,
    auto: 'Propose agent candidates for this project (Auto customize)',
  },
};

// buildCustomizePrompt('skill', { description: 'reviews PRs for accessibility' })
// buildCustomizePrompt('skill', { auto: true })
function buildCustomizePrompt(kind, opts) {
  const p = PROMPTS[kind];
  if (!p) throw new Error(`Unknown customize kind "${kind}" (expected dashboard, skill or agent).`);
  const o = opts || {};
  if (o.auto) return p.auto;
  const d = o.description && String(o.description).trim();
  if (!d) throw new Error('A description is required unless --auto is passed.');
  return p.add(d);
}

module.exports = { PROMPTS, buildCustomizePrompt };
