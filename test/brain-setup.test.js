'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every file this suite writes lands in a throwaway HOME — never the real one.
const realHome = os.homedir();
beforeEach(() => { process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-bsetup-')); process.env.USERPROFILE = process.env.HOME; delete process.env.COPILOT_HOME; delete process.env.CODEX_HOME; delete process.env.CLAUDE_CONFIG_DIR; });
const setupLib = require('../lib/brain-setup');
const BIN = path.join(__dirname, '..', 'bin', 'spectoflow.js');
const at = (...p) => path.join(os.homedir(), ...p);
const json = (fp) => JSON.parse(fs.readFileSync(fp, 'utf8'));
const noPath = { PATH: '' };

test('the suite really runs against a temporary HOME', () => {
  assert.notStrictEqual(os.homedir(), realHome);
});

test('serverCommand: node + this bin when `spectoflow` on PATH is another install; SPECTOFLOW_HOME passed through', () => {
  const cmd = setupLib.serverCommand({ binPath: BIN, env: { PATH: '', SPECTOFLOW_HOME: '/x/home' } });
  assert.deepStrictEqual(cmd, { command: process.execPath, args: [BIN, 'mcp'], env: { SPECTOFLOW_HOME: '/x/home' } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-bin-'));
  fs.symlinkSync(BIN, path.join(dir, 'spectoflow'));
  assert.deepStrictEqual(setupLib.serverCommand({ binPath: BIN, env: { PATH: dir }, platform: 'linux' }), { command: 'spectoflow', args: ['mcp'] });
});

test('JSON agents: created, then added next to existing servers, then left alone', () => {
  const r1 = setupLib.setup({ binPath: BIN, agents: ['gemini'], env: noPath });
  assert.strictEqual(r1[0].status, 'created');
  assert.deepStrictEqual(json(at('.gemini', 'settings.json')).mcpServers.spectoflow, { command: process.execPath, args: [BIN, 'mcp'] });

  fs.mkdirSync(at('.kiro', 'settings'), { recursive: true });
  fs.writeFileSync(at('.kiro', 'settings', 'mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } }, keep: 1 }));
  assert.strictEqual(setupLib.setup({ binPath: BIN, agents: ['kiro'], env: noPath })[0].status, 'added');
  const kiro = json(at('.kiro', 'settings', 'mcp.json'));
  assert.deepStrictEqual(Object.keys(kiro.mcpServers), ['other', 'spectoflow']);
  assert.strictEqual(kiro.keep, 1);

  const custom = { command: 'my-own', args: [] };
  kiro.mcpServers.spectoflow = custom;
  fs.writeFileSync(at('.kiro', 'settings', 'mcp.json'), JSON.stringify(kiro));
  assert.strictEqual(setupLib.setup({ binPath: BIN, agents: ['kiro'], env: noPath })[0].status, 'exists');
  assert.deepStrictEqual(json(at('.kiro', 'settings', 'mcp.json')).mcpServers.spectoflow, custom, 'an existing entry is never touched');
});

test('an unparseable file (JSONC with comments) is skipped, never rewritten', () => {
  const fp = at('.config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const original = '{\n  // my comment\n  "theme": "dark"\n}\n';
  fs.writeFileSync(fp, original);
  assert.strictEqual(setupLib.setup({ binPath: BIN, agents: ['opencode'], env: noPath })[0].status, 'skipped');
  assert.strictEqual(fs.readFileSync(fp, 'utf8'), original);
});

test('OpenCode and Copilot get their own entry shapes', () => {
  setupLib.setup({ binPath: BIN, agents: ['opencode', 'copilot'], env: noPath });
  assert.deepStrictEqual(json(at('.config', 'opencode', 'opencode.json')).mcp.spectoflow, { type: 'local', command: [process.execPath, BIN, 'mcp'], enabled: true });
  assert.deepStrictEqual(json(at('.copilot', 'mcp-config.json')).mcpServers.spectoflow, { type: 'local', tools: ['*'], command: process.execPath, args: [BIN, 'mcp'] });
});

test('Codex TOML: appended as its own table, detected on the next run', () => {
  const fp = at('.codex', 'config.toml');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n');
  assert.strictEqual(setupLib.setup({ binPath: BIN, agents: ['codex'], env: noPath })[0].status, 'added');
  const text = fs.readFileSync(fp, 'utf8');
  assert.ok(text.startsWith('model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n'), 'existing content untouched');
  assert.ok(text.endsWith(`\n\n[mcp_servers.spectoflow]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(BIN)}, "mcp"]\n`));
  assert.strictEqual(setupLib.setup({ binPath: BIN, agents: ['codex'], env: noPath })[0].status, 'exists');
  assert.strictEqual(fs.readFileSync(fp, 'utf8'), text);
});

test('Goose gets a snippet to paste, never an edit', () => {
  const [r] = setupLib.setup({ binPath: BIN, agents: ['goose'], env: noPath });
  assert.strictEqual(r.status, 'manual');
  assert.match(r.manual, /^extensions:\n {2}spectoflow:\n {4}type: stdio\n/);
  assert.ok(!fs.existsSync(r.file));
  fs.mkdirSync(path.dirname(r.file), { recursive: true });
  fs.writeFileSync(r.file, r.manual);
  assert.strictEqual(setupLib.setup({ binPath: BIN, agents: ['goose'], env: noPath })[0].status, 'exists');
});

test('Claude Code goes through `claude mcp add --scope user <name> --env … -- cmd`, and is detected from its .claude.json', () => {
  const calls = [];
  const run = (bin, args) => { calls.push([bin, ...args]); return { status: 0, stdout: '', stderr: '' }; };
  const [r] = setupLib.setup({ binPath: BIN, agents: ['claude'], env: noPath, run });
  assert.strictEqual(r.status, 'added');
  assert.deepStrictEqual(calls, [['claude', 'mcp', 'add', '--scope', 'user', 'spectoflow', '--', process.execPath, BIN, 'mcp']]);
  assert.ok(!fs.existsSync(at('.claude.json')), 'the file itself is never written');

  calls.length = 0;
  setupLib.setup({ binPath: BIN, agents: ['claude'], env: { PATH: '', SPECTOFLOW_HOME: '/x/h' }, run });
  assert.deepStrictEqual(calls[0], ['claude', 'mcp', 'add', '--scope', 'user', 'spectoflow', '--env', 'SPECTOFLOW_HOME=/x/h', '--', process.execPath, BIN, 'mcp'], 'the name comes before --env, which takes several values');

  fs.writeFileSync(at('.claude.json'), JSON.stringify({ mcpServers: { spectoflow: { command: 'spectoflow' } } }));
  calls.length = 0;
  assert.strictEqual(setupLib.setup({ binPath: BIN, agents: ['claude'], env: noPath, run })[0].status, 'exists');
  assert.deepStrictEqual(calls, []);

  fs.unlinkSync(at('.claude.json'));
  const failing = () => ({ status: 1, stderr: 'boom' });
  const [f] = setupLib.setup({ binPath: BIN, agents: ['claude'], env: noPath, run: failing });
  assert.strictEqual(f.status, 'failed');
  assert.strictEqual(f.detail, 'boom');
  assert.match(f.manual, /^claude mcp add --scope user spectoflow -- /);
  const already = () => ({ status: 1, stderr: 'MCP server spectoflow already exists in user config' });
  assert.strictEqual(setupLib.setup({ binPath: BIN, agents: ['claude'], env: noPath, run: already })[0].status, 'exists');
});

test('Claude Code with CLAUDE_CONFIG_DIR: detected from that folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-claudecfg-'));
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ mcpServers: { spectoflow: {} } }));
    assert.strictEqual(setupLib.isWired('claude'), true);
  } finally { delete process.env.CLAUDE_CONFIG_DIR; }
});

test('Codex: every TOML form of an existing spectoflow server is detected; an unclear mention is never appended to', () => {
  const fp = at('.codex', 'config.toml');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const wired = [
    "[mcp_servers.'spectoflow']\ncommand = \"x\"\n",
    '[mcp_servers.spectoflow]   # mine\ncommand = "x"\n',
    '[ mcp_servers . "spectoflow" ]\ncommand = "x"\n',
    '[mcp_servers]\nspectoflow = { command = "x" }\n',
    'mcp_servers.spectoflow = { command = "x" }\n',
    '[mcp_servers.spectoflow.env]\nA = "b"\n',
  ];
  for (const text of wired) {
    fs.writeFileSync(fp, text);
    const [r] = setupLib.setup({ binPath: BIN, agents: ['codex'], env: noPath });
    assert.strictEqual(r.status, 'exists', text);
    assert.strictEqual(fs.readFileSync(fp, 'utf8'), text, 'untouched');
  }
  const inline = 'mcp_servers = { other = { command = "x" } }\n';
  fs.writeFileSync(fp, inline);
  assert.strictEqual(setupLib.setup({ binPath: BIN, agents: ['codex'], env: noPath })[0].status, 'manual', 'an inline mcp_servers table cannot be extended by a header');
  assert.strictEqual(fs.readFileSync(fp, 'utf8'), inline);
  const unclear = '# I once tried spectoflow here\nmodel = "x"\n';
  fs.writeFileSync(fp, unclear);
  const [u] = setupLib.setup({ binPath: BIN, agents: ['codex'], env: noPath });
  assert.strictEqual(u.status, 'manual');
  assert.match(u.manual, /^\[mcp_servers\.spectoflow\]\n/);
  assert.strictEqual(fs.readFileSync(fp, 'utf8'), unclear, 'nothing appended');
});

test('Codex honours CODEX_HOME', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-codexhome-'));
  process.env.CODEX_HOME = dir;
  try {
    const [r] = setupLib.setup({ binPath: BIN, agents: ['codex'], env: noPath });
    assert.strictEqual(r.file, path.join(dir, 'config.toml'));
    assert.ok(fs.existsSync(path.join(dir, 'config.toml')));
  } finally { delete process.env.CODEX_HOME; }
});

test('on Windows the entry always runs node + the bin path (an npm .cmd shim cannot be spawned without a shell)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-winbin-'));
  fs.writeFileSync(path.join(dir, 'spectoflow.cmd'), '');
  assert.deepStrictEqual(setupLib.serverCommand({ binPath: BIN, env: { PATH: dir, PATHEXT: '.CMD' }, platform: 'win32' }), { command: process.execPath, args: [BIN, 'mcp'] });
});

test('Goose: only an `extensions:` → `spectoflow:` entry counts as wired', () => {
  const fp = at('.config', 'goose', 'config.yaml');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, 'providers:\n  spectoflow:\n    x: 1\n');
  assert.strictEqual(setupLib.isWired('goose'), false);
  fs.writeFileSync(fp, 'extensions:\n  developer:\n    enabled: true\n  spectoflow:\n    type: stdio\n');
  assert.strictEqual(setupLib.isWired('goose'), true);
});

test('--dry-run reports the same outcome and writes nothing', () => {
  const calls = [];
  const rows = setupLib.setup({ binPath: BIN, agents: ['gemini', 'codex', 'claude'], dryRun: true, env: noPath, run: (...a) => { calls.push(a); return { status: 0 }; } });
  assert.deepStrictEqual(rows.map((r) => r.status), ['created', 'created', 'added']);
  assert.deepStrictEqual(calls, [], 'no command run');
  assert.ok(!fs.existsSync(at('.gemini')) && !fs.existsSync(at('.codex')));
});

test('without an explicit list, only agents whose CLI is on PATH are wired; status() reports them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-path-'));
  for (const b of ['gemini', 'droid']) fs.writeFileSync(path.join(dir, b), '');
  const env = { PATH: dir };
  assert.deepStrictEqual(setupLib.status({ env }).map((a) => [a.id, a.wired]), [['gemini', false], ['droid', false]]);
  const rows = setupLib.setup({ binPath: BIN, env });
  assert.deepStrictEqual(rows.map((r) => r.id), ['gemini', 'droid']);
  assert.deepStrictEqual(setupLib.status({ env }).map((a) => [a.id, a.wired]), [['gemini', true], ['droid', true]]);
});
