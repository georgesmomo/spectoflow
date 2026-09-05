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

// Files the kit shipped before 0.24 and no longer does. Used ONLY for the no-manifest hint: with a
// manifest, retired files are computed from it, not from this list.
const LEGACY_LEFTOVERS = ['dashboard', 'lib/store.js', 'lib/agents-registry.js', 'lib/customize-prompts.js', 'lib/custom-dashboard.js'];

// Data migration (0.23 → 0.24): custom views out of the old dashboard folder, the per-project lock
// and its .gitignore line gone. Runs before any removal, is idempotent, and never overwrites.
function migrateProjectData(projectRoot, sf, dryRun) {
  const r = { movedViews: [], conflicts: [], removedLock: false, gitignoreCleaned: false };
  const oldDir = path.join(sf, 'dashboard', 'custom'), newDir = path.join(sf, 'dashboards');
  if (fs.existsSync(oldDir)) {
    for (const f of fs.readdirSync(oldDir).filter((x) => x.endsWith('.json')).sort()) {
      if (fs.existsSync(path.join(newDir, f))) { r.conflicts.push(f); continue; }
      r.movedViews.push(f);
      if (!dryRun) { fs.mkdirSync(newDir, { recursive: true }); fs.renameSync(path.join(oldDir, f), path.join(newDir, f)); }
    }
    // Every view that could move did; if nothing was left behind (no conflict), the folder the
    // retired-files loop can't see (it never tracked a data folder as a framework file) won't prune
    // itself — do it here so an all-clear migration doesn't block dashboard/ from fully retiring.
    if (!dryRun) { try { if (fs.readdirSync(oldDir).length === 0) fs.rmdirSync(oldDir); } catch { /* not empty, or already gone */ } }
  }
  const lock = path.join(sf, '.dashboard.lock');
  if (fs.existsSync(lock)) { r.removedLock = true; if (!dryRun) fs.unlinkSync(lock); }
  const gi = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(gi)) {
    const lines = fs.readFileSync(gi, 'utf8').split('\n');
    const kept = lines.filter((l) => l.trim() !== '.spectoflow/.dashboard.lock');
    if (kept.length !== lines.length) { r.gitignoreCleaned = true; if (!dryRun) fs.writeFileSync(gi, kept.join('\n')); }
  }
  return r;
}

// Remove `fp`, then every now-empty parent up to (not including) `stop`.
function removeAndPrune(fp, stop) {
  fs.unlinkSync(fp);
  let dir = path.dirname(fp);
  while (dir.startsWith(stop + path.sep)) {
    try { if (fs.readdirSync(dir).length) break; fs.rmdirSync(dir); } catch { break; }
    dir = path.dirname(dir);
  }
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
    removed: [],
    kept: [],
    migration: null,
    legacyLeftovers: [],
  };
  const baseline = (prev && prev.files) || {};
  const nextFiles = {}; // manifest to write after this run
  report.migration = migrateProjectData(projectRoot, sf, dryRun);

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

  // Retired files: in the previous manifest, no longer in the kit. Intact (hash == baseline) → gone;
  // modified → kept and reported, and it stays in the manifest so the next run warns again. --force
  // never applies here: there is no kit version to restore, so nothing legitimate to force.
  const kit = new Set(ownership.listFrameworkFiles(templatesDir));
  for (const rel of Object.keys(baseline)) {
    if (kit.has(rel)) continue;
    const diskPath = toDisk(sf, rel);
    if (!fs.existsSync(diskPath)) continue; // already gone — just drop it from the manifest
    if (manifest.sha256(fs.readFileSync(diskPath)) === baseline[rel]) {
      if (!dryRun) removeAndPrune(diskPath, sf);
      report.removed.push(rel);
    } else {
      report.kept.push(rel);
      nextFiles[rel] = baseline[rel];
    }
  }
  if (!prev) {
    for (const rel of LEGACY_LEFTOVERS) if (fs.existsSync(toDisk(sf, rel))) report.legacyLeftovers.push(rel);
  }

  if (!dryRun) manifest.writeManifest(sf, { version, files: nextFiles });
  return report;
}

module.exports = { runUpdate };
