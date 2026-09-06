'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PUB = path.resolve(__dirname, '..', 'lib', 'dashboard', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

test('i18n: the two offline keys exist in all 6 languages', () => {
  const src = read('i18n.js');
  for (const key of ['offline.banner', 'offline.readonly']) {
    const n = (src.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || []).length;
    assert.strictEqual(n, 6, `${key} must be defined 6 times (en/fr/es/de/pt/it), found ${n}`);
  }
  assert.ok(/'offline\.banner':'[^']*\{name\}[^']*\{when\}/.test(src), 'en banner uses {name} and {when}');
});

test('app.js: offline state = body.is-offline + a 503 guard on mutating /api calls; index.html has the bar', () => {
  const app = read('app.js');
  assert.ok(app.includes("classList.toggle('is-offline'"), 'body.is-offline toggled');
  assert.ok(app.includes('online===false') || app.includes('online === false'), 'reads online:false');
  assert.ok(/status:\s*503/.test(app), 'mutations short-circuit to 503 while offline');
  assert.ok(read('index.html').includes('id="offlineBar"'));
  assert.ok(read('styles.css').includes('.offline-bar'));
});

test('hub.js: remote mode hides add/remove and shows the machine; local mode has the Online toggle', () => {
  const hub = read('hub.js');
  assert.ok(hub.includes("data.mode === 'remote'"));
  assert.ok(hub.includes('data-publish='));
  assert.ok(hub.includes('/publish'));
  const css = read('styles.css');
  assert.ok(css.includes('.hub-body.hub-remote'));
  const appended = css.slice(css.indexOf('online dashboard'));
  assert.ok(!/gradient\(/.test(appended), 'no gradients in the new rules');
});
