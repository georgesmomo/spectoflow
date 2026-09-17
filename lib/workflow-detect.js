'use strict';
/*
 * Fits the workflow to the project (docs/workflow-autoconfig-design.md, DECISIONS D75). A deterministic,
 * zero-dependency look at the files: is there code yet (phase: design or build), what kind of project it is
 * (app / infra / data), and which test setups already exist. From that, which of the kit's workflow steps
 * make sense now — each decision with a reason code. `init` applies it to a freshly copied workflow.md;
 * `spectoflow workflow suggest` and the dashboard's Workflow tab offer it for an existing project. Steps
 * the user added themselves are never touched. The agent refines this with the user (it can tell a
 * prototype from a product; a file scan can't).
 */
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.spectoflow', 'vendor', 'dist', 'build', 'target', '.venv', 'venv', '__pycache__', 'coverage', '.next', '.nuxt', 'out']);
const CODE_EXT = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.cs', '.rb', '.php', '.swift', '.c', '.cpp', '.h', '.vue', '.svelte', '.dart', '.scala', '.ex', '.exs']);
const MANIFESTS = new Set(['pyproject.toml', 'setup.py', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json', 'pubspec.yaml', 'mix.exs']);
const INFRA_FILES = new Set(['Pulumi.yaml', 'Chart.yaml', 'kustomization.yaml', 'ansible.cfg']);
const TEST_DIRS = new Set(['test', 'tests', '__tests__']);
const E2E_DEPS = ['@playwright/test', 'playwright', 'cypress', 'puppeteer'];
const LIMITS = { depth: 4, entries: 5000 };

const isTestFile = (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || /_test\.(go|py)$/.test(name) || /^test_.*\.py$/.test(name) || /Tests?\.(java|kt|cs)$/.test(name) || /_spec\.rb$/.test(name);

function readPackageJson(fp, s) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts || {};
  const realScripts = Object.entries(scripts).filter(([k, v]) => !(k === 'test' && /no test specified/.test(String(v))));
  if (Object.keys(deps).length || realScripts.length) s.manifests.push(fp);
  if (scripts.test && !/no test specified/.test(String(scripts.test))) s.unitTests = true;
  if (E2E_DEPS.some((d) => deps[d])) s.e2e = true;
}

// → { sourceFiles, manifests, unitTests, e2e, integration, infra, data, truncated }
function scan(root, limits = LIMITS) {
  const s = { sourceFiles: 0, manifests: [], unitTests: false, e2e: false, integration: false, infra: false, data: false, truncated: false };
  let seen = 0;
  const walk = (dir, depth, dirs) => {
    if (s.truncated) return;
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (++seen > limits.entries) { s.truncated = true; return; }
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.') || depth >= limits.depth) continue;
        walk(fp, depth + 1, [...dirs, e.name]);
        continue;
      }
      if (!e.isFile()) continue;
      const name = e.name, ext = path.extname(name).toLowerCase();
      if (name === 'package.json') readPackageJson(fp, s);
      else if (MANIFESTS.has(name) || ext === '.csproj') s.manifests.push(fp);
      if (/^(playwright|cypress)\.config\.[cm]?[jt]s$/.test(name) || name === 'cypress.json') s.e2e = true;
      if (ext === '.tf' || INFRA_FILES.has(name)) s.infra = true;
      if (name === 'dbt_project.yml' || ext === '.ipynb' || (ext === '.py' && dirs.includes('dags'))) s.data = true;
      if (!CODE_EXT.has(ext)) continue;
      const underTests = dirs.some((d) => TEST_DIRS.has(d));
      if (dirs.includes('e2e') || dirs.includes('cypress')) { s.e2e = true; continue; }
      if (underTests && dirs.includes('integration')) { s.integration = true; continue; }
      if (underTests || isTestFile(name)) { s.unitTests = true; continue; }
      s.sourceFiles++;
    }
  };
  walk(root, 0, []);
  return s;
}

const STEPS = ['Brainstorm', 'Analysis', 'Spec', 'Plan', 'Develop', 'Unit tests', 'Integration tests', 'End-to-end tests', 'Review'];

// → { projectType, phase, signals, steps: { <name>: { enabled, reason } } }
function detect(root, limits) {
  const signals = scan(root, limits);
  const hasCode = signals.sourceFiles > 0 || signals.manifests.length > 0 || signals.unitTests || signals.infra || signals.data;
  const projectType = signals.infra && signals.sourceFiles < 10 ? 'infra' : signals.data ? 'data' : 'app';
  const phase = hasCode ? 'build' : 'design';
  const on = (reason) => ({ enabled: true, reason }), off = (reason) => ({ enabled: false, reason });
  const steps = { Brainstorm: on('always'), Analysis: on('always'), Spec: on('always'), Plan: on('always') };
  if (phase === 'design') {
    for (const n of ['Develop', 'Unit tests', 'Integration tests', 'End-to-end tests', 'Review']) steps[n] = off('design-no-code');
  } else {
    steps.Develop = on('has-code');
    steps.Review = on('has-code');
    steps['Unit tests'] = projectType === 'infra' ? (signals.unitTests ? on('has-tests') : off('infra-no-tests'))
      : projectType === 'data' ? on('data-quality') : on('has-code');
    steps['Integration tests'] = signals.integration ? on('has-integration-tests') : off('no-integration-tests');
    steps['End-to-end tests'] = projectType === 'app' && signals.e2e ? on('has-e2e-setup') : off('no-e2e-setup');
  }
  return { projectType, phase, signals, steps };
}

// The step's name as store.readWorkflow() reports it: annotation stripped first, then "(optional)".
function stepName(rest) {
  const ann = rest.match(/\{([^}]*)\}\s*$/);
  if (ann) rest = rest.slice(0, ann.index).trim();
  return rest.replace(/\s*\(optional\)\s*$/i, '').trim();
}
const LINE_RE = /^(\s*- \[)( |x|X)(\]\s+)(.*?)(\r?)$/;

function workflowPath(root) { return path.join(root, '.spectoflow', 'workflow.md'); }

// Current state of the steps detection knows about → [{ name, enabled }] in file order.
function currentSteps(root) {
  let text;
  try { text = fs.readFileSync(workflowPath(root), 'utf8'); } catch { return []; }
  return text.split('\n').map((l) => l.match(LINE_RE)).filter(Boolean).map((m) => ({ name: stepName(m[4]), enabled: m[2].trim() !== '' }));
}

// What re-analysis would change → { projectType, phase, currentType, changes: [{ name, from, to, reason }] }
function suggest(root, { projectType: currentType, limits } = {}) {
  const d = detect(root, limits);
  const changes = currentSteps(root)
    .filter((s) => d.steps[s.name] && d.steps[s.name].enabled !== s.enabled)
    .map((s) => ({ name: s.name, from: s.enabled, to: d.steps[s.name].enabled, reason: d.steps[s.name].reason }));
  return { projectType: d.projectType, phase: d.phase, currentType: currentType || null, changes, truncated: d.signals.truncated };
}

// Set the checkbox of each named step to `target[name]` (true/false). Only those lines change, byte for
// byte otherwise. → names actually changed.
function applySteps(root, target) {
  const fp = workflowPath(root);
  const lines = fs.readFileSync(fp, 'utf8').split('\n');
  const changed = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE_RE);
    if (!m) continue;
    const name = stepName(m[4]);
    if (!Object.prototype.hasOwnProperty.call(target, name)) continue;
    const want = target[name] ? 'x' : ' ';
    if ((m[2].trim() ? 'x' : ' ') === want) continue;
    lines[i] = m[1] + want + m[3] + m[4] + m[5];
    if (!changed.includes(name)) changed.push(name);
  }
  if (changed.length) fs.writeFileSync(fp, lines.join('\n'));
  return changed;
}

const REASONS = {
  always: 'always useful',
  'design-no-code': 'no code yet',
  'has-code': 'the project has code',
  'has-tests': 'the project has tests',
  'infra-no-tests': 'infrastructure project with no tests',
  'data-quality': 'data project — data quality tests',
  'has-integration-tests': 'integration tests exist',
  'no-integration-tests': 'no integration tests yet',
  'has-e2e-setup': 'an end-to-end test setup exists',
  'no-e2e-setup': 'no end-to-end test setup',
};

module.exports = { scan, detect, suggest, applySteps, currentSteps, STEPS, REASONS, LIMITS };
