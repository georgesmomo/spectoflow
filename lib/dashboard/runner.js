'use strict';
/*
 * Agent run pipeline — spawns the configured agent headless and turns its output into the
 * group-chat message log. The user prompt is logged as a message; the agent identifies itself by
 * printing sentinel lines (::spectoflow role=… kind=… msg=…) which become structured messages;
 * any other output streams raw as run-line events. `emit` publishes SSE events to the dashboard.
 *
 * Kept separate from the HTTP layer so the pipeline is unit-testable without a server.
 */
const path = require('path');
const { spawn } = require('child_process');
const store = require('../store');
const adapters = require('../adapters');
const detect = require('../detect');
const brain = require('../brain');
const runnerTrust = require('../runner-trust');

// The command to run `which`: config.json's own runners map first (an explicit user choice always
// wins), falling back to the registry's default for a known, headless-capable, genuinely-installed
// agent — so picking one from a per-message agent list works the first time, before it's ever been
// the project's "active agent" and had a runner seeded into config.json for it.
function resolveRunnerCommand(root, cfg, which, opts) {
  if (cfg.runners && cfg.runners[which]) return cfg.runners[which];
  const known = adapters.knownAgents().find((a) => a.id === which);
  if (known && known.runner && detect.isAgentInstalled(which, root, opts)) return known.runner;
  return null;
}

// Agent processes in flight, per project and group — so a stuck one can be stopped from the dashboard. Runs,
// summaries and meeting notes share the 'chat' group; a task worked on in isolation (D79) has its own,
// 'task:<id>', so stopping the chat never stops it, and the other way round.
const inFlight = new Map();
const flightKey = (root, group) => `${path.resolve(root)}\n${group || 'chat'}`;
function trackChild(root, child, group) {
  const key = flightKey(root, group);
  if (!inFlight.has(key)) inFlight.set(key, new Set());
  inFlight.get(key).add(child);
  child.on('close', () => { const set = inFlight.get(key); if (set) set.delete(child); });
}
// Stop every agent process of this project's group → how many were signalled.
function stopRuns(root, group) {
  const set = inFlight.get(flightKey(root, group));
  if (!set || !set.size) return 0;
  for (const child of set) { try { child.kill(); } catch (_) {} }
  return set.size;
}
const isRunning = (root, group) => { const set = inFlight.get(flightKey(root, group)); return !!(set && set.size); };
// After a crash or restart, runs recorded as running can't be: mark them interrupted.
function reconcileRunsOnBoot(root) {
  const rt = store.readRuntime(root);
  const stale = (rt.agents || []).filter((a) => a.status === 'running');
  if (!stale.length) return 0;
  const now = new Date().toISOString();
  stale.forEach((a) => { a.status = 'interrupted'; a.endedAt = a.endedAt || now; });
  store.writeRuntime(root, rt);
  return stale.length;
}

function runStart(root, run) {
  const rt = store.readRuntime(root); rt.agents = rt.agents || []; rt.agents.push(run); store.writeRuntime(root, rt);
}
function runEnd(root, id, code, signal) {
  const rt = store.readRuntime(root); const a = (rt.agents || []).find((x) => x.id === id);
  if (a) { a.status = signal ? 'stopped' : code === 0 ? 'done' : 'failed'; a.endedAt = new Date().toISOString(); }
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

// Detect a second-brain line: `::spectoflow learn category=<id> msg=<text>` — the fallback an agent uses
// when its brain_learn MCP tool is unavailable or refused (non-interactive runs often refuse MCP tools).
function parseLearnLine(line) {
  const m = /^::spectoflow\s+learn\b(.*)$/.exec(String(line).trim());
  if (!m) return null;
  const msg = (/\bmsg=([\s\S]+)$/.exec(m[1]) || [])[1];
  if (!msg || !msg.trim()) return null;
  const category = (/\bcategory=(\S+)/.exec(m[1].slice(0, m[1].indexOf('msg='))) || [])[1];
  return { category, text: msg.trim() };
}

// Start an agent run. Returns { runId, child } or { error } if no runner is configured.
// learn:false ignores `::spectoflow learn` lines — for runs a remote caller started (the online relay, or
// another machine on the network): nobody but the machine's owner may write into their second brain.
// logPrompt:false suppresses echoing the prompt as a user bubble — used by the orchestrator,
// whose priming prompt ("You are the …") is machinery the user shouldn't have to read.
// display: when a non-empty string, the chat bubble shows this while the child still receives prompt.
// task + cwd: a task worked on in isolation (D79) — the agent runs in the task's worktree, its run and events
// carry the task id (the chat stays free), and it is stopped with its own group.
function startRun(root, { prompt, agent, logPrompt = true, display, learn = true, task, cwd }, emit) {
  const cfg = store.readConfig(root);
  const which = agent || cfg.agent || 'claude';
  const cmdStr = resolveRunnerCommand(root, cfg, which);
  if (!cmdStr) return { error: `No runner configured for "${which}".` };
  const blocked = runnerTrust.blockedMessage(root, which, cmdStr);
  if (blocked) return { error: blocked, untrustedRunner: { agent: which, command: cmdStr } };
  const parts = cmdStr.split(/\s+/).filter(Boolean);
  const runId = 'r' + Date.now().toString(36);
  const p = String(prompt).trim();
  // The chat bubble can show a shorter, friendlier text than what the agent actually receives — e.g.
  // a slash-command invocation "/rapport_jour focus bugs" instead of the full expanded instruction.
  // The child (line ~84) always spawns with `p`, the real prompt.
  const shown = (typeof display === 'string' && display.trim()) ? display.trim() : p;

  if (logPrompt) {
    const um = store.appendMessage(root, { role: 'user', kind: 'message', text: shown, agent: which, runId });
    emit({ type: 'message', message: um });
  }

  const run = { id: runId, tool: which, prompt: p, status: 'running', startedAt: new Date().toISOString(), ...(task ? { task } : {}) };
  const tag = task ? { task } : {};
  runStart(root, run); emit({ type: 'run-start', run, ...tag }); emit({ type: 'change' });

  let child;
  // windowsHide: without it, spawning a .cmd-shimmed CLI (e.g. a global npm install of `claude` on
  // Windows) pops up a real, empty console window on top of the browser — jarring, and pointless
  // since stdout/stderr are already piped and captured below, never read from that window anyway.
  try { child = spawn(parts[0], [...parts.slice(1), p], { cwd: cwd || root, env: process.env, windowsHide: true }); }
  catch (e) {
    runEnd(root, runId, 1);
    emit({ type: 'run-line', runId, chunk: 'spawn error: ' + e.message + '\n', ...tag });
    emit({ type: 'run-end', runId, code: 1, ...tag }); emit({ type: 'change' });
    return { runId, spawnError: e.message };
  }
  // End the child's stdin immediately: a child that reads stdin (or a Windows pipe that
  // otherwise keeps 'close' from firing) can't stall the run waiting on input that never comes.
  try { child.stdin && child.stdin.end(); } catch {}
  trackChild(root, child, task ? `task:${task}` : 'chat');

  const onLine = (line) => {
    // A learn line is swallowed either way. When recorded, it ALWAYS waits in "To confirm", whatever
    // brain.autoAdd says: this is raw stdout/stderr, which also carries command output and file contents
    // an agent echoes, so a line in a cloned repo could otherwise plant a standing instruction. And the
    // fact is never written into the chat log — that log is part of project.read, which a published
    // project sends to the relay. The page learns about it from the hub's local-only brain watcher.
    const learned = parseLearnLine(line);
    if (learned) {
      if (learn) { try { brain.add({ ...learned, by: 'agent', status: 'pending' }); } catch (_) {} }
      return;
    }
    const att = parseAttentionLine(line);
    if (att) { pushAttention(root, att, which); emit({ type: 'change' }); return; }
    const m = store.parseAgentLine(line);
    if (m) { const full = store.appendMessage(root, { ...m, agent: which, runId }); emit({ type: 'message', message: full }); }
    else emit({ type: 'run-line', runId, chunk: line + '\n', ...tag });
  };
  const out = makeFeeder(onLine), err = makeFeeder(onLine);
  child.stdout && child.stdout.on('data', (d) => out.feed(d));
  child.stderr && child.stderr.on('data', (d) => err.feed(d));
  child.on('error', (e) => emit({ type: 'run-line', runId, chunk: 'error: ' + e.message + '\n', ...tag }));
  child.on('close', (code, signal) => {
    out.flush(); err.flush();
    runEnd(root, runId, code, signal);
    const sm = store.appendMessage(root, { role: which, kind: 'status', text: signal ? 'stopped' : `finished (exit ${code})`, agent: which, runId });
    emit({ type: 'message', message: sm });
    emit({ type: 'run-end', runId, code, ...tag }); emit({ type: 'change' });
  });
  return { runId, child };
}

module.exports = { startRun, resolveRunnerCommand, parseLearnLine, trackChild, stopRuns, isRunning, reconcileRunsOnBoot };
