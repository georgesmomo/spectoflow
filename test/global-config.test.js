'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-gc-'));
  const prev = process.env.SPECTOFLOW_HOME; process.env.SPECTOFLOW_HOME = home;
  delete require.cache[require.resolve('../lib/global-config')];
  try { return fn(require('../lib/global-config'), home); }
  finally { if (prev === undefined) delete process.env.SPECTOFLOW_HOME; else process.env.SPECTOFLOW_HOME = prev; delete require.cache[require.resolve('../lib/global-config')]; }
}

test('read() returns every default when no file exists, and get() reports source=default', () => withHome((gc, home) => {
  const cfg = gc.read();
  assert.strictEqual(cfg.dashboard.url, 'http://localhost:4319');
  assert.strictEqual(cfg.dashboard.path, path.join(home, 'dashboard'));
  assert.deepStrictEqual(cfg.defaults, { agent: 'claude', language: 'en', mode: 'semi', design: 'console' });
  assert.deepStrictEqual(gc.get('defaults.mode'), { value: 'semi', source: 'default' });
}));

test('set() writes the file, get() then reports source=set, list() shows every key', () => withHome((gc, home) => {
  gc.set('defaults.mode', 'manual');
  assert.ok(fs.existsSync(path.join(home, 'config.json')));
  assert.deepStrictEqual(gc.get('defaults.mode'), { value: 'manual', source: 'set' });
  assert.deepStrictEqual(gc.list().map((k) => k.key), gc.KEYS);
}));

test('set() validates: unknown key, bad mode, bad url, unknown agent all throw', () => withHome((gc) => {
  assert.throws(() => gc.set('nope.key', 'x'), /unknown key/i);
  assert.throws(() => gc.set('defaults.mode', 'turbo'), /autopilot, semi, manual/);
  assert.throws(() => gc.set('dashboard.url', 'not a url'), /url/i);
  assert.throws(() => gc.set('defaults.agent', 'skynet'), /unknown agent/i);
}));

test('set("dashboard.path") expands ~ and stores an absolute path', () => withHome((gc) => {
  const v = gc.set('dashboard.path', '~/my-hub');
  assert.strictEqual(v, path.join(os.homedir(), 'my-hub'));
  assert.ok(path.isAbsolute(gc.read().dashboard.path));
}));

test('ensure() creates an empty config file once and never overwrites a set value', () => withHome((gc, home) => {
  gc.ensure();
  assert.strictEqual(fs.readFileSync(path.join(home, 'config.json'), 'utf8').trim(), '{}');
  gc.set('defaults.language', 'fr');
  gc.ensure();
  assert.strictEqual(gc.get('defaults.language').value, 'fr');
}));
