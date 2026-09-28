// Hand-built SVG charts following the dataviz rules: thin marks, 4px rounded data-ends,
// 2px lines, hairline grid, legend for 2+ series, selective direct labels, and a
// tooltip/crosshair on hover, tap and keyboard focus. Text uses text tokens, never series colour.

import { MONTHS, fmtCompact, round2 } from './core.js';

const NS = 'http://www.w3.org/2000/svg';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
/** A bar whose top corners are rounded (4px) and whose base sits square on the baseline. */
function barPath(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
}
function el(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
  if (text != null) n.textContent = text;
  return n;
}
function tipRow(color, value, label) {
  const r = document.createElement('div'); r.className = 't-r';
  const i = document.createElement('i'); i.style.background = color;
  const b = document.createElement('b'); b.textContent = value;
  const s = document.createElement('span'); s.textContent = label;
  r.append(i, b, s);
  return r;
}
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/**
 * In vs out per month. data: [{ label, tin, tout }] in display currency.
 * fmt(n) formats a value for labels and the tooltip.
 */
export function inOutColumns(host, data, fmt, cur) {
  host.innerHTML = '';
  host.classList.add('chart');
  const W = Math.max(280, Math.round(host.clientWidth || 640)), H = W < 420 ? 210 : 240, padL = 40, padR = 6, padT = 26, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.tin, d.tout))));
  const band = plotW / data.length, bw = Math.min(24, (band - 18) / 2), gap = 2;
  const cIn = css('--in'), cOut = css('--out');
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Money in and out for the last ' + data.length + ' months' });
  for (let i = 0; i <= 4; i++) {                                         // hairline grid + clean ticks
    const v = (max / 4) * i, y = padT + plotH - (v / max) * plotH;
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: i === 0 ? 'axis' : 'gridline' }));
    svg.appendChild(el('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end' }, fmtCompact(v, cur)));
  }
  const tip = document.createElement('div'); tip.className = 'tip';
  const groups = data.map((d, i) => {
    const cx = padL + band * i + band / 2;
    const g = el('g', { class: 'mark', tabindex: '0', role: 'button', 'aria-label': d.label + ': in ' + fmt(d.tin) + ', out ' + fmt(d.tout) });
    const hIn = (d.tin / max) * plotH, hOut = (d.tout / max) * plotH;
    g.appendChild(el('path', { d: barPath(cx - bw - gap / 2, padT + plotH - hIn, bw, hIn, 4), fill: cIn }));
    g.appendChild(el('path', { d: barPath(cx + gap / 2, padT + plotH - hOut, bw, hOut, 4), fill: cOut }));
    g.appendChild(el('rect', { x: padL + band * i, y: padT, width: band, height: plotH, class: 'hit' }));
    svg.appendChild(g);
    svg.appendChild(el('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, d.label));
    return { g, d, cx, top: padT + plotH - Math.max(hIn, hOut) };
  });
  // Direct labels only on the latest month.
  const last = groups[groups.length - 1];
  if (last && (last.d.tin || last.d.tout)) {
    const t = el('text', { x: last.cx, y: Math.max(12, last.top - 8), 'text-anchor': 'middle', style: 'fill:var(--text-2);font-weight:650' }, 'net ' + fmt(last.d.tin - last.d.tout));
    svg.appendChild(t);
  }
  host.appendChild(svg);
  host.appendChild(tip);
  const show = (o) => {
    host.classList.add('hovering');
    groups.forEach((x) => x.g.classList.toggle('on', x === o));
    tip.innerHTML = '';
    const h = document.createElement('div'); h.className = 't-h'; h.textContent = o.d.full || o.d.label;
    tip.append(h, tipRow(cIn, fmt(o.d.tin), 'in'), tipRow(cOut, fmt(o.d.tout), 'out'), tipRow('transparent', fmt(o.d.tin - o.d.tout), 'net'));
    const rect = host.getBoundingClientRect(), sx = rect.width / W;
    tip.style.left = Math.min(rect.width - 70, Math.max(70, o.cx * sx)) + 'px';
    tip.style.top = Math.max(40, o.top * sx) + 'px';
    tip.classList.add('on');
  };
  const hide = () => { host.classList.remove('hovering'); groups.forEach((x) => x.g.classList.remove('on')); tip.classList.remove('on'); };
  groups.forEach((o) => {
    o.g.addEventListener('pointerenter', () => show(o));
    o.g.addEventListener('pointerdown', () => show(o));
    o.g.addEventListener('focus', () => show(o));
    o.g.addEventListener('blur', hide);
  });
  svg.addEventListener('pointerleave', hide);
}

/**
 * Running spend through the month vs last month, with an optional budget line.
 * cur/prev: arrays of cumulative values per day (null = future). All in display currency.
 */
export function paceLines(host, cur, prev, budget, fmt, curCode, monthLabel, prevLabel) {
  host.innerHTML = '';
  host.classList.add('chart');
  const W = Math.max(280, Math.round(host.clientWidth || 640)), H = W < 420 ? 190 : 220, padL = 40, padR = 52, padT = 16, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const days = Math.max(cur.length, prev.length);
  const vals = cur.concat(prev).filter((v) => v != null);
  const max = niceMax(Math.max(1, budget || 0, ...vals));
  const x = (i) => padL + (days <= 1 ? 0 : (i / (days - 1)) * plotW);
  const y = (v) => padT + plotH - (v / max) * plotH;
  const cAcc = css('--accent'), cPrev = css('--text-3'), cWarn = css('--warn');
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Spending through ' + monthLabel + ' compared with ' + prevLabel });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: i === 0 ? 'axis' : 'gridline' }));
    svg.appendChild(el('text', { x: padL - 8, y: yy + 4, 'text-anchor': 'end' }, fmtCompact(v, curCode)));
  }
  [1, Math.ceil(days / 2), days].forEach((d) => svg.appendChild(el('text', { x: x(d - 1), y: H - 6, 'text-anchor': d === 1 ? 'start' : d === days ? 'end' : 'middle' }, String(d))));
  if (budget > 0) {                                                       // budget reference
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(budget), y2: y(budget), stroke: cWarn, 'stroke-width': 1.5 }));
    svg.appendChild(el('text', { x: W - padR + 6, y: y(budget) + 4, style: 'fill:var(--text-2);font-weight:650' }, 'Budget'));
  }
  const pathOf = (arr) => arr.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  const prevD = pathOf(prev);
  if (prevD) svg.appendChild(el('path', { d: prevD, fill: 'none', stroke: cPrev, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.7 }));
  const curPts = cur.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
  if (curPts.length) {
    const d = curPts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
    svg.appendChild(el('path', { d: d + 'L' + curPts[curPts.length - 1][0].toFixed(1) + ',' + y(0) + 'L' + curPts[0][0].toFixed(1) + ',' + y(0) + 'Z', fill: cAcc, opacity: 0.1 }));
    svg.appendChild(el('path', { d, fill: 'none', stroke: cAcc, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const end = curPts[curPts.length - 1];
    svg.appendChild(el('circle', { cx: end[0], cy: end[1], r: 5, fill: cAcc, stroke: css('--surface'), 'stroke-width': 2 }));
    svg.appendChild(el('text', { x: Math.min(end[0] + 9, W - padR + 2), y: end[1] - 9, style: 'fill:var(--text);font-weight:700' }, fmt(cur[curPts.length - 1])));
  }
  const cross = el('line', { y1: padT, y2: padT + plotH, class: 'crosshair', opacity: 0 });
  const dotC = el('circle', { r: 4.5, fill: cAcc, stroke: css('--surface'), 'stroke-width': 2, opacity: 0 });
  const dotP = el('circle', { r: 4.5, fill: cPrev, stroke: css('--surface'), 'stroke-width': 2, opacity: 0 });
  svg.append(cross, dotC, dotP);
  const hit = el('rect', { x: padL, y: padT, width: plotW, height: plotH, class: 'hit', tabindex: '0', 'aria-label': 'Explore spending by day' });
  svg.appendChild(hit);
  host.appendChild(svg);
  const tip = document.createElement('div'); tip.className = 'tip'; host.appendChild(tip);
  let focusDay = days - 1;
  const showDay = (i) => {
    i = Math.max(0, Math.min(days - 1, i)); focusDay = i;
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
    const cv = cur[i], pv = prev[i];
    if (cv != null) { dotC.setAttribute('cx', x(i)); dotC.setAttribute('cy', y(cv)); dotC.setAttribute('opacity', 1); } else dotC.setAttribute('opacity', 0);
    if (pv != null) { dotP.setAttribute('cx', x(i)); dotP.setAttribute('cy', y(pv)); dotP.setAttribute('opacity', 1); } else dotP.setAttribute('opacity', 0);
    tip.innerHTML = '';
    const h = document.createElement('div'); h.className = 't-h'; h.textContent = 'Day ' + (i + 1);
    tip.append(h);
    tip.append(tipRow(cAcc, cv == null ? '—' : fmt(cv), monthLabel));
    tip.append(tipRow(cPrev, pv == null ? '—' : fmt(pv), prevLabel));
    const rect = host.getBoundingClientRect(), sx = rect.width / W;
    tip.style.left = Math.min(rect.width - 80, Math.max(80, x(i) * sx)) + 'px';
    tip.style.top = Math.max(44, (padT + 8) * sx) + 'px';
    tip.classList.add('on');
  };
  const hide = () => { cross.setAttribute('opacity', 0); dotC.setAttribute('opacity', 0); dotP.setAttribute('opacity', 0); tip.classList.remove('on'); };
  const fromEvent = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    return Math.round(((px - padL) / plotW) * (days - 1));
  };
  hit.addEventListener('pointermove', (e) => showDay(fromEvent(e)));
  hit.addEventListener('pointerdown', (e) => showDay(fromEvent(e)));
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => showDay(focusDay));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); showDay(focusDay - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); showDay(focusDay + 1); }
  });
}

/** Month label helpers for charts. */
export const shortMonth = (m) => MONTHS[m];
export const roundDisplay = round2;
