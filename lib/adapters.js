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

**Be an expert analyst, not an order-taker.** When a request is ambiguous, **clarify before acting**:
reflect it back and ask **one targeted question at a time** (each with a recommendation) until the need
is clear — then execute. See the Clarify reflex in \`.spectoflow/AGENTS.md\`.

- Command: \`/spectoflow\` (\`init\` / \`status\` / or just a request).
- Dashboard: \`node .spectoflow/dashboard/server.js\` → http://localhost:4319
- Artifacts are markdown in \`specs/\` and \`plans/\`; volatile state in \`.spectoflow/runtime.json\`.
`;

const ROOT_AGENTS_MD = `# AGENTS.md — spectoflow

This project uses **spectoflow**. **Read \`.spectoflow/AGENTS.md\` and follow it** as your operating
instructions. Artifacts are markdown in \`specs/\` and \`plans/\`; the workflow is \`.spectoflow/workflow.md\`.

**Be an expert analyst, not an order-taker.** When a request is ambiguous, **clarify before acting**:
reflect it back and ask **one targeted question at a time** (each with a recommendation) until the need
is clear — then execute. See the Clarify reflex in \`.spectoflow/AGENTS.md\`.
`;

const GEMINI_MD = `# GEMINI.md — spectoflow

This project uses **spectoflow**. **Read \`.spectoflow/AGENTS.md\` and follow it** as your operating
instructions (intent router, workflow, standing rules). Artifacts are markdown in \`specs/\` and
\`plans/\`; the workflow is \`.spectoflow/workflow.md\`.

**Be an expert analyst, not an order-taker.** When a request is ambiguous, **clarify before acting**:
reflect it back and ask **one targeted question at a time** (each with a recommendation) until the need
is clear — then execute. See the Clarify reflex in \`.spectoflow/AGENTS.md\`.
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
//
// `docsUrl` points at that agent's own official CLI docs — cited from the research pass that set
// `runner`/`headless`, never guessed; it's surfaced verbatim in the dashboard's Documentation tab so
// "which agent is this and where do I read about it" has a real answer, not just an id.
//
// `headless: false` marks an agent spectoflow can DETECT and let you set as active, but never spawn
// itself — no confirmed non-interactive one-shot mode (prompt as trailing arg → stdout → exit) as of
// this research pass, so `runner` is null on purpose (a fabricated command would just fail silently
// for real users). The dashboard still lists it and shows why Run/Orchestrate/Summarize are disabled
// for it, rather than hiding it — you can drive it yourself in its own terminal meanwhile, and
// `config.json → runners` is still yours to hand-wire a command into if one ships later.
//
// A runner string with more than one flag deliberately puts the trailing prompt right after whichever
// flag takes a value (e.g. `copilot -s --allow-all-tools -p`, not `copilot -p --allow-all-tools`) —
// runner.js spawns `[...parts.slice(1), prompt]`, appending the prompt as the LAST token, so a
// value-taking flag must be the last one in the string or the prompt lands on the wrong flag.
//
// Researched against both github.com/Fission-AI/OpenSpec/blob/main/docs/supported-tools.md and
// github.github.io/spec-kit/reference/integrations.html (broad agent-compatibility lists) — those
// pages document IDE/slash-command integration, not headless CLI support, so every entry below was
// independently verified against that tool's own primary docs regardless of appearing there.
//
// Left out of KNOWN_AGENTS entirely (not even headless:false) — researched, not re-added on a whim:
// DeepSeek Harness (deepseek-ai/deepseek-harness). It has no single installable binary to detect —
// it's invoked as `npx @deepseek-ai/dsh <subcommand>`, is explicitly a local WEB-APP framework (not a
// terminal chat/prompt tool like the others), and ships as an August-2026 "developer preview" whose
// APIs the project itself says will change. Detecting "is npx present" would not mean deepseek-harness
// is; it doesn't fit this registry's detection model. Revisit once it (or Kimi) publishes a real
// one-shot flag, or wire a custom command into config.json → runners by hand in the meantime.
const REGISTRY = [
  {
    id: 'claude',
    label: 'Claude Code',
    entries: [
      { path: 'CLAUDE.md', content: CLAUDE_MD },
      { path: '.claude/commands/spectoflow.md', content: SLASH_CMD },
    ],
    runner: 'claude -p --permission-mode acceptEdits',
    headless: true,
    docsUrl: 'https://code.claude.com/docs/en/cli-reference',
    detect: { bin: 'claude', dirs: ['.claude'] },
  },
  {
    id: 'codex',
    label: 'Codex',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: 'codex exec',
    headless: true,
    docsUrl: 'https://developers.openai.com/codex/cli/reference',
    detect: { bin: 'codex', dirs: ['.codex'] },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: 'cursor-agent -p',
    headless: true,
    docsUrl: 'https://cursor.com/docs/cli/overview',
    detect: { bin: 'cursor-agent', dirs: ['.cursor'] },
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    entries: [{ path: 'GEMINI.md', content: GEMINI_MD }],
    runner: 'gemini -p',
    headless: true,
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    detect: { bin: 'gemini', dirs: ['.gemini'] },
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: 'opencode run --quiet',
    headless: true,
    docsUrl: 'https://opencode.ai/docs/cli/',
    detect: { bin: 'opencode', dirs: ['.opencode'] },
  },
  {
    id: 'kiro',
    label: 'Kiro CLI',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: 'kiro-cli chat --no-interactive --trust-all-tools',
    headless: true,
    docsUrl: 'https://kiro.dev/docs/cli/headless/',
    detect: { bin: 'kiro-cli', dirs: ['.kiro'] },
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: 'agy -p',
    headless: true,
    docsUrl: 'https://antigravity.google/docs/cli/headless/',
    detect: { bin: 'agy', dirs: [] },
  },
  {
    id: 'kimi',
    label: 'Kimi CLI',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: null, // no confirmed non-interactive one-shot mode — see the note above REGISTRY
    headless: false,
    docsUrl: 'https://github.com/MoonshotAI/kimi-cli',
    detect: { bin: 'kimi', dirs: [] },
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }], // also reads CLAUDE.md/GEMINI.md and its own .github/copilot-instructions.md natively
    runner: 'copilot -s --allow-all-tools -p',
    headless: true,
    docsUrl: 'https://docs.github.com/copilot/concepts/agents/about-copilot-cli',
    // No detect.dirs on purpose: `.github/` is common on any project with GitHub Actions, whether or
    // not Copilot CLI is set up — using it as a signal would falsely mark Copilot "installed" on
    // countless unrelated projects. PATH detection (the bin) only.
    detect: { bin: 'copilot', dirs: [] },
  },
  {
    id: 'amazon-q',
    label: 'Amazon Q Developer CLI',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }], // NOT confirmed native — Q wires memory via `.amazonq/rules/**/*.md` referenced in its own agent config; this pointer is a harmless, forward-compatible default in the meantime
    runner: 'q chat --no-interactive --trust-all-tools',
    headless: true,
    docsUrl: 'https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-chat.html',
    detect: { bin: 'q', dirs: ['.amazonq'] },
  },
  {
    id: 'droid',
    label: 'Factory Droid CLI',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: 'droid exec',
    headless: true,
    docsUrl: 'https://docs.factory.ai/droid-exec/overview',
    detect: { bin: 'droid', dirs: ['.factory'] },
  },
  {
    id: 'auggie',
    label: 'Auggie CLI',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }],
    runner: 'auggie --quiet --print',
    headless: true,
    docsUrl: 'https://docs.augmentcode.com/cli/overview',
    detect: { bin: 'auggie', dirs: ['.augment'] },
  },
  {
    id: 'goose',
    label: 'Goose CLI',
    entries: [{ path: 'AGENTS.md', content: ROOT_AGENTS_MD }], // memory-file convention not confirmed AGENTS.md-native — same harmless-default treatment as amazon-q
    runner: 'goose run -t',
    headless: true,
    docsUrl: 'https://block.github.io/goose/',
    detect: { bin: 'goose', dirs: ['.goose'] },
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
    if (a && a.runner) out[id] = a.runner; // headless:false agents (e.g. kimi) have no runner to seed
  }
  return out;
}

module.exports = { generate, defaultRunners, REGISTRY };
