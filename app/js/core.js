// Shared helpers: DOM, dates, money, storage, hashing. No app state lives here.

export const APP_VERSION = '2.1.0';

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
export const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function haptic(ms = 8) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* unsupported */ } }

/* ---------- Dates ---------- */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function pad(n) { return (n < 10 ? '0' : '') + n; }
export function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function fromISO(s) { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
export function isValidISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(fromISO(s)) === s; }
export function makeDate(y, m0, d) {
  if (!(y >= 1900 && y <= 2200) || m0 < 0 || m0 > 11 || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(y, m0, d);
  return dt.getFullYear() === y && dt.getMonth() === m0 && dt.getDate() === d ? dt : null;
}
export function todayDate() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }
export function todayISO() { return toISO(todayDate()); }
export function fmtDate(iso) { const d = fromISO(iso); return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
export function fmtDateLong(iso) { const d = fromISO(iso); return DOW[d.getDay()] + ', ' + fmtDate(iso); }
export function fmtDayHeading(iso) {
  const t = todayISO();
  if (iso === t) return 'Today';
  const y = todayDate(); y.setDate(y.getDate() - 1);
  if (iso === toISO(y)) return 'Yesterday';
  const d = fromISO(iso);
  return DOW[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== todayDate().getFullYear() ? ', ' + d.getFullYear() : '');
}
export function monthIndex(s) { return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(s.toLowerCase().slice(0, 3)); }
export function weekdayIndex(s) { return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(s.toLowerCase().slice(0, 3)); }
export function monthKey(y, m) { return y + '-' + pad(m + 1); }
export function addMonths(y, m, delta) { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; }
export function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

/* ---------- Money ---------- */
export const DEFAULT_RATE = 26.5;
export const MAX_AMOUNT = 1e9;
export function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

let nfSAR = null, nfINR = null, nfCompactIN = null, nfCompact = null;
try { nfSAR = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (e) { nfSAR = null; }
try {
  nfINR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (nfINR.format(1234567).indexOf('12,34,567') === -1) nfINR = null;
} catch (e) { nfINR = null; }
try { nfCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }); } catch (e) { nfCompact = null; }
try { nfCompactIN = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }); } catch (e) { nfCompactIN = null; }

function groupWestern(i) { return i.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function groupIndian(i) {
  if (i.length <= 3) return i;
  return i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + i.slice(-3);
}
export function sarNumber(n) {
  if (nfSAR) return nfSAR.format(n);
  const p = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '-' : '') + groupWestern(p[0]) + '.' + p[1];
}
export function fmtSAR(n) { n = round2(n); return (n < 0 ? '−' : '') + 'SAR ' + sarNumber(Math.abs(n)); }
export function fmtINR(n) {
  n = round2(n);
  if (nfINR) return (n < 0 ? '−' : '') + nfINR.format(Math.abs(n));
  const p = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '−' : '') + '₹' + groupIndian(p[0]) + '.' + p[1];
}
/** Short amounts for chart axes and tiles: 12.4K, 1.2L-style handled by en-IN compact. */
export function fmtCompact(n, cur) {
  const abs = Math.abs(n);
  if (abs < 1000) return (cur === 'INR' ? '₹' : '') + Math.round(abs).toString();
  const f = cur === 'INR' ? nfCompactIN : nfCompact;
  const s = f ? f.format(abs) : (abs / 1000).toFixed(1) + 'K';
  return (cur === 'INR' ? '₹' : '') + s;
}

/* ---------- Ids ---------- */
export function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  try { window.crypto.getRandomValues(arr); } catch (e) { for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256); }
  return Array.from(arr, (b) => ('0' + b.toString(16)).slice(-2)).join('');
}
export function uid() {
  try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); } catch (e) { /* insecure context */ }
  return 't' + Date.now().toString(36) + randomHex(6);
}

/* ---------- Storage: try/catch everywhere, in-memory fallback ---------- */
export const store = (() => {
  let ok = true;
  const mem = {};
  try { const k = '__smartspend_probe__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); } catch (e) { ok = false; }
  return {
    get(k) {
      if (ok) { try { return localStorage.getItem(k); } catch (e) { ok = false; } }
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    },
    set(k, v) {
      mem[k] = v;
      if (!ok) return false;
      try { localStorage.setItem(k, v); return true; } catch (e) { ok = false; return false; }
    },
    remove(k) {
      delete mem[k];
      if (!ok) return;
      try { localStorage.removeItem(k); } catch (e) { ok = false; }
    },
    getJSON(k, fallback) { try { const r = this.get(k); return r ? JSON.parse(r) : fallback; } catch (e) { return fallback; } },
    setJSON(k, v) { return this.set(k, JSON.stringify(v)); },
    available() { return ok; }
  };
})();

let memSession = null;
export const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return memSession && memSession[k] || null; } },
  set(k, v) {
    memSession = memSession || {};
    if (v == null) delete memSession[k]; else memSession[k] = v;
    try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* memory only */ }
  }
};

/* ---------- SHA-256 (sync, pure JS) for PIN hashing and fingerprints ---------- */
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
export function sha256Hex(msg) {
  const bin = unescape(encodeURIComponent(msg));
  const len = bin.length, words = [];
  for (let i = 0; i < len; i++) words[i >> 2] |= bin.charCodeAt(i) << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  const total = (((len + 8) >> 6) + 1) * 16;
  words[total - 1] = len * 8;
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Array(64);
  for (let j = 0; j < total; j += 16) {
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      if (t < 16) W[t] = words[j + t] | 0;
      else {
        const x = W[t - 15], y = W[t - 2];
        W[t] = (W[t - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + W[t - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10))) | 0;
      }
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[t] + W[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((v) => ('00000000' + (v >>> 0).toString(16)).slice(-8)).join('');
}

/* ---------- Tiny event bus ---------- */
const listeners = {};
export function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
export function emit(evt, data) { (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
