'use strict';
// Tests launch stub agents through custom runner commands (`node test/fixtures/…`), which runner-trust
// (D76) refuses until the user allows them on the machine. Allow them the same way a user would — in a
// throwaway SPECTOFLOW_HOME, set here for this test process and inherited by the CLI/hub it spawns, so
// the real ~/.spectoflow is never read or written.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.SPECTOFLOW_HOME || !path.resolve(process.env.SPECTOFLOW_HOME).startsWith(path.resolve(os.tmpdir()))) {
  process.env.SPECTOFLOW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-test-home-'));
}

// Allow every runner the project's config.json sets, in `home` (a hub started with its own home needs it there).
function allowRunners(root, home = process.env.SPECTOFLOW_HOME) {
  const prev = process.env.SPECTOFLOW_HOME;
  process.env.SPECTOFLOW_HOME = home;
  try {
    const trust = require('../../lib/runner-trust');
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.spectoflow', 'config.json'), 'utf8'));
    for (const [which, cmd] of Object.entries(cfg.runners || {})) if (typeof cmd === 'string') trust.trust(root, which, cmd);
  } finally { process.env.SPECTOFLOW_HOME = prev; }
}

module.exports = { allowRunners };
