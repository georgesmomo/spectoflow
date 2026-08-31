'use strict';
/*
 * spec-drift — a small, ZERO-DEPENDENCY helper for the spec-source-guardian.
 *
 * It computes deterministic, ADVISORY signals about source-of-truth drift between the spec (intent)
 * and the code/tests (reality). It never edits anything and never blocks — natural-language specs
 * can't be auto-synced safely, so this only *flags* divergence for a human (or the guardian agent)
 * to judge. That is the honest, spec-anchored stance: the spec stays the intent of record, the code
 * and tests stay the enforced reality, and a guardian keeps them from silently drifting apart.
 *
 * Pure, unit-tested functions: classifyChange(paths), coverageSignals({specs, plans}).
 * CLI: `node spec-drift.js` — inspects the git working tree + specs/plans and prints signals, and
 * emits `::spectoflow attention msg=…` lines that the dashboard turns into Attention items.
 */

const CODE_EXT = /\.(js|jsx|ts|tsx|py|go|rs|java|rb|php|c|cc|cpp|h|hpp|cs|kt|swift|scala|sql|sh)$/i;
const isSpec = (p) => /(^|\/)specs?\//.test(p);
const isPlan = (p) => /(^|\/)plans?\//.test(p);
const isFramework = (p) => /(^|\/)\.spectoflow\//.test(p);
const isTest = (p) => (/(^|[._-])(test|spec|e2e)s?([._-]|\/|$)/i.test(p) || /(^|\/)(tests?|__tests__)\//i.test(p)) && !isSpec(p) && !isPlan(p);
const isCode = (p) => CODE_EXT.test(p) && !isFramework(p) && !isTest(p);

// Advisory drift signals for the set of paths changed in one unit of work → [{level, msg}].
function classifyChange(paths) {
  const list = (paths || []).map(String);
  const has = (fn) => list.some(fn);
  const codeOrTest = has((p) => (isCode(p) || isTest(p)) && !isSpec(p) && !isPlan(p) && !isFramework(p));
  const specOrPlan = has((p) => isSpec(p) || isPlan(p));
  const out = [];
  if (codeOrTest && !specOrPlan)
    out.push({ level: 'warn', msg: 'code/tests changed but no specs/ or plans/ file was updated — confirm the spec still matches, or update it.' });
  if (has(isSpec) && !has(isCode) && !has(isTest))
    out.push({ level: 'info', msg: 'a spec changed but no code/tests followed — make sure a plan task and tests carry the new intent.' });
  return out;
}

// Coverage signals from the presence of spec/plan markdown files (not their content) → [{level, msg}].
function coverageSignals({ specs, plans } = {}) {
  const s = (specs || []).length, p = (plans || []).length;
  const out = [];
  if (p > 0 && s === 0)
    out.push({ level: 'warn', msg: 'plans/ has work but specs/ is empty — the plan has no spec to trace back to (source of truth missing).' });
  if (s > 0 && p === 0)
    out.push({ level: 'info', msg: 'specs/ exists but plans/ is empty — the spec is not yet broken into traceable, testable tasks.' });
  return out;
}

module.exports = { classifyChange, coverageSignals, isCode, isTest, isSpec, isPlan };

// ---- CLI ------------------------------------------------------------------
if (require.main === module) {
  const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
  const root = process.cwd();
  let changed = [];
  try {
    changed = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8' })
      .split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  } catch {}
  const ls = (d) => { try { return fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.md')); } catch { return []; } };
  const signals = [...classifyChange(changed), ...coverageSignals({ specs: ls('specs'), plans: ls('plans') })];
  if (!signals.length) { console.log('spec-drift: no source-of-truth signals — spec and reality look aligned.'); process.exit(0); }
  console.log('spec-drift — advisory source-of-truth signals (judge, do not auto-apply):');
  for (const s of signals) {
    console.log(`  [${s.level}] ${s.msg}`);
    console.log(`::spectoflow attention msg=Source-of-truth: ${s.msg}`);
  }
  process.exit(0);
}
