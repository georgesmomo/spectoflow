'use strict';
/*
 * Claude Code "Stop" hook (OPT-IN) — the spec-source-guardian's watchdog.
 *
 * At the end of an agent turn it runs the deterministic spec-drift check on the git working tree and
 * appends any source-of-truth signals to the dashboard's Attention tab. Advisory only: it NEVER edits
 * code or specs and NEVER fails the agent (always exits 0).
 *
 * Enable it by adding this to your project's .claude/settings.json (spectoflow does NOT wire it
 * automatically, to avoid clobbering your settings):
 *
 *   {
 *     "hooks": {
 *       "Stop": [
 *         { "hooks": [ { "type": "command", "command": "node .spectoflow/hooks/spec-drift.js" } ] }
 *       ]
 *     }
 *   }
 *
 * Deduped against still-open Attention items, so it never spams.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { classifyChange, coverageSignals } = require('../lib/spec-drift');

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => { try { run(); } catch { /* never fail the agent */ } process.exit(0); });

function run() {
  const root = process.cwd();
  let changed = [];
  try {
    changed = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8' })
      .split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  } catch {}
  const ls = (d) => { try { return fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.md')); } catch { return []; } };
  const signals = [...classifyChange(changed), ...coverageSignals({ specs: ls('specs'), plans: ls('plans') })];
  if (!signals.length) return;

  const rp = path.join(root, '.spectoflow', 'runtime.json');
  let rt = {};
  try { rt = JSON.parse(fs.readFileSync(rp, 'utf8')); } catch {}
  rt.attention = rt.attention || [];
  const open = new Set(rt.attention.filter((a) => a.status !== 'resolved').map((a) => a.text));
  let added = false;
  for (const s of signals) {
    const text = 'Source-of-truth: ' + s.msg;
    if (open.has(text)) continue;
    rt.attention.unshift({
      id: 'att' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36),
      at: new Date().toISOString(), by: 'spec-source-guardian', source: 'agent', status: 'open', text,
    });
    added = true;
  }
  if (added) { try { fs.writeFileSync(rp, JSON.stringify(rt, null, 2) + '\n'); } catch {} }
}
