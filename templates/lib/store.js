'use strict';
/*
 * spectoflow storage engine (zero dependency).
 *
 * Artifacts are MARKDOWN (human source of truth, versioned):
 *   plans/<name>.md   — tasks as checkbox lines:
 *       ## Phase title
 *       - [ ] T-012 Add login form @dev ~standard %in_progress
 *         - note: some comment            (indented sub-bullets = comments)
 *   specs/<name>.md   — free-form spec markdown (listed, not parsed into tasks)
 *
 * Volatile execution state is JSON (gitignored, never read by humans):
 *   .spectoflow/runtime.json  — running agents, heartbeats, test results
 *
 * Writes are GRANULAR: we locate a task's line by id and rewrite only that line (or insert a
 * sub-bullet), leaving the rest of the file byte-for-byte intact.
 */
const fs = require('fs');
const path = require('path');

// ---- task line parsing -------------------------------------------------------
// - [ ] T-012 Title here @owner ~level %status
const LINE_RE = /^(\s*)- \[( |x|X)\]\s+(\S+)\s*(.*)$/;

function parseTaskLine(line) {
  const m = line.match(LINE_RE);
  if (!m) return null;
  const [, indent, check, id, rest0] = m;
  let rest = rest0;
  const owner = (rest.match(/(?:^|\s)@([\w-]+)/) || [])[1] || null;
  const level = (rest.match(/(?:^|\s)~([\w-]+)/) || [])[1] || null;
  const statusTag = (rest.match(/(?:^|\s)%([\w-]+)/) || [])[1] || null;
  const title = rest.replace(/(?:^|\s)[@~%][\w-]+/g, '').replace(/\s+/g, ' ').trim();
  const done = check.toLowerCase() === 'x';
  const status = done ? 'done' : (statusTag || 'todo');
  return { indent, id, title, owner, level: level || 'standard', status, done };
}

function buildTaskLine(t) {
  const parts = [`${t.indent || ''}- [${t.status === 'done' ? 'x' : ' '}] ${t.id} ${t.title}`];
  if (t.owner) parts.push(`@${t.owner}`);
  if (t.level && t.level !== 'standard') parts.push(`~${t.level}`);
  if (t.status !== 'done' && t.status !== 'todo') parts.push(`%${t.status}`);
  return parts.join(' ');
}

// ---- plan file model ---------------------------------------------------------
function parsePlan(text) {
  const lines = text.split('\n');
  const phases = [];
  let cur = { id: 'P0', title: 'Tasks', goal: '', tasks: [] };
  let lastTask = null;
  const pushPhase = () => { if (cur.tasks.length || cur.title !== 'Tasks') phases.push(cur); };
  lines.forEach((line) => {
    const h = line.match(/^##\s+(.*)$/);
    if (h) { pushPhase(); cur = { id: 'P' + phases.length, title: h[1].trim(), goal: '', tasks: [] }; lastTask = null; return; }
    const t = parseTaskLine(line);
    if (t) { t.comments = []; cur.tasks.push(t); lastTask = t; return; }
    const c = line.match(/^\s+- (?:note:|comment:)?\s*(.*)$/);
    if (c && lastTask && c[1].trim()) lastTask.comments.push(c[1].trim());
  });
  pushPhase();
  return phases;
}

function readPlans(projectRoot) {
  const dir = path.join(projectRoot, 'plans');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    out.push({ file: f, phases: parsePlan(text) });
  }
  return out;
}

// ---- granular writes ---------------------------------------------------------
// Rewrite only the line whose task id matches, preserving everything else.
function updateTaskLine(projectRoot, file, id, patch) {
  const fp = path.join(projectRoot, 'plans', file);
  const lines = fs.readFileSync(fp, 'utf8').split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const t = parseTaskLine(lines[i]);
    if (t && t.id === id) {
      const next = Object.assign(t, patch);
      lines[i] = buildTaskLine(next);
      changed = true;
      break;
    }
  }
  if (changed) writeAtomic(fp, lines.join('\n'));
  return changed;
}

function addTaskComment(projectRoot, file, id, text, author) {
  const fp = path.join(projectRoot, 'plans', file);
  const lines = fs.readFileSync(fp, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = parseTaskLine(lines[i]);
    if (t && t.id === id) {
      const indent = (t.indent || '') + '  ';
      const who = author ? `@${author}: ` : '';
      // insert after any existing comment sub-bullets
      let j = i + 1;
      while (j < lines.length && /^\s+- /.test(lines[j])) j++;
      lines.splice(j, 0, `${indent}- note: ${who}${text}`);
      writeAtomic(fp, lines.join('\n'));
      return true;
    }
  }
  return false;
}

function writeAtomic(fp, content) {
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, fp);
}

// ---- runtime sidecar (volatile) ---------------------------------------------
function runtimePath(projectRoot) { return path.join(projectRoot, '.spectoflow', 'runtime.json'); }
function readRuntime(projectRoot) {
  try { return JSON.parse(fs.readFileSync(runtimePath(projectRoot), 'utf8')); }
  catch { return { agents: [], tests: {}, messages: [], updatedAt: null }; }
}
function writeRuntime(projectRoot, rt) {
  rt.updatedAt = new Date().toISOString();
  writeAtomic(runtimePath(projectRoot), JSON.stringify(rt, null, 2) + '\n');
  return rt;
}

// ---- group-chat message log (volatile) --------------------------------------
// A running agent identifies itself by printing sentinel lines on stdout:
//   ::spectoflow role=developer kind=status msg=finished T-023
// Everything after `msg=` is free text to end of line. Non-sentinel lines return null.
function parseAgentLine(line) {
  const s = String(line);
  if (!/^\s*::spectoflow\b/.test(s)) return null;
  return {
    role: (s.match(/\brole=(\S+)/) || [])[1] || 'agent',
    kind: (s.match(/\bkind=(\S+)/) || [])[1] || 'message',
    text: ((s.match(/\bmsg=([\s\S]*)$/) || [])[1] || '').trim(),
  };
}

// Append one message to runtime.messages (id + at stamped here; caller can't override them).
function appendMessage(projectRoot, msg) {
  const rt = readRuntime(projectRoot);
  rt.messages = rt.messages || [];
  const full = { kind: 'message', ...msg,
    id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString() };
  rt.messages.push(full);
  writeRuntime(projectRoot, rt);
  return full;
}

// ---- config & workflow -------------------------------------------------------
function readConfig(projectRoot) {
  try { return JSON.parse(fs.readFileSync(path.join(projectRoot, '.spectoflow', 'config.json'), 'utf8')); }
  catch { return { mode: 'semi', language: 'en', agent: 'claude' }; }
}
function readWorkflow(projectRoot) {
  // workflow.md: each "- [x]/[ ] Step name" line = a step (checked = enabled)
  try {
    const text = fs.readFileSync(path.join(projectRoot, '.spectoflow', 'workflow.md'), 'utf8');
    const steps = [];
    text.split('\n').forEach((l) => {
      const m = l.match(/^\s*- \[( |x|X)\]\s+(.*?)\s*$/);
      if (m) steps.push({ name: m[2].replace(/\s*\(optional\)\s*$/i, '').trim(),
        enabled: m[1].toLowerCase() === 'x', optional: /\(optional\)/i.test(m[2]) });
    });
    return steps;
  } catch { return []; }
}

// ---- unified read for the dashboard -----------------------------------------
function readProject(projectRoot) {
  const config = readConfig(projectRoot);
  const plans = readPlans(projectRoot);
  const runtime = readRuntime(projectRoot);
  const workflow = readWorkflow(projectRoot);
  const specs = (() => {
    const d = path.join(projectRoot, 'specs');
    return fs.existsSync(d) ? fs.readdirSync(d).filter((x) => x.endsWith('.md')) : [];
  })();
  const agents = listMd(path.join(projectRoot, '.spectoflow', 'agents'));
  const skills = listSkills(path.join(projectRoot, '.spectoflow', 'skills'));
  return { config, plans, specs, workflow, agents, skills, runtime };
}
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (m) m[1].split('\n').forEach((l) => { const kv = l.match(/^([\w-]+):\s*(.*)$/); if (kv) out[kv[1]] = kv[2].trim(); });
  return out;
}
function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const fm = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { file: f, name: fm.name || f.replace(/\.md$/, ''), title: fm.title || fm.name || f, capability: fm.capability || '', description: fm.description || '' };
  });
}
function listSkills(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
    const sk = path.join(dir, e.name, 'SKILL.md');
    const fm = fs.existsSync(sk) ? frontmatter(fs.readFileSync(sk, 'utf8')) : {};
    return { name: fm.name || e.name, description: fm.description || '' };
  });
}

module.exports = {
  parseTaskLine, buildTaskLine, parsePlan, readPlans, updateTaskLine, addTaskComment,
  readRuntime, writeRuntime, parseAgentLine, appendMessage, readConfig, readWorkflow, readProject,
};
