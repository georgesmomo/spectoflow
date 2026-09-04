'use strict';
/*
 * Agent run pipeline — spawns the configured agent headless and turns its output into the
 * group-chat message log. The user prompt is logged as a message; the agent identifies itself by
 * printing sentinel lines (::spectoflow role=… kind=… msg=…) which become structured messages;
 * any other output streams raw as run-line events. `emit` publishes SSE events to the dashboard.
 *
 * Kept separate from server.js so the pipeline is unit-testable without an HTTP server.
 */
const { spawn } = require('child_process');
const store = require('../lib/store');
const agentsRegistry = require('../lib/agents-registry');

// The command to run `which`: config.json's own runners map first (an explicit user choice always
// wins), falling back to the registry's default for a known, headless-capable, genuinely-installed
// agent — so picking one from a per-message agent list works the first time, before it's ever been
// the project's "active agent" and had a runner seeded into config.json for it.
function resolveRunnerCommand(root, cfg, which, opts) {
  if (cfg.runners && cfg.runners[which]) return cfg.runners[which];
  const known = agentsRegistry.KNOWN_AGENTS.find((a) => a.id === which);
  if (known && known.runner && agentsRegistry.isAgentInstalled(which, root, opts)) return known.runner;
  return null;
}

function runStart(root, run) {
  const rt = store.readRuntime(root); rt.agents = rt.agents || []; rt.agents.push(run); store.writeRuntime(root, rt);
}
function runEnd(root, id, code) {
  const rt = store.readRuntime(root); const a = (rt.agents || []).find((x) => x.id === id);
  if (a) { a.status = code === 0 ? 'done' : 'failed'; a.endedAt = new Date().toISOString(); }
  store.writeRuntime(root, rt);
}
// Buffer a stream into whole lines; flush() emits any trailing partial line at close.
function makeFeeder(onLine) {
  let buf = '';
  return {
    feed(chunk) { buf += chunk.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } },
    flush() { if (buf) { onLine(buf); buf = ''; } },
  };
}

// Detect an attention sentinel: `::spectoflow attention msg=<text>` (kind=… optional).
// Agents raise points that deserve the user's eye; they surface in the Attention tab.
function parseAttentionLine(line) {
  const m = /^::spectoflow\s+attention\b(.*)$/.exec(String(line).trim());
  if (!m) return null;
  const rest = m[1];
  const msg = (/\bmsg=([\s\S]+)$/.exec(rest) || [])[1];
  if (!msg || !msg.trim()) return null;
  return msg.trim();
}
function pushAttention(root, text, by) {
  const rt = store.readRuntime(root); rt.attention = rt.attention || [];
  const item = { id: 'att' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36), at: new Date().toISOString(), by: by || 'agent', source: 'agent', status: 'open', text };
  rt.attention.unshift(item); store.writeRuntime(root, rt);
  return item;
}

// Start an agent run. Returns { runId, child } or { error } if no runner is configured.
// logPrompt:false suppresses echoing the prompt as a user bubble — used by the orchestrator,
// whose priming prompt ("You are the …") is machinery the user shouldn't have to read.
function startRun(root, { prompt, agent, logPrompt = true }, emit) {
  const cfg = store.readConfig(root);
  const which = agent || cfg.agent || 'claude';
  const cmdStr = resolveRunnerCommand(root, cfg, which);
  if (!cmdStr) return { error: `No runner configured for "${which}".` };
  const parts = cmdStr.split(/\s+/).filter(Boolean);
  const runId = 'r' + Date.now().toString(36);
  const p = String(prompt).trim();

  if (logPrompt) {
    const um = store.appendMessage(root, { role: 'user', kind: 'message', text: p, agent: which, runId });
    emit({ type: 'message', message: um });
  }

  const run = { id: runId, tool: which, prompt: p, status: 'running', startedAt: new Date().toISOString() };
  runStart(root, run); emit({ type: 'run-start', run }); emit({ type: 'change' });

  let child;
  try { child = spawn(parts[0], [...parts.slice(1), p], { cwd: root, env: process.env }); }
  catch (e) {
    runEnd(root, runId, 1);
    emit({ type: 'run-line', runId, chunk: 'spawn error: ' + e.message + '\n' });
    emit({ type: 'run-end', runId, code: 1 }); emit({ type: 'change' });
    return { runId };
  }
  // End the child's stdin immediately: a child that reads stdin (or a Windows pipe that
  // otherwise keeps 'close' from firing) can't stall the run waiting on input that never comes.
  try { child.stdin && child.stdin.end(); } catch {}

  const onLine = (line) => {
    const att = parseAttentionLine(line);
    if (att) { pushAttention(root, att, which); emit({ type: 'change' }); return; }
    const m = store.parseAgentLine(line);
    if (m) { const full = store.appendMessage(root, { ...m, agent: which, runId }); emit({ type: 'message', message: full }); }
    else emit({ type: 'run-line', runId, chunk: line + '\n' });
  };
  const out = makeFeeder(onLine), err = makeFeeder(onLine);
  child.stdout && child.stdout.on('data', (d) => out.feed(d));
  child.stderr && child.stderr.on('data', (d) => err.feed(d));
  child.on('error', (e) => emit({ type: 'run-line', runId, chunk: 'error: ' + e.message + '\n' }));
  child.on('close', (code) => {
    out.flush(); err.flush();
    runEnd(root, runId, code);
    const sm = store.appendMessage(root, { role: which, kind: 'status', text: `finished (exit ${code})`, agent: which, runId });
    emit({ type: 'message', message: sm });
    emit({ type: 'run-end', runId, code }); emit({ type: 'change' });
  });
  return { runId, child };
}

module.exports = { startRun, resolveRunnerCommand };
