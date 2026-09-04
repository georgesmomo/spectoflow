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
// it client-side; runner/summarize.js also refuse server-side (defense in depth). See the longer
// rationale above lib/adapters.js's REGISTRY, the richer install-time twin of this list.
const KNOWN_AGENTS = [
  { id: 'claude', label: 'Claude Code', bin: 'claude', dirs: ['.claude'], runner: 'claude -p --permission-mode acceptEdits', headless: true },
  { id: 'codex', label: 'Codex', bin: 'codex', dirs: ['.codex'], runner: 'codex exec', headless: true },
  { id: 'cursor', label: 'Cursor', bin: 'cursor-agent', dirs: ['.cursor'], runner: 'cursor-agent -p', headless: true },
  { id: 'gemini', label: 'Gemini CLI', bin: 'gemini', dirs: ['.gemini'], runner: 'gemini -p', headless: true },
  { id: 'opencode', label: 'OpenCode', bin: 'opencode', dirs: ['.opencode'], runner: 'opencode run --quiet', headless: true },
  { id: 'kiro', label: 'Kiro CLI', bin: 'kiro-cli', dirs: ['.kiro'], runner: 'kiro-cli chat --no-interactive --trust-all-tools', headless: true },
  { id: 'antigravity', label: 'Antigravity', bin: 'agy', dirs: [], runner: 'agy -p', headless: true },
  { id: 'kimi', label: 'Kimi CLI', bin: 'kimi', dirs: [], runner: null, headless: false },
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
