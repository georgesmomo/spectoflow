'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { injectDesign, sanitizeDesign, DEFAULT_DESIGN } = require('../lib/dashboard/inject-design');

test('injectDesign replaces an existing data-design value on the <html> tag', () => {
  const html = '<!doctype html>\n<html lang="en" data-theme="dark" data-design="console">\n<head></head>';
  const out = injectDesign(html, 'orbit');
  assert.match(out, /<html lang="en" data-theme="dark" data-design="orbit">/);
});

test('injectDesign adds data-design when the <html> tag has none', () => {
  const html = '<html lang="en">\n<head></head>';
  const out = injectDesign(html, 'mission');
  assert.match(out, /<html lang="en" data-design="mission">/);
});

test('injectDesign leaves data-theme and every other attribute untouched', () => {
  const html = '<html lang="en" data-theme="dark" data-design="console">';
  const out = injectDesign(html, 'obsidian');
  assert.match(out, /data-theme="dark"/);
  assert.match(out, /lang="en"/);
});

test('injectDesign falls back to the default for a missing/undefined design value', () => {
  const html = '<html lang="en" data-design="console">';
  assert.match(injectDesign(html, undefined), new RegExp(`data-design="${DEFAULT_DESIGN}"`));
  assert.match(injectDesign(html, null), new RegExp(`data-design="${DEFAULT_DESIGN}"`));
});

test('injectDesign never trusts an arbitrary/malicious string into the HTML', () => {
  const html = '<html lang="en" data-design="console">';
  const out = injectDesign(html, '"><script>alert(1)</script>');
  assert.ok(!out.includes('<script>'));
  assert.match(out, new RegExp(`data-design="${DEFAULT_DESIGN}"`));
});

test('sanitizeDesign accepts a real design id and rejects everything else', () => {
  assert.strictEqual(sanitizeDesign('control-room'), 'control-room');
  assert.strictEqual(sanitizeDesign('not valid!'), DEFAULT_DESIGN);
  assert.strictEqual(sanitizeDesign(123), DEFAULT_DESIGN);
});
