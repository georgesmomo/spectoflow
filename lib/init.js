'use strict';
/*
 * Scaffolds .spectoflow/ into a target folder — the logic behind `spectoflow init`, extracted from
 * bin/spectoflow.js so server code (the hub's Add Project auto-init step, sub-project 4) can call it
 * too, without any CLI argv/console.log coupling. bin/spectoflow.js's init() is now a thin wrapper:
 * parse argv, call runInit(), print the result.
 */
const fs = require('fs');
const path = require('path');
const detect = require('./detect');
const adapters = require('./adapters');
const ownership = require('./ownership');
const manifest = require('./manifest');
const mcp = require('./mcp');
const store = require('../templates/lib/store');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

// Existing project: give id-less checkbox tasks a stable id, in place.
const ID_RE = /^[A-Za-z]{1,5}-?\d+[A-Za-z]?$/;
function normalizePlans(root, config) {
  const dirName = store.resolvePlansDir(root, config || store.readConfig(root));
  const dir = path.join(root, dirName);
  if (!fs.existsSync(dir)) return 0;
  let added = 0, seq = 1;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fp = path.join(dir, f);
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*- \[[ xX]\]\s+)(\S+)(\s.*)?$/);
      if (m && !ID_RE.test(m[2])) {
        const id = 'T-' + String(seq++).padStart(3, '0');
        lines[i] = `${m[1]}${id} ${m[2]}${m[3] || ''}`;
        touched = true; added++;
      } else if (m) { seq++; }
    }
    if (touched) fs.writeFileSync(fp, lines.join('\n'));
  }
  return added;
}

function runInit({ target, templatesDir, version, agentsArg }) {
  fs.mkdirSync(target, { recursive: true });
  const notes = [];

  let agents, detected = [];
  if (agentsArg) {
    agents = agentsArg.split(',');
  } else {
    detected = detect.detectAgents(target);
    agents = detected.length ? detected : ['claude', 'codex'];
    notes.push(detected.length
      ? `Detected agent(s): ${detected.join(', ')} — active: ${agents[0]}.`
      : 'No agent CLI detected — defaulted to claude + codex.');
  }

  const claude = path.join(target, 'CLAUDE.md');
  if (fs.existsSync(claude) && !fs.existsSync(claude + '.tomerge')) {
    fs.renameSync(claude, claude + '.tomerge');
    notes.push('Existing CLAUDE.md preserved as CLAUDE.md.tomerge — your agent merges it on first run.');
  }

  const spectoflowDir = path.join(target, '.spectoflow');
  copyDir(templatesDir, spectoflowDir);

  const frameworkFiles = ownership.listFrameworkFiles(templatesDir);
  manifest.writeManifest(spectoflowDir, {
    version,
    files: manifest.hashFileMap(spectoflowDir, frameworkFiles),
  });

  const cfgPath = path.join(spectoflowDir, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.agent = agents[0];
  cfg.runners = { ...cfg.runners, ...adapters.defaultRunners(agents) };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  const plansDirName = store.resolvePlansDir(target, cfg);
  const specsDirName = store.resolveSpecsDir(target, cfg);
  fs.mkdirSync(path.join(target, specsDirName), { recursive: true });
  fs.mkdirSync(path.join(target, plansDirName), { recursive: true });
  if (plansDirName !== 'plans') notes.push(`Using existing '${plansDirName}/' as the plans folder (set plansDir in config.json to override).`);
  if (specsDirName !== 'specs') notes.push(`Using existing '${specsDirName}/' as the specs folder (set specsDir in config.json to override).`);

  const added = normalizePlans(target, cfg);
  if (added) notes.push(`Normalized ${added} existing task(s) with stable ids.`);

  const written = adapters.generate(target, agents);

  const mcpTargets = [path.join(target, '.mcp.json')];
  if (agents.includes('cursor')) mcpTargets.push(path.join(target, '.cursor', 'mcp.json'));
  for (const fp of mcpTargets) {
    const rel = path.relative(target, fp).split(path.sep).join('/');
    const r = mcp.mergeMcpServer(fp, 'playwright', mcp.PLAYWRIGHT_MCP);
    if (r === 'created' || r === 'added') notes.push(`Wired Playwright MCP into ${rel} (npx @playwright/mcp — for the E2E agent; commit it to share).`);
    else if (r === 'skipped') notes.push(`Left ${rel} as-is (couldn't parse it) — add a 'playwright' MCP server yourself for browser-driven E2E.`);
  }

  const gi = path.join(target, '.gitignore');
  const giText = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  for (const line of ['.spectoflow/runtime.json', '.spectoflow/.dashboard.lock']) {
    if (!giText.includes(line)) fs.appendFileSync(gi, ((fs.existsSync(gi) && fs.readFileSync(gi, 'utf8').length) ? '\n' : '') + line + '\n');
  }

  return { target, agents, detected, written, notes };
}

module.exports = { runInit };
