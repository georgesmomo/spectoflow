'use strict';
/*
 * Global config — ~/.spectoflow/config.json (or $SPECTOFLOW_HOME/config.json). Settings that apply
 * to every project on this machine: where the dashboard workspace lives, which dashboard URL
 * projects talk to, and the defaults `spectoflow init` seeds a new project's config.json with.
 * Layering, lowest to highest: kit templates < these defaults < the project's own config.json.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REGISTRY } = require('./adapters');

const KEYS = ['dashboard.url', 'dashboard.path', 'defaults.agent', 'defaults.language', 'defaults.mode', 'defaults.design'];
const MODES = ['autopilot', 'semi', 'manual'];

function homeDir() { return process.env.SPECTOFLOW_HOME || path.join(os.homedir(), '.spectoflow'); }
function configPath() { return path.join(homeDir(), 'config.json'); }
function defaultDashboardPath() { return path.join(homeDir(), 'dashboard'); }
function expandHome(p) { return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p; }

function defaults() {
  return { dashboard: { url: 'http://localhost:4319', path: defaultDashboardPath() }, defaults: { agent: 'claude', language: 'en', mode: 'semi', design: 'console' } };
}
function readRaw() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {}; } catch { return {}; }
}
function writeRaw(obj) {
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(obj, null, 2) + '\n');
}
const getPath = (obj, key) => key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
const setPath = (obj, key, value) => { const ks = key.split('.'); let o = obj; for (const k of ks.slice(0, -1)) o = (o[k] = o[k] || {}); o[ks[ks.length - 1]] = value; };

function read() {
  const d = defaults(), raw = readRaw();
  return { dashboard: { ...d.dashboard, ...(raw.dashboard || {}) }, defaults: { ...d.defaults, ...(raw.defaults || {}) } };
}
function get(key) {
  if (!KEYS.includes(key)) throw new Error(`unknown key "${key}" — valid keys: ${KEYS.join(', ')}`);
  const raw = getPath(readRaw(), key);
  return raw !== undefined ? { value: raw, source: 'set' } : { value: getPath(defaults(), key), source: 'default' };
}
function list() { return KEYS.map((key) => ({ key, ...get(key) })); }

function validate(key, value) {
  const v = String(value).trim();
  switch (key) {
    case 'dashboard.url': { let u; try { u = new URL(v); } catch { throw new Error('dashboard.url must be a URL, e.g. http://localhost:4319'); } if (!/^https?:$/.test(u.protocol)) throw new Error('dashboard.url must start with http:// or https://'); return u.origin; }
    case 'dashboard.path': { if (!v) throw new Error('dashboard.path must be a folder path'); return path.resolve(expandHome(v)); }
    case 'defaults.agent': { if (!REGISTRY.some((a) => a.id === v)) throw new Error(`unknown agent "${v}" — one of: ${REGISTRY.map((a) => a.id).join(', ')}`); return v; }
    case 'defaults.language': { if (!/^[a-z]{2}$/.test(v)) throw new Error('defaults.language must be a 2-letter code (en, fr, es, de, pt, it…)'); return v; }
    case 'defaults.mode': { if (!MODES.includes(v)) throw new Error(`defaults.mode must be one of: ${MODES.join(', ')}`); return v; }
    case 'defaults.design': { if (!/^[a-z0-9-]{1,40}$/.test(v)) throw new Error('defaults.design must be a design id (console, orbit, …)'); return v; }
    default: throw new Error(`unknown key "${key}" — valid keys: ${KEYS.join(', ')}`);
  }
}
function set(key, value) {
  const v = validate(key, value);
  const raw = readRaw(); setPath(raw, key, v); writeRaw(raw);
  return v;
}
// Creates the file (empty object) if it doesn't exist — never touches an existing one.
function ensure() { if (!fs.existsSync(configPath())) writeRaw({}); }

module.exports = { KEYS, homeDir, configPath, defaultDashboardPath, expandHome, read, get, set, list, ensure };
