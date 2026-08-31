#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const store = require('../templates/lib/store');
const adapters = require('../lib/adapters');
const detect = require('../lib/detect');
const ownership = require('../lib/ownership');
const manifest = require('../lib/manifest');

const KIT = path.resolve(__dirname, '..');
const TPL = path.join(KIT, 'templates');
const VERSION = require('../package.json').version;
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';

// Tiny ANSI colouriser — no dependency; disabled when not a TTY or NO_COLOR is set.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = { g: paint('32'), cy: paint('36'), b: paint('34'), y: paint('33'), dim: paint('2'), bold: paint('1'), amber: paint('38;5;179') };

// ---- dashboard port + running-state probe ------------------------------------
// Precedence: --port=NNNN > SPECTOFLOW_PORT env > 4319 (matches templates/dashboard/server.js).
function resolvePort(args) {
  const arg = (args.find((a) => a.startsWith('--port=')) || '').split('=')[1];
  return Number(arg || process.env.SPECTOFLOW_PORT || 4319);
}

// Native http probe, ~500ms timeout, never throws — resolves true/false.
function probeDashboard(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port, path: '/api/project', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

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

function init() {
  const target = path.resolve(argv[1] && !argv[1].startsWith('--') ? argv[1] : '.');
  const agentsArg = (argv.find((a) => a.startsWith('--agent=')) || '').split('=')[1];
  fs.mkdirSync(target, { recursive: true });
  const notes = [];

  // explicit --agent wins; otherwise detect installed agents; otherwise fall back to claude + codex
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

  // preserve an existing CLAUDE.md
  const claude = path.join(target, 'CLAUDE.md');
  if (fs.existsSync(claude) && !fs.existsSync(claude + '.tomerge')) {
    fs.renameSync(claude, claude + '.tomerge');
    notes.push('Existing CLAUDE.md preserved as CLAUDE.md.tomerge — your agent merges it on first run.');
  }

  // canonical framework → .spectoflow/
  const spectoflowDir = path.join(target, '.spectoflow');
  copyDir(TPL, spectoflowDir);

  // record the install baseline so `update` can tell untouched framework files from user edits
  const frameworkFiles = ownership.listFrameworkFiles(TPL);
  manifest.writeManifest(spectoflowDir, {
    version: VERSION,
    files: manifest.hashFileMap(spectoflowDir, frameworkFiles),
  });

  // set the active agent and seed runner commands from the selected/detected agents
  const cfgPath = path.join(spectoflowDir, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.agent = agents[0];
  cfg.runners = { ...cfg.runners, ...adapters.defaultRunners(agents) };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  // artifact folders — reuse an existing differently-named folder (e.g. a project that already
  // keeps its plans in `plan/`, singular) instead of always forcing the plans/specs convention;
  // mkdir is a no-op when the resolved folder already exists.
  const plansDirName = store.resolvePlansDir(target, cfg);
  const specsDirName = store.resolveSpecsDir(target, cfg);
  fs.mkdirSync(path.join(target, specsDirName), { recursive: true });
  fs.mkdirSync(path.join(target, plansDirName), { recursive: true });
  if (plansDirName !== 'plans') notes.push(`Using existing '${plansDirName}/' as the plans folder (set plansDir in config.json to override).`);
  if (specsDirName !== 'specs') notes.push(`Using existing '${specsDirName}/' as the specs folder (set specsDir in config.json to override).`);

  // existing project: id-normalize any plans already there
  const added = normalizePlans(target, cfg);
  if (added) notes.push(`Normalized ${added} existing task(s) with stable ids.`);

  // per-agent shims
  const written = adapters.generate(target, agents);

  // gitignore the volatile runtime
  const gi = path.join(target, '.gitignore');
  const giText = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  for (const line of ['.spectoflow/runtime.json', '.spectoflow/.dashboard.lock']) {
    if (!giText.includes(line)) fs.appendFileSync(gi, ((fs.existsSync(gi) && fs.readFileSync(gi, 'utf8').length) ? '\n' : '') + line + '\n');
  }

  console.log('spectoflow installed in', target);
  console.log('  .spectoflow/   framework (brain, workflow, agents, skills, policy, dashboard, config)');
  console.log('  specs/ plans/  markdown artifacts (your source of truth)');
  written.forEach((w) => console.log('  + ' + w));
  notes.forEach((n) => console.log('  ! ' + n));
  const port = resolvePort(argv);
  console.log('\nNext:');
  console.log('  1) Open your agent here — or just say what you want to build.');
  console.log('  2) spectoflow dashboard');
  console.log(`     → http://localhost:${port}`);
}

function update() {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, '.spectoflow'))) {
    return console.log('No spectoflow project here. Run: spectoflow init');
  }
  const dryRun = argv.includes('--dry-run');
  const r = require('../lib/update').runUpdate({ projectRoot: root, templatesDir: TPL, version: VERSION, dryRun });

  const from = r.fromVersion || 'unknown';
  const changed = r.refreshed.length + r.created.length + r.adopted.length + r.newSidecar.length;
  const row = (sym, label, list, painter, note) => {
    if (!list.length) return;
    const n = c.dim(String(list.length).padStart(2));
    const detail = note ? c.dim(note) : c.dim(list.slice(0, 6).join(', ') + (list.length > 6 ? ` +${list.length - 6} more` : ''));
    console.log(`  ${sym}  ${painter(label.padEnd(9))} ${n}   ${detail}`);
  };
  console.log('');
  console.log(`  ${c.bold('spectoflow update')}   ${c.dim(from)} ${c.amber('→')} ${c.bold(r.toVersion)}${dryRun ? c.dim('   (dry-run)') : ''}`);
  console.log('');
  row(c.g('✓'), 'refreshed', r.refreshed, c.g);
  row(c.cy('+'), 'created', r.created, c.cy);
  row(c.b('~'), 'adopted', r.adopted, c.b);
  row(c.y('!'), '.new', r.newSidecar, c.y, 'you edited these — new version saved as *.new, merge by hand');
  if (r.unchanged.length) console.log(`  ${c.dim('·')}  ${c.dim('unchanged'.padEnd(9))} ${c.dim(String(r.unchanged.length).padStart(2))}`);
  console.log(`  ${c.dim('=')}  ${c.dim('preserved'.padEnd(9))}      ${c.dim('config.json · workflow.md · specs/ · plans/ · your custom agents & skills')}`);
  console.log('');
  if (dryRun) console.log(`  ${c.dim('(dry-run — nothing was written)')}`);
  else console.log(`  ${changed ? c.g('✓ Done') : c.dim('Already up to date')}${changed ? c.dim(` · ${changed} file(s) changed`) : ''}`);
  if (r.newSidecar.length && !dryRun) console.log(`  ${c.y('→')} ${c.dim(`${r.newSidecar.length} *.new file(s) to review and merge`)}`);
  console.log('');
}

// THE launch command — prints the URL clearly and won't crash on EADDRINUSE: it probes first
// and, if a dashboard is already up on that port, just reports it instead of spawning a second one.
async function dashboard() {
  if (argv[1] === 'stop' || argv.includes('stop')) return stopDashboard();
  const port = resolvePort(argv);
  const url = `http://localhost:${port}`;
  if (await probeDashboard(port)) {
    console.log(`spectoflow dashboard already running → ${url}`);
    return;
  }
  const local = path.resolve('.spectoflow', 'dashboard', 'server.js');
  const bundled = path.join(TPL, 'dashboard', 'server.js');
  const env = Object.assign({}, process.env, { SPECTOFLOW_PORT: String(port) });
  spawn('node', [fs.existsSync(local) ? local : bundled], { stdio: 'inherit', env });
  console.log(`spectoflow dashboard → ${url}`);
}

// Stop the running dashboard: read the pidfile it wrote, verify it's actually up, then terminate it
// and clear the lock. Safe against a stale lock (a recycled pid) because it only kills when the port
// still responds.
async function stopDashboard() {
  const root = process.cwd();
  const lock = path.join(root, '.spectoflow', '.dashboard.lock');
  let info = null;
  try { info = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch {}
  const port = (info && info.port) || resolvePort(argv);
  const running = await probeDashboard(port);
  if (!running) {
    if (info) { try { fs.unlinkSync(lock); } catch {} }   // stale lock
    return console.log('No spectoflow dashboard is running.');
  }
  if (info && info.pid) {
    try {
      process.kill(info.pid);                  // SIGTERM → server clears its own lock (POSIX)
      try { fs.unlinkSync(lock); } catch {}     // and we clear it too (Windows has no real signals)
      return console.log(`spectoflow dashboard stopped (pid ${info.pid}, was on http://localhost:${port}).`);
    } catch {}
  }
  console.log(`A dashboard is responding on http://localhost:${port} but isn't stoppable via the lock file — stop it where you launched it (Ctrl+C).`);
}

async function status() {
  const root = process.cwd();
  const cfg = store.readConfig(root);
  const plansDirName = store.resolvePlansDir(root, cfg);
  if (!fs.existsSync(path.join(root, plansDirName)) && !fs.existsSync(path.join(root, '.spectoflow'))) {
    return console.log('No spectoflow project here. Run: spectoflow init');
  }
  const p = store.readProject(root);
  const tasks = p.plans.flatMap((pl) => pl.phases.flatMap((ph) => ph.tasks));
  const done = tasks.filter((t) => t.status === 'done').length;
  console.log(`${(p.config && p.config.projectType) || 'project'} — mode ${p.config.mode} · lang ${p.config.language}`);
  console.log(`${done}/${tasks.length} tasks done · ${p.specs.length} spec(s) · ${p.agents.length} agents · ${p.skills.length} skills`);
  tasks.filter((t) => t.status === 'in_progress').forEach((t) => console.log(`  > in progress: ${t.id} ${t.title}`));
  const port = resolvePort(argv);
  const running = await probeDashboard(port);
  console.log(`dashboard: ${running ? `running → http://localhost:${port}` : 'not running'}`);
}

function version() { console.log(`spectoflow v${VERSION}`); }

const help = () => console.log(`${c.bold('spectoflow')} ${c.amber('v' + VERSION)} — agent-agnostic spec-driven development

${c.dim('Usage:')} spectoflow <command> [options]

${c.bold('Commands:')}
  ${c.g('init')} [dir] [--agent=claude,codex]   scaffold a project (auto-detects installed agents)
  ${c.g('update')} [--dry-run]                  refresh framework files to this kit version
  ${c.g('dashboard')} [--port=NNNN]             run the local control plane (default 4319, or $SPECTOFLOW_PORT)
  ${c.g('dashboard stop')}                      stop the running dashboard (alias: ${c.g('stop')})
  ${c.g('status')}                              print progress + whether the dashboard is running

${c.bold('Options:')}
  -v, --version                       print the version
  -h, --help                          show this help

${c.dim('Docs:')} https://github.com/georgesmomo/spectoflow`);

const fns = { init, update, dashboard, stop: stopDashboard, status, help, version };
if (['-v', '-V', '--version', 'version'].includes(cmd)) version();
else if (['-h', '--help'].includes(cmd)) help();
else if (fns[cmd]) fns[cmd]();
else help();
