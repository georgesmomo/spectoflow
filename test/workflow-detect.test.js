'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wd = require('../lib/workflow-detect');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'templates', 'workflow.md'), 'utf8');
function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-wd-'));
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return root;
}
const enabled = (d) => Object.fromEntries(Object.entries(d.steps).map(([k, v]) => [k, v.enabled]));

test('an empty folder or documents only → design phase: build steps off, reason design-no-code', () => {
  for (const files of [{}, { 'README.md': '# idea', 'docs/brief.md': 'x', 'specs/login.md': 'x', 'maquette.pdf': 'x' }]) {
    const d = wd.detect(tree(files));
    assert.strictEqual(d.phase, 'design');
    assert.strictEqual(d.projectType, 'app');
    assert.deepStrictEqual(enabled(d), { Brainstorm: true, Analysis: true, Spec: true, Plan: true, Develop: false, 'Unit tests': false, 'Integration tests': false, 'End-to-end tests': false, Review: false });
    assert.strictEqual(d.steps.Develop.reason, 'design-no-code');
  }
});

test("npm's placeholder package.json is not code; a real one is", () => {
  const placeholder = { name: 'x', version: '1.0.0', scripts: { test: 'echo "Error: no test specified" && exit 1' } };
  assert.strictEqual(wd.detect(tree({ 'package.json': JSON.stringify(placeholder) })).phase, 'design');
  assert.strictEqual(wd.detect(tree({ 'package.json': JSON.stringify({ dependencies: { express: '^5' } }) })).phase, 'build');
});

test('a Node app: build phase; unit tests on; E2E only with a setup; integration only with integration tests', () => {
  const app = wd.detect(tree({ 'package.json': JSON.stringify({ dependencies: { express: '^5' }, scripts: { start: 'node src/index.js' } }), 'src/index.js': 'x' }));
  assert.strictEqual(app.phase, 'build');
  assert.deepStrictEqual(enabled(app), { Brainstorm: true, Analysis: true, Spec: true, Plan: true, Develop: true, 'Unit tests': true, 'Integration tests': false, 'End-to-end tests': false, Review: true });
  assert.strictEqual(app.steps['End-to-end tests'].reason, 'no-e2e-setup');

  const withE2e = wd.detect(tree({ 'src/app.ts': 'x', 'playwright.config.ts': 'x', 'tests/integration/api.test.ts': 'x', 'tests/unit/a.test.ts': 'x' }));
  assert.strictEqual(withE2e.steps['End-to-end tests'].enabled, true);
  assert.strictEqual(withE2e.steps['End-to-end tests'].reason, 'has-e2e-setup');
  assert.strictEqual(withE2e.steps['Integration tests'].enabled, true);
  assert.strictEqual(wd.detect(tree({ 'src/a.js': 'x', 'package.json': JSON.stringify({ devDependencies: { cypress: '^13' } }) })).steps['End-to-end tests'].enabled, true);
  assert.strictEqual(wd.detect(tree({ 'src/a.js': 'x', 'cypress/e2e/login.cy.js': 'x' })).signals.e2e, true);
});

test('test files are recognised across languages and not counted as source', () => {
  for (const [file, lang] of [['pkg/user_test.go', 'go'], ['tests/test_user.py', 'python'], ['src/UserTest.java', 'java'], ['spec/user_spec.rb', 'ruby'], ['src/__tests__/a.js', 'js']]) {
    const s = wd.scan(tree({ [file]: 'x' }));
    assert.strictEqual(s.unitTests, true, lang);
    assert.strictEqual(s.sourceFiles, 0, lang);
  }
});

test('infra: Terraform with little app code; unit tests only when tests exist', () => {
  const tf = wd.detect(tree({ 'main.tf': 'x', 'modules/vpc/main.tf': 'x', 'README.md': 'x' }));
  assert.strictEqual(tf.projectType, 'infra');
  assert.strictEqual(tf.phase, 'build');
  assert.deepStrictEqual([tf.steps.Develop.enabled, tf.steps['Unit tests'].enabled, tf.steps['Unit tests'].reason, tf.steps['End-to-end tests'].enabled], [true, false, 'infra-no-tests', false]);
  assert.strictEqual(wd.detect(tree({ 'main.tf': 'x', 'test/vpc_test.go': 'x' })).steps['Unit tests'].enabled, true);
});

test('data: dbt or notebooks → data type, data quality tests on', () => {
  for (const files of [{ 'dbt_project.yml': 'x', 'models/a.sql': 'x' }, { 'analysis/explore.ipynb': '{}' }, { 'dags/etl.py': 'x' }]) {
    const d = wd.detect(tree(files));
    assert.strictEqual(d.projectType, 'data', JSON.stringify(files));
    assert.deepStrictEqual([d.steps['Unit tests'].enabled, d.steps['Unit tests'].reason], [true, 'data-quality']);
  }
});

test('node_modules, .git, build output and hidden folders are never scanned; the scan is bounded', () => {
  const docs = tree({ 'README.md': 'x', 'node_modules/lib/index.js': 'x', '.git/hooks/pre-commit.py': 'x', 'dist/bundle.js': 'x', '.cache/a.js': 'x', '.spectoflow/lib/spec-drift.js': 'x' });
  assert.strictEqual(wd.detect(docs).phase, 'design');
  const deep = tree({ 'a/b/c/d/e/f/deep.js': 'x' });
  assert.strictEqual(wd.scan(deep).sourceFiles, 0, 'beyond the depth limit');
  const many = tree(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`docs/n${i}.md`, 'x'])));
  assert.strictEqual(wd.scan(many, { depth: 4, entries: 10 }).truncated, true);
});

test('suggest lists only the differences; applySteps rewrites only those checkboxes, user steps untouched', () => {
  const root = tree({ '.spectoflow/workflow.md': TEMPLATE.replace('- [x] Review {cap:quality skill:code-review}', '- [x] Review {cap:quality skill:code-review}\n- [x] My own step {cap:quality}\n- [ ] Security audit {cap:security skill:security-review policy}') });
  const before = fs.readFileSync(path.join(root, '.spectoflow', 'workflow.md'), 'utf8');
  const s = wd.suggest(root, { projectType: 'app' });
  assert.strictEqual(s.phase, 'design');
  assert.deepStrictEqual(s.changes, [
    { name: 'Develop', from: true, to: false, reason: 'design-no-code' },
    { name: 'Unit tests', from: true, to: false, reason: 'design-no-code' },
    { name: 'Review', from: true, to: false, reason: 'design-no-code' },
  ]);
  const changed = wd.applySteps(root, Object.fromEntries(s.changes.map((c) => [c.name, c.to])));
  assert.deepStrictEqual(changed, ['Develop', 'Unit tests', 'Review']);
  const after = fs.readFileSync(path.join(root, '.spectoflow', 'workflow.md'), 'utf8');
  assert.strictEqual(after, before.replace('- [x] Develop', '- [ ] Develop').replace('- [x] Unit tests', '- [ ] Unit tests').replace('- [x] Review', '- [ ] Review'));
  assert.ok(after.includes('- [x] My own step {cap:quality}') && after.includes('- [ ] Security audit'), 'user steps untouched');
  assert.deepStrictEqual(wd.suggest(root).changes, [], 'nothing left to suggest');
  assert.deepStrictEqual(wd.applySteps(root, { Develop: false }), [], 'already in that state: no write');
});

test('applySteps keeps CRLF line endings', () => {
  const root = tree({ '.spectoflow/workflow.md': TEMPLATE.replace(/\n/g, '\r\n') });
  wd.applySteps(root, { Develop: false });
  const after = fs.readFileSync(path.join(root, '.spectoflow', 'workflow.md'), 'utf8');
  assert.ok(after.includes('- [ ] Develop {cap:implementation skill:implement}\r\n'));
  assert.ok(!/[^\r]\n/.test(after), 'every line still CRLF');
});
