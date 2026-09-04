'use strict';
/*
 * The project registry — ~/.spectoflow/projects.json. Tracks every project spectoflow has seen (via
 * `spectoflow dashboard`, wired in a later sub-project), so the multi-project hub knows what to list
 * and switch between. This module owns only the registry file itself; it has no opinion about
 * dashboards, ports, or servers, and nothing else in the codebase calls it yet.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REGISTRY_FILE = 'projects.json';

// Resolution order: an explicit baseDir (unit tests) > SPECTOFLOW_HOME (CLI-level test isolation,
// same convention as SPECTOFLOW_ROOT/SPECTOFLOW_PORT elsewhere in this codebase) > the real home dir.
function registryDir(baseDir) {
  return baseDir || process.env.SPECTOFLOW_HOME || path.join(os.homedir(), '.spectoflow');
}
function registryPath(baseDir) {
  return path.join(registryDir(baseDir), REGISTRY_FILE);
}

function readRegistry(baseDir) {
  try { return JSON.parse(fs.readFileSync(registryPath(baseDir), 'utf8')); }
  catch { return { projects: [] }; }
}

function writeRegistry(baseDir, data) {
  const dir = registryDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryPath(baseDir), JSON.stringify(data, null, 2) + '\n');
}

// 6 hex chars; regenerated on the rare collision against ids already in the registry. `randomFn` is
// injectable (defaults to crypto.randomBytes) so collision handling is testable without depending on
// genuine randomness to ever actually collide.
function genId(existingIds, randomFn) {
  const rand = randomFn || ((n) => crypto.randomBytes(n));
  let id;
  do { id = rand(3).toString('hex'); } while (existingIds.includes(id));
  return id;
}

function findByPath(projectPath, baseDir) {
  const target = path.resolve(projectPath);
  return readRegistry(baseDir).projects.find((p) => path.resolve(p.path) === target) || null;
}

// Registers `projectPath` if it isn't already known (matched by normalized path); either way stamps
// lastOpened to now and returns the entry. Never duplicates the same folder under a second id.
function addProject(projectPath, baseDir) {
  const reg = readRegistry(baseDir);
  const target = path.resolve(projectPath);
  let entry = reg.projects.find((p) => path.resolve(p.path) === target);
  if (!entry) {
    entry = {
      id: genId(reg.projects.map((p) => p.id)),
      path: target,
      name: path.basename(target),
      lastOpened: new Date().toISOString(),
    };
    reg.projects.push(entry);
  } else {
    entry.lastOpened = new Date().toISOString();
  }
  writeRegistry(baseDir, reg);
  return entry;
}

function removeProject(id, baseDir) {
  const reg = readRegistry(baseDir);
  const before = reg.projects.length;
  reg.projects = reg.projects.filter((p) => p.id !== id);
  writeRegistry(baseDir, reg);
  return reg.projects.length < before;
}

function touchProject(id, baseDir) {
  const reg = readRegistry(baseDir);
  const entry = reg.projects.find((p) => p.id === id);
  if (!entry) return false;
  entry.lastOpened = new Date().toISOString();
  writeRegistry(baseDir, reg);
  return true;
}

// Newest-first — the natural "what did I touch most recently" order for both `spectoflow projects
// list` and (in a later sub-project) the hub landing page.
function listProjects(baseDir) {
  return readRegistry(baseDir).projects.slice()
    .sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || ''));
}

module.exports = {
  readRegistry, writeRegistry, genId, addProject, removeProject, touchProject,
  findByPath, listProjects, registryPath,
};
