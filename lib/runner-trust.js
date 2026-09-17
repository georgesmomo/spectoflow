'use strict';
/*
 * A project's config.json can set the command that launches an agent (`runners`). That file is committed
 * and can be written by others — a cloned repository, a teammate's change, a member of the online
 * dashboard, or an agent run told to edit it — so a command that isn't the registry's default for that
 * agent only runs once the user has allowed it on THIS machine. Trust lives outside every project
 * (~/.spectoflow/trusted-runners.json) and is bound to the exact command: change it, and it must be
 * allowed again. Default commands never ask. (D76)
 */
const fs = require('fs');
const path = require('path');
const globalConfig = require('./global-config');
const adapters = require('./adapters');

function storePath() { return path.join(globalConfig.homeDir(), 'trusted-runners.json'); }
function readStore() { try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')) || {}; } catch { return {}; } }
function projectKey(root) { try { return fs.realpathSync(root); } catch { return path.resolve(root); } }

const defaultRunner = (which) => { const a = adapters.knownAgents().find((x) => x.id === which); return a ? a.runner : null; };
const isDefault = (which, cmd) => !!cmd && cmd === defaultRunner(which);

function isTrusted(root, which, cmd) {
  if (!cmd || isDefault(which, cmd)) return true;
  const allowed = readStore()[projectKey(root)];
  return !!(allowed && allowed[which] === cmd);
}

function trust(root, which, cmd) {
  const store = readStore(), key = projectKey(root);
  store[key] = { ...(store[key] || {}), [which]: cmd };
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
}

// The project's runners that would be refused right now → [{ agent, command }].
function untrusted(root, cfg) {
  return Object.entries((cfg && cfg.runners) || {})
    .filter(([which, cmd]) => typeof cmd === 'string' && !isTrusted(root, which, cmd))
    .map(([agent, command]) => ({ agent, command }));
}

// null when `cmd` may run; otherwise the message explaining why not and how to allow it.
function blockedMessage(root, which, cmd) {
  if (isTrusted(root, which, cmd)) return null;
  return `For your safety, this project's custom command for "${which}" needs your OK once on this machine before it runs: ${cmd} — allow it in Personalize → Agent & automation, or run: spectoflow runners allow ${which}`;
}

module.exports = { isTrusted, isDefault, trust, untrusted, blockedMessage, storePath };
