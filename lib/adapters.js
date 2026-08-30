'use strict';
/*
 * Per-agent adapters. The canonical brain is .spectoflow/AGENTS.md. Each agent needs a thin entry
 * file in the place IT reads, pointing back to the canonical brain — so the framework stays in
 * .spectoflow/ (swappable, no pollution) while every agent still finds its native entry point.
 * (Same pattern OpenSpec uses to support claude/codex/cursor/gemini/…)
 */
const fs = require('fs');
const path = require('path');

const CLAUDE_MD = `# CLAUDE.md — spectoflow

This project uses **spectoflow**. **Read \`.spectoflow/AGENTS.md\` and follow it** as your operating
instructions (intent router, workflow, standing rules).

> If \`CLAUDE.md.tomerge\` exists next to this file, it is your previous CLAUDE.md, preserved on
> install. Merge its project-specific content into this file, then delete \`CLAUDE.md.tomerge\`,
> before anything else.

- Command: \`/spectoflow\` (\`init\` / \`status\` / or just a request).
- Dashboard: \`node .spectoflow/dashboard/server.js\` → http://localhost:4319
- Artifacts are markdown in \`specs/\` and \`plans/\`; volatile state in \`.spectoflow/runtime.json\`.
`;

const ROOT_AGENTS_MD = `# AGENTS.md — spectoflow

This project uses **spectoflow**. **Read \`.spectoflow/AGENTS.md\` and follow it** as your operating
instructions. Artifacts are markdown in \`specs/\` and \`plans/\`; the workflow is \`.spectoflow/workflow.md\`.
`;

const SLASH_CMD = `---
description: spectoflow — spec-driven control (init / status / or just a request)
---

Read \`.spectoflow/AGENTS.md\` and \`.spectoflow/config.json\` first.

Argument: \`$ARGUMENTS\`

- \`init\`: verify setup. If \`CLAUDE.md.tomerge\` exists, merge it into \`CLAUDE.md\` and delete it. If
  \`specs/\` and \`plans/\` are empty, greet me, state the mode, and start Intake (brainstorm → analysis
  → spec → plan) by asking what I want to build.
- \`status\`: summarize progress from \`plans/*.md\` and \`.spectoflow/runtime.json\`.
- otherwise: treat \`$ARGUMENTS\` as a request and run the Router in \`.spectoflow/AGENTS.md\`.
`;

function writeIfAbsent(fp, content) {
  if (fs.existsSync(fp)) return false;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
  return true;
}

function generate(projectRoot, agents) {
  const written = [];
  const list = agents && agents.length ? agents : ['claude', 'codex'];
  if (list.includes('claude')) {
    if (writeIfAbsent(path.join(projectRoot, 'CLAUDE.md'), CLAUDE_MD)) written.push('CLAUDE.md');
    if (writeIfAbsent(path.join(projectRoot, '.claude', 'commands', 'spectoflow.md'), SLASH_CMD)) written.push('.claude/commands/spectoflow.md');
  }
  if (list.includes('codex') || list.includes('cursor')) {
    if (writeIfAbsent(path.join(projectRoot, 'AGENTS.md'), ROOT_AGENTS_MD)) written.push('AGENTS.md');
  }
  return written;
}

module.exports = { generate };
