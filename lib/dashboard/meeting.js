'use strict';
/*
 * Daily meeting — generates a dated standup-style note (.spectoflow/meetings/<date>.md) via the
 * configured agent. Structurally parallel to summarize.js's runSummarize (read that first — this
 * file mirrors its resolveRunnerCommand/spawn/emit shape exactly) but differs in two ways: what it
 * feeds the agent (a digest of recent task activity + the chat log, not just the chat log alone) and
 * where the result lands (a dated file under .spectoflow/meetings/, via files.js, never
 * runtime.messages — a meeting note is a project artifact, not a chat message).
 */
const { spawn } = require('child_process');
const store = require('../store');
const files = require('./files');
const { resolveRunnerCommand } = require('./runner');
const { formatLog } = require('./summarize'); // reused as-is rather than reimplemented — see report

const TASK_LIMIT = 20; // mirrors summarize.js's own DEFAULT_LIMIT philosophy (cap, most-recent-last)
const LOG_LIMIT = 40; // same DEFAULT_LIMIT summarize.js uses for the chat log

// YYYY-MM-DD in the machine running the dashboard's OWN local time zone. This is a deliberate,
// explicit choice (see the project report for the full reasoning): a meeting note's filename must be
// unambiguous, and this is a single-writer local tool — a viewer's own browser time zone must never
// decide which file "today" resolves to (it could differ from the server's, or from another viewer's
// browser, producing two different "today"s for the same project). The client reads this same value
// back from GET /api/project (ops.js's 'project.read' → p.todayDate), so both halves of this feature
// (manual edit and agent-generate) agree on exactly one "today".
function todayLocal() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "id: title (status)" lines for tasks that are done or in_progress — a cheap, already-available
// proxy for "what was built / is in flight" (no new aggregation invented), most-recent-last order
// (readPlans' own file/task order), capped to TASK_LIMIT.
function formatTasks(plans, limit = TASK_LIMIT) {
  const tasks = [];
  for (const pl of plans || []) {
    for (const ph of pl.phases || []) {
      for (const t of ph.tasks || []) {
        if (t.status === 'done' || t.status === 'in_progress') tasks.push(t);
      }
    }
  }
  return tasks.slice(-limit).map((t) => `${t.id}: ${t.title} (${t.status})`).join('\n');
}

// Strict YYYY-MM-DD only. This is the security boundary for the meetings feature: meetingPath()
// concatenates `date` straight into a file path, and files.writeFile()'s own safePath() guard only
// rejects a path that resolves OUTSIDE the project root entirely — it does NOT confine a write to
// .spectoflow/meetings/, so an unvalidated date like "../../important" would happily write to
// <root>/important.md. Every caller of meetingPath()/runMeetingGenerate() with a date that did not
// come from todayLocal() MUST go through this check first (see runMeetingGenerate below).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(date) {
  return DATE_RE.test(date);
}

function meetingPath(date) {
  return `.spectoflow/meetings/${date}.md`;
}

// Same "reply with the text only" instruction line runSummarize already uses (already well-tuned),
// adapted for a daily-meeting-note framing instead of a chat-log-digest framing.
function buildPrompt(plans, messages) {
  const taskDigest = formatTasks(plans) || '(no done / in-progress tasks yet)';
  const logDigest = formatLog(messages, LOG_LIMIT) || '(no recent chat activity)';
  return 'Write a short daily meeting note for this project, standup-style: what was done, '
    + 'what\'s in progress or blocked, and suggested next steps — 3-6 concise bullet points or short '
    + 'paragraphs. Reply with the note text only: no preamble, no sentinel lines, and do not read, '
    + 'search or edit any files — answer using only the digest below.'
    + '\n\nRecent tasks:\n' + taskDigest
    + '\n\nRecent chat log:\n' + logDigest;
}

// Generates a daily meeting note and WRITES it to .spectoflow/meetings/<date>.md (default: today —
// see todayLocal()), OVERWRITING whatever is already there. Overwrite-SAFETY (not silently
// destroying a real existing note) is the CLIENT's responsibility — see app.js's meeting-generate
// confirm flow — this function trusts its caller the same way runSummarize trusts chat.summarize's
// caller. Returns { child } on success or { error }, mirroring runSummarize's own shape exactly.
function runMeetingGenerate(root, { agent, date } = {}, emit) {
  const cfg = store.readConfig(root);
  const which = agent || cfg.agent || 'claude';
  const cmdStr = resolveRunnerCommand(root, cfg, which);
  if (!cmdStr) return { error: `No runner configured for "${which}".` };

  const day = date || todayLocal();
  if (!isValidDate(day)) return { error: 'Invalid date.' };
  const plans = store.readPlans(root);
  const messages = store.readRuntime(root).messages || [];
  const prompt = buildPrompt(plans, messages);

  const parts = cmdStr.split(/\s+/).filter(Boolean);
  const runId = 'meeting-' + Date.now().toString(36);
  // Emitted before the spawn attempt (same order runner.js/summarize.js use) so the client's "agent
  // running" indicator lights up immediately, and a spawn failure below still gets a matching run-end.
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
    const text = out.trim() || (code === 0 ? '(no output)' : `meeting generate failed (exit ${code})`);
    files.writeFile(root, meetingPath(day), text);
    // run-end before change, same ordering summarize.js uses — the client must never see "running"
    // linger past the point where the new content is actually ready to be re-fetched.
    if (emit) { emit({ type: 'run-end', runId, code }); emit({ type: 'change' }); }
  });
  return { child };
}

module.exports = { runMeetingGenerate, formatTasks, todayLocal, meetingPath, buildPrompt, isValidDate };
