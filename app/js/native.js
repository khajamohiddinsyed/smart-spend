// Android app (Capacitor) glue. The same web code runs in the browser and in the app;
// everything here is a no-op in the browser.
//  - Online-backup settings (GitHub token, passphrase) live in an Android Keystore-sealed
//    vault instead of WebView storage.
//  - First launch after updating from the native Android app (v1.0 / v1.1) moves its
//    profiles, PINs, records, rates and online-backup settings across.
//  - Backup files are saved through the system "Save to" picker; Back closes sheets.

import { store, DEFAULT_RATE } from './core.js';

const cap = typeof window !== 'undefined' ? window.Capacitor : null;
export const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

const PLUGIN = 'SmartSpend';
const MIGRATED_KEY = 'smartspend.native.migrated';
const SECRET_PREFIX = 'smartspend.cloud.p.';
const COLORS = ['#38bdf8', '#12a594', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#a3e635', '#2dd4bf'];

const call = (method, opts) => cap.nativePromise(PLUGIN, method, opts || {});

/* ---------- vault ---------- */

function installVault(items) {
  const mem = Object.assign({}, items);
  store.setVault({
    handles: (k) => k.indexOf(SECRET_PREFIX) === 0,
    get: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    set: (k, v) => { mem[k] = v; call('vaultSet', { key: k, value: v }).catch(() => {}); },
    remove: (k) => { delete mem[k]; call('vaultRemove', { key: k }).catch(() => {}); }
  });
  // Anything a browser build left in WebView storage moves into the vault.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf(SECRET_PREFIX) === 0) { if (!mem[k]) store.set(k, localStorage.getItem(k)); localStorage.removeItem(k); }
    }
  } catch (e) { /* storage blocked */ }
}

/* ---------- migration from the native app ---------- */

function isoFromEpochDay(day) {
  const d = new Date(Number(day) * 86400000);
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

function toWebProfile(p, i) {
  const out = {
    id: String(p.id), name: String(p.name || 'Profile'), color: COLORS[(Number(p.colorIndex) || i) % COLORS.length],
    salt: p.salt || null, pinHash: p.pinHash || null, fails: 0, lockUntil: 0, createdAt: Number(p.createdAt) || Date.now(),
    pinUpdatedAt: 0
  };
  // PBKDF2 PINs from the native app. Stamped as "oldest" so a PIN set on the web later wins.
  if (out.pinHash && out.salt) { out.pinAlgo = 'pbkdf2'; out.pinIter = 20000; out.pinUpdatedAt = 1; }
  return out;
}

async function migrateLegacy() {
  if (store.get(MIGRATED_KEY)) return null;
  const L = await call('legacyRead');
  if (!L || !L.found) { store.set(MIGRATED_KEY, 'none'); return null; }

  const records = Array.isArray(L.records) ? L.records : [];
  const tombs = Array.isArray(L.tombstones) ? L.tombstones : [];
  const settings = L.settings || {};
  const cloud = L.cloud || {};

  let list = null;
  try { list = JSON.parse(L.profilesJson || 'null'); } catch (e) { list = null; }
  if (!Array.isArray(list) || !list.length) list = [{ id: 'sharooq', name: 'Sharooq', colorIndex: 0 }, { id: 'roshan', name: 'Roshan', colorIndex: 1 }];
  if (records.some((r) => r.profileId === 'main') && !list.some((p) => p.id === 'main')) list.push({ id: 'main', name: 'Main', colorIndex: list.length });
  const profilesOut = list.filter((p) => p && p.id).map(toWebProfile);

  // Keep any profile the web app already created here, add the app's ones.
  const existing = store.getJSON('smartspend.profiles.v1', null);
  const merged = existing && Array.isArray(existing.profiles) ? existing.profiles.slice() : [];
  profilesOut.forEach((p) => { if (!merged.some((x) => x.id === p.id)) merged.push(p); });

  const now = Date.now();
  profilesOut.forEach((p) => {
    const pid = p.id;
    const txns = records.filter((r) => r.profileId === pid).map((r) => ({
      id: r.id, title: r.title, amount: Math.round(Number(r.amount) * 100) / 100, type: r.type, category: r.category,
      date: isoFromEpochDay(r.day), createdAt: r.createdAt || now, updatedAt: r.updatedAt || r.createdAt || now
    }));
    const deleted = {};
    tombs.filter((t) => t.profileId === pid && t.id).forEach((t) => { deleted[t.id] = Number(t.deletedAt) || now; });
    let learned;
    try { learned = settings['learned_' + pid] ? JSON.parse(settings['learned_' + pid]) : undefined; } catch (e) { learned = undefined; }
    const rate = Number(settings['rate_' + pid]) || (pid === 'main' ? Number(settings.exchange_rate) : 0) || DEFAULT_RATE;
    const key = 'smartspend.v1.p.' + pid;
    if (!store.get(key) && (txns.length || Object.keys(deleted).length || settings['rate_' + pid])) {
      store.setJSON(key, { v: 1, rate, rateUpdatedAt: Number(settings['rate_ts_' + pid]) || 0, transactions: txns, deleted, learned, ui: {}, sample: false });
    }
    const c = cloud[pid];
    if (c && c.repo && c.token && !store.get(SECRET_PREFIX + pid)) {
      const remember = c.remember !== false && !!c.pass;
      store.setJSON(SECRET_PREFIX + pid, {
        repo: c.repo, token: c.token, owner: String(c.repo).split('/')[0] || null,
        auto: c.dailyBackup !== false, sync: c.sync !== false, remember, pass: remember ? c.pass : null,
        verifier: c.verifier || null, syncAt: 0, lastAt: Number(c.lastBackupAt) || 0, lastHash: null, lastPath: null, lastError: null
      });
    }
  });
  store.setJSON('smartspend.profiles.v1', { v: 1, profiles: merged, last: existing ? existing.last : null });
  await call('legacyDone');
  store.set(MIGRATED_KEY, String(now));
  return { profiles: profilesOut.length, records: records.length };
}

/* ---------- boot ---------- */

export const nativeInfo = { migrated: null };

/** Runs before the app reads any storage. Resolves immediately in the browser. */
export async function initNative() {
  if (!isNative) return;
  document.documentElement.classList.add('native');
  try { installVault(((await call('vaultLoad')) || {}).items || {}); } catch (e) { console.error('vault', e); }
  try { nativeInfo.migrated = await migrateLegacy(); } catch (e) { console.error('migration', e); }
}

/** Saves text through the system picker. Resolves true when saved, false when cancelled. */
export async function saveTextFile(filename, text) {
  const r = await call('saveFile', { filename, text, mime: 'application/json' });
  return !!(r && r.saved);
}

/** Android Back: `handler()` returns true when it handled it; otherwise the app closes. */
export function onBack(handler) {
  if (!isNative) return;
  cap.nativeCallback('App', 'addListener', { eventName: 'backButton' }, () => {
    if (!handler()) cap.nativePromise('App', 'exitApp', {}).catch(() => {});
  });
}
