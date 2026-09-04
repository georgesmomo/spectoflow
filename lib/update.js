'use strict';
/*
 * `spectoflow update` — refresh framework-owned files in an installed project to the current kit,
 * without ever touching the user's work. Ownership is decided per file against the install manifest:
 *
 *   file absent on disk .......................... create (new file shipped by this version)
 *   disk == new template ......................... already current (unchanged, or adopted if legacy)
 *   disk == manifest baseline (untouched) ........ refresh to the new template
 *   otherwise (user-edited, or legacy-divergent) . preserve; write <file>.new for manual merge
 *
 * User-owned files (config.json, workflow.md) are not in the framework set, so they are never read
 * for writing. No 3-way auto-merge and no deletions in v1 — refresh the safe, offer the rest as .new.
 */
const fs = require('fs');
const path = require('path');
const ownership = require('./ownership');
const manifest = require('./manifest');

function toDisk(sf, rel) {
  return path.join(sf, rel.split('/').join(path.sep));
}

function runUpdate({ projectRoot, templatesDir, version, dryRun = false, force = false }) {
  const sf = path.join(projectRoot, '.spectoflow');
  const prev = manifest.readManifest(sf);
  const report = {
    fromVersion: prev ? prev.version : null,
    toVersion: version,
    dryRun,
    force,
    created: [],
    refreshed: [],
    newSidecar: [],
    adopted: [],
    unchanged: [],
    forced: [],
  };
  const baseline = (prev && prev.files) || {};
  const nextFiles = {}; // manifest to write after this run

  const write = (fp, buf) => {
    if (dryRun) return;
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, buf);
  };

  for (const rel of ownership.listFrameworkFiles(templatesDir)) {
    const newBuf = fs.readFileSync(toDisk(templatesDir, rel));
    const newHash = manifest.sha256(newBuf);
    const diskPath = toDisk(sf, rel);
    const base = baseline[rel]; // undefined for legacy / brand-new files

    if (!fs.existsSync(diskPath)) {
      write(diskPath, newBuf);
      report.created.push(rel);
      nextFiles[rel] = newHash;
      continue;
    }

    const diskHash = manifest.sha256(fs.readFileSync(diskPath));

    if (diskHash === newHash) {
      (base === undefined ? report.adopted : report.unchanged).push(rel);
      nextFiles[rel] = newHash; // bring legacy files under tracking; keep tracked ones current
    } else if (base !== undefined && diskHash === base) {
      write(diskPath, newBuf); // untouched framework file → safe to refresh
      report.refreshed.push(rel);
      nextFiles[rel] = newHash;
    } else if (force) {
      write(diskPath, newBuf); // --force: overwrite the diverged file too, no .new sidecar
      report.forced.push(rel);
      nextFiles[rel] = newHash;
    } else {
      write(diskPath + '.new', newBuf); // user-edited or legacy-divergent → offer, never overwrite
      report.newSidecar.push(rel);
      if (base !== undefined) nextFiles[rel] = base; // keep flagged as diverged next time
    }
  }

  if (!dryRun) manifest.writeManifest(sf, { version, files: nextFiles });
  return report;
}

module.exports = { runUpdate };
