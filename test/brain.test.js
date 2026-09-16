'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SPECTOFLOW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-brain-home-'));
const brain = require('../lib/brain');
const globalConfig = require('../lib/global-config');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stf-brain-')), 'brain.md');
const withAutoAdd = (value, fn) => {
  globalConfig.set('brain.autoAdd', value);
  try { return fn(); } finally { globalConfig.set('brain.autoAdd', true); }
};

test('lives in SPECTOFLOW_HOME, and reading a missing file gives an empty brain', () => {
  assert.strictEqual(brain.brainPath(), path.join(process.env.SPECTOFLOW_HOME, 'brain.md'));
  assert.deepStrictEqual(brain.read(tmpFile()), { entries: [], pending: [], autoAdd: true });
});

test('add writes a confirmed entry under its category, with id/by/at metadata', () => {
  const f = tmpFile();
  const { duplicate, entry } = brain.add({ category: 'profile', text: '  Scrum master\nand dev  ' }, f);
  assert.strictEqual(duplicate, false);
  assert.strictEqual(entry.text, 'Scrum master and dev', 'one line, trimmed');
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /^# Second brain\n/);
  assert.match(text, new RegExp(`## Profile\\n- Scrum master and dev <!-- id:${entry.id} by:user at:\\d{4}-\\d{2}-\\d{2} -->`));
  assert.deepStrictEqual(brain.read(f).entries.map((e) => [e.category, e.text, e.status]), [['profile', 'Scrum master and dev', 'confirmed']]);
});

test('unknown category falls back to preferences; text is capped and loses comment delimiters', () => {
  const f = tmpFile();
  const { entry } = brain.add({ category: 'nonsense', text: 'x'.repeat(600) + ' <!-- sneaky -->' }, f);
  assert.strictEqual(entry.category, 'preferences');
  assert.strictEqual(entry.text.length, brain.MAX_TEXT);
  assert.ok(!entry.text.includes('<!--'));
  assert.throws(() => brain.add({ category: 'profile', text: '   ' }, f), /required/);
});

test('a case-insensitive duplicate is not added twice', () => {
  const f = tmpFile();
  const first = brain.add({ category: 'avoid', text: 'Never push without asking' }, f).entry;
  const again = brain.add({ category: 'preferences', text: 'never PUSH without asking' }, f);
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(again.entry.id, first.id);
  assert.strictEqual(brain.read(f).entries.length, 1);
});

test('learn: confirmed when autoAdd is on, "to confirm" when off — and confirm() moves it', () => {
  const f = tmpFile();
  const on = brain.learn({ category: 'workflow', text: 'Wants a short recommendation' }, f).entry;
  assert.strictEqual(on.status, 'confirmed');
  assert.strictEqual(on.by, 'agent');
  withAutoAdd(false, () => {
    const off = brain.learn({ category: 'preferences', text: 'Prefers pnpm' }, f).entry;
    assert.strictEqual(off.status, 'pending');
    assert.match(fs.readFileSync(f, 'utf8'), /## To confirm\n- \[preferences\] Prefers pnpm <!-- id:/);
    assert.strictEqual(brain.read(f).autoAdd, false);
    brain.confirm(off.id, f);
  });
  const r = brain.read(f);
  assert.deepStrictEqual(r.pending, []);
  assert.ok(r.entries.some((e) => e.text === 'Prefers pnpm' && e.category === 'preferences' && e.status === 'confirmed'));
  assert.ok(!fs.readFileSync(f, 'utf8').includes('To confirm'), 'empty section is not written');
});

test('update changes text and moves a confirmed entry to its new category; remove deletes; unknown id is a 404', () => {
  const f = tmpFile();
  const e = brain.add({ category: 'preferences', text: 'Likes tabs' }, f).entry;
  brain.update(e.id, { text: 'Likes spaces', category: 'avoid' }, f);
  const after = brain.read(f).entries;
  assert.deepStrictEqual(after.map((x) => [x.category, x.text]), [['avoid', 'Likes spaces']]);
  assert.throws(() => brain.update(e.id, { text: '' }, f), /required/);
  brain.remove(e.id, f);
  assert.deepStrictEqual(brain.read(f).entries, []);
  assert.throws(() => brain.remove('nope', f), (err) => err.status === 404);
  assert.throws(() => brain.confirm('nope', f), (err) => err.status === 404);
});

test('a hand-edited file: lines without metadata get a stable id, unknown lines and sections are kept', () => {
  const f = tmpFile();
  fs.writeFileSync(f, [
    '# My brain',
    'A note I wrote at the top.',
    '## Working style',
    '- Works late at night',
    'just a sentence, not a bullet',
    '## Hobbies',
    '- Chess',
    '',
  ].join('\n'));
  const first = brain.read(f).entries;
  assert.deepStrictEqual(first.map((e) => [e.category, e.text]), [['workflow', 'Works late at night']]);
  assert.strictEqual(brain.read(f).entries[0].id, first[0].id, 'same id on every read');
  brain.add({ category: 'profile', text: 'Developer' }, f);
  const text = fs.readFileSync(f, 'utf8');
  for (const kept of ['A note I wrote at the top.', 'just a sentence, not a bullet', '## Hobbies', '- Chess']) assert.ok(text.includes(kept), kept);
  assert.ok(brain.read(f).entries.some((e) => e.id === first[0].id), 'the hand-written entry kept its id once saved');
  brain.remove(first[0].id, f);
  assert.ok(!fs.readFileSync(f, 'utf8').includes('Works late at night'));
  const saved = fs.readFileSync(f, 'utf8');
  assert.strictEqual(brain.serialize(brain.parse(saved)), saved, 'stable with kept lines and sections too');
});

test('parse → serialize is stable', () => {
  const f = tmpFile();
  brain.add({ category: 'profile', text: 'A' }, f);
  withAutoAdd(false, () => brain.learn({ category: 'avoid', text: 'B' }, f));
  const once = fs.readFileSync(f, 'utf8');
  assert.strictEqual(brain.serialize(brain.parse(once)), once);
});

test('renderForAgent gives confirmed entries only, grouped by category', () => {
  const f = tmpFile();
  assert.strictEqual(brain.renderForAgent(f), '');
  brain.add({ category: 'avoid', text: 'Never publish without asking' }, f);
  brain.add({ category: 'profile', text: 'Scrum master' }, f);
  withAutoAdd(false, () => brain.learn({ category: 'preferences', text: 'Unconfirmed guess' }, f));
  assert.strictEqual(brain.renderForAgent(f), '## Profile\n- Scrum master\n\n## Avoid\n- Never publish without asking');
});

test('brain.autoAdd is a validated boolean global setting, true by default', () => {
  assert.strictEqual(globalConfig.set('brain.autoAdd', 'false'), false);
  assert.deepStrictEqual(globalConfig.get('brain.autoAdd'), { value: false, source: 'set' });
  assert.throws(() => globalConfig.set('brain.autoAdd', 'maybe'), /true or false/);
  globalConfig.set('brain.autoAdd', true);
});

// ---- a hand-edited file survives any save (independent review, finding I4) --------------------------
const HAND = [
  '# My own brain',
  '',
  'An intro I wrote.',
  '',
  'It has two paragraphs.',
  '',
  '## Profile',
  '',
  '- Foo <!-- why I wrote this -->',
  '- Uses `<!-- x -->` in templates',
  '- Same line',
  '- Same line',
  '',
  '## Snippets',
  '',
  '```bash',
  '# a bash comment, not a title',
  '## not a heading either',
  'echo hi',
  '```',
  '',
  '## Preferences',
  '- Likes tabs',
  '',
  '## To confirm',
  '- [prefs] Maybe likes vim',
  '',
].join('\n');

test('an unrelated write keeps every hand-written line, blank line, comment, code block and section order', () => {
  const f = tmpFile();
  fs.writeFileSync(f, HAND);
  assert.strictEqual(brain.serialize(brain.parse(HAND)), HAND, 'no change → byte-identical');
  brain.learn({ category: 'avoid', text: 'Never publish without asking' }, f);
  const after = fs.readFileSync(f, 'utf8');
  const expected = HAND.replace(/\n$/, '') + '\n\n## Avoid\n';
  assert.ok(after.startsWith(HAND.replace('## To confirm\n- [prefs] Maybe likes vim\n', '')), 'everything before the new section is untouched');
  for (const kept of ['# My own brain', 'An intro I wrote.\n\nIt has two paragraphs.', '- Foo <!-- why I wrote this -->', '- Uses `<!-- x -->` in templates', '# a bash comment, not a title', '## not a heading either', '- [prefs] Maybe likes vim']) {
    assert.ok(after.includes(kept), `kept: ${kept}`);
  }
  assert.ok(after.indexOf('## Snippets') < after.indexOf('## Preferences'), 'unknown section stays where it was');
  assert.ok(after.indexOf('## Avoid') < after.indexOf('## To confirm'), 'a new category section goes before To confirm');
  assert.match(after, /## Avoid\n- Never publish without asking <!-- id:\S+ by:agent/);
  assert.ok(expected.length > 0);
});

test('parsing a hand-edited file: code blocks are not parsed, pending [prefs] reads as preferences, identical lines get distinct ids', () => {
  const r = brain.parse(HAND);
  const entries = r.blocks.flatMap((b) => b.items.filter((i) => i.raw === undefined));
  assert.deepStrictEqual(entries.map((e) => [e.category, e.text, e.status]), [
    ['profile', 'Foo', 'confirmed'],
    ['profile', 'Uses ` x ` in templates', 'confirmed'],
    ['profile', 'Same line', 'confirmed'],
    ['profile', 'Same line', 'confirmed'],
    ['preferences', 'Likes tabs', 'confirmed'],
    ['preferences', 'Maybe likes vim', 'pending'],
  ]);
  assert.notStrictEqual(entries[2].id, entries[3].id, 'identical lines are told apart');
  const f = tmpFile(); fs.writeFileSync(f, HAND);
  brain.remove(entries[3].id, f);
  assert.strictEqual((fs.readFileSync(f, 'utf8').match(/^- Same line$/gm) || []).length, 1, 'only one of the two identical lines removed');
});

test('only the entry that changes is rewritten', () => {
  const f = tmpFile(); fs.writeFileSync(f, HAND);
  const likes = brain.read(f).entries.find((e) => e.text === 'Likes tabs');
  brain.update(likes.id, { text: 'Likes spaces' }, f);
  const after = fs.readFileSync(f, 'utf8');
  assert.match(after, /- Likes spaces <!-- id:h[0-9a-f]+ by:user -->/);
  assert.strictEqual(after.replace(/- Likes spaces <!-- id:h[0-9a-f]+ by:user -->/, '- Likes tabs'), HAND);
});

test('concurrent writers in several processes never lose a fact', async () => {
  const f = tmpFile();
  const { spawn } = require('node:child_process');
  const script = (p) => `const b=require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'brain'))}); for (let i=0;i<15;i++) b.add({category:'profile', text:'p${p} fact '+i}, ${JSON.stringify(f)});`;
  await Promise.all([0, 1, 2, 3].map((p) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['-e', script(p)], { env: process.env, stdio: 'inherit' });
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error('writer exited ' + code))));
  })));
  assert.strictEqual(brain.read(f).entries.length, 60);
  assert.ok(!fs.existsSync(f + '.lock'), 'lock released');
});

test('a user comment on a hand-written line never reaches the agent, and CRLF files stay CRLF', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '# Second brain\r\n\r\n## Profile\r\n- Developer <!-- keep this private -->\r\n');
  assert.strictEqual(brain.renderForAgent(f), '## Profile\n- Developer');
  brain.add({ category: 'avoid', text: 'Never publish without asking' }, f);
  const after = fs.readFileSync(f, 'utf8');
  assert.ok(after.includes('- Developer <!-- keep this private -->\r\n'), 'the line itself is kept');
  assert.ok(!/[^\r]\n/.test(after), 'every line ends with CRLF');
});
