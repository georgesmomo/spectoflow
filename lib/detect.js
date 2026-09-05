'use strict';
/*
 * Agent auto-detection. A detected agent means: its CLI is on PATH (so its runner will actually
 * work) OR the project already has that agent's config dir. `init` uses this to pick sensible
 * defaults (which shims to write, which agent is active) instead of asking the user to specify.
 */
const fs = require('fs');
const path = require('path');
const { REGISTRY } = require('./adapters');

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

// Agent ids detected for `projectRoot`, in REGISTRY (priority) order.
function detectAgents(projectRoot, opts = {}) {
  return REGISTRY.filter((a) => {
    if (a.detect.bin && binOnPath(a.detect.bin, opts)) return true;
    return (a.detect.dirs || []).some((d) => fs.existsSync(path.join(projectRoot, d)));
  }).map((a) => a.id);
}

// True if `id` looks genuinely installed: its bin resolves on PATH, or the project already has its
// config dir (a project can be set up for an agent whose bin isn't on THIS machine's PATH, e.g. a
// remote/CI runner). Unknown ids are never "installed".
function isAgentInstalled(id, projectRoot, opts) {
  const a = REGISTRY.find((x) => x.id === id);
  if (!a) return false;
  if (a.detect.bin && binOnPath(a.detect.bin, opts)) return true;
  return (a.detect.dirs || []).some((d) => fs.existsSync(path.join(projectRoot, d)));
}

// ids of every known agent actually installed for this project, in REGISTRY (priority) order.
function installedAgents(projectRoot, opts) {
  return REGISTRY.filter((a) => isAgentInstalled(a.id, projectRoot, opts)).map((a) => a.id);
}

module.exports = { binOnPath, detectAgents, isAgentInstalled, installedAgents };
