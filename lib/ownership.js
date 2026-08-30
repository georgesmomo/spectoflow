'use strict';
/*
 * Ownership model for `spectoflow update`.
 *
 * Framework-owned files (refreshed on update) are DERIVED from the kit's templates/ — every file the
 * kit ships EXCEPT the ones that belong to the user. Deriving the set (rather than hard-coding it)
 * keeps it correct when new default agents/skills are added to the kit.
 *
 * User-owned (never touched): config.json (settings) and workflow.md (edited from the dashboard).
 * specs/, plans/, runtime.json and .manifest.json are not in templates/, so they never appear here.
 */
const fs = require('fs');
const path = require('path');

// Files the kit ships but the user owns — never refreshed by update.
const USER_OWNED = new Set(['config.json', 'workflow.md']);

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (e.isDirectory()) walk(abs, base, out);
    else out.push(rel);
  }
}

// Relative POSIX paths of every framework-owned file shipped in `templatesDir`, sorted, deduped.
function listFrameworkFiles(templatesDir) {
  const out = [];
  walk(templatesDir, templatesDir, out);
  return [...new Set(out.filter((f) => !USER_OWNED.has(f)))].sort();
}

module.exports = { listFrameworkFiles, USER_OWNED };
