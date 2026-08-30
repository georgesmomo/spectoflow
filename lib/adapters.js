'use strict';
/*
 * Per-agent adapters. The canonical brain is .spectoflow/AGENTS.md. Each agent needs a thin entry
 * file in the place IT reads, pointing back to the canonical brain — so the framework stays in
 * .spectoflow/ (swappable, no pollution) while every agent still finds its native entry point.
 * (Same pattern OpenSpec uses to support claude/codex/cursor/gemini/…)
 *
 * The REGISTRY is the single source: for each agent, the native entry file(s) to write (shims), the
 * default headless runner command (fills config.runners; user-adjustable), and how to detect it
 * (a PATH binary and/or existing agent dir). Order = default-agent priority when several are found.
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

const GEMINI_MD = `# GEMINI.md — spectoflow

This project uses **spectoflow**. **Read \`.spectoflow/AGENTS.md\` and follow it** as your operating
instructions (intent router, workflow, standing rules). Artifacts are markdown in \`specs/\` and
\`plans/\`; the workflow is \`.spectoflow/workflow.md\`.
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

// Priority order = which agent becomes the default when several are detected.
const REGISTRY = [
  {
    id: 'claude',
    entries: [
      { path: 'CLAUDE.md', content: CLAUDE_MD },
      { path: '.claude/commands/spectoflow.md', content: SLASH_CMD },
    ],
    runner: 'claude -p --permission-mode acceptEdits',
    detect: { bin: 'claude', dirs: ['.claude'] },
  },
  {
    id: 'codex',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: 'codex exec',
    detect: { bin: 'codex', dirs: ['.codex'] },
  },
  {
    id: 'cursor',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: 'cursor-agent -p',
    detect: { bin: 'cursor-agent', dirs: ['.cursor'] },
  },
  {
    id: 'gemini',
    entries: [{ path: 'GEMINI.md', content: GEMINI_MD }],
    runner: 'gemini -p',
    detect: { bin: 'gemini', dirs: ['.gemini'] },
  },
];

const byId = (id) => REGISTRY.find((a) => a.id === id);

function writeIfAbsent(fp, content) {
  if (fs.existsSync(fp)) return false;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
  return true;
}

// Write the native entry-file shims for each selected agent. Shared files (AGENTS.md across
// codex/cursor) are written once — writeIfAbsent dedupes. Returns the relative paths written.
function generate(projectRoot, agents) {
  const list = (agents && agents.length ? agents : ['claude', 'codex']).map(byId).filter(Boolean);
  const written = [];
  for (const a of list) {
    for (const e of a.entries) {
      if (writeIfAbsent(path.join(projectRoot, e.path), e.content)) written.push(e.path);
    }
  }
  return written;
}

// { id: runner } defaults for the given agents — used to seed config.runners at init.
function defaultRunners(agents) {
  const out = {};
  for (const id of agents) {
    const a = byId(id);
    if (a) out[id] = a.runner;
  }
  return out;
}

module.exports = { generate, defaultRunners, REGISTRY };
