# Dashboard Theme Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every color-blend CSS gradient from the spectoflow dashboard's 6 designs, replace
motion that used to fade between colors with a flat fill + translucent white sweep, fix a repeated
"AI-safe" typography tell (Space Grotesk), and lock the result in place with a permanent regression
test.

**Architecture:** This is a pure CSS/font content change to the dashboard's client-side assets under
`lib/dashboard/public/` — no server, API, or CLI logic is touched. Work test-first: write the
regression test against the *current* (unfixed) code so it fails, listing every gradient line that
isn't on the Family-B allow-list; then convert each Family-A line one file at a time, watching the
test's failure list shrink to nothing.

**Tech Stack:** Plain CSS (custom properties / design tokens already established in this codebase),
self-hosted `.woff2` web fonts, `node --test` for the regression test. No new dependencies.

**Spec:** `docs/dashboard-theme-redesign-design.md` (binding authority — read it in full; it names
the exact selectors, exact before/after values, and the two visual decisions the user approved via
the brainstorming skill's visual companion).

## Global Constraints

- **Zero CSS gradients that visibly blend two colors, anywhere in `lib/dashboard/public/`.** The
  spec's "Family B" list (6 exact selectors, all confirmed *not* a visible blend) is the only
  allowed exception, and it is closed — no new gradient may be added anywhere without a human
  deliberately updating the regression test's allow-list.
- The replacement pattern is **flat `var(--signal)` fill**, plus — only where the original animated
  — a **translucent white sweep** (`rgba(255,255,255,.35–.5)`, opacity/position only, never a second
  hue). This exact pattern, not a per-implementer reinterpretation.
- **Zero runtime dependencies** — self-hosted fonts only, same `@font-face` pattern already used for
  Sora/Space Grotesk/JetBrains Mono/IBM Plex Sans.
- Everything in English, code comments included.
- No other existing test may regress — this plan touches no server/API/CLI code, so the full
  `npm test` suite must stay exactly as green as it is today.
- `docs/DECISIONS.md` and `CLAUDE.md`'s "What exists" narrative are written by the controller
  personally (French for DECISIONS, matching every prior sub-project in this repo) — a task leaves
  an exact placeholder marker for each, never real prose.

---

### Task 1: The gradient regression test (written first, against the *unfixed* code)

**Files:**
- Create: `test/dashboard-no-gradients.test.js`

**Interfaces:**
- Produces: a `node --test` file with no exports — this is the regression gate every later task
  narrows toward green. It reads three files directly as plain text (no `require`, since CSS isn't a
  Node module): `lib/dashboard/public/styles.css`, `lib/dashboard/public/designs/console.css`,
  `lib/dashboard/public/designs/orbit.css`.

- [ ] **Step 1: Write the test**

```js
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
  path.join('designs', 'console.css'): [
    'var(--cx-grid) 1px, transparent 1px), linear-gradient(90deg, var(--cx-grid)', // background grid pattern
  ],
  path.join('designs', 'orbit.css'): [
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
```

- [ ] **Step 2: Run it to see the real, current failure**

Run: `node --test test/dashboard-no-gradients.test.js`
Expected: FAIL. The first test's `deepStrictEqual` reports an array of 8 unexpected lines in
`styles.css` (`:25` `.brand-mark`, `:47` `.progress-meter-fill`, `:162` `.bar-fill`, `:196`
`.phase-bar-fill`, `:373` `.wf-arrow::after`, `:637` `.wf-conn`, `:750` `.wf-rail::before`, `:1009`
`.hub-card-progress-fill`), 1 in `designs/console.css` (`:171` `.wf-link.on` design override), and 2
in `designs/orbit.css` (`:80` `.wf-arrow::after`, `:81` `.wf-conn`) — 11 lines total, matching the
spec's Family-A inventory exactly. The second test passes already (the Family-B markers are
untouched by anything in this plan).

- [ ] **Step 3: Commit**

```bash
git add test/dashboard-no-gradients.test.js
git commit -m "test(dashboard): regression gate — no gradient() outside the Family-B allow-list

Currently failing (expected): 11 Family-A color-blend gradients still exist. Tasks 2-4 convert
them one file at a time; this test's failure list narrows to empty as each is fixed."
```

---

### Task 2: Convert `styles.css` — the 8 shared Family-A selectors

**Files:**
- Modify: `lib/dashboard/public/styles.css`
- Test: `test/dashboard-no-gradients.test.js` (already written; this task should narrow its
  `styles.css` failure list to empty)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `styles.css` has zero remaining Family-A `gradient(` lines. Every other design's own
  file (console.css, orbit.css) still overrides some of these selectors — those overrides are
  Task 3/4's job, not this one's.

- [ ] **Step 1: Delete `.brand-mark`** (dead CSS — confirmed unreferenced by any `.html`/`.js` under
  `lib/dashboard/public/`)

Find and delete this exact line (currently line 25):
```css
.brand-mark { width:16px; height:16px; border-radius:4px; background:conic-gradient(from 210deg,var(--signal),var(--cool),var(--signal)); box-shadow:0 0 0 1px var(--line) inset; flex-shrink:0; }
```

- [ ] **Step 2: Flat fill for `.progress-meter-fill`, `.bar-fill`, `.phase-bar-fill`,
  `.hub-card-progress-fill`, `.wf-rail::before`**

Five straightforward two-color-to-flat conversions. Find and replace each:

```css
.progress-meter-fill { height:100%; width:0%; background:linear-gradient(90deg,var(--cool),var(--signal)); border-radius:999px; transition:width .5s ease; }
```
→
```css
.progress-meter-fill { height:100%; width:0%; background:var(--signal); border-radius:999px; transition:width .5s ease; }
```

```css
.bar-fill { height:100%; background:linear-gradient(90deg,var(--cool),var(--signal)); border-radius:999px; transition:width .5s ease; }
```
→
```css
.bar-fill { height:100%; background:var(--signal); border-radius:999px; transition:width .5s ease; }
```

```css
.phase-bar-fill { height:100%; background:linear-gradient(90deg,var(--cool),var(--signal)); border-radius:999px; transition:width .4s ease; }
```
→
```css
.phase-bar-fill { height:100%; background:var(--signal); border-radius:999px; transition:width .4s ease; }
```

```css
.hub-card-progress-fill { height:100%; background:linear-gradient(90deg,var(--cool),var(--signal)); border-radius:999px; transition:width .4s ease; }
```
→
```css
.hub-card-progress-fill { height:100%; background:var(--signal); border-radius:999px; transition:width .4s ease; }
```

```css
.wf-step.on .wf-rail::before { background:linear-gradient(var(--signal),color-mix(in srgb,var(--signal) 55%,var(--cool))); }
```
→
```css
.wf-step.on .wf-rail::before { background:var(--signal); }
```

(The pre-existing `:root[data-design="mission"] .progress-meter-fill, .phase-bar-fill, .bar-fill {
background:var(--signal); }` override at lines 937-939 is now redundant but harmless — leave it
exactly as-is, do not remove it in this task.)

- [ ] **Step 3: Flat fill + white sweep for `.wf-arrow::after`**

Find:
```css
.wf-arrow { width:34px; height:2px; position:relative; background:var(--line); margin:0 2px; overflow:hidden; }
.wf-arrow::after { content:""; position:absolute; inset:0; width:40%; background:linear-gradient(90deg,transparent,var(--signal),transparent); animation:flow 2.2s linear infinite; }
.wf-arrow.off::after { display:none; }
```
Replace with:
```css
.wf-arrow { width:34px; height:2px; position:relative; background:var(--line); margin:0 2px; overflow:hidden; }
.wf-arrow:not(.off) { background:var(--signal); }
.wf-arrow::after { content:""; position:absolute; inset:0; width:35%; background:rgba(255,255,255,.4); animation:flow 2.2s linear infinite; }
.wf-arrow.off::after { display:none; }
```

(`:not(.off)` is new: previously the arrow's own base color stayed `var(--line)` at all times and
the *fade itself* carried the signal color from transparent→signal→transparent; now that the sweep
is colorless, an enabled arrow needs its own flat `var(--signal)` fill. `.wf-arrow` already toggles
an `.off` class today via existing JS — this is a pure CSS negation of that same class, so it
requires no JS change at all.)

- [ ] **Step 4: Flat fill + white sweep for `.wf-conn`**

Find:
```css
.wf-conn { flex:0 0 auto; align-self:center; width:26px; height:2px; background:linear-gradient(90deg,var(--cool),var(--signal)); margin:0 2px; border-radius:2px; }
.wf-conn.off { background:var(--line); }
```
Replace with:
```css
.wf-conn { flex:0 0 auto; align-self:center; width:26px; height:2px; background:var(--signal); margin:0 2px; border-radius:2px; position:relative; overflow:hidden; }
.wf-conn::after { content:""; position:absolute; inset:0; width:35%; background:rgba(255,255,255,.4); animation:flow 2.2s linear infinite; }
.wf-conn.off { background:var(--line); }
.wf-conn.off::after { display:none; }
```

- [ ] **Step 5: Run the regression test**

Run: `node --test test/dashboard-no-gradients.test.js`
Expected: the `styles.css` sub-test now PASSES (0 unexpected lines); the `designs/console.css` and
`designs/orbit.css` sub-tests still FAIL (unchanged — Tasks 3/4's job).

- [ ] **Step 6: Run the full existing suite to confirm nothing else broke**

Run: `npm test`
Expected: identical pass count to before this task (CSS-only change, no server/CLI/API touched).

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/public/styles.css
git commit -m "fix(dashboard): styles.css — flat signal fill + white sweep, no more color-blend gradients

Removes the dead .brand-mark rule; converts .progress-meter-fill, .bar-fill, .phase-bar-fill,
.hub-card-progress-fill, .wf-rail::before to a flat var(--signal) fill; converts .wf-arrow::after
and .wf-conn to the same flat fill plus a translucent white sweep in place of the old
transparent-to-signal color fade. See docs/dashboard-theme-redesign-design.md."
```

---

### Task 3: Convert `designs/console.css` — `.wf-link.on`

**Files:**
- Modify: `lib/dashboard/public/designs/console.css`
- Test: `test/dashboard-no-gradients.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `designs/console.css` has zero remaining Family-A `gradient(` lines.

- [ ] **Step 1: Flat fill for the design-specific `.wf-link.on` override**

Find (currently line 171):
```css
html[data-design="console"] .wf-link.on { background:linear-gradient(90deg,color-mix(in srgb,var(--signal) 55%,var(--line)),var(--line)); }
```
Replace with:
```css
html[data-design="console"] .wf-link.on { background:var(--signal); }
```

Leave everything else in this file untouched — in particular, the particle-dot animation right
below it (`.wf-link.on::after`, `.wf-strip .wf-arrow:not(.off)::after`, the `@keyframes cx-travel`
block) is a solid-colored `--cool` dot, not a gradient, and is not part of this plan.

- [ ] **Step 2: Run the regression test**

Run: `node --test test/dashboard-no-gradients.test.js`
Expected: the `designs/console.css` sub-test now PASSES; `designs/orbit.css` still fails (Task 4).

- [ ] **Step 3: Run the full existing suite**

Run: `npm test`
Expected: same pass count as after Task 2.

- [ ] **Step 4: Commit**

```bash
git add lib/dashboard/public/designs/console.css
git commit -m "fix(dashboard): console.css — flat signal fill for .wf-link.on, no more color fade"
```

---

### Task 4: Convert `designs/orbit.css` — `.wf-arrow::after` and `.wf-conn`

**Files:**
- Modify: `lib/dashboard/public/designs/orbit.css`
- Test: `test/dashboard-no-gradients.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `designs/orbit.css` has zero remaining Family-A `gradient(` lines. This is the last
  Family-A file — after this task, `test/dashboard-no-gradients.test.js` is fully green.

- [ ] **Step 1: `.wf-arrow::after` — same flat-fill + white-sweep pattern as the base rule**

Find (currently line 80):
```css
html[data-design="orbit"] .wf-arrow::after { background:linear-gradient(90deg,transparent,var(--signal),transparent); }
```
Replace with:
```css
html[data-design="orbit"] .wf-arrow::after { background:rgba(255,255,255,.4); }
```

- [ ] **Step 2: `.wf-conn` — flat fill ONLY, no sweep (the one deliberate exception, per spec)**

Find (currently line 81):
```css
html[data-design="orbit"] .wf-conn { position:relative; overflow:hidden; background:linear-gradient(90deg,var(--cool),var(--signal)); }
```
Replace with:
```css
html[data-design="orbit"] .wf-conn { position:relative; overflow:hidden; background:var(--signal); }
```

Do **not** add a `::after` sweep here — Orbit already layers its own solid traveling dot particle on
top (`html[data-design="orbit"] .wf-conn::after` at the lines right below this one, using
`@keyframes ob-flow` — untouched, still solid `var(--signal)` with a glow `box-shadow`). Adding the
base-rule sweep on top of Orbit's own particle would stack two motion effects on the same element —
the spec calls this out explicitly as the one place to deliberately not apply the general pattern.

- [ ] **Step 3: Run the regression test — should be fully green now**

Run: `node --test test/dashboard-no-gradients.test.js`
Expected: **every** sub-test passes (all 3 files' Family-A lists are empty; the Family-B
allow-list-accuracy test still passes).

- [ ] **Step 4: Run the full existing suite**

Run: `npm test`
Expected: same pass count as before Task 2 started — confirms this whole gradient-removal effort
introduced zero regressions anywhere else in the codebase.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/public/designs/orbit.css
git commit -m "fix(dashboard): orbit.css — flat signal fill for .wf-arrow/.wf-conn, no more color fade

.wf-conn deliberately gets no white-sweep overlay (Orbit already has its own solid traveling dot
particle on this element) — see docs/dashboard-theme-redesign-design.md's documented exception.

All Family-A gradients removed project-wide; test/dashboard-no-gradients.test.js is fully green."
```

---

### Task 5: Typography — Bricolage Grotesque replaces Space Grotesk (and fills the gap on Control Room / Mission Control)

**Files:**
- Create: `lib/dashboard/public/fonts/bricolage-grotesque-400.woff2`
- Create: `lib/dashboard/public/fonts/bricolage-grotesque-600.woff2`
- Create: `lib/dashboard/public/fonts/bricolage-grotesque-700.woff2`
- Modify: `lib/dashboard/public/styles.css`
- Modify: `lib/dashboard/public/designs/orbit.css`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of Tasks 1-4; can run in parallel in principle,
  but this plan executes tasks in order).
- Produces: `--display` resolves to `'Bricolage Grotesque'` for Orbit, Neon Command, Control Room,
  and Mission Control; the `Space Grotesk` `@font-face` declarations and font files are gone.

- [ ] **Step 1: Download the three real font files** (verified working URLs — genuine, distinct
  woff2 binaries per weight, confirmed via their `wOF2` magic bytes before writing this plan; latin
  subset only, matching every other self-hosted font in this project)

```bash
cd lib/dashboard/public/fonts
curl -s -o bricolage-grotesque-400.woff2 "https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9U6as8bTXq_nANBjzKo3IeZx8z6up5BeSl5jBNz_19PpbpMXuECpwUxJBOm_OJWiaaD30YfKfjZZoLvRvi-Molsg.woff2"
curl -s -o bricolage-grotesque-600.woff2 "https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9U6as8bTXq_nANBjzKo3IeZx8z6up5BeSl5jBNz_19PpbpMXuECpwUxJBOm_OJWiaaD30YfKfjZZoLvcXl-Molsg.woff2"
curl -s -o bricolage-grotesque-700.woff2 "https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9U6as8bTXq_nANBjzKo3IeZx8z6up5BeSl5jBNz_19PpbpMXuECpwUxJBOm_OJWiaaD30YfKfjZZoLvfzl-Molsg.woff2"
cd ../../../..
```

Verify each is a genuine woff2 file (starts with the 4-byte magic `wOF2`, hex `774f4632`) and that
all three are distinct files (different byte sizes — a real per-weight static instance, not the same
file copy-pasted three times):
```bash
for f in lib/dashboard/public/fonts/bricolage-grotesque-*.woff2; do
  echo "$f: $(wc -c < "$f") bytes, magic $(head -c4 "$f" | xxd -p)"
done
```
Expected: three different byte counts (roughly 22-23KB each), all magic `774f4632`. If either check
fails for any file (wrong magic, or all three identical in size), the download did not get a real
distinct static instance — stop and report rather than proceeding with a broken/duplicate font file.

- [ ] **Step 2: Add the three `@font-face` blocks and remove the three `Space Grotesk` ones**

In `lib/dashboard/public/styles.css`, find the existing `Space Grotesk` block (currently lines
874-876):
```css
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:400;font-display:swap;src:url(fonts/space-grotesk-400.woff2) format('woff2');}
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:500;font-display:swap;src:url(fonts/space-grotesk-500.woff2) format('woff2');}
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:700;font-display:swap;src:url(fonts/space-grotesk-700.woff2) format('woff2');}
```
Replace with:
```css
@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-weight:400;font-display:swap;src:url(fonts/bricolage-grotesque-400.woff2) format('woff2');}
@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-weight:600;font-display:swap;src:url(fonts/bricolage-grotesque-600.woff2) format('woff2');}
@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-weight:700;font-display:swap;src:url(fonts/bricolage-grotesque-700.woff2) format('woff2');}
```

- [ ] **Step 3: Delete the now-unused Space Grotesk font files**

First confirm nothing still references the family name (should print nothing after Step 2 and
Step 4-6 below are all done — run this check only after finishing Step 6, not before):
```bash
grep -rn "Space Grotesk" lib/dashboard/public/
```
Once that grep is empty, delete the files:
```bash
rm lib/dashboard/public/fonts/space-grotesk-400.woff2 lib/dashboard/public/fonts/space-grotesk-500.woff2 lib/dashboard/public/fonts/space-grotesk-700.woff2
```

- [ ] **Step 4: Wire `--display` into Orbit**

In `lib/dashboard/public/designs/orbit.css`, find:
```css
  --sans:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif;
  --display:'Space Grotesk',ui-sans-serif,system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
```
Replace with:
```css
  --sans:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif;
  --display:'Bricolage Grotesque',ui-sans-serif,system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
```

- [ ] **Step 5: Wire `--display` into Neon Command (in `styles.css`)**

Find:
```css
  --sans:'Sora', system-ui, sans-serif; --display:'Space Grotesk', system-ui, sans-serif;
```
Replace with:
```css
  --sans:'Sora', system-ui, sans-serif; --display:'Bricolage Grotesque', system-ui, sans-serif;
```

- [ ] **Step 6: Add `--display` fresh to Control Room and Mission Control (both currently have none)**

`data-design` is *always* present on `<html>` (`index.html:2` hard-codes `data-design="console"`,
and `app.js`'s `applyDesign(id)` always calls `setAttribute('data-design', id)`, including for
`id:'control-room'` when the user picks it — confirmed by reading both files directly). There is no
`:root[data-design="control-room"]` block anywhere in `styles.css` — Control Room's entire identity
(palette, radius, shadow, and now typography) comes from whatever the bare, un-scoped `:root {}`
block says, and nothing more specific ever overrides it for this one design (every other design's
own attribute-selector block *is* more specific and wins there instead). So Control Room's display
face is set simply by editing the bare block's own `--display` line directly — no new selector, no
`:not(...)` trick needed.

In `lib/dashboard/public/styles.css`, the bare `:root {}` block (currently lines 4-14) contains:
```css
  --display: var(--sans);   /* headings / big numbers — designs may swap in a display face */
```
Replace with:
```css
  --display: 'Bricolage Grotesque', var(--sans);   /* Control Room's own display face; every other design overrides this in its own block */
```

For Mission Control, find (currently lines 928-933):
```css
:root[data-design="mission"] {
  --bg:#1b1e24; --surface:#262a33; --surface-2:#2d323d; --line:#353b46;
  --ink:#e9ebf0; --muted:#9aa2af; --faint:#6b7280;
  --signal:#5b6cff; --cool:#22d3ee; --on-accent:#ffffff;
  --s-todo:#6b7280; --s-in_progress:#f59e0b; --s-to_validate:#ec4899; --s-to_analyze:#a855f7; --s-done:#22c55e; --s-blocked:#ef4444;
  --radius:14px; --shadow:0 10px 30px rgba(0,0,0,.4);
}
```
Replace with:
```css
:root[data-design="mission"] {
  --bg:#1b1e24; --surface:#262a33; --surface-2:#2d323d; --line:#353b46;
  --ink:#e9ebf0; --muted:#9aa2af; --faint:#6b7280;
  --signal:#5b6cff; --cool:#22d3ee; --on-accent:#ffffff;
  --s-todo:#6b7280; --s-in_progress:#f59e0b; --s-to_validate:#ec4899; --s-to_analyze:#a855f7; --s-done:#22c55e; --s-blocked:#ef4444;
  --radius:14px; --shadow:0 10px 30px rgba(0,0,0,.4);
  --display:'Bricolage Grotesque', system-ui, sans-serif;
}
```

- [ ] **Step 7: Run the full existing suite**

Run: `npm test`
Expected: same pass count as after Task 4 (font/token-only change, no logic touched).

- [ ] **Step 8: Manual smoke check — confirm the font actually loads**

Start the hub on a scratch home (`SPECTOFLOW_HOME=<tmp> SPECTOFLOW_PORT=4399 node
lib/dashboard/hub-server.js`), open a project's board, switch the design to Orbit via Personalize,
inspect a KPI number's computed `font-family` in devtools (or take a screenshot) — confirm it reads
`Bricolage Grotesque`, not falling back to `system-ui`. Repeat for Neon Command, Mission Control, and
Control Room.

- [ ] **Step 9: Commit**

```bash
git add lib/dashboard/public/fonts/bricolage-grotesque-400.woff2 \
        lib/dashboard/public/fonts/bricolage-grotesque-600.woff2 \
        lib/dashboard/public/fonts/bricolage-grotesque-700.woff2 \
        lib/dashboard/public/styles.css \
        lib/dashboard/public/designs/orbit.css
git rm lib/dashboard/public/fonts/space-grotesk-400.woff2 \
       lib/dashboard/public/fonts/space-grotesk-500.woff2 \
       lib/dashboard/public/fonts/space-grotesk-700.woff2
git commit -m "feat(dashboard): Bricolage Grotesque replaces Space Grotesk (Orbit, Neon Command),
fills the missing display-face gap on Control Room and Mission Control

Space Grotesk is named in this project's own design guidance as one of the most recognizable
'AI-safe' typographic tells; two of six designs shared it. Self-hosted, same @font-face pattern as
every other font here. See docs/dashboard-theme-redesign-design.md."
```

---

### Task 6: Real browser QA, versioning, DECISIONS/CLAUDE.md controller markers

**Files:**
- Modify: `package.json` (version only)
- Modify: `docs/DECISIONS.md` (controller-only placeholder marker, not committed by this task)
- Modify: `CLAUDE.md` (controller-only placeholder marker, not committed by this task)

**Interfaces:**
- Consumes: the fully green `test/dashboard-no-gradients.test.js` from Tasks 1-4, and the font swap
  from Task 5.
- Produces: nothing further downstream — this is the last task.

- [ ] **Step 1: Real browser QA across all 12 combinations**

This is the "très poussé" QA the user asked for — do not skip or abbreviate it. For each of the 6
designs (`console`, `orbit`, `control-room`, `obsidian`, `neon-command`, `mission`) × both
`[data-theme]` values (`dark`, `light`) = 12 combinations, using a headless-Chrome screenshot pass
(or the Chrome browser tool if available) against a real project's dashboard:

1. Board tab — confirm the KPI progress bars/rings render a flat `--signal` fill (not a two-tone
   fade), with no visual artifact where the old gradient used to sit.
2. Workflow tab — open the pipeline view, confirm the connectors between enabled steps show the
   flat fill + white sweep animation (or, for Orbit's `.wf-conn`, flat fill + its own existing dot
   particle, no double motion); confirm the popover's vertical rail (`.wf-rail`) shows a flat active
   color.
3. Hub landing page — confirm each project card's progress bar is a flat fill.
4. Confirm `Bricolage Grotesque` genuinely renders (not a system-font fallback) on Orbit, Neon
   Command, Mission Control, and Control Room — Console (Sora) and Obsidian Ops (JetBrains Mono) are
   unaffected and should look exactly as before.
5. Confirm the topbar's small `#globalMeterFill` percentage meter (next to the brand name) is a
   flat fill on every design.
6. Confirm nothing regressed elsewhere by eye — this touched shared, `!design-scoped` CSS rules
   (`.bar-fill` etc.) used by every design, so a mistake in Task 2 would show up on ALL 6 designs at
   once, not just one.

Record the outcome (pass/fail per combination, any screenshot evidence) in this task's completion —
if a subagent is executing this plan, it reports what it found; a genuine visual defect found here
is a real bug to fix before this task can complete, not something to wave through.

- [ ] **Step 2: Confirm no other test regressed, one final time**

Run: `npm test`
Expected: identical pass/fail/skip counts to the baseline recorded before Task 1 started.

- [ ] **Step 3: Bump the version**

In `package.json`, change:
```json
  "version": "0.25.0",
```
to:
```json
  "version": "0.26.0",
```
(Minor, not patch — this changes the rendered look of every one of the dashboard's 6 designs at
once, plus a typography change spanning 4 of them; matches how this repo has versioned every prior
sub-project's user-visible dashboard change.)

- [ ] **Step 4: Leave the controller-only documentation markers** (do NOT write real prose — these
  two files' "What exists"/DECISIONS narrative is written by the controller personally, in French for
  DECISIONS, after implementation — matching the exact pattern this repo's previous sub-project
  (C1) used for its own final task)

Append to `docs/DECISIONS.md` (find the end of the D65 entry and append right after it):
```markdown
<!-- CONTROLLER: write D66 here (French), summarizing sub-project D — dashboard theme cleanup,
zero color-blend gradients — per the repo's existing DECISIONS entry style (see D65 for the shape:
what existed before, what changed, why, what was verified). Remove this marker once written. -->
```

Append to `CLAUDE.md`, right after the `## What exists (v0.25.0 — see DECISIONS D65)` section's
last paragraph (before the next `## What exists` heading):
```markdown
<!-- CONTROLLER: add a "## What exists (v0.26.0 — see DECISIONS D66)" section here, in this file's
own established voice/format (see the v0.25.0 section just above for the shape), describing sub-
project D: the gradient-to-flat-fill/white-sweep cleanup across all 6 designs, and the Bricolage
Grotesque typography fix. Remove this marker once written. -->
```

These two edits are made to the working tree but **NOT staged or committed** by this task — same
convention as the previous sub-project's final task (the controller commits them together with the
real D66 write-up afterward).

- [ ] **Step 5: Commit the version bump only**

```bash
git add package.json
git commit -m "chore: spectoflow 0.26.0 — dashboard theme cleanup (sub-project D)"
```

---

## Self-Review

**1. Spec coverage** — every requirement in `docs/dashboard-theme-redesign-design.md` maps to a task:
Goal 1 (zero Family-A gradients) → Tasks 1-4 (test-first, then the 11 conversions across 3 files).
Goal 2 (the flat-fill + white-sweep replacement language, including the documented `.wf-conn`
Orbit exception) → Task 2 Steps 3-4, Task 4 Steps 1-2. Goal 3 (Bricolage Grotesque) → Task 5. Goal 4
(`.brand-mark` removal) → Task 2 Step 1. Goal 5 (durable regression test) → Task 1, exercised again by
every later task. The spec's Testing § "no other existing test should be affected" → every task's own
`npm test` step. The spec's Versioning § → Task 6 Steps 3-4. The spec's "What this deliberately does
not attempt" (full redesign fallback) is explicitly out of scope for this plan — nothing to implement,
correctly absent from every task.

**2. Placeholder scan** — no TBD/TODO in any step; every code block is complete, real code (the
Bricolage Grotesque download URLs are genuine, tested working URLs, not a stand-in). Task 5 Step 6's
Control Room fix was verified directly while writing this plan — read `index.html`, `app.js`, and
`styles.css` together, confirmed `data-design` is always set (never absent), confirmed no
`:root[data-design="control-room"]` block exists, and confirmed the bare `:root{}` block is
therefore genuinely what Control Room renders through — no open question was left in the step.

**3. Type/interface consistency** — the regression test's `ALLOWED` map (Task 1) uses file-relative
keys (`'styles.css'`, `path.join('designs','console.css')`, `path.join('designs','orbit.css')`) and
every later task's file paths match those exactly. The CSS selector names used in Task 2's `.wf-arrow`
fix (`.wf-arrow:not(.off)`) and Task 4's Orbit fix reference the exact same underlying `.wf-arrow`/
`.wf-conn`/`.off` class vocabulary already used throughout the existing codebase (confirmed by reading
the current file content directly before writing this plan, not assumed). `--signal`/`--cool`/
`--display` are the project's existing, established custom-property names — no new token name is
invented anywhere in this plan.
