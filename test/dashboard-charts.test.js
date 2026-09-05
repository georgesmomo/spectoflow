'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../lib/dashboard/public/charts');

test('donut builds one arc path per non-zero segment with a centre label', () => {
  const svg = C.donut([{ value: 1, color: '#a', label: 'A' }, { value: 1, color: '#b', label: 'B' }], { center: '2', sub: 'TASKS' });
  assert.strictEqual((svg.match(/<path /g) || []).length, 2);
  assert.match(svg, /2/); assert.match(svg, /TASKS/);
});
test('donut skips zero-value segments', () => {
  const svg = C.donut([{ value: 3, color: '#a' }, { value: 0, color: '#b' }]);
  assert.strictEqual((svg.match(/<path /g) || []).length, 1);
});
test('area builds a smoothed line + filled area per series with grid', () => {
  const svg = C.area([{ name: 'scope', color: '#a', data: [5, 5, 6] }, { name: 'done', color: '#b', data: [0, 2, 3] }], ['d1', 'd2', 'd3']);
  assert.match(svg, /class="area-line"/);
  assert.match(svg, /class="area-fill"/);
  assert.ok((svg.match(/ C /g) || []).length >= 1, 'has bezier smoothing');
  assert.match(svg, /pathLength="1"/);
});
test('ring encodes the pct in the arc dash', () => {
  const svg = C.ring(50);
  assert.match(svg, /50/);
});
test('polar returns [x,y] on the circle', () => {
  const [x, y] = C.polar(50, 50, 40, 0);
  assert.ok(Math.abs(x - 50) < 1 && Math.abs(y - 10) < 1); // 0° = top
});
