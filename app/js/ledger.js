// One profile's ledger: records, rate, deletion markers (for sync), learned
// categories, budgets. Storage format is unchanged from v1, so existing data loads as-is.

import {
  store, emit, uid, round2, todayDate, todayISO, toISO, fromISO, isValidISO, makeDate, monthIndex,
  DEFAULT_RATE, MAX_AMOUNT, addMonths, daysInMonth, monthKey
} from './core.js';
import { CATEGORIES, CAT_BY_ID, catOf, sanitizeLearned, learnCategory } from './categories.js';

export const DATA_PREFIX = 'smartspend.v1.p.';
const BUDGET_PREFIX = 'smartspend.budgets.p.';

export const state = {
  profileId: null,
  txns: [],
  rate: DEFAULT_RATE,
  rateUpdatedAt: 0,
  deleted: {},                       // id → deletion time (sync tombstones)
  learned: { tokens: {}, phrases: {} },
  sample: false,
  ui: {}                             // v1 UI prefs, kept untouched
};

export function dataKey(pid = state.profileId) { return DATA_PREFIX + pid; }

/* ---------- sanitising (also used for imports) ---------- */

export function validRate(v) { v = parseFloat(v); return isFinite(v) && v > 0 && v < 100000 ? v : null; }

// Accepts ISO dates plus the Android app's "Sep 24, 2026" and d/m/yyyy.
export function parseLooseDate(v) {
  if (isValidISO(v)) return v;
  if (typeof v === 'number' && isFinite(v)) {
    const d = v < 100000 ? new Date(v * 86400000) : new Date(v);
    return isNaN(d) ? null : toISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = String(v || '').trim();
  let m, dt;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) dt = makeDate(+m[1], +m[2] - 1, +m[3]);
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)) && monthIndex(m[1]) >= 0) dt = makeDate(+m[3], monthIndex(m[1]), +m[2]);
  else if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s)) && monthIndex(m[2]) >= 0) dt = makeDate(+m[3], monthIndex(m[2]), +m[1]);
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) dt = makeDate(+m[3], +m[2] - 1, +m[1]);
  return dt ? toISO(dt) : null;
}

export function sanitizeTxn(t) {
  if (!t || typeof t !== 'object') return null;
  const amount = round2(Math.abs(parseFloat(t.amount)));
  if (!isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
  const typeRaw = String(t.type || t.flow || '').toLowerCase();
  const type = (typeRaw === 'in' || typeRaw === 'inflow' || typeRaw === 'credit' || typeRaw === 'income') ? 'in' : 'out';
  let cat = String(t.category || 'General');
  if (cat === 'Cash/ATM' || cat.toLowerCase() === 'cash') cat = 'Cash';
  if (!CAT_BY_ID[cat]) {
    const match = CATEGORIES.filter((c) => c.id.toLowerCase() === cat.toLowerCase())[0];
    cat = match ? match.id : 'General';
  }
  const date = parseLooseDate(t.date) || todayISO();
  const title = String(t.title != null ? t.title : (t.text != null ? t.text : (t.description || ''))).replace(/\s+/g, ' ').trim().slice(0, 120);
  return {
    id: String(t.id || uid()).slice(0, 64),
    title: title || catOf(cat).label,
    amount, type, category: cat, date,
    createdAt: Number(t.createdAt) || Date.now(),
    updatedAt: Number(t.updatedAt) || Number(t.createdAt) || Date.now()
  };
}

export function sanitizeList(arr) {
  const seen = {}, out = [];
  (Array.isArray(arr) ? arr : []).forEach((raw) => {
    const t = sanitizeTxn(raw);
    if (!t) return;
    if (seen[t.id]) t.id = uid();
    seen[t.id] = true;
    out.push(t);
  });
  return out;
}

function sanitizeDeleted(raw) {
  const out = {};
  if (raw && typeof raw === 'object') Object.keys(raw).slice(0, 20000).forEach((id) => {
    const ts = Number(raw[id]);
    if (id && ts > 0) out[String(id).slice(0, 64)] = ts;
  });
  return out;
}

/* ---------- load / save ---------- */

export function reset(profileId = null) {
  state.profileId = profileId;
  state.txns = [];
  state.rate = DEFAULT_RATE;
  state.rateUpdatedAt = 0;
  state.deleted = {};
  state.learned = { tokens: {}, phrases: {} };
  state.sample = false;
  state.ui = {};
}

/** Loads a profile's ledger. Returns false when it has none yet. */
export function load(profileId) {
  reset(profileId);
  const raw = store.get(dataKey(profileId));
  if (!raw) return false;
  try {
    const d = JSON.parse(raw);
    state.txns = sanitizeList(d.transactions);
    state.rate = validRate(d.rate) || DEFAULT_RATE;
    state.sample = !!d.sample && state.txns.length > 0;
    state.learned = sanitizeLearned(d.learned);
    state.deleted = sanitizeDeleted(d.deleted);
    state.rateUpdatedAt = Number(d.rateUpdatedAt) || 0;
    state.ui = d.ui && typeof d.ui === 'object' ? d.ui : {};
  } catch (e) { /* corrupt payload: start clean in memory */ }
  return true;
}

/** Saves and tells the app. `source` lets sync avoid reacting to its own writes. */
export function persist(source = 'user') {
  if (!state.profileId) return;
  store.set(dataKey(), JSON.stringify({
    v: 1, rate: state.rate, transactions: state.txns, ui: state.ui, sample: state.sample,
    learned: state.learned, deleted: state.deleted, rateUpdatedAt: state.rateUpdatedAt
  }));
  emit('ledger', { source });
}

export function countFor(profileId) {
  const d = store.getJSON(dataKey(profileId), null);
  return d && Array.isArray(d.transactions) ? d.transactions.length : 0;
}

/* ---------- changes ---------- */

export function snapshot() {
  return {
    txns: state.txns.map((t) => Object.assign({}, t)), rate: state.rate, sample: state.sample,
    learned: JSON.parse(JSON.stringify(state.learned))
  };
}

function recContent(t) { return [t.title, t.amount, t.type, t.category, t.date].join('|'); }

// Stamps a wholesale change so sync treats it as the newest edit: new or changed
// records (all of them when `force`) get updatedAt = now; vanished ones get tombstones.
function reconcile(before, after, force) {
  const now = Date.now(), prev = {}, keep = {};
  before.forEach((t) => { prev[t.id] = t; });
  after.forEach((t) => {
    keep[t.id] = 1;
    const b = prev[t.id];
    if (force || !b || recContent(b) !== recContent(t)) t.updatedAt = now;
    delete state.deleted[t.id];
  });
  before.forEach((t) => { if (!keep[t.id]) state.deleted[t.id] = now; });
}

export function restoreSnapshot(snap) {
  reconcile(state.txns, snap.txns);
  state.txns = snap.txns;
  state.sample = snap.sample;
  if (snap.learned) state.learned = snap.learned;
  if (snap.rate !== state.rate) { state.rate = snap.rate; state.rateUpdatedAt = Date.now(); }
  persist();
}

/** Adds parsed items. A forced category also teaches the categoriser. */
export function addItems(items) {
  const stamp = Date.now();
  const added = items.map((it, i) => {
    const t = { id: uid(), title: it.title, amount: it.amount, type: it.type, category: it.category, date: it.date,
      createdAt: stamp + i, updatedAt: stamp + i };
    if (it.forced) learnCategory(state.learned, it.title, it.category);
    state.txns.push(t);
    return t;
  });
  state.sample = state.sample && state.txns.length > added.length;
  persist();
  return added;
}

export function updateTxn(id, patch) {
  const t = state.txns.find((x) => x.id === id);
  if (!t) return null;
  if (patch.category && patch.category !== t.category) learnCategory(state.learned, patch.title || t.title, patch.category);
  Object.assign(t, patch, { updatedAt: Date.now() });
  persist();
  return t;
}

export function deleteTxn(id) {
  const idx = state.txns.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const snap = snapshot();
  const [t] = state.txns.splice(idx, 1);
  state.deleted[t.id] = Date.now();
  persist();
  return { removed: t, snap };
}

export function clearAll() {
  const snap = snapshot();
  reconcile(state.txns, []);
  state.txns = [];
  state.sample = false;
  persist();
  return snap;
}

export function setRate(v) {
  const r = validRate(v);
  if (!r || r === state.rate) return false;
  state.rate = r;
  state.rateUpdatedAt = Date.now();
  persist();
  return true;
}

/* ---------- backup files ---------- */

export function buildBackupPayload(profileName) {
  return {
    app: 'smart-spend-inflow-analyzer', version: 2, exportedAt: new Date().toISOString(),
    profile: profileName || null, baseCurrency: 'SAR', rate: state.rate,
    transactions: sortedTxns(state.txns).map((t) => ({ id: t.id, title: t.title, amount: t.amount, type: t.type,
      category: t.category, date: t.date, createdAt: t.createdAt })),
    learned: state.learned
  };
}

/** Reads any supported backup shape without applying it. */
export function readBackup(data) {
  const arr = Array.isArray(data) ? data : (data && Array.isArray(data.transactions) ? data.transactions : null);
  if (!arr) return { error: 'That backup has no transactions list.' };
  const clean = sanitizeList(arr);
  if (arr.length && !clean.length) return { error: 'None of the records in that backup were valid.' };
  const rate = !Array.isArray(data) && (validRate(data.rate) || validRate(data.exchangeRate));
  return {
    txns: clean, dropped: arr.length - clean.length, rate: rate || null,
    learned: !Array.isArray(data) && data.learned ? sanitizeLearned(data.learned) : null,
    profile: !Array.isArray(data) ? data.profile || null : null,
    exportedAt: !Array.isArray(data) ? data.exportedAt || null : null
  };
}

/** Replaces the ledger with a read backup. An explicit restore beats older edits elsewhere. */
export function applyBackup(read) {
  const snap = snapshot();
  reconcile(state.txns, read.txns, true);
  state.txns = read.txns;
  state.sample = false;
  if (read.rate) { state.rate = read.rate; state.rateUpdatedAt = Date.now(); }
  if (read.learned) state.learned = read.learned;
  persist();
  return snap;
}

/* ---------- demo ---------- */

export function loadDemo() {
  const snap = snapshot();
  const t = todayDate(), out = [];
  let seq = 0;
  const tpl = [
    [1, 'Apartment Rent', 3200, 'out', 'Utilities'], [2, 'Panda Weekly Groceries', 342.75, 'out', 'Groceries'],
    [3, 'STC Mobile Recharge', 115, 'out', 'Utilities'], [4, 'Starbucks Coffee', 24, 'out', 'Dining'],
    [5, 'Home Internet WiFi', 299, 'out', 'Utilities'], [6, 'Uber to Office', 42.5, 'out', 'Transport'],
    [7, 'Client Payment for Logo Project', 2400, 'in', 'Freelance'], [8, 'Fuel Refill', 120, 'out', 'Transport'],
    [9, 'Shawarma Dinner', 38, 'out', 'Dining'], [10, 'Withdrew Cash from ATM', 500, 'out', 'Cash'],
    [11, 'Lulu Hypermarket', 218.4, 'out', 'Groceries'], [12, 'Electricity Bill', 286, 'out', 'Utilities'],
    [13, 'Nahdi Pharmacy', 67.25, 'out', 'Healthcare'], [14, 'Amazon Order Headphones', 260, 'out', 'Shopping'],
    [15, 'Team Lunch', 96, 'out', 'Dining'], [16, 'Metro Fare', 8, 'out', 'Transport'],
    [17, 'Amazon Refund', 89, 'in', 'Shopping'], [18, 'Carrefour Groceries', 190, 'out', 'Groceries'],
    [19, 'Jarir Books', 145, 'out', 'Shopping'], [20, 'Dividend Credited', 310, 'in', 'General'],
    [21, 'Careem Ride', 36, 'out', 'Transport'], [22, 'Coffee with Client', 31, 'out', 'Dining'],
    [24, 'Got Cash 450', 450, 'in', 'Cash'], [24, 'Spent 40 on Fuel', 40, 'out', 'Transport'],
    [25, 'Clinic Consultation', 150, 'out', 'Healthcare'], [26, 'Danube Fresh Vegetables', 74.5, 'out', 'Groceries'],
    [27, 'Monthly Salary Credited', 14500, 'in', 'Salary'], [28, 'Dinner at Restaurant', 185, 'out', 'Dining']
  ];
  [-5, -4, -3, -2, -1, 0].forEach((off) => {
    const base = new Date(t.getFullYear(), t.getMonth() + off, 1);
    const dim = daysInMonth(base.getFullYear(), base.getMonth());
    tpl.forEach((row, i) => {
      if (off < 0 && (i * 7 + off * 3) % 6 === 4) return;          // a little variety month to month
      const d = new Date(base.getFullYear(), base.getMonth(), Math.min(row[0], dim));
      if (d > t) return;
      const fixed = row[4] === 'Salary' || /Rent|Internet/.test(row[1]);
      const f = 0.78 + (((i + 3) * 37 + (off + 6) * 11) % 44) / 100;
      out.push({ id: uid(), title: row[1], amount: off < 0 && !fixed ? round2(row[2] * f) : row[2], type: row[3], category: row[4],
        date: toISO(d), createdAt: Date.now() - 900000 + seq, updatedAt: Date.now() - 900000 + (seq++) });
    });
  });
  reconcile(state.txns, out);
  state.txns = out;
  state.sample = true;
  persist();
  return snap;
}

/* ---------- queries ---------- */

export function sortedTxns(list) {
  return list.slice().sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.createdAt - a.createdAt));
}
export function inMonth(list, y, m) { const p = monthKey(y, m) + '-'; return list.filter((t) => t.date.indexOf(p) === 0); }
export function totals(list) {
  const r = { tin: 0, tout: 0, nin: 0, nout: 0 };
  list.forEach((t) => { if (t.type === 'in') { r.tin += t.amount; r.nin++; } else { r.tout += t.amount; r.nout++; } });
  r.net = r.tin - r.tout;
  return r;
}
/** Spend per category, largest first. */
export function categorySpend(list) {
  const m = {};
  list.forEach((t) => { if (t.type === 'out') { const b = m[t.category] || (m[t.category] = { id: t.category, sum: 0, n: 0 }); b.sum += t.amount; b.n++; } });
  return Object.values(m).sort((a, b) => b.sum - a.sum);
}
/** In/out totals for the `n` months ending at (y, m), oldest first. */
export function monthlySeries(y, m, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = addMonths(y, m, -i);
    out.push(Object.assign({ y: p.y, m: p.m }, totals(inMonth(state.txns, p.y, p.m))));
  }
  return out;
}
/** Running total of spend through the month, one value per day (null after today). */
export function cumulativeSpend(y, m) {
  const dim = daysInMonth(y, m), perDay = new Array(dim).fill(0);
  inMonth(state.txns, y, m).forEach((t) => { if (t.type === 'out') perDay[fromISO(t.date).getDate() - 1] += t.amount; });
  const today = todayDate(), isCurrent = today.getFullYear() === y && today.getMonth() === m;
  const last = isCurrent ? today.getDate() : dim;
  let run = 0;
  return perDay.map((v, i) => { run += v; return i < last ? round2(run) : null; });
}
export function dayAggregates() {
  const map = {};
  state.txns.forEach((t) => {
    const a = map[t.date] || (map[t.date] = { tin: 0, tout: 0, n: 0 });
    if (t.type === 'in') a.tin += t.amount; else a.tout += t.amount;
    a.n++;
  });
  return map;
}

/* ---------- budgets (kept apart from the synced ledger on purpose) ---------- */

export function getBudgets(pid = state.profileId) {
  const raw = store.getJSON(BUDGET_PREFIX + pid, {});
  const out = {};
  Object.keys(raw || {}).forEach((k) => { const v = Number(raw[k]); if (CAT_BY_ID[k] && v > 0) out[k] = round2(v); });
  return out;
}
export function setBudget(cat, amount) {
  const b = getBudgets();
  const v = Number(amount);
  if (v > 0) b[cat] = round2(v); else delete b[cat];
  store.setJSON(BUDGET_PREFIX + state.profileId, b);
  emit('budgets');
}
export function removeProfileData(pid) {
  store.remove(DATA_PREFIX + pid);
  store.remove(BUDGET_PREFIX + pid);
}
