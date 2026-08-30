'use strict';
// Pure SVG chart builders — no DOM, no fetch, just strings. Node-testable and
// browser-usable (UMD, same pattern as stats.js). Callers own colours (design
// tokens) and drop the returned markup straight into innerHTML.
(function (root) {
  // polar(cx,cy,r,deg) -> [x,y] on the circle, 0deg = top (12 o'clock), increasing clockwise.
  function polar(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
  }

  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const n2 = (v) => (Math.round(v * 100) / 100).toString();

  // donut(segs, opts) — segs=[{value,color,label}]. One <path> arc per non-zero
  // segment (zeros skipped), small gap between arcs, staggered draw via --i,
  // optional centre value/sub label.
  function donut(segs, opts) {
    opts = opts || {};
    segs = segs || [];
    const size = opts.size || 140;
    const stroke = opts.stroke || 16;
    const cx = size / 2, cy = size / 2;
    const r = (size - stroke) / 2;
    const gap = opts.gap != null ? opts.gap : 3; // degrees
    const total = segs.reduce((a, s) => a + (s.value || 0), 0);

    let angle = 0, i = 0, arcs = '';
    segs.forEach((s) => {
      const v = s.value || 0;
      if (!v) return;
      const sweep = total ? (v / total) * 360 : 0;
      const halfGap = sweep > gap ? gap / 2 : 0;
      const start = angle + halfGap;
      const end = angle + sweep - halfGap;
      const [x0, y0] = polar(cx, cy, r, start);
      const [x1, y1] = polar(cx, cy, r, end);
      const large = end - start > 180 ? 1 : 0;
      arcs += `<path d="M ${n2(x0)} ${n2(y0)} A ${n2(r)} ${n2(r)} 0 ${large} 1 ${n2(x1)} ${n2(y1)}" fill="none" stroke="${esc(s.color)}" stroke-width="${stroke}" stroke-linecap="round" class="seg-anim" style="--i:${i}"><title>${esc(s.label)}</title></path>`;
      angle += sweep;
      i++;
    });

    const center = opts.center != null
      ? `<text x="${cx}" y="${total ? cy - 2 : cy}" text-anchor="middle" dominant-baseline="middle" class="donut-total" style="fill:var(--ink)">${esc(opts.center)}</text>`
      : '';
    const sub = opts.sub
      ? `<text x="${cx}" y="${cy + 15}" text-anchor="middle" class="donut-sub" style="fill:var(--faint)">${esc(opts.sub)}</text>`
      : '';

    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="donut-svg">` +
      `<circle cx="${cx}" cy="${cy}" r="${n2(r)}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>` +
      arcs + center + sub +
      `</svg>`;
  }

  // area(series, labels, opts) — series=[{name,color,data:[...]}]. A 4-line
  // horizontal grid + y labels, one smoothed (Catmull-Rom) line + filled area
  // per series, dots + value labels, transparent per-x hover hit-rects, x labels.
  function smoothPath(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M ${n2(pts[0][0])} ${n2(pts[0][1])}`;
    let d = `M ${n2(pts[0][0])} ${n2(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${n2(c1x)} ${n2(c1y)}, ${n2(c2x)} ${n2(c2y)}, ${n2(p2[0])} ${n2(p2[1])}`;
    }
    return d;
  }

  function area(series, labels, opts) {
    opts = opts || {};
    series = series || [];
    labels = labels || [];
    const width = opts.width || 480;
    const height = opts.height || 180;
    const padL = opts.padLeft != null ? opts.padLeft : 32;
    const padR = opts.padRight != null ? opts.padRight : 10;
    const padT = opts.padTop != null ? opts.padTop : 10;
    const padB = opts.padBottom != null ? opts.padBottom : 22;
    const innerW = Math.max(0, width - padL - padR);
    const innerH = Math.max(0, height - padT - padB);

    const n = labels.length || series.reduce((a, s) => Math.max(a, (s.data || []).length), 0);
    const allVals = series.reduce((a, s) => a.concat(s.data || []), []);
    const dataMax = allVals.length ? Math.max.apply(null, allVals) : 0;
    const max = opts.max != null ? opts.max : Math.max(1, Math.ceil(dataMax));

    const x = (i) => (n > 1 ? padL + (innerW * i) / (n - 1) : padL + innerW / 2);
    const y = (v) => padT + innerH - (innerH * v) / max;
    const baseline = padT + innerH;

    // grid: 4 horizontal lines + y labels
    const steps = 4;
    let grid = '';
    for (let g = 0; g <= steps; g++) {
      const gy = padT + (innerH * g) / steps;
      const val = Math.round(max - (max * g) / steps);
      grid += `<line x1="${n2(padL)}" y1="${n2(gy)}" x2="${n2(padL + innerW)}" y2="${n2(gy)}" class="area-grid" stroke="var(--line)"/>`;
      grid += `<text x="${n2(padL - 8)}" y="${n2(gy + 3)}" text-anchor="end" class="area-ylabel" style="fill:var(--faint)">${val}</text>`;
    }

    let xlabels = '';
    labels.forEach((lb, i) => {
      xlabels += `<text x="${n2(x(i))}" y="${n2(height - 4)}" text-anchor="middle" class="area-xlabel" style="fill:var(--faint)">${esc(lb)}</text>`;
    });

    let seriesMarkup = '';
    series.forEach((s, si) => {
      const data = s.data || [];
      const pts = data.map((v, i) => [x(i), y(v)]);
      const linePath = smoothPath(pts);
      let fillPath = linePath;
      if (pts.length) {
        fillPath += ` L ${n2(pts[pts.length - 1][0])} ${n2(baseline)} L ${n2(pts[0][0])} ${n2(baseline)} Z`;
      }
      seriesMarkup += `<path d="${fillPath}" fill="${esc(s.color)}" fill-opacity="0.13" stroke="none" class="area-fill"/>`;
      seriesMarkup += `<path d="${linePath}" fill="none" stroke="${esc(s.color)}" stroke-width="2" class="area-line" pathLength="1" style="--i:${si}"/>`;
      pts.forEach((p, i) => {
        seriesMarkup += `<circle cx="${n2(p[0])}" cy="${n2(p[1])}" r="3" fill="${esc(s.color)}" class="area-dot"/>`;
        seriesMarkup += `<text x="${n2(p[0])}" y="${n2(p[1] - 8)}" text-anchor="middle" class="area-value" style="fill:var(--ink)">${esc(data[i])}</text>`;
      });
    });

    let tips = '';
    for (let i = 0; i < n; i++) {
      const cx = x(i);
      const w = n > 1 ? innerW / (n - 1) : innerW;
      tips += `<rect x="${n2(cx - w / 2)}" y="${n2(padT)}" width="${n2(w)}" height="${n2(innerH)}" fill="transparent" class="area-hit" data-tip="${esc(labels[i])}"/>`;
    }

    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="area-svg">` +
      `<g class="area-grid-g">${grid}</g>` +
      seriesMarkup +
      `<g class="area-xlabels">${xlabels}</g>` +
      `<g class="area-tips">${tips}</g>` +
      `</svg>`;
  }

  // bars(items, opts) — items=[{label,value,sub,color,suffix}]. Rows with a
  // track + .bar-fill (width via --w, staggered via --i) and a count-up span.
  function bars(items, opts) {
    opts = opts || {};
    items = items || [];
    if (!items.length) return `<div class="empty">${esc(opts.empty || 'No phases yet.')}</div>`;
    let rows = '';
    items.forEach((it, i) => {
      const pct = Math.max(0, Math.min(100, it.value || 0));
      const fillStyle = `width:${n2(pct)}%; --w:${n2(pct)}; --i:${i}` + (it.color ? `; background:${esc(it.color)}` : '');
      rows += `<div class="bar-row">` +
        `<div class="bar-head">` +
          `<span class="bar-label">${esc(it.label)}</span>` +
          `<span class="bar-sub">${esc(it.sub || '')}</span>` +
          `<span class="bar-count" data-count="${it.value || 0}">0${esc(it.suffix || '')}</span>` +
        `</div>` +
        `<div class="bar-track"><div class="bar-fill" style="${fillStyle}"></div></div>` +
        `</div>`;
    });
    return `<div class="bars">${rows}</div>`;
  }

  // ring(pct, opts) — a progress ring: track circle + foreground arc via
  // stroke-dasharray/offset (stroke="url(#grad)" — caller provides the
  // <linearGradient id="grad"> once), centre pct% text.
  function ring(pct, opts) {
    opts = opts || {};
    pct = Math.max(0, Math.min(100, pct || 0));
    const size = opts.size || 72;
    const stroke = opts.stroke || 7;
    const cx = size / 2, cy = size / 2;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - pct / 100);
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring-svg">` +
      `<circle cx="${cx}" cy="${cy}" r="${n2(r)}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${n2(r)}" fill="none" stroke="${opts.stroke2 || 'url(#grad)'}" stroke-width="${stroke}" stroke-linecap="round" ` +
        `stroke-dasharray="${n2(c)}" stroke-dashoffset="${n2(offset)}" transform="rotate(-90 ${cx} ${cy})"/>` +
      `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" class="ring-label" style="fill:var(--ink)">${pct}%</text>` +
      `</svg>`;
  }

  const api = { polar, donut, area, bars, ring };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpectoCharts = api;
})(typeof window !== 'undefined' ? window : globalThis);
