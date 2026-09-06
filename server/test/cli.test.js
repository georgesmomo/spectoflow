'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const CLI = path.resolve(__dirname, '..', 'cli.js');

function dbUrl() { return 'sqlite:' + path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stf-srv-cli-')), 'db.sqlite'); }
const run = (url, args) => execFileSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } });

test('migrate, then create a real owner account via signup, then token create prints the token once; list shows it active; revoke closes it', async () => {
  const url = dbUrl();
  run(url, ['migrate']);
  // token create now requires an existing owner account — create one directly via the db model
  // (no HTTP server involved in this CLI-only test), matching how a real admin would point the CLI
  // at an account created through the web /signup page.
  const { createDb } = require('../src/db');
  const db = await createDb(url);
  await db.createUser('ci-owner@example.com', 'password-123456');
  await db.destroy();
  const created = run(url, ['token', 'create', '--name=ci-box', '--owner-email=ci-owner@example.com']);
  const m = created.match(/token \(shown once.*\):\s*\n\s*\n\s*(spf_\S+)/s);
  assert.ok(m, created);
  const token = m[1];
  let list = run(url, ['token', 'list']);
  assert.match(list, /ci-box\s+active/);
  const id = list.trim().split(/\s+/)[0];
  const revoked = run(url, ['token', 'revoke', id]);
  assert.match(revoked, /revoked/);
  list = run(url, ['token', 'list']);
  assert.match(list, /ci-box\s+revoked/);
  assert.throws(() => run(url, ['token', 'create', '--name=x']));       // missing --owner-email
  assert.throws(() => run(url, ['token', 'create', '--name=x', '--owner-email=nobody@example.com'])); // unknown owner
});
