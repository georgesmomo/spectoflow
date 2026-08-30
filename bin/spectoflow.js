#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('../templates/lib/store');
const adapters = require('../lib/adapters');

const KIT = path.resolve(__dirname, '..');
const TPL = path.join(KIT, 'templates');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';

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
function normalizePlans(root) {
  const dir = path.join(root, 'plans');
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
  const agents = agentsArg ? agentsArg.split(',') : ['claude', 'codex'];
  fs.mkdirSync(target, { recursive: true });
  const notes = [];

  // preserve an existing CLAUDE.md
  const claude = path.join(target, 'CLAUDE.md');
  if (fs.existsSync(claude) && !fs.existsSync(claude + '.tomerge')) {
    fs.renameSync(claude, claude + '.tomerge');
    notes.push('Existing CLAUDE.md preserved as CLAUDE.md.tomerge — your agent merges it on first run.');
  }

  // canonical framework → .spectoflow/
  copyDir(TPL, path.join(target, '.spectoflow'));

  // artifact folders
  fs.mkdirSync(path.join(target, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(target, 'plans'), { recursive: true });

  // existing project: id-normalize any plans already there
  const added = normalizePlans(target);
  if (added) notes.push(`Normalized ${added} existing task(s) with stable ids.`);

  // per-agent shims
  const written = adapters.generate(target, agents);

  // gitignore the volatile runtime
  const gi = path.join(target, '.gitignore');
  const line = '.spectoflow/runtime.json';
  if (!fs.existsSync(gi) || !fs.readFileSync(gi, 'utf8').includes(line)) {
    fs.appendFileSync(gi, (fs.existsSync(gi) ? '\n' : '') + line + '\n');
  }

  console.log('spectoflow installed in', target);
  console.log('  .spectoflow/   framework (brain, workflow, agents, skills, policy, dashboard, config)');
  console.log('  specs/ plans/  markdown artifacts (your source of truth)');
  written.forEach((w) => console.log('  + ' + w));
  notes.forEach((n) => console.log('  ! ' + n));
  console.log('\nNext:');
  console.log('  1) Open your agent here (Claude Code loads CLAUDE.md; Codex loads AGENTS.md).');
  console.log('  2) Run /spectoflow init — or just say what you want to build.');
  console.log('  3) Watch: node .spectoflow/dashboard/server.js → http://localhost:4319');
}

function dashboard() {
  const local = path.resolve('.spectoflow', 'dashboard', 'server.js');
  const bundled = path.join(TPL, 'dashboard', 'server.js');
  spawn('node', [fs.existsSync(local) ? local : bundled], { stdio: 'inherit' });
}

function status() {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'plans')) && !fs.existsSync(path.join(root, '.spectoflow'))) {
    return console.log('No spectoflow project here. Run: spectoflow init');
  }
  const p = store.readProject(root);
  const tasks = p.plans.flatMap((pl) => pl.phases.flatMap((ph) => ph.tasks));
  const done = tasks.filter((t) => t.status === 'done').length;
  console.log(`${(p.config && p.config.projectType) || 'project'} — mode ${p.config.mode} · lang ${p.config.language}`);
  console.log(`${done}/${tasks.length} tasks done · ${p.specs.length} spec(s) · ${p.agents.length} agents · ${p.skills.length} skills`);
  tasks.filter((t) => t.status === 'in_progress').forEach((t) => console.log(`  > in progress: ${t.id} ${t.title}`));
}

const help = () => console.log(`spectoflow — commands:
  init [dir] [--agent=claude,codex]   install into a project
  dashboard                           run the local control plane
  status                              print progress`);

({ init, dashboard, status, help })[cmd] ? ({ init, dashboard, status, help })[cmd]() : help();
