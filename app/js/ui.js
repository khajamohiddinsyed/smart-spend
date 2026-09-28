// Shared UI: icons, toast, bottom sheet, display preferences, money formatting for screens.

import { $, esc, store, fmtSAR, fmtINR, fmtCompact, round2, emit, reducedMotion } from './core.js';
import { catOf } from './categories.js';
import { initialOf } from './profiles.js';
import { state } from './ledger.js';

/* ---------- icons (24px stroke) ---------- */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  activity: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M7 13h4M7 17h7"/>',
  insights: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  more: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c1.2-3.6 4-5.2 7-5.2s5.8 1.6 7 5.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
  cloud: '<path d="M17.5 19H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 11.5 3.8 3.8 0 0 1 17.5 19z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  swap: '<path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 14h9"/>',
  wipe: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.4A6 6 0 1 1 9.4 15.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.01"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  del: '<path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m17 9-6 6M11 9l6 6"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  arrowIn: '<path d="M17 7 7 17M17 17H7V7"/>',
  arrowOut: '<path d="M7 17 17 7M7 7h10v10"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  logo: '<path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  github: '<path d="M9 19c-4 1.3-4-2-6-2.5M15 22v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 2.8 5.8 3.1 5.8 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V22"/>',
  // categories
  Groceries: '<path d="M5 8h14l-1.5 10.5a2 2 0 0 1-2 1.5h-7a2 2 0 0 1-2-1.5L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  Dining: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 21V3c-2 1.5-3 4-3 7h3"/>',
  Transport: '<path d="M5 17h14v-5l-2-5H7l-2 5v5z"/><path d="M5 12h14M7.5 17v2M16.5 17v2"/><circle cx="8" cy="14.5" r=".6"/><circle cx="16" cy="14.5" r=".6"/>',
  Utilities: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  Cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/>',
  Shopping: '<path d="M6 7h12l1 13H5L6 7z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  Healthcare: '<path d="M12 21s-7-4.4-9-9.2C1.6 8.4 3.8 4.5 7.5 4.5c2 0 3.5 1.2 4.5 2.6 1-1.4 2.5-2.6 4.5-2.6 3.7 0 5.9 3.9 4.5 7.3C19 16.6 12 21 12 21z"/><path d="M8 12h2l1.5-2.5L13 14l1.5-2H16"/>',
  Salary: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  Freelance: '<rect x="4" y="4" width="16" height="11" rx="2"/><path d="M2 19h20M10 19v-4M14 19v-4"/>',
  General: '<circle cx="12" cy="12" r="8.5"/><circle cx="8.5" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="15.5" cy="12" r=".8"/>'
};
export function icon(name, cls) {
  return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.General) + '</svg>';
}
export function catIcon(catId, size) {
  const c = catOf(catId);
  const st = size ? 'width:' + size + 'px;height:' + size + 'px;' : '';
  return '<span class="cat-ico" style="--cat:' + c.color + ';' + st + '">' + icon(P[catId] ? catId : 'General') + '</span>';
}
export function catTag(catId) { const c = catOf(catId); return '<span class="tag" style="--cat:' + c.color + '">' + esc(c.label) + '</span>'; }
export function avatar(p, size) {
  const s = size || 34;
  return '<span class="av" style="width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s * 0.42) + 'px;background:' + p.color + '" aria-hidden="true">' + esc(initialOf(p.name)) + '</span>';
}

/* ---------- display preferences ---------- */
const PREFS_KEY = 'smartspend.prefs';
export const prefs = Object.assign({ theme: 'dark', currency: 'SAR', installDismissed: false }, store.getJSON(PREFS_KEY, {}));
export function setPref(k, v) { prefs[k] = v; store.setJSON(PREFS_KEY, prefs); applyTheme(); emit('prefs'); }
export function applyTheme() {
  document.documentElement.setAttribute('data-theme', prefs.theme || 'dark');
  const light = prefs.theme === 'light' || (prefs.theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#f3f6fb' : '#070b14');
}

/** Main amount in the chosen display currency. */
export function money(sar) { return prefs.currency === 'INR' ? fmtINR(sar * state.rate) : fmtSAR(sar); }
/** The other currency, for the smaller line. */
export function moneyAlt(sar) { return prefs.currency === 'INR' ? fmtSAR(sar) : fmtINR(sar * state.rate); }
export function signed(sar, type) { return (type === 'in' ? '+' : '−') + money(Math.abs(sar)).replace(/^−/, ''); }
/** Compact amount for stat tiles: SAR 6.5K / ₹1.7L. */
export function moneyCompact(sar) {
  const v = prefs.currency === 'INR' ? sar * state.rate : sar;
  const s = fmtCompact(Math.abs(v), prefs.currency);
  return (v < 0 ? '−' : '') + (prefs.currency === 'INR' ? s : 'SAR ' + s);
}
export function displayValue(sar) { return prefs.currency === 'INR' ? round2(sar * state.rate) : sar; }

/* ---------- toast ---------- */
let toastTimer = null, toastAction = null;
export function toast(msg, opts = {}) {
  const el = $('#toast'), act = $('#toastAct');
  $('#toastMsg').textContent = msg;
  el.className = 'toast show' + (opts.tone ? ' ' + opts.tone : '');
  toastAction = opts.onAction || null;
  act.hidden = !(opts.actionLabel && toastAction);
  if (!act.hidden) act.textContent = opts.actionLabel;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.duration || (toastAction ? 6500 : 3200));
}
export function hideToast() { $('#toast').classList.remove('show'); toastAction = null; }
export function initToast() {
  $('#toastAct').addEventListener('click', () => { const h = toastAction; hideToast(); if (h) h(); });
}

/* ---------- bottom sheet ---------- */
let sheetState = null, lastFocus = null;
export function sheetOpen() { return !!sheetState; }

/**
 * Opens the shared sheet. `handlers` receive delegated events inside it:
 * { click(e, target), submit(e), input(e), change(e), onClose() }.
 */
export function openSheet(opts) {
  const layer = $('#sheetLayer');
  if (!sheetState) lastFocus = document.activeElement;
  sheetState = opts;
  $('#sheetTitle').textContent = opts.title || '';
  $('#sheetBody').innerHTML = opts.body || '';
  const foot = $('#sheetFoot');
  foot.hidden = !opts.foot;
  foot.innerHTML = opts.foot || '';
  layer.classList.add('open');
  layer.setAttribute('aria-hidden', 'false');
  $('#app').setAttribute('inert', '');
  if (opts.onOpen) opts.onOpen($('.sheet', layer));
  setTimeout(() => {
    const f = layer.querySelector('[data-autofocus]') || layer.querySelector('.sheet-b input, .sheet-b textarea, .sheet-b button');
    if (f && !('ontouchstart' in window && f.tagName !== 'BUTTON' && !opts.focusOnTouch)) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
  }, reducedMotion() ? 0 : 320);
}
export function updateSheet(body, foot) {
  if (body != null) $('#sheetBody').innerHTML = body;
  if (foot !== undefined) { const f = $('#sheetFoot'); f.hidden = !foot; f.innerHTML = foot || ''; }
}
export function closeSheet() {
  if (!sheetState) return;
  const s = sheetState;
  sheetState = null;
  const layer = $('#sheetLayer');
  layer.classList.remove('open');
  layer.setAttribute('aria-hidden', 'true');
  $('#app').removeAttribute('inert');
  if (s.onClose) s.onClose();
  setTimeout(() => { if (!sheetState) { $('#sheetBody').innerHTML = ''; $('#sheetFoot').innerHTML = ''; } }, 360);
  if (lastFocus && document.body.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}
export function initSheet() {
  const layer = $('#sheetLayer'), sheet = $('.sheet', layer);
  layer.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    if (sheetState && sheetState.click) sheetState.click(e, e.target);
  });
  ['submit', 'input', 'change'].forEach((t) => layer.addEventListener(t, (e) => {
    if (t === 'submit') e.preventDefault();
    if (sheetState && sheetState[t]) sheetState[t](e);
  }));
  document.addEventListener('keydown', (e) => {
    if (!sheetState) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key === 'Tab') {                                     // keep focus inside the sheet
      const f = Array.from(sheet.querySelectorAll('button, input, select, textarea, a[href]')).filter((n) => !n.disabled && n.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  // Drag the handle or header down to dismiss.
  let startY = null, dy = 0;
  const start = (e) => {
    if (!e.target.closest('.grab, .sheet-h') || e.target.closest('button')) return;
    startY = e.touches ? e.touches[0].clientY : e.clientY; dy = 0; sheet.classList.add('dragging');
  };
  const move = (e) => {
    if (startY == null) return;
    dy = Math.max(0, (e.touches ? e.touches[0].clientY : e.clientY) - startY);
    sheet.style.transform = 'translateY(' + dy + 'px)';
  };
  const end = () => {
    if (startY == null) return;
    sheet.classList.remove('dragging'); sheet.style.transform = '';
    if (dy > 110) closeSheet();
    startY = null;
  };
  sheet.addEventListener('touchstart', start, { passive: true });
  window.addEventListener('touchmove', move, { passive: true });
  window.addEventListener('touchend', end);
}

/** Two-tap confirm for destructive buttons. Returns true on the second tap. */
export function armed(btn, label) {
  if (btn.classList.contains('armed')) return true;
  const orig = btn.innerHTML;
  btn.classList.add('armed');
  btn.textContent = label || 'Tap again to confirm';
  setTimeout(() => { if (document.body.contains(btn)) { btn.classList.remove('armed'); btn.innerHTML = orig; } }, 3500);
  return false;
}
