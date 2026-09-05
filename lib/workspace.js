'use strict';
/*
 * The dashboard workspace — the dashboard's own state, outside every project: dashboard.json
 * (name/port/design), projects.json (the registry), hub.lock, and projects/<id>/ for dashboard-side
 * per-project data (meta.json today; B adds a scan cache, C adds members/tokens). Default location
 * $SPECTOFLOW_HOME/dashboard (~/.spectoflow/dashboard); movable via global config dashboard.path.
 */
const fs = require('fs');
const path = require('path');
const globalConfig = require('./global-config');
const registry = require('./registry');

const SETTINGS_DEFAULTS = { name: null, port: 4319, design: 'console' };

function dir(baseDir) { return baseDir || globalConfig.read().dashboard.path; }
function settingsPath(baseDir) { return path.join(dir(baseDir), 'dashboard.json'); }
function lockPath(baseDir) { return path.join(dir(baseDir), 'hub.lock'); }
function projectDir(id, baseDir) { return path.join(dir(baseDir), 'projects', id); }

function readJSON(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; } }
function settings(baseDir) {
  const raw = readJSON(settingsPath(baseDir)) || {};
  const s = { ...SETTINGS_DEFAULTS, ...raw };
  if (!s.name) s.name = path.basename(dir(baseDir));
  return s;
}
function exists(baseDir) { return fs.existsSync(settingsPath(baseDir)); }

// Idempotent: creates what is missing, never deletes, updates dashboard.json only for fields passed.
// Moving the workspace (a new `path`) carries the registry over when the new one has no projects.
function init({ path: newPath, port, name, design } = {}) {
  const prevDir = globalConfig.read().dashboard.path;
  const target = newPath ? path.resolve(globalConfig.expandHome(newPath)) : prevDir;
  const created = !exists(target);
  fs.mkdirSync(path.join(target, 'projects'), { recursive: true });
  const s = { ...SETTINGS_DEFAULTS, ...(readJSON(settingsPath(target)) || {}) };
  if (!s.name) s.name = path.basename(target);
  if (name !== undefined) s.name = String(name);
  if (port !== undefined) s.port = Number(port);
  if (design !== undefined) s.design = String(design);
  fs.writeFileSync(settingsPath(target), JSON.stringify(s, null, 2) + '\n');
  let registryCarried = false;
  const targetReg = registry.readRegistry(target);
  if (!fs.existsSync(registry.registryPath(target))) {
    const prevReg = path.resolve(prevDir) !== path.resolve(target) ? registry.readRegistry(prevDir) : { projects: [] };
    if (prevReg.projects.length && !targetReg.projects.length) { registry.writeRegistry(target, prevReg); registryCarried = true; }
    else registry.writeRegistry(target, { projects: [] });
  }
  if (path.resolve(target) !== path.resolve(prevDir) || globalConfig.get('dashboard.path').source === 'default') globalConfig.set('dashboard.path', target);
  return { dir: target, created, registryCarried };
}

function registerProject(projectPath, baseDir) {
  const entry = registry.addProject(projectPath, baseDir);
  const pd = projectDir(entry.id, baseDir);
  fs.mkdirSync(pd, { recursive: true });
  const metaPath = path.join(pd, 'meta.json');
  if (!fs.existsSync(metaPath)) fs.writeFileSync(metaPath, JSON.stringify({ addedAt: new Date().toISOString(), lastOpened: entry.lastOpened, kind: entry.kind || 'spectoflow' }, null, 2) + '\n');
  return entry;
}

// Pre-0.24 the registry and lock sat directly in ~/.spectoflow/. Move them into the workspace the
// first time the new code runs — one-time, and only when the workspace has none of its own.
function migrateLegacyHome(baseDir) {
  const home = globalConfig.homeDir();
  const target = dir(baseDir);
  const r = { movedRegistry: false, movedLock: false };
  if (path.resolve(home) === path.resolve(target)) return r;
  fs.mkdirSync(target, { recursive: true });
  const legacyReg = path.join(home, 'projects.json');
  if (fs.existsSync(legacyReg) && !fs.existsSync(registry.registryPath(target))) { fs.renameSync(legacyReg, registry.registryPath(target)); r.movedRegistry = true; }
  const legacyLock = path.join(home, 'hub.lock');
  if (fs.existsSync(legacyLock) && !fs.existsSync(lockPath(target))) { fs.renameSync(legacyLock, lockPath(target)); r.movedLock = true; }
  return r;
}

// The hub's lock: the workspace's, else a legacy one still written by a pre-0.24 hub that may be
// running right now (so `dashboard status/stop` keep finding it across the upgrade).
function readLock(baseDir) {
  return readJSON(lockPath(baseDir)) || readJSON(path.join(globalConfig.homeDir(), 'hub.lock'));
}

module.exports = { dir, exists, settings, settingsPath, lockPath, projectDir, init, registerProject, migrateLegacyHome, readLock };
