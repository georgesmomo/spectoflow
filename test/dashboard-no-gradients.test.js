'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.resolve(__dirname, '..', 'lib', 'dashboard', 'public');

// Family B (docs/dashboard-theme-redesign-design.md): gradient() used as a rendering TECHNIQUE with
// no visible color blend (a background pattern, an icon shape, a dashed-line texture, a hard
// two-color-stop pie-chart-style ring) — confirmed with the user, explicitly out of scope. Each entry
// is an exact, distinctive substring of the one line it allows; a gradient line matching none of its
// file's markers is a Family-A gradient that must not exist after this plan ships.
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

function gradientLines(file) {
  const text = fs.readFileSync(path.join(PUB, file), 'utf8');
  return text.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes('gradient('));
}

for (const file of Object.keys(ALLOWED)) {
  test(`${file}: every remaining gradient() is on the Family-B allow-list`, () => {
    const unexpected = gradientLines(file).filter(({ line }) =>
      !ALLOWED[file].some((marker) => line.includes(marker))
    );
    assert.deepStrictEqual(
      unexpected.map((u) => `${file}:${u.n}: ${u.line.trim()}`),
      [],
      'a gradient() call was found that is not on the Family-B allow-list — either it is a new ' +
      'Family-A color-blend gradient that must be converted to a flat fill (see docs/dashboard-' +
      'theme-redesign-design.md), or it is a genuine new rendering-technique use that needs a new ' +
      'allow-list entry above (only after confirming with a human it is not a visible color blend).'
    );
  });
}

test('every Family-B marker is still present exactly once (the allow-list itself stays accurate)', () => {
  for (const [file, markers] of Object.entries(ALLOWED)) {
    const lines = gradientLines(file);
    for (const marker of markers) {
      const matches = lines.filter(({ line }) => line.includes(marker));
      assert.strictEqual(matches.length, 1, `expected exactly one gradient() line containing "${marker}" in ${file}, found ${matches.length}`);
    }
  }
});
