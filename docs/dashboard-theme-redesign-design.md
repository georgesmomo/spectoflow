# Dashboard theme cleanup — zero color-blend gradients (sub-project D) — design

**Status:** approved by user, section-by-section, 2026-09-06 (visual choices made with the
brainstorming skill's visual companion). Implementation via `writing-plans`.

## Program context

The "one dashboard, many projects" program (`docs/dashboard-separation-design.md`, table at the
top) has four sub-projects: **A** dashboard separation (shipped, v0.24.0, D64), **B** smart add,
**C** online dashboard (**C1** shipped, v0.25.0, D65 — relay + connector; C2/C3/C4 still to come),
**D** theme redesign (this document). D was deliberately scheduled right after C1 so that C2/C3's
future screens are drawn on the final look, per the user's own decomposition.

The user's original request, verbatim, from C's brainstorming: *"Pour l'occasion on doit revoir
tous les themes, et surtout sur les themes je ne veux plus aucun degradé, absolument aucun, ça fait
trop IA."* Confirmed in this session's own brainstorming: the scope is a **thorough, targeted
cleanup** of the existing 6 designs — not a ground-up visual reinvention of each — with the explicit
fallback that if real testing after this pass shows it isn't enough, a full redesign follows as a
separate iteration. A persistent memory (`no-gradients-in-ui.md`) already records the zero-gradient
rule for this repo.

## Problem — the actual inventory (not a guess)

The dashboard has 6 selectable designs (`lib/dashboard/public/designs.js`): **Console/Spectral**
(default, own files: `designs/console.css`+`.js`), **Orbit** (own files: `designs/orbit.css`+`.js`),
and four token-only designs living as scoped blocks directly inside the shared `styles.css`:
**Control Room** (the un-scoped bare `:root{}` — the original palette, still selectable, no
`data-design` override block of its own), **Obsidian Ops**, **Neon Command**, **Mission Control**.
Every design has a light and dark mode (`[data-theme]`), so there are 12 rendered combinations.

A full grep of every CSS file under `lib/dashboard/public/` (and a check of every `.js` file for
JS-injected/canvas gradients — none found) turned up **17 uses of a CSS `gradient()` function**,
across `styles.css` (11), `designs/console.css` (2), `designs/orbit.css` (4). They split cleanly
into two families, confirmed with the user:

- **Family A — genuine color blends** (what "ça fait trop IA" means, and what this sub-project
  removes): a fill or line that visibly fades from one color to another. **11 instances**, all
  listed in Design § below.
- **Family B — rendering techniques with no visible blend** (explicitly **out of scope**, confirmed
  with the user): `gradient()` used as a CSS trick to draw something else — a background grid-line
  pattern (`designs/console.css`), a background dot-texture pattern (`designs/orbit.css`), a
  select-element's chevron arrow (`styles.css` `.brand-mini-select`), the light/dark theme-toggle
  icon's moon/sun shape (`styles.css` `.theme-ico`), the active workflow link's dashed-line texture
  (`styles.css` `.wf-link.on`'s base rule — a `repeating-linear-gradient` alternating solid/transparent
  to fake a dashed line, no two colors blended), and Orbit's circular progress ring
  (`designs/orbit.css` `.ob-hub`, a **hard two-color-stop** `conic-gradient` — functionally a CSS
  pie/donut chart, identical in spirit to `stroke-dasharray` on an SVG circle, not a blend). **6
  instances.** None of these render a visible color fade; none are touched.

One additional finding, confirmed with the user and resolved (not a design question): `.brand-mark`
(`styles.css:25`, a 16px conic-gradient swoosh) is **dead CSS** — grepped every `.html`/`.js` file
under `lib/dashboard/public/`, it is never referenced in any markup. The real spectoflow logo is the
`logo-dark.png`/`logo-white.png` image pair already used via `<img class="brand-logo-img">`. This
rule is deleted, not redesigned.

A second finding, also confirmed and in scope: **Orbit and Neon Command both use `Space Grotesk`**
as their display/heading typeface — a font explicitly named in this project's own design guidance as
one of the most recognizable "AI-safe" typographic tells. Control Room and Mission Control have no
distinct display face at all (they fall back to the body sans-serif). The user chose **Bricolage
Grotesque** (self-hosted, matching this project's existing zero-dependency/offline-capable font
policy) as the replacement/addition for all four.

## Goals

1. Zero Family-A gradients anywhere in `lib/dashboard/public/` — verified by an automated regression
   test, not just a one-time sweep.
2. A single, consistent **replacement language** for every removed color-blend, chosen with the user
   via the visual companion (see Design §): a flat, on-brand fill, plus — wherever the original had
   *motion* (an animated flowing highlight) — a translucent white "sweep" (opacity-based, not a
   second color) crossing the same element, so nothing that used to feel alive goes fully static.
3. Bricolage Grotesque as the shared display typeface for Orbit, Neon Command, Control Room, and
   Mission Control (Console keeps Sora; Obsidian Ops keeps JetBrains Mono — both already distinct,
   non-generic choices, untouched).
4. Remove the dead `.brand-mark` rule.
5. A real regression test (grep-based, allow-listing the exact Family-B selectors) so a future PR
   can't silently reintroduce a Family-A gradient without a reviewer noticing, and so this sub-project
   itself can prove its own completeness.

## Non-goals (explicitly deferred)

- A ground-up visual reinvention of any design's palette, layout, or component structure — the
  fallback path if this pass proves insufficient after the user's own real-world testing, but a
  **separate future iteration**, not part of this plan.
- Family B gradients (grid/dot background patterns, the select chevron, the theme-toggle icon
  shape, Orbit's hard-stop progress ring) — explicitly confirmed out of scope.
- Any change to designs the user didn't ask about beyond the gradient/typography fixes found in the
  audit above (no unrelated refactoring).
- Sub-projects B, C2, C3, C4 — untouched.

## Design

### 1. The replacement language — confirmed with the visual companion

Two decisions, made by the user looking at real mockups in the palette of the affected designs
(Console's ambre/cyan shown as the concrete example; the same principle applies with each design's
own `--signal`/`--cool` tokens):

- **Static fills** (progress bars/rings, connector lines, the vertical rail): replace the two-color
  `linear-gradient(90deg, var(--cool), var(--signal))` (or equivalent) with a **flat `var(--signal)`
  fill**.
- **Animated elements** (the "flow" highlight that used to fade transparent→signal→transparent
  while traveling; the connector's own moving highlight): keep the flat fill from above, and layer a
  **translucent white sweep** on top — `rgba(255,255,255,.35–.5)` traveling across the element via a
  `left`/`transform` keyframe animation, opacity/brightness only, never a second hue. This is one
  visual idea (a passing highlight, not a color transition) applied uniformly everywhere motion
  existed before.

Concretely, this pattern (fill color + optional traveling `rgba(255,255,255,…)` sweep, in a
`::after` or nested div, `overflow:hidden` on the parent) replaces every Family-A gradient. Two
elements already had a separate, solid-colored "traveling particle" animation layered *on top of* the
fading background (Console's `.wf-link.on::after` dot, Orbit's `.wf-conn::after` dot) — those
particles are already solid, already fine, and are **not touched**; only the faded background
underneath them becomes a flat fill.

### 2. Exact file-by-file changes (Family A — the only files touched for gradients)

**`lib/dashboard/public/styles.css`** (shared, affects every design that doesn't override it):
- `:25` `.brand-mark` — **delete the whole rule** (dead CSS, confirmed unused).
- `:47` `.progress-meter-fill` — the small global "% delivered" meter next to the brand name in the
  topbar (`index.html`'s `#globalMeterFill`) — same change as `.bar-fill` below.
- `:162` `.bar-fill` — `background:linear-gradient(90deg,var(--cool),var(--signal))` →
  `background:var(--signal)`.
- `:196` `.phase-bar-fill` — same change (now redundant with, but harmless alongside, the existing
  Mission-specific override at `:938-939` which already does exactly this — see below).
- `:373` `.wf-arrow::after` — becomes the flat-fill + white-sweep pattern (§1) instead of the
  transparent→signal→transparent fade; keep the same `animation` timing/easing feel, change only
  what's animating (opacity/position of a white layer, not a color fade).
- `:637` `.wf-conn` — becomes the same flat-fill + white-sweep pattern as `.wf-arrow::after` above
  (this is the exact element the visual-companion mockup showed, in Console's own palette, when the
  user chose the sweep — Console itself has no `.wf-conn` override of its own, so the base rule is
  what Console, Control Room, Obsidian Ops, Neon Command, and Mission Control all actually render).
- `:750` `.wf-step.on .wf-rail::before` — `linear-gradient(var(--signal),color-mix(in srgb,var(--signal)
  55%,var(--cool)))` → flat `var(--signal)`.
- `:1009` `.hub-card-progress-fill` — same as `.bar-fill`.
- `:937-939` (`:root[data-design="mission"] .progress-meter-fill, .phase-bar-fill, .bar-fill {
  background:var(--signal); }`) — **no change needed**; Mission already overrides all three to a
  flat fill (this independently validates the chosen direction). Left as a harmless, now-redundant
  override — removing it is optional cleanup, not required.

**`lib/dashboard/public/designs/console.css`**:
- `:171` `html[data-design="console"] .wf-link.on` — `linear-gradient(90deg,color-mix(in srgb,
  var(--signal) 55%,var(--line)),var(--line))` → flat `var(--signal)` (the particle dot animation at
  `:172-176` is untouched — it already sits on top as a separate `::after`).

**`lib/dashboard/public/designs/orbit.css`**:
- `:80` `html[data-design="orbit"] .wf-arrow::after` — same flat-fill + white-sweep pattern as the
  base rule above.
- `:81` `html[data-design="orbit"] .wf-conn` — **flat `var(--signal)` fill only, no sweep** — this is
  the one deliberate exception to the general pattern: Orbit already layers its own solid traveling
  dot particle on top (`:82-85`, untouched), so adding the white sweep as well would stack two motion
  effects on the same element. Confirmed during the real browser QA pass (Testing §) that the base
  rule's sweep + Console's own `.wf-strip .wf-arrow` particle (a *different*, narrower-scoped
  override that doesn't replace the base `.wf-arrow::after` used by the full Workflow-tab pipeline)
  don't clash the same way — if QA finds they do, drop the base sweep specifically inside
  `.wf-strip`, not project-wide.

That is the complete Family-A list — 11 lines across 3 files: 10 gradient→flat/sweep conversions
(`.progress-meter-fill`, `.bar-fill`, `.phase-bar-fill`, `.wf-arrow::after`×2, `.wf-conn`×2,
`.wf-rail::before`, `.hub-card-progress-fill`, `.wf-link.on` in console.css) plus `.brand-mark`'s
unrelated deletion.

### 3. Typography — Bricolage Grotesque

- Self-host the variable font (matching the existing `@font-face` pattern for Sora/Space
  Grotesk/JetBrains Mono/IBM Plex Sans already in `styles.css`): download the woff2 weight(s) this
  project actually uses (400/600/700, matching the visual-companion mockup), add
  `fonts/bricolage-grotesque-400.woff2` etc. and matching `@font-face` blocks.
- `designs/orbit.css`'s `--display:'Space Grotesk',ui-sans-serif,system-ui,sans-serif` →
  `--display:'Bricolage Grotesque',ui-sans-serif,system-ui,sans-serif`.
- `styles.css:900` (Neon Command's `--display:'Space Grotesk', system-ui, sans-serif`) →
  `--display:'Bricolage Grotesque', system-ui, sans-serif`.
- Control Room (bare `:root`) and Mission Control (`:root[data-design="mission"]`) currently have no
  `--display` override of their own (both inherit `--display:var(--sans)` from the base `:root` at
  `styles.css:13`) — add `--display:'Bricolage Grotesque', system-ui, sans-serif` to each design's own
  token block.
- Remove the now-unused `Space Grotesk` `@font-face` declarations and its `.woff2` font files
  (`fonts/space-grotesk-*.woff2`) once nothing references the family name any more — confirm via a
  full-repo grep before deleting.

### 4. Testing

- **Automated regression** (new): a small `node --test` file scanning every `.css` file under
  `lib/dashboard/public/` for `gradient(` and asserting each remaining match is one of the 6
  Family-B selectors named above (an explicit allow-list keyed by file+selector snippet, so a
  *new* gradient anywhere — including a new design added later — fails the test unless a human
  deliberately adds it to the allow-list). This is the test that makes Goal 5 durable, not just true
  today.
- **Real browser QA** (manual, per the user's "très poussé" ask): screenshot all 12 combinations
  (6 designs × light/dark) — the Board (progress bars visible), the Workflow tab (connectors +
  popover rail), and the hub landing page (card progress bars) — confirming the flat fills and
  sweep animation read correctly and that Bricolage Grotesque renders (not falling back to system
  font) on all four designs that now use it.
- **No other existing test should be affected** — this sub-project touches only CSS/font files, no
  server logic, no API, no CLI. The existing `node --test` suite must stay fully green.

### 5. Versioning

`spectoflow` version bump (patch or minor, whichever the actual diff size justifies at
implementation time — likely a minor given the shared token/typography change spans every design);
`docs/DECISIONS.md` entry (French, written by the controller, not by an implementation task) once
shipped.

## What this deliberately does not attempt

If, after the user's own real use of the cleaned-up designs, the "ça fait trop IA" feeling persists
even without literal gradients (a palette, layout, or component-level issue rather than a rendering
technique), the next step is a genuine ground-up redesign of the 6 designs — a new brainstorming
pass, scoped and approved separately, not an extension of this plan.
