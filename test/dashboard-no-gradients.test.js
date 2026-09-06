'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.resolve(__dirname, '..', 'lib', 'dashboard', 'public');

// Family B (docs/dashboard-theme-redesign-design.md): gradient() used as a rendering TECHNIQUE with
// no visible color blend (a background pattern, an icon shape, a dashed-line texture, a hard
// two-color-stop pie-chart-style ring) — confirmed with the user, explicitly out of scope. Each entry
// is an exact, distinctive substring of the one line it allows; a matching line in its file that hits
// none of its markers is a Family-A gradient (or a stray inline SVG gradient def) that must not exist
// after this plan ships. Keyed by path relative to PUB, so it applies uniformly whether the file was
// one of the originally-hardcoded 3 or any other file under the tree (new files get zero allowance —
// any match in a file with no entry here is automatically "unexpected").
const ALLOWED = {
  'styles.css': [
    'currentColor 50%',                                    // .brand-mini-select — select chevron arrow
    'circle at 32% 32%',                                    // .theme-ico — light/dark toggle icon shape
    'repeating-linear-gradient(90deg, color-mix',           // .wf-link.on base rule — dashed-line texture
  ],
  [path.join('designs', 'console.css')]: [
    'var(--cx-grid) 1px, transparent 1px), linear-gradient(90deg, var(--cx-grid)', // background grid pattern
  ],
  [path.join('designs', 'orbit.css')]: [
    'var(--ob-dot) 1.2px',   // background dot-texture pattern
    'var(--ob-pct',          // .ob-hub — hard two-color-stop conic-gradient progress ring
  ],
};

// Files whose extension we scan: CSS gradient() calls (linear-gradient/radial-gradient/conic-gradient/
// repeating-*), plus JS string literals containing "gradient(", plus inline SVG gradient defs that can
// hide in an .html file (invisible to a CSS-only scanner — this is exactly how a real Family-A gradient
// slipped through earlier in this sub-project, as an SVG <linearGradient> in index.html referenced by a
// stroke="url(#grad)" in a .js file).
const SCAN_EXTENSIONS = new Set(['.css', '.html', '.js']);
const MARKERS_ANY = ['gradient(', '<linearGradient', '<radialGradient', '<conicGradient'];

// Recursively list every file under `dir` (subdirectories like designs/, fonts/ included).
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// Every scannable file under lib/dashboard/public/, as paths relative to PUB.
function scannableFiles() {
  return walk(PUB)
    .filter((full) => SCAN_EXTENSIONS.has(path.extname(full)))
    .map((full) => path.relative(PUB, full))
    .sort();
}

// Every line in `relFile` that contains a gradient() call or an inline SVG gradient def.
function matchingLines(relFile) {
  const text = fs.readFileSync(path.join(PUB, relFile), 'utf8');
  return text.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => MARKERS_ANY.some((marker) => line.includes(marker)));
}

for (const relFile of scannableFiles()) {
  test(`${relFile}: every gradient()/SVG-gradient line is on the Family-B allow-list`, () => {
    const allow = ALLOWED[relFile] || [];
    const unexpected = matchingLines(relFile).filter(({ line }) =>
      !allow.some((marker) => line.includes(marker))
    );
    assert.deepStrictEqual(
      unexpected.map((u) => `${relFile}:${u.n}: ${u.line.trim()}`),
      [],
      'a gradient()/inline-SVG-gradient line was found that is not on the Family-B allow-list — ' +
      'either it is a new Family-A color-blend gradient that must be converted to a flat fill (see ' +
      'docs/dashboard-theme-redesign-design.md), or it is a genuine new rendering-technique use that ' +
      'needs a new allow-list entry above (only after confirming with a human it is not a visible ' +
      'color blend).'
    );
  });
}

test('every Family-B marker is still present exactly once (the allow-list itself stays accurate)', () => {
  for (const [file, markers] of Object.entries(ALLOWED)) {
    const lines = matchingLines(file);
    for (const marker of markers) {
      const matches = lines.filter(({ line }) => line.includes(marker));
      assert.strictEqual(matches.length, 1, `expected exactly one gradient()/SVG-gradient line containing "${marker}" in ${file}, found ${matches.length}`);
    }
  }
});
