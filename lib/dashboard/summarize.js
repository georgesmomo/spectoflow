'use strict';
/*
 * Chat "Summarize" — condenses the group-chat log down to one digest message, via the same
 * configured agent runner (kept separate from runner.js since it captures the child's raw stdout as
 * one summary, not sentinel-parsed lines; unit-testable without an HTTP server, same as runner.js).
 * Deliberately REPLACES runtime.messages rather than appending: a digest that leaves the full history
 * sitting right below it doesn't condense anything — it just adds noise on top of noise.
 */
const { spawn } = require('child_process');
const store = require('../store');
const { resolveRunnerCommand } = require('./runner');

const DEFAULT_LIMIT = 40;

// "role: text" lines, oldest first, capped to the most recent `limit` entries.
function formatLog(messages, limit = DEFAULT_LIMIT) {
  return (messages || []).slice(-limit).map((m) => `${m.role}: ${m.text}`).join('\n');
}

// Summarizes runtime.messages (excluding prior summaries, so re-summarizing doesn't compound) into
// one new message of kind 'summary', REPLACING the log. Returns { child } on success or { error } —
// mirrors startRun's shape, without the sentinel-line streaming runner.js does (this is a one-shot
// digest, not a task run).
function runSummarize(root, { agent } = {}, emit) {
  const cfg = store.readConfig(root);
  const which = agent || cfg.agent || 'claude';
  const cmdStr = resolveRunnerCommand(root, cfg, which);
  if (!cmdStr) return { error: `No runner configured for "${which}".` };

  const rt = store.readRuntime(root);
  const messages = (rt.messages || []).filter((m) => m.kind !== 'summary');
  if (!messages.length) return { error: 'Nothing to summarize yet.' };
  const summarizedIds = new Set(messages.map((m) => m.id));

  const prompt = 'Summarize this project\'s recent activity log in 3-6 concise bullet points — '
    + 'what was built, decided, or is blocked. Reply with the summary text only: no preamble, no '
    + 'sentinel lines, and do not read, search or edit any files — answer using only the log below.'
    + '\n\n' + formatLog(messages);

  const parts = cmdStr.split(/\s+/).filter(Boolean);
  const runId = 'summarize-' + Date.now().toString(36);
  // Emitted before the spawn attempt (same order runner.js uses) so the client's "agent running"
  // indicator lights up immediately, and so a spawn failure below still gets a matching run-end
  // rather than leaving that indicator stuck on.
  if (emit) emit({ type: 'run-start', run: { id: runId } });
  let child;
  // windowsHide: without it, spawning a .cmd-shimmed CLI on Windows pops up a real console window.
  try { child = spawn(parts[0], [...parts.slice(1), prompt], { cwd: root, env: process.env, windowsHide: true }); }
  catch (e) { if (emit) emit({ type: 'run-end', runId, code: 1 }); return { error: e.message }; }
  try { child.stdin && child.stdin.end(); } catch {}

  let out = '';
  child.stdout && child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr && child.stderr.on('data', (d) => { out += d.toString(); });
  child.on('close', (code) => {
    const text = out.trim() || (code === 0 ? '(no output)' : `summarize failed (exit ${code})`);
    const summary = {
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      kind: 'summary',
      role: which,
      agent: which,
      text,
    };
    // Re-read fresh (not the earlier snapshot): drop exactly the messages that went INTO this
    // summary, keep anything that arrived while the agent was running — condensing the log must
    // never silently lose a message someone sent in the meantime.
    const fresh = store.readRuntime(root);
    fresh.messages = (fresh.messages || []).filter((m) => !summarizedIds.has(m.id));
    fresh.messages.push(summary);
    store.writeRuntime(root, fresh);
    if (emit) { emit({ type: 'run-end', runId, code }); emit({ type: 'message', message: summary }); emit({ type: 'change' }); }
  });
  return { child };
}

module.exports = { runSummarize, formatLog };
