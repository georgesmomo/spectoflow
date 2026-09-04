'use strict';
/*
 * Chat "Summarize" — condenses the recent group-chat log into one digest message, via the same
 * configured agent runner (kept separate from runner.js since it captures the child's raw stdout as
 * one summary, not sentinel-parsed lines; unit-testable without an HTTP server, same as runner.js).
 */
const { spawn } = require('child_process');
const store = require('../lib/store');

const DEFAULT_LIMIT = 40;

// "role: text" lines, oldest first, capped to the most recent `limit` entries.
function formatLog(messages, limit = DEFAULT_LIMIT) {
  return (messages || []).slice(-limit).map((m) => `${m.role}: ${m.text}`).join('\n');
}

// Summarizes runtime.messages (excluding prior summaries, so re-summarizing doesn't compound) into
// one new message of kind 'summary'. Returns { child } on success or { error } — mirrors startRun's
// shape, without the sentinel-line streaming runner.js does (this is a one-shot digest, not a task run).
function runSummarize(root, { agent } = {}, emit) {
  const cfg = store.readConfig(root);
  const which = agent || cfg.agent || 'claude';
  const cmdStr = cfg.runners && cfg.runners[which];
  if (!cmdStr) return { error: `No runner configured for "${which}".` };

  const rt = store.readRuntime(root);
  const messages = (rt.messages || []).filter((m) => m.kind !== 'summary');
  if (!messages.length) return { error: 'Nothing to summarize yet.' };

  const prompt = 'Summarize this project\'s recent activity log in 3-6 concise bullet points — '
    + 'what was built, decided, or is blocked. Reply with the summary only, no preamble or sentinel lines.'
    + '\n\n' + formatLog(messages);

  const parts = cmdStr.split(/\s+/).filter(Boolean);
  let child;
  try { child = spawn(parts[0], [...parts.slice(1), prompt], { cwd: root, env: process.env }); }
  catch (e) { return { error: e.message }; }
  try { child.stdin && child.stdin.end(); } catch {}

  let out = '';
  child.stdout && child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr && child.stderr.on('data', (d) => { out += d.toString(); });
  child.on('close', (code) => {
    const text = out.trim() || (code === 0 ? '(no output)' : `summarize failed (exit ${code})`);
    const m = store.appendMessage(root, { role: which, kind: 'summary', text, agent: which });
    if (emit) { emit({ type: 'message', message: m }); emit({ type: 'change' }); }
  });
  return { child };
}

module.exports = { runSummarize, formatLog };
