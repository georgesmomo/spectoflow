'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('../lib/store');
const files = require('../lib/dashboard/files');
const { runMeetingGenerate, formatTasks, todayLocal, meetingPath, buildPrompt } = require('../lib/dashboard/meeting');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const SUMMARY_FIXTURE = path.join(KIT, 'test', 'fixtures', 'summary-agent.js').split(path.sep).join('/');

function installWithStub() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-meeting-'));
  execFileSync('node', [BIN, 'init', proj], { stdio: 'pipe' });
  const cfgPath = path.join(proj, '.spectoflow', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.agent = 'claude';
  cfg.runners = { claude: `node ${SUMMARY_FIXTURE}` };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  return proj;
}
function waitForClose(r) {
  return new Promise((resolve) => { r.child.on('close', resolve); });
}

test('todayLocal returns a YYYY-MM-DD string matching the machine\'s own local date', () => {
  const d = new Date();
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.strictEqual(todayLocal(), expected);
});

test('meetingPath resolves under .spectoflow/meetings/', () => {
  assert.strictEqual(meetingPath('2026-01-02'), '.spectoflow/meetings/2026-01-02.md');
});

test('formatTasks keeps only done/in_progress tasks, most-recent-last, capped to the limit', () => {
  const plans = [{ file: 'p.md', phases: [{ tasks: [
    { id: 'T-001', title: 'Add login', status: 'done' },
    { id: 'T-002', title: 'Add signup', status: 'todo' },
    { id: 'T-003', title: 'Fix parser', status: 'in_progress' },
    { id: 'T-004', title: 'Blocked one', status: 'blocked' },
  ] }] }];
  assert.strictEqual(formatTasks(plans), 'T-001: Add login (done)\nT-003: Fix parser (in_progress)');
  assert.strictEqual(formatTasks(plans, 1), 'T-003: Fix parser (in_progress)');
});

test('buildPrompt embeds a task digest, the chat log, and a "note text only" instruction — never a preamble/sentinel/file-op instruction violation', () => {
  const plans = [{ file: 'p.md', phases: [{ tasks: [{ id: 'T-001', title: 'Add login', status: 'done' }] }] }];
  const messages = [{ role: 'user', text: 'ship it' }];
  const prompt = buildPrompt(plans, messages);
  assert.match(prompt, /daily meeting note/i);
  assert.match(prompt, /T-001: Add login \(done\)/);
  assert.match(prompt, /user: ship it/);
  assert.match(prompt, /note text only/i);
  assert.match(prompt, /do not read, search or edit any files/i);
});

test('buildPrompt handles an empty digest (no tasks, no chat) without throwing', () => {
  const prompt = buildPrompt([], []);
  assert.match(prompt, /no done \/ in-progress tasks yet/);
  assert.match(prompt, /no recent chat activity/);
});

test('writes the generated note to .spectoflow/meetings/<date>.md, defaulting date to today', async () => {
  const proj = installWithStub();
  const r = runMeetingGenerate(proj, { agent: 'claude' }, () => {});
  assert.ok(!r.error, r.error);
  await waitForClose(r);
  const read = files.readFile(proj, meetingPath(todayLocal()));
  assert.match(read.content, /Added login form/);
});

test('writes to the EXPLICIT date when one is given, not today', async () => {
  const proj = installWithStub();
  const r = runMeetingGenerate(proj, { agent: 'claude', date: '2020-01-01' }, () => {});
  await waitForClose(r);
  const read = files.readFile(proj, meetingPath('2020-01-01'));
  assert.match(read.content, /Added login form/);
  // today's own file was never touched
  assert.strictEqual(files.readFile(proj, meetingPath(todayLocal())).error, 'Not found.');
});

test('OVERWRITES an existing note for that date (the client is responsible for confirming first)', async () => {
  const proj = installWithStub();
  files.writeFile(proj, meetingPath('2020-01-01'), 'old content');
  const r = runMeetingGenerate(proj, { agent: 'claude', date: '2020-01-01' }, () => {});
  await waitForClose(r);
  const read = files.readFile(proj, meetingPath('2020-01-01'));
  assert.match(read.content, /Added login form/);
  assert.doesNotMatch(read.content, /old content/);
});

test('emits run-start immediately and a matching run-end + change when the child closes', async () => {
  const proj = installWithStub();
  const events = [];
  const r = runMeetingGenerate(proj, { agent: 'claude' }, (e) => events.push(e));
  assert.ok(events.some((e) => e.type === 'run-start' && e.run && e.run.id));
  const runId = events.find((e) => e.type === 'run-start').run.id;
  await waitForClose(r);
  assert.ok(events.some((e) => e.type === 'run-end' && e.runId === runId && e.code === 0));
  assert.ok(events.some((e) => e.type === 'change'));
  const endIdx = events.findIndex((e) => e.type === 'run-end');
  const changeIdx = events.findIndex((e) => e.type === 'change');
  assert.ok(endIdx < changeIdx, 'run-end must land before change, so the client never sees "running" past the point the file is ready to re-fetch');
});

test('errors when no runner is configured for the requested agent (never spawns, never emits run-start)', () => {
  const proj = installWithStub();
  const events = [];
  const r = runMeetingGenerate(proj, { agent: 'nope' }, (e) => events.push(e));
  assert.match(r.error, /No runner configured/);
  assert.strictEqual(events.length, 0);
});

// Security regression: date is concatenated straight into a file path by meetingPath(), and
// files.writeFile()'s safePath() guard only rejects a path that resolves OUTSIDE the project root
// entirely — it does not confine a write to .spectoflow/meetings/. Without format validation,
// {date: '../../important'} would write to <root>/important.md.
test('rejects a path-traversal date (never spawns, never writes anywhere)', () => {
  const proj = installWithStub();
  const events = [];
  const r = runMeetingGenerate(proj, { agent: 'claude', date: '../../important' }, (e) => events.push(e));
  assert.match(r.error, /Invalid date/);
  assert.strictEqual(events.length, 0, 'must never spawn/emit run-start for a malformed date');
  assert.strictEqual(fs.existsSync(path.join(proj, 'important.md')), false, 'must never write outside .spectoflow/meetings/');
  assert.strictEqual(fs.existsSync(path.join(path.dirname(proj), 'important.md')), false, 'must never write above the project root');
});

test('rejects a non-date-shaped date string (never spawns, never writes)', () => {
  const proj = installWithStub();
  const events = [];
  const r = runMeetingGenerate(proj, { agent: 'claude', date: 'not-a-date' }, (e) => events.push(e));
  assert.match(r.error, /Invalid date/);
  assert.strictEqual(events.length, 0);
  assert.strictEqual(files.readFile(proj, meetingPath('not-a-date')).error, 'Not found.', 'nothing was written for the malformed date itself either');
});
