#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const store = require('../lib/store');
const adapters = require('../lib/adapters');
const detect = require('../lib/detect');
const ownership = require('../lib/ownership');
const manifest = require('../lib/manifest');
const registry = require('../lib/registry');
const initLib = require('../lib/init');
const mcp = require('../lib/mcp');
const { startRun } = require('../lib/dashboard/runner');
const { buildCustomizePrompt } = require('../lib/customize-prompts');

const KIT = path.resolve(__dirname, '..');
const TPL = path.join(KIT, 'templates');
const VERSION = require('../package.json').version;
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';

// Tiny ANSI colouriser — no dependency; disabled when not a TTY or NO_COLOR is set.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = { g: paint('32'), cy: paint('36'), b: paint('34'), y: paint('33'), dim: paint('2'), bold: paint('1'), amber: paint('38;5;179'), white: paint('97') };

// ---- branding ---------------------------------------------------------------
// Shared ASCII brand (white hexagon + amber wordmark) lives in lib/brand.js so the CLI and the
// postinstall welcome render the exact same art.
const brand = require('../lib/brand');
const logo = () => brand.logo(c, VERSION);        // white hexagon + centered amber wordmark (init/update)
const wordmark = () => brand.wordmark(c, VERSION); // amber wordmark alone (help + explore)
const brandLine = () => `${c.amber('spectoflow')} ${c.dim('v' + VERSION)}`;

// ---- framework introspection (list agents / skills / workflow) --------------
// Read from the project's .spectoflow when present, else the bundled kit — so `list` works anywhere.
function frameworkSource() {
  const local = path.resolve('.spectoflow');
  return fs.existsSync(local) ? { dir: local, scope: 'project' } : { dir: TPL, scope: 'kit' };
}
// Tiny frontmatter reader — a few scalar keys, no YAML dependency.
function frontmatter(file) {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (mm) out[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}
function listAgents(dir) {
  const d = path.join(dir, 'agents');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => {
    const fm = frontmatter(path.join(d, f));
    return { name: fm.name || f.replace(/\.md$/, ''), capability: fm.capability || '', description: fm.description || '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
function listSkills(dir) {
  const d = path.join(dir, 'skills');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
    const fm = frontmatter(path.join(d, e.name, 'SKILL.md'));
    return { name: fm.name || e.name, capability: fm.capability || '', description: fm.description || '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
function readWorkflowSteps(dir) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(dir, 'workflow.md'), 'utf8'); } catch { return []; }
  return txt.split('\n').map((l) => l.match(/^- \[([ xX])\]\s+(.+?)\s*(\{.*\})?\s*$/))
    .filter(Boolean).map((m) => ({ on: m[1].toLowerCase() === 'x', name: m[2] }));
}

// ---- dashboard port + running-state probe ------------------------------------
// Precedence: --port=NNNN > SPECTOFLOW_PORT env > 4319 (matches lib/dashboard/hub-server.js).
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

function init() {
  const target = path.resolve(argv[1] && !argv[1].startsWith('--') ? argv[1] : '.');
  const agentsArg = (argv.find((a) => a.startsWith('--agent=')) || '').split('=')[1];
  const r = initLib.runInit({ target, templatesDir: TPL, version: VERSION, agentsArg });
  console.log(logo());
  console.log(`${c.g('✓')} installed in ${c.bold(r.target)}`);
  console.log(`  ${c.dim('.spectoflow/')}   framework — brain, workflow, agents, skills, policy, dashboard, config`);
  console.log(`  ${c.dim('specs/ plans/')}  markdown artifacts (your source of truth)`);
  r.written.forEach((w) => console.log(`  ${c.cy('+')} ${w}`));
  r.notes.forEach((n) => console.log(`  ${c.y('!')} ${c.dim(n)}`));
  const port = resolvePort(argv);
  console.log(`\n${c.bold('Next')}`);
  console.log(`  ${c.dim('1)')} Open your agent here — or just say what you want to build.`);
  console.log(`  ${c.dim('2)')} ${c.g('spectoflow dashboard')}  ${c.dim('→ http://localhost:' + port)}`);
  console.log(`  ${c.dim('3)')} ${c.g('spectoflow list')}       ${c.dim('see the agents, skills & workflow you got')}`);
  console.log('');
}

async function update() {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, '.spectoflow'))) {
    return console.log('No spectoflow project here. Run: spectoflow init');
  }
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force') || argv.includes('-f');
  const r = require('../lib/update').runUpdate({ projectRoot: root, templatesDir: TPL, version: VERSION, dryRun, force });

  const from = r.fromVersion || 'unknown';
  const changed = r.refreshed.length + r.created.length + r.adopted.length + r.newSidecar.length + r.forced.length;
  const row = (sym, label, list, painter, note) => {
    if (!list.length) return;
    const n = c.dim(String(list.length).padStart(2));
    const detail = note ? c.dim(note) : c.dim(list.slice(0, 6).join(', ') + (list.length > 6 ? ` +${list.length - 6} more` : ''));
    console.log(`  ${sym}  ${painter(label.padEnd(9))} ${n}   ${detail}`);
  };
  console.log(logo());
  console.log(`  ${c.bold('spectoflow update')}   ${c.dim(from)} ${c.amber('→')} ${c.bold(r.toVersion)}${dryRun ? c.dim('   (dry-run)') : ''}${force ? c.y('   (force)') : ''}`);
  console.log('');
  row(c.g('✓'), 'refreshed', r.refreshed, c.g);
  row(c.cy('+'), 'created', r.created, c.cy);
  row(c.b('~'), 'adopted', r.adopted, c.b);
  row(c.y('!'), 'forced', r.forced, c.y, 'overwrote a diverged file — its previous content is gone');
  row(c.y('!'), '.new', r.newSidecar, c.y, 'you edited these — new version saved as *.new, merge by hand (or re-run with --force)');
  if (r.unchanged.length) console.log(`  ${c.dim('·')}  ${c.dim('unchanged'.padEnd(9))} ${c.dim(String(r.unchanged.length).padStart(2))}`);
  console.log(`  ${c.dim('=')}  ${c.dim('preserved'.padEnd(9))}      ${c.dim('config.json · workflow.md · specs/ · plans/ · your custom agents & skills')}`);
  console.log('');
  if (dryRun) console.log(`  ${c.dim('(dry-run — nothing was written)')}`);
  else console.log(`  ${changed ? c.g('✓ Done') : c.dim('Already up to date')}${changed ? c.dim(` · ${changed} file(s) changed`) : ''}`);
  if (r.newSidecar.length && !dryRun) console.log(`  ${c.y('→')} ${c.dim(`${r.newSidecar.length} *.new file(s) to review and merge — or re-run: spectoflow update --force`)}`);
  console.log('');

  // A running hub has the OLD framework code loaded into memory (Node caches `require()`d modules
  // per project on first open) — new bytes on disk change nothing until that project's cached code
  // is invalidated. Do that via a surgical per-project reload so an update always actually takes
  // effect, without restarting the whole hub (which would disturb every other project open in it).
  if (!dryRun && changed) {
    const lockPath = registry.hubLockPath();
    let info = null;
    try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
    if (info && info.port && (await probeDashboard(info.port, 2000))) {
      const entry = registry.findByPath(root);
      if (entry) {
        try {
          const res = await fetch(`http://localhost:${info.port}/api/hub/reload/${entry.id}`, { method: 'POST' });
          const body = await res.json().catch(() => ({}));
          console.log(`  ${c.dim(body.reloaded
            ? 'Hub is running — reloaded this project\'s server code (other open projects unaffected).'
            : 'Hub is running, but this project wasn\'t loaded in it yet — nothing to reload.')}`);
        } catch {
          console.log(`  ${c.y('!')} Hub is running on port ${info.port} but the reload request failed — restart it yourself if changes don't seem to take effect: ${c.g('spectoflow dashboard restart')}`);
        }
      }
    }
  }
}

// THE launch command — routes the subcommands, then starts. Starting spawns the server DETACHED and
// hands the prompt straight back (no foreground blocking), then prints the commands to drive it.
async function dashboard() {
  const sub = argv[1];
  if (sub === 'stop') return stopDashboard();
  if (sub === 'status') return dashboardStatus();
  if (sub === 'restart') return restartDashboard();
  if (sub === 'create') return runCustomize('dashboard');
  return startDashboard();
}

// ---- projects: the multi-project registry's CLI surface (~/.spectoflow/projects.json) ----
function projectsCmd() {
  const sub = argv[1];
  if (sub === 'remove') return projectsRemove(argv[2]);
  return projectsList();
}
function projectsList() {
  console.log(wordmark());
  const rows = registry.listProjects();
  if (!rows.length) {
    console.log(c.dim('  no projects registered yet — run `spectoflow dashboard` inside one'));
    return;
  }
  const w = Math.max(4, ...rows.map((r) => r.name.length));
  rows.forEach((r) => console.log(`  ${c.g(r.id)}  ${r.name.padEnd(w)}  ${c.dim(r.path)}`));
}
function projectsRemove(id) {
  if (!id) { console.log('Usage: spectoflow projects remove <id>'); return; }
  const ok = registry.removeProject(id);
  console.log(ok ? `${c.g('✓')} removed ${id}` : `${c.y('!')} no project registered with id ${id}`);
}

// ---- Customize: `spectoflow skill/agent/dashboard create` — the CLI mirror of the dashboard's
// Settings → Customize UI. Both surfaces build the same natural-language prompt (customize-prompts.js)
// and post it through the same pipeline (runner.js's startRun — the function /api/run itself calls),
// so a generation triggered from the terminal behaves identically to one triggered from a click.
function requireProjectRoot() {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, '.spectoflow'))) {
    console.log('No spectoflow project here. Run: spectoflow init');
    return null;
  }
  return root;
}
// "create <description words…> [--auto] [--agent=name]" → { description, auto, agentOverride }.
// Words are re-joined with spaces so an unquoted multi-word description works the same as a quoted one.
function parseCreateArgs(args) {
  return {
    auto: args.includes('--auto'),
    agentOverride: (args.find((a) => a.startsWith('--agent=')) || '').split('=')[1] || undefined,
    description: args.filter((a) => !a.startsWith('--')).join(' ').trim(),
  };
}
function printCreateUsage(kind) {
  console.log(`Usage: spectoflow ${kind} create "<description>" ${c.dim('[--agent=name]')}`);
  console.log(`   or: spectoflow ${kind} create --auto ${c.dim('[--agent=name]')}`);
}
// Streams the same events the dashboard's SSE feed would show: raw output lines as-is, and
// structured ::spectoflow sentinel messages as "[role] text" (skip the echoed user prompt — printed
// separately, up front, so it isn't shown twice).
function cliEmit(evt) {
  if (evt.type === 'run-line') process.stdout.write(evt.chunk);
  else if (evt.type === 'message' && evt.message && evt.message.role !== 'user') {
    console.log(`${c.cy('[' + evt.message.role + ']')} ${evt.message.text}`);
  }
}
async function runCustomize(kind) {
  const root = requireProjectRoot();
  if (!root) return;
  if (argv[1] !== 'create') return printCreateUsage(kind);
  const { auto, agentOverride, description } = parseCreateArgs(argv.slice(2));
  let prompt;
  try { prompt = buildCustomizePrompt(kind, { auto, description }); }
  catch (e) { console.log(c.y(e.message)); console.log(''); return printCreateUsage(kind); }
  console.log(c.dim(`→ ${prompt}`));
  const code = await new Promise((resolve) => {
    const r = startRun(root, { prompt, agent: agentOverride }, cliEmit);
    if (r.error) { console.log(c.y(r.error)); return resolve(1); }
    if (!r.child) return resolve(1); // spawn failed — cliEmit already printed the error
    r.child.on('close', (exitCode) => resolve(exitCode == null ? 1 : exitCode));
  });
  process.exitCode = code;
}

// Start in the background and return control. Registers (or touches) the current folder in the
// global registry first, then either joins an already-running hub or spawns a new one — probing first
// so a second start just reports the running one instead of spawning a duplicate.
async function startDashboard() {
  const root = process.cwd();
  const entry = registry.addProject(root);
  const boardUrl = (p) => `http://localhost:${p}/p/${entry.id}/board`;
  const lockPath = registry.hubLockPath();
  let info = null;
  try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  if (info && info.port && await probeDashboard(info.port)) {
    console.log(`${c.g('●')} hub already running → ${c.bold(boardUrl(info.port))}`);
    return printDashboardCommands();
  }
  const port = resolvePort(argv);
  const hubPath = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');
  const env = Object.assign({}, process.env, { SPECTOFLOW_PORT: String(port) });
  const child = spawn('node', [hubPath], { detached: true, stdio: 'ignore', env });
  child.unref();                                   // let this CLI exit while the hub keeps running
  // Confirm it actually came up (a still-releasing port from a just-stopped instance, or any other
  // startup error, would otherwise print a false "started" while the detached process silently died).
  let up = false;
  for (let i = 0; i < 20 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await probeDashboard(port, 300); }
  if (up) console.log(`${c.g('✓')} hub started → ${c.bold(boardUrl(port))}  ${c.dim('(pid ' + child.pid + ')')}`);
  else console.log(`${c.y('!')} spawned (pid ${child.pid}) but it isn't responding on http://localhost:${port} yet — check ${c.g('spectoflow dashboard status')} in a moment, or its own output if something's wrong.`);
  printDashboardCommands();
}

function printDashboardCommands() {
  console.log('');
  console.log(`  ${c.dim('status ')}  ${c.g('spectoflow dashboard status')}   ${c.dim('is it up? (url + pid)')}`);
  console.log(`  ${c.dim('stop   ')}  ${c.g('spectoflow dashboard stop')}     ${c.dim('(alias: spectoflow stop)')}`);
  console.log(`  ${c.dim('restart')}  ${c.g('spectoflow dashboard restart')}  ${c.dim('stop then start')}`);
  console.log('');
}

async function dashboardStatus() {
  const lockPath = registry.hubLockPath();
  let info = null;
  try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  const port = (info && info.port) || resolvePort(argv);
  const running = await probeDashboard(port);
  if (running) console.log(`${c.g('●')} hub running → ${c.bold('http://localhost:' + port)}${info && info.pid ? c.dim(' (pid ' + info.pid + ')') : ''}`);
  else console.log(`${c.dim('○')} hub not running`);
}

async function restartDashboard() {
  await stopDashboard();
  // Windows doesn't deliver real signals — process.kill() returns once the request is issued, not
  // once the process (and the port it held) is actually gone. A short gap here, plus startDashboard()
  // now confirming the new one actually came up, keeps a restart honest under load instead of racing
  // a rebind against a socket the OS hasn't finished releasing yet.
  await new Promise((r) => setTimeout(r, 1000));
  return startDashboard();
}

// Stop the running hub: read the global lock it wrote, verify it's actually up, then terminate it
// and clear the lock. Safe against a stale lock (a recycled pid) because it only kills when the port
// still responds.
async function stopDashboard() {
  const lockPath = registry.hubLockPath();
  let info = null;
  try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  const port = (info && info.port) || resolvePort(argv);
  const running = await probeDashboard(port);
  if (!running) {
    if (info) { try { fs.unlinkSync(lockPath); } catch {} }   // stale lock
    return console.log('No spectoflow hub is running.');
  }
  if (info && info.pid) {
    try {
      process.kill(info.pid);                  // SIGTERM → hub clears its own lock (POSIX)
      try { fs.unlinkSync(lockPath); } catch {}     // and we clear it too (Windows has no real signals)
      return console.log(`spectoflow hub stopped (pid ${info.pid}, was on http://localhost:${port}).`);
    } catch {}
  }
  console.log(`A hub is responding on http://localhost:${port} but isn't stoppable via the lock file — stop it where you launched it (Ctrl+C).`);
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
  const lockPath = registry.hubLockPath();
  let info = null;
  try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  const port = (info && info.port) || resolvePort(argv);
  const running = await probeDashboard(port);
  console.log(`dashboard: ${running ? `running → http://localhost:${port}` : 'not running'}`);
}

function version() { console.log(`spectoflow v${VERSION}`); }

// ---- explore commands -------------------------------------------------------
function printAgents(withBrand = true) {
  const { dir, scope } = frameworkSource();
  const rows = listAgents(dir);
  if (withBrand) console.log(`${brandLine()} ${c.dim('· agents (' + scope + ')')}`);
  const w = Math.max(4, ...rows.map((r) => r.name.length));
  rows.forEach((r) => console.log(`  ${c.g(r.name.padEnd(w))}  ${c.dim((r.capability || '').padEnd(14))} ${r.description}`));
  if (!rows.length) console.log(c.dim('  (none found)'));
}
function printSkills(withBrand = true) {
  const { dir, scope } = frameworkSource();
  const rows = listSkills(dir);
  if (withBrand) console.log(`${brandLine()} ${c.dim('· skills (' + scope + ')')}`);
  const w = Math.max(4, ...rows.map((r) => r.name.length));
  rows.forEach((r) => console.log(`  ${c.cy(r.name.padEnd(w))}  ${c.dim((r.capability || '').padEnd(14))} ${r.description}`));
  if (!rows.length) console.log(c.dim('  (none found)'));
}
function printWorkflow(withBrand = true) {
  const { dir, scope } = frameworkSource();
  const steps = readWorkflowSteps(dir);
  if (withBrand) console.log(`${brandLine()} ${c.dim('· workflow (' + scope + ')')}`);
  steps.forEach((s) => console.log(`  ${s.on ? c.g('●') : c.dim('○')} ${s.on ? s.name : c.dim(s.name + '  (disabled)')}`));
  if (!steps.length) console.log(c.dim('  (no workflow.md)'));
}
function listAll() {
  const { scope } = frameworkSource();
  console.log(wordmark());
  console.log(`${c.bold('Agents')} ${c.dim('— stable team personas (' + scope + ')')}`);
  printAgents(false);
  console.log(`\n${c.bold('Skills')} ${c.dim('— evolving procedures')}`);
  printSkills(false);
  console.log(`\n${c.bold('Workflow')} ${c.dim('— enabled pipeline steps')}`);
  printWorkflow(false);
  console.log('');
}

// ---- help (global + per-command) --------------------------------------------
const help = () => console.log(`${wordmark()}
${c.dim('Usage:')} spectoflow ${c.g('<command>')} ${c.dim('[options]')}   ${c.dim('· append -h to any command for its help')}

${c.bold('Project')}
  ${c.g('init')} ${c.dim('[dir] [--agent=a,b]')}    scaffold a project (auto-detects agents; wires Playwright MCP)
  ${c.g('update')} ${c.dim('[--dry-run|--force]')}  refresh framework files to this kit version
  ${c.g('status')}                      progress + whether the dashboard is running

${c.bold('Dashboard')}
  ${c.g('dashboard')} ${c.dim('[--port=NNNN]')}     start the control plane in the background (default 4319)
  ${c.g('dashboard status')}             is it running? (url + pid)
  ${c.g('dashboard stop')}               stop it ${c.dim('(alias: stop)')}
  ${c.g('dashboard restart')}            stop then start
  ${c.g('projects')} ${c.dim('[remove <id>]')}     list every project seen so far (~/.spectoflow/projects.json)

${c.bold('Customize')} ${c.dim('— same as Settings → Customize, from the terminal')}
  ${c.g('skill create')} ${c.dim('"<description>" | --auto')}      generate a project skill
  ${c.g('agent create')} ${c.dim('"<description>" | --auto')}      generate a project agent
  ${c.g('dashboard create')} ${c.dim('"<description>" | --auto')}  generate a custom dashboard

${c.bold('Explore')}
  ${c.g('list')}                        agents, skills and the workflow at a glance
  ${c.g('agents')}                      list the team personas
  ${c.g('skills')}                      list the procedures
  ${c.g('workflow')}                    show the enabled pipeline steps

${c.bold('Options')}
  ${c.g('-v')}, ${c.g('--version')}                print the version
  ${c.g('-h')}, ${c.g('--help')}                   show this help

${c.dim('Docs:')} https://github.com/georgesmomo/spectoflow`);

// Per-command help — shown when -h/--help follows a command (e.g. `spectoflow dashboard -h`).
const HELP = {
  init: `${c.bold('spectoflow init')} ${c.dim('[dir] [--agent=a,b]')}\n
  Scaffold spectoflow into <dir> (default: current directory).
  Auto-detects installed agents (${c.dim('claude, codex, cursor, gemini, opencode, kiro, antigravity,')}
  ${c.dim('copilot, amazon-q, droid, auggie, goose, kimi')}) and writes their entry shims; override
  with ${c.g('--agent=claude,codex')}. Also wires ${c.bold('Playwright MCP')} into the project's
  ${c.dim('.mcp.json')} (idempotent — never touches an existing entry).
  ${c.dim('An existing CLAUDE.md is preserved as CLAUDE.md.tomerge for you to merge on first run.')}
  ${c.dim('Full list with docs links: the dashboard\'s Documentation tab, or the README.')}`,
  update: `${c.bold('spectoflow update')} ${c.dim('[--dry-run] [--force|-f]')}\n
  Refresh framework-owned files (engine, dashboard, default agents & skills, AGENTS.md, policy…)
  to this CLI's version, ${c.bold('preserving your work')}: config.json, workflow.md, specs/, plans/
  and any agent/skill you edited are never overwritten (an edited file's new version lands as
  ${c.dim('*.new')} for you to merge). ${c.g('--dry-run')} previews without writing.
  ${c.g('--force')} (${c.g('-f')}) overwrites a diverged file in place instead of dropping a ${c.dim('*.new')}
  — use it when you know you have no local edits worth keeping (e.g. a file stuck diverged from an
  earlier update). It never touches config.json, workflow.md, specs/ or plans/.`,
  dashboard: `${c.bold('spectoflow dashboard')} ${c.dim('[--port=NNNN] [status|stop|restart|create]')}\n
  Start the local control plane in the ${c.bold('background')} (default ${c.dim('4319')} or
  ${c.dim('$SPECTOFLOW_PORT')}) and hand the prompt back. Subcommands:
    ${c.g('status')}    is it running? (url + pid)
    ${c.g('stop')}      stop it            ${c.dim('(alias: spectoflow stop)')}
    ${c.g('restart')}   stop then start
    ${c.g('create')}    generate a custom dashboard, e.g. ${c.dim('spectoflow dashboard create "..." --auto')}`,
  projects: `${c.bold('spectoflow projects')} ${c.dim('[remove <id>]')}\n
  List every registered project in the global registry at ${c.dim('~/.spectoflow/projects.json')} (stored by
  ${c.g('spectoflow dashboard')}) — id, name, path. ${c.g('remove <id>')} drops one (e.g. a project that moved
  or was deleted) from this list only; it never touches that project's own files.`,
  skill: `${c.bold('spectoflow skill create')} ${c.dim('"<description>" [--agent=name]')}\n${c.bold('spectoflow skill create')} ${c.dim('--auto [--agent=name]')}\n
  Generate a project-specific skill — the CLI mirror of Settings → Customize → ${c.bold('Skills')} →
  ${c.bold('Add skill')} in the dashboard. Describe what it should do, or pass ${c.g('--auto')} to have
  the agent survey the project and propose candidates instead. Runs the configured agent headless
  (${c.dim('config.json → agent')}, or override with ${c.g('--agent=')}), streaming its output live;
  it clarifies first if the ask is ambiguous, and marks what it writes ${c.dim('origin: user-generated')}.`,
  agent: `${c.bold('spectoflow agent create')} ${c.dim('"<description>" [--agent=name]')}\n${c.bold('spectoflow agent create')} ${c.dim('--auto [--agent=name]')}\n
  Generate a project-specific agent — the CLI mirror of Settings → Customize → ${c.bold('Agents')} →
  ${c.bold('Add agent')}. Same behaviour as ${c.g('spectoflow skill create')}, for an agent persona instead.`,
  status: `${c.bold('spectoflow status')}\n
  Print project progress from ${c.dim('plans/*.md')} (tasks done, specs, agents, skills, in-progress
  items) and whether the dashboard is currently running.`,
  list: `${c.bold('spectoflow list')}\n
  Show the ${c.g('agents')}, ${c.cy('skills')} and ${c.bold('workflow')} of the current project
  (or the bundled kit when run outside a project) at a glance.`,
  agents: `${c.bold('spectoflow agents')}\n  List the stable team personas (name · capability · role).`,
  skills: `${c.bold('spectoflow skills')}\n  List the evolving procedures (name · capability · what it does).`,
  workflow: `${c.bold('spectoflow workflow')}\n  Show the pipeline steps, marking which are enabled (●) or disabled (○).`,
  stop: `${c.bold('spectoflow stop')}\n  Stop the running dashboard (alias for ${c.g('spectoflow dashboard stop')}).`,
};
const showHelp = (name) => console.log('\n' + HELP[name].trim() + '\n');

// ---- dispatch ---------------------------------------------------------------
const fns = {
  init, update, dashboard, stop: stopDashboard, status, list: listAll, help, version,
  projects: projectsCmd,
  agents: () => { console.log(wordmark()); printAgents(false); },
  skills: () => { console.log(wordmark()); printSkills(false); },
  workflow: () => { console.log(wordmark()); printWorkflow(false); },
  skill: () => runCustomize('skill'),
  agent: () => runCustomize('agent'),
};
const wantsHelp = argv.slice(1).some((a) => a === '-h' || a === '--help');

if (['-v', '-V', '--version', 'version'].includes(cmd)) version();
else if (['-h', '--help', 'help'].includes(cmd)) help();
else if (fns[cmd] && wantsHelp && HELP[cmd]) showHelp(cmd);
else if (fns[cmd]) fns[cmd]();
else help();
