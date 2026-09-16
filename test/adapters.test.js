'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const adapters = require('../lib/adapters');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stf-adapt-'));

test('generate writes the gemini entry file (GEMINI.md)', () => {
  const proj = tmp();
  const { written } = adapters.generate(proj, ['gemini']);
  assert.ok(written.includes('GEMINI.md'));
  assert.ok(fs.existsSync(path.join(proj, 'GEMINI.md')));
  assert.match(fs.readFileSync(path.join(proj, 'GEMINI.md'), 'utf8'), /\.spectoflow\/SPECTOFLOW\.md/);
});

test('generate writes the shared AGENTS.md once for codex + cursor', () => {
  const proj = tmp();
  const { written } = adapters.generate(proj, ['codex', 'cursor']);
  assert.deepStrictEqual(written, ['AGENTS.md'], 'shared file written a single time');
});

test('generate writes claude shims: CLAUDE.md and the slash command', () => {
  const proj = tmp();
  const { written } = adapters.generate(proj, ['claude']);
  assert.ok(written.includes('CLAUDE.md'));
  assert.ok(written.includes('.claude/commands/spectoflow.md'));
});

test('defaultRunners returns a runner command per known agent', () => {
  const runners = adapters.defaultRunners(['claude', 'gemini']);
  assert.ok(runners.claude && runners.claude.startsWith('claude'));
  assert.ok(runners.gemini && runners.gemini.startsWith('gemini'));
  assert.ok(!('unknown-agent' in adapters.defaultRunners(['unknown-agent'])));
});

test('generate writes the shared AGENTS.md once for opencode + kiro + antigravity', () => {
  const proj = tmp();
  const { written } = adapters.generate(proj, ['opencode', 'kiro', 'antigravity']);
  assert.deepStrictEqual(written, ['AGENTS.md'], 'shared file written a single time');
  assert.match(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8'), /\.spectoflow\/SPECTOFLOW\.md/);
});

test('defaultRunners covers opencode, kiro and antigravity with their real headless flags', () => {
  const runners = adapters.defaultRunners(['opencode', 'kiro', 'antigravity']);
  assert.strictEqual(runners.opencode, 'opencode run --quiet');
  assert.strictEqual(runners.kiro, 'kiro-cli chat --no-interactive --trust-all-tools');
  assert.strictEqual(runners.antigravity, 'agy -p');
});

test('every REGISTRY entry has a bin to detect and at least one entry file', () => {
  for (const a of adapters.REGISTRY) {
    assert.ok(a.detect && a.detect.bin, `${a.id} has a detect.bin`);
    assert.ok(a.entries && a.entries.length, `${a.id} writes at least one entry file`);
    assert.strictEqual(typeof a.headless, 'boolean', `${a.id} declares headless explicitly`);
  }
});

test('a headless:true entry has a real runner command; a headless:false entry has none', () => {
  for (const a of adapters.REGISTRY) {
    if (a.headless) assert.ok(a.runner && a.runner.length, `${a.id} (headless) has a runner command`);
    else assert.strictEqual(a.runner, null, `${a.id} (not headless) has no runner to fabricate`);
  }
});

test('kimi is known and detectable, but marked non-headless (no confirmed one-shot mode)', () => {
  const kimi = adapters.REGISTRY.find((a) => a.id === 'kimi');
  assert.ok(kimi, 'kimi is registered');
  assert.strictEqual(kimi.headless, false);
  assert.strictEqual(kimi.detect.bin, 'kimi');
  assert.strictEqual(kimi.runner, null);
});

test('defaultRunners never seeds a runner for a non-headless agent', () => {
  const runners = adapters.defaultRunners(['claude', 'kimi']);
  assert.ok(runners.claude);
  assert.ok(!('kimi' in runners), 'kimi has no runner to seed');
});

test('copilot never uses .github as a detect dir (false-positive risk: any CI project has one)', () => {
  const copilot = adapters.REGISTRY.find((a) => a.id === 'copilot');
  assert.ok(copilot, 'copilot is registered');
  assert.deepStrictEqual(copilot.detect.dirs, [], 'PATH-only detection for copilot');
  assert.strictEqual(copilot.detect.bin, 'copilot');
});

test('generate writes the shared AGENTS.md once for copilot + amazon-q + droid + auggie + goose', () => {
  const proj = tmp();
  const { written } = adapters.generate(proj, ['copilot', 'amazon-q', 'droid', 'auggie', 'goose']);
  assert.deepStrictEqual(written, ['AGENTS.md'], 'shared file written a single time');
});

test('the September 2026 wave (copilot, amazon-q, droid, auggie, goose) are all headless with a runner and a docsUrl', () => {
  for (const id of ['copilot', 'amazon-q', 'droid', 'auggie', 'goose']) {
    const a = adapters.REGISTRY.find((x) => x.id === id);
    assert.ok(a, `${id} is registered`);
    assert.strictEqual(a.headless, true, `${id} is headless`);
    assert.ok(a.runner && a.runner.length, `${id} has a runner`);
    assert.match(a.docsUrl, /^https:\/\//, `${id} has a docs URL`);
  }
});

test('an existing AGENTS.md is kept and gets a spectoflow pointer section appended', () => {
  const proj = tmp();
  const own = '# Team conventions\n\nUse pnpm. Never commit to main.\n';
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), own);
  const { written, appended } = adapters.generate(proj, ['codex', 'cursor']);
  assert.deepStrictEqual(written, []);
  assert.deepStrictEqual(appended, ['AGENTS.md'], 'shared file appended a single time');
  const text = fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8');
  assert.ok(text.startsWith(own.trimEnd()), 'the user content is untouched, and stays first');
  assert.match(text, /<!-- spectoflow:start -->[\s\S]*\.spectoflow\/SPECTOFLOW\.md[\s\S]*<!-- spectoflow:end -->\n$/);
});

test('appending the pointer is idempotent, and a file that already points to the brain is left alone', () => {
  const proj = tmp();
  fs.writeFileSync(path.join(proj, 'GEMINI.md'), '# mine\n');
  adapters.generate(proj, ['gemini']);
  const once = fs.readFileSync(path.join(proj, 'GEMINI.md'), 'utf8');
  assert.deepStrictEqual(adapters.generate(proj, ['gemini']).appended, []);
  assert.strictEqual(fs.readFileSync(path.join(proj, 'GEMINI.md'), 'utf8'), once);
  assert.strictEqual((once.match(/spectoflow:start/g) || []).length, 1);

  const manual = '# mine\nSee .spectoflow/SPECTOFLOW.md for everything.\n';
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), manual);
  assert.deepStrictEqual(adapters.ensurePointers(proj), { appended: [], repointed: [] });
  assert.strictEqual(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8'), manual);
});

test('ensurePointers repairs existing memory files only, never creates one, and honours dryRun', () => {
  const proj = tmp();
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), '# mine\n');
  assert.deepStrictEqual(adapters.ensurePointers(proj, true).appended, ['AGENTS.md'], 'dry-run reports');
  assert.strictEqual(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8'), '# mine\n', 'dry-run writes nothing');
  assert.deepStrictEqual(adapters.ensurePointers(proj).appended, ['AGENTS.md']);
  assert.ok(!fs.existsSync(path.join(proj, 'GEMINI.md')) && !fs.existsSync(path.join(proj, 'CLAUDE.md')), 'absent files are never created');
});

test('a pointer to the pre-0.28 brain (.spectoflow/AGENTS.md) is rewritten in place, never duplicated', () => {
  const proj = tmp();
  const legacyShim = '# AGENTS.md — spectoflow\n\nRead `.spectoflow/AGENTS.md` and follow it. See the Clarify reflex in `.spectoflow/AGENTS.md`.\n';
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), legacyShim);
  fs.mkdirSync(path.join(proj, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'commands', 'spectoflow.md'), 'Read `.spectoflow/AGENTS.md` first.\n');
  assert.deepStrictEqual(adapters.ensurePointers(proj), { appended: [], repointed: ['AGENTS.md', '.claude/commands/spectoflow.md'] });
  const text = fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8');
  assert.ok(!text.includes('.spectoflow/AGENTS.md'), 'no legacy path left');
  assert.strictEqual((text.match(/\.spectoflow\/SPECTOFLOW\.md/g) || []).length, 2, 'both references rewritten');
  assert.ok(!text.includes('spectoflow:start'), 'rewritten, not given a second pointer section');
  assert.strictEqual(fs.readFileSync(path.join(proj, '.claude', 'commands', 'spectoflow.md'), 'utf8'), 'Read `.spectoflow/SPECTOFLOW.md` first.\n');
  assert.deepStrictEqual(adapters.ensurePointers(proj), { appended: [], repointed: [] }, 'idempotent');
});

test('generate reports a repointed legacy entry file at init too', () => {
  const proj = tmp();
  fs.writeFileSync(path.join(proj, 'GEMINI.md'), 'See .spectoflow/AGENTS.md\n');
  const r = adapters.generate(proj, ['gemini']);
  assert.deepStrictEqual(r, { written: [], appended: [], repointed: ['GEMINI.md'] });
});
