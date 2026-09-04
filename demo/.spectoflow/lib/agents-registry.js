'use strict';
/*
 * The dashboard's own view of "which coding agents exist and is one actually installed" — a small,
 * self-contained subset of this package's lib/adapters.js (the richer install-time registry with
 * memory-file content). Duplicated rather than shared: .spectoflow/ must be self-contained (ships
 * into every project), while lib/adapters.js does not ship there. test/agents-registry.test.js
 * guards the two id/bin/runner sets from drifting apart.
 */
const fs = require('fs');
const path = require('path');

// headless:false = detectable and selectable as the active agent, but spectoflow never spawns it
// itself (no confirmed non-interactive one-shot mode) — Run/Orchestrate/Summarize stay disabled for
// it client-side; runner/summarize.js also refuse server-side (defense in depth). `docsUrl` is that
// agent's own official CLI docs, surfaced verbatim in the dashboard's Documentation tab. See the
// longer rationale above lib/adapters.js's REGISTRY, the richer install-time twin of this list —
// including why DeepSeek Harness isn't here at all, and why some runner strings order their flags
// the way they do (the trailing prompt must land right after whichever flag takes a value).
const KNOWN_AGENTS = [
  { id: 'claude', label: 'Claude Code', bin: 'claude', dirs: ['.claude'], runner: 'claude -p --permission-mode acceptEdits', headless: true, docsUrl: 'https://code.claude.com/docs/en/cli-reference' },
  { id: 'codex', label: 'Codex', bin: 'codex', dirs: ['.codex'], runner: 'codex exec', headless: true, docsUrl: 'https://developers.openai.com/codex/cli/reference' },
  { id: 'cursor', label: 'Cursor', bin: 'cursor-agent', dirs: ['.cursor'], runner: 'cursor-agent -p', headless: true, docsUrl: 'https://cursor.com/docs/cli/overview' },
  { id: 'gemini', label: 'Gemini CLI', bin: 'gemini', dirs: ['.gemini'], runner: 'gemini -p', headless: true, docsUrl: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'opencode', label: 'OpenCode', bin: 'opencode', dirs: ['.opencode'], runner: 'opencode run --quiet', headless: true, docsUrl: 'https://opencode.ai/docs/cli/' },
  { id: 'kiro', label: 'Kiro CLI', bin: 'kiro-cli', dirs: ['.kiro'], runner: 'kiro-cli chat --no-interactive --trust-all-tools', headless: true, docsUrl: 'https://kiro.dev/docs/cli/headless/' },
  { id: 'antigravity', label: 'Antigravity', bin: 'agy', dirs: [], runner: 'agy -p', headless: true, docsUrl: 'https://antigravity.google/docs/cli/headless/' },
  { id: 'kimi', label: 'Kimi CLI', bin: 'kimi', dirs: [], runner: null, headless: false, docsUrl: 'https://github.com/MoonshotAI/kimi-cli' },
  { id: 'copilot', label: 'GitHub Copilot CLI', bin: 'copilot', dirs: [], runner: 'copilot -s --allow-all-tools -p', headless: true, docsUrl: 'https://docs.github.com/copilot/concepts/agents/about-copilot-cli' },
  { id: 'amazon-q', label: 'Amazon Q Developer CLI', bin: 'q', dirs: ['.amazonq'], runner: 'q chat --no-interactive --trust-all-tools', headless: true, docsUrl: 'https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-chat.html' },
  { id: 'droid', label: 'Factory Droid CLI', bin: 'droid', dirs: ['.factory'], runner: 'droid exec', headless: true, docsUrl: 'https://docs.factory.ai/droid-exec/overview' },
  { id: 'auggie', label: 'Auggie CLI', bin: 'auggie', dirs: ['.augment'], runner: 'auggie --quiet --print', headless: true, docsUrl: 'https://docs.augmentcode.com/cli/overview' },
  { id: 'goose', label: 'Goose CLI', bin: 'goose', dirs: ['.goose'], runner: 'goose run -t', headless: true, docsUrl: 'https://block.github.io/goose/' },
];

// Is `bin` an executable resolvable on PATH? On win32, an extension from PATHEXT is required, so we
// try each; we also try the bare name (covers test fixtures and extensionless shims).
function binOnPath(bin, { env = process.env, platform = process.platform } = {}) {
  const raw = env.PATH || env.Path || '';
  const dirs = raw.split(path.delimiter).filter(Boolean);
  const exts =
    platform === 'win32' ? ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  for (const d of dirs) {
    for (const e of exts) {
      if (fs.existsSync(path.join(d, bin + e))) return true;
    }
  }
  return false;
}

// True if `id` looks genuinely installed: its bin resolves on PATH, or the project already has its
// config dir (a project can be set up for an agent whose bin isn't on THIS machine's PATH, e.g. a
// remote/CI runner). Unknown ids are never "installed".
function isAgentInstalled(id, projectRoot, opts) {
  const a = KNOWN_AGENTS.find((x) => x.id === id);
  if (!a) return false;
  if (a.bin && binOnPath(a.bin, opts)) return true;
  return (a.dirs || []).some((d) => fs.existsSync(path.join(projectRoot, d)));
}

// ids of every known agent actually installed for this project, in KNOWN_AGENTS (priority) order.
function installedAgents(projectRoot, opts) {
  return KNOWN_AGENTS.filter((a) => isAgentInstalled(a.id, projectRoot, opts)).map((a) => a.id);
}

module.exports = { KNOWN_AGENTS, binOnPath, isAgentInstalled, installedAgents };
