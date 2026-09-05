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

test('handlers.js requires cleanly inside a host project whose own package.json says "type":"module"', () => {
  const proj = initModuleTypeProject();
  const handlersPath = path.join(proj, '.spectoflow', 'dashboard', 'handlers.js');
  // A child process, not a same-process require(): Node's module-type resolution is cached per
  // absolute path for the lifetime of the process, so a prior require() of this same test suite's
  // own CommonJS files must never taint the result for this specific project directory.
  const out = execFileSync('node', ['-e', `
    const { createHandlers } = require(${JSON.stringify(handlersPath)});
    const h = createHandlers(${JSON.stringify(proj)});
    console.log(typeof h.handleApi);
  `], { encoding: 'utf8' });
  assert.strictEqual(out.trim(), 'function');
});
