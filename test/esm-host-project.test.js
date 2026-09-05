'use strict';
// A real user project can declare "type": "module" in its own package.json (e.g. a modern web app).
// Node resolves a .js file's module type by walking UP to the nearest ancestor package.json — since
// .spectoflow/ shipped no package.json of its own, that walk landed on the HOST project's
// "type":"module" and made Node treat every vendored CommonJS file (require()/module.exports) under
// .spectoflow/ as an ES module, breaking `require()` for the whole dashboard with a confusing
// "Cannot find module" error on an otherwise-valid relative path. Found via real dogfooding: adding
// such a project to the hub showed "dashboard code failed to load" for every project of this shape.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BIN = path.resolve(__dirname, '..', 'bin', 'spectoflow.js');

function initModuleTypeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-esm-host-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'host', type: 'module' }, null, 2));
  execFileSync('node', [BIN, 'init', dir], { stdio: 'pipe' });
  return dir;
}

test('init writes .spectoflow/package.json pinning "type":"commonjs"', () => {
  const proj = initModuleTypeProject();
  const pkgPath = path.join(proj, '.spectoflow', 'package.json');
  assert.ok(fs.existsSync(pkgPath), '.spectoflow/package.json exists');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.strictEqual(pkg.type, 'commonjs');
});

test('the hub opens a project whose own package.json says "type":"module"', async () => {
  const proj = initModuleTypeProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-esm-home-'));
  const entry = require('../lib/registry').addProject(proj, path.join(home, 'dashboard'));
  const port = 7600 + Math.floor(Math.random() * 100);
  const { spawn } = require('node:child_process');
  const HUB = path.resolve(__dirname, '..', 'lib', 'dashboard', 'hub-server.js');
  const srv = await new Promise((resolve) => {
    const s = spawn('node', [HUB], { env: { ...process.env, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
    s.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(s); });
  });
  try {
    const res = await fetch(`http://localhost:${port}/api/project?p=${entry.id}`);
    assert.strictEqual(res.status, 200);
  } finally { srv.kill(); }
});
