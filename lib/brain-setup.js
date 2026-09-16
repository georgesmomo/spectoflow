'use strict';
/*
 * `spectoflow brain setup` — registers the `spectoflow mcp` server (lib/mcp-server.js) in the
 * USER-LEVEL MCP config of every coding agent installed on this machine, once per machine. User level
 * because the second brain is personal, and because project-level MCP config is unreliable or absent
 * for several agents (trusted-projects-only in Codex, ignored by Antigravity, missing in Goose/Kimi).
 *
 * Paths and entry shapes come from each agent's own docs (research pass 2026-09-16, see
 * docs/second-brain-design.md). Same rules as lib/mcp.js: an existing entry is never touched, a file
 * that can't be parsed is never rewritten. Claude Code is the one agent wired through its own CLI —
 * it rewrites ~/.claude.json constantly, so editing that file directly could lose the write.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { REGISTRY } = require('./adapters');
const detect = require('./detect');
const { mergeMcpServer } = require('./mcp');

const NAME = 'spectoflow';

// `spectoflow mcp` when the `spectoflow` on PATH is this very install; otherwise node + this bin's
// absolute path (running from a clone, or another version on PATH). Always node + path on Windows: there
// `spectoflow` is an npm .cmd shim, which MCP hosts that spawn without a shell can't start.
function serverCommand({ binPath, env = process.env, platform = process.platform } = {}) {
  const found = findOnPath('spectoflow', env, platform);
  let same = false;
  if (found && platform !== 'win32') { try { same = fs.realpathSync(found) === fs.realpathSync(binPath); } catch { same = false; } }
  const cmd = same ? { command: 'spectoflow', args: ['mcp'] } : { command: process.execPath, args: [binPath, 'mcp'] };
  if (env.SPECTOFLOW_HOME) cmd.env = { SPECTOFLOW_HOME: env.SPECTOFLOW_HOME };
  return cmd;
}
function findOnPath(bin, env, platform) {
  const exts = platform === 'win32' ? ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  for (const d of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const e of exts) { const fp = path.join(d, bin + e); if (fs.existsSync(fp)) return fp; }
  }
  return null;
}

const home = () => os.homedir();
const appData = () => process.env.APPDATA || path.join(home(), 'AppData', 'Roaming');

// id → how to wire it. `file` is resolved lazily (tests point HOME elsewhere).
const TARGETS = {
  claude: { kind: 'claude-cli', file: () => path.join(process.env.CLAUDE_CONFIG_DIR || home(), '.claude.json') },
  codex: { kind: 'toml', file: () => path.join(process.env.CODEX_HOME || path.join(home(), '.codex'), 'config.toml') },
  cursor: { kind: 'json', file: () => path.join(home(), '.cursor', 'mcp.json') },
  gemini: { kind: 'json', file: () => path.join(home(), '.gemini', 'settings.json') },
  opencode: { kind: 'opencode', file: () => path.join(home(), '.config', 'opencode', 'opencode.json') },
  kiro: { kind: 'json', file: () => path.join(home(), '.kiro', 'settings', 'mcp.json') },
  antigravity: { kind: 'json', file: () => path.join(home(), '.gemini', 'config', 'mcp_config.json') },
  copilot: { kind: 'json', extra: { type: 'local', tools: ['*'] }, file: () => path.join(process.env.COPILOT_HOME || path.join(home(), '.copilot'), 'mcp-config.json') },
  'amazon-q': { kind: 'json', file: () => path.join(home(), '.aws', 'amazonq', 'mcp.json') },
  droid: { kind: 'json', file: () => path.join(home(), '.factory', 'mcp.json') },
  auggie: { kind: 'json', file: () => path.join(home(), '.augment', 'settings.json') },
  goose: { kind: 'yaml-snippet', file: () => (process.platform === 'win32' ? path.join(appData(), 'Block', 'goose', 'config', 'config.yaml') : path.join(home(), '.config', 'goose', 'config.yaml')) },
  kimi: { kind: 'json', file: () => path.join(home(), '.kimi', 'mcp.json') },
};

const tomlString = (s) => JSON.stringify(String(s));
function tomlBlock(cmd) {
  const lines = [`[mcp_servers.${NAME}]`, `command = ${tomlString(cmd.command)}`, `args = [${cmd.args.map(tomlString).join(', ')}]`];
  if (cmd.env) lines.push(`env = { ${Object.entries(cmd.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(', ')} }`);
  return lines.join('\n') + '\n';
}
function yamlBlock(cmd) {
  const q = (s) => JSON.stringify(String(s));
  const lines = ['extensions:', `  ${NAME}:`, '    type: stdio', `    name: ${NAME}`, '    enabled: true', `    cmd: ${q(cmd.command)}`, `    args: [${cmd.args.map(q).join(', ')}]`, '    timeout: 300'];
  if (cmd.env) lines.push(`    envs: { ${Object.entries(cmd.env).map(([k, v]) => `${k}: ${q(v)}`).join(', ')} }`);
  return lines.join('\n') + '\n';
}
const readText = (fp) => { try { return fs.readFileSync(fp, 'utf8'); } catch { return null; } };

// Is a `spectoflow` MCP server declared in this Codex TOML, in any of the forms TOML allows:
// [mcp_servers.spectoflow] (bare or quoted key, trailing comment), a dotted key, or a key inside [mcp_servers].
function tomlHasServer(text) {
  const key = `(["']?)${NAME}\\1`;
  if (new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${key}\\s*(\\.[^\\]]*)?\\]\\s*(#.*)?$`, 'm').test(text)) return true;
  if (new RegExp(`^\\s*mcp_servers\\s*\\.\\s*${key}\\s*[.=]`, 'm').test(text)) return true;
  let inTable = false;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^\s*\[\s*([^\]]+?)\s*\]/);
    if (h) { inTable = h[1].replace(/\s+/g, '') === 'mcp_servers'; continue; }
    if (inTable && new RegExp(`^\\s*${key}\\s*[.=]`).test(line)) return true;
  }
  return false;
}

// Is the spectoflow server already registered for this agent? (true/false; null = can't tell)
function isWired(id) {
  const t = TARGETS[id]; if (!t) return null;
  const fp = t.file(), text = readText(fp);
  if (text === null) return false;
  if (t.kind === 'toml') return tomlHasServer(text);
  if (t.kind === 'yaml-snippet') return /^extensions:\s*$/m.test(text) && new RegExp(`^ {2}${NAME}:\\s*$`, 'm').test(text);
  try {
    const doc = JSON.parse(text);
    const map = t.kind === 'opencode' ? doc.mcp : doc.mcpServers;
    return !!(map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, NAME));
  } catch { return null; }
}

function wireOne(id, cmd, { dryRun, run }) {
  const t = TARGETS[id], fp = t.file();
  if (t.kind === 'claude-cli') {
    if (isWired(id)) return { status: 'exists', file: fp };
    // Name before --env: --env takes several values and would swallow the name otherwise.
    const args = ['mcp', 'add', '--scope', 'user', NAME, ...Object.entries(cmd.env || {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]), '--', cmd.command, ...cmd.args];
    if (dryRun) return { status: 'added', file: fp, via: `claude ${args.join(' ')}` };
    const r = run('claude', args);
    const out = `${r.stderr || ''}${r.stdout || ''}`.trim();
    if (r.status === 0) return { status: 'added', file: fp, via: 'claude mcp add' };
    if (/already exists/i.test(out)) return { status: 'exists', file: fp };
    return { status: 'failed', file: fp, detail: out || (r.error && r.error.message) || 'failed', manual: `claude ${args.join(' ')}` };
  }
  if (t.kind === 'json') return { status: mergeMcpServer(fp, NAME, { ...(t.extra || {}), command: cmd.command, args: cmd.args, ...(cmd.env ? { env: cmd.env } : {}) }, { dryRun }), file: fp };
  if (t.kind === 'opencode') return { status: mergeMcpServer(fp, NAME, { type: 'local', command: [cmd.command, ...cmd.args], enabled: true, ...(cmd.env ? { environment: cmd.env } : {}) }, { key: 'mcp', dryRun }), file: fp };
  if (t.kind === 'toml') {
    const text = readText(fp);
    if (text !== null && isWired(id)) return { status: 'exists', file: fp };
    // Any other mention of spectoflow is a form we can't classify: appending could declare the table twice,
    // and a duplicate key makes Codex refuse its whole config. Hand the user the block instead.
    if (text !== null && text.includes(NAME)) return { status: 'manual', file: fp, manual: tomlBlock(cmd) };
    // `mcp_servers = { … }` (an inline table) can't be extended by a [mcp_servers.x] header either.
    if (text !== null && /^\s*mcp_servers\s*=/m.test(text)) return { status: 'manual', file: fp, manual: tomlBlock(cmd) };
    if (!dryRun) {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, text === null ? tomlBlock(cmd) : text.replace(/\s*$/, '') + '\n\n' + tomlBlock(cmd));
    }
    return { status: text === null ? 'created' : 'added', file: fp };
  }
  // Goose: YAML can't be edited safely without a parser — hand the user the exact block instead.
  if (isWired(id)) return { status: 'exists', file: fp };
  return { status: 'manual', file: fp, manual: yamlBlock(cmd) };
}

// No shell on POSIX. On Windows `claude` is a .cmd shim, which needs cmd.exe — with every argument quoted,
// or a path like C:\\Program Files\\nodejs\\node.exe would be split.
function defaultRun(bin, args) {
  if (process.platform !== 'win32') return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true });
  const q = (a) => `"${String(a).replace(/"/g, '""')}"`;
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${[bin, ...args].map(q).join(' ')}"`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true });
}

// → [{ id, label, status: created|added|exists|skipped|manual|failed, file, manual?, detail? }]
// for every agent installed on this machine. `agents` overrides detection (tests, explicit choice).
function setup({ binPath, dryRun = false, agents, run = defaultRun, env = process.env } = {}) {
  const cmd = serverCommand({ binPath, env });
  const ids = agents || REGISTRY.filter((a) => TARGETS[a.id] && detect.binOnPath(a.detect.bin, { env })).map((a) => a.id);
  return ids.filter((id) => TARGETS[id]).map((id) => {
    const label = (REGISTRY.find((a) => a.id === id) || {}).label || id;
    try { return { id, label, ...wireOne(id, cmd, { dryRun, run }) }; }
    catch (e) { return { id, label, status: 'failed', file: TARGETS[id].file(), detail: e.message }; }
  });
}

// For the dashboard page: each installed agent and whether the server is registered for it.
function status({ env = process.env } = {}) {
  return REGISTRY.filter((a) => TARGETS[a.id] && detect.binOnPath(a.detect.bin, { env }))
    .map((a) => ({ id: a.id, label: a.label, wired: isWired(a.id) === true }));
}

module.exports = { setup, status, isWired, serverCommand, TARGETS, NAME };
