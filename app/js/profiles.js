// Profiles and PINs. A PIN keeps family members out of each other's ledger on a
// shared device; only a salted hash is stored. Storage is unchanged from v1.

import { store, session, sha256Hex, randomHex } from './core.js';

export const PROFILES_KEY = 'smartspend.profiles.v1';
export const SESSION_KEY = 'smartspend.session';
export const PIN_LEN = 4;
export const MAX_PIN_TRIES = 5;
export const PIN_LOCK_MS = 30000;
const PIN_ROUNDS = 2000;
const DEFAULT_PROFILES = [{ id: 'sharooq', name: 'Sharooq' }, { id: 'roshan', name: 'Roshan' }];
export const PROFILE_COLORS = ['#38bdf8', '#12a594', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#a3e635', '#2dd4bf'];

export const profiles = { list: [], last: null };

function makeProfile(name, id, idx) {
  return {
    id: id || ('p' + Date.now().toString(36) + randomHex(3)), name,
    color: PROFILE_COLORS[idx % PROFILE_COLORS.length],
    salt: null, pinHash: null, fails: 0, lockUntil: 0, createdAt: Date.now()
  };
}

function sanitizeProfile(p, idx) {
  if (!p || typeof p !== 'object' || !p.id) return null;
  const name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!name) return null;
  return {
    id: String(p.id).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || ('p' + idx),
    name,
    color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : PROFILE_COLORS[idx % PROFILE_COLORS.length],
    salt: typeof p.salt === 'string' ? p.salt : null,
    pinHash: typeof p.pinHash === 'string' ? p.pinHash : null,
    // "pbkdf2" marks a PIN carried over from the Android app (PBKDF2-HMAC-SHA256, hex salt).
    pinAlgo: p.pinAlgo === 'pbkdf2' ? 'pbkdf2' : undefined,
    pinIter: Number(p.pinIter) || undefined,
    pinUpdatedAt: Number(p.pinUpdatedAt) || 0,
    fails: Number(p.fails) || 0,
    lockUntil: Number(p.lockUntil) || 0,
    createdAt: Number(p.createdAt) || Date.now()
  };
}

export function saveProfiles() { store.setJSON(PROFILES_KEY, { v: 1, profiles: profiles.list, last: profiles.last }); }

export function loadProfiles() {
  const d = store.getJSON(PROFILES_KEY, null);
  if (!d || !Array.isArray(d.profiles)) {
    profiles.list = DEFAULT_PROFILES.map((p, i) => makeProfile(p.name, p.id, i));
    profiles.last = null;
    saveProfiles();
    return;
  }
  profiles.list = d.profiles.map(sanitizeProfile).filter(Boolean);
  profiles.last = d.last || null;
}

export function findProfile(id) { return profiles.list.find((p) => p.id === id) || null; }
export const initialOf = (name) => (String(name).trim().charAt(0) || '?').toUpperCase();
export function slugOf(p) { return p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || p.id; }

/** Returns an error message, or the new profile. */
export function addProfile(rawName) {
  const name = String(rawName || '').replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Enter a name for the profile.' };
  if (name.length > 24) return { error: 'Keep the name to 24 characters or fewer.' };
  const dup = profiles.list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (dup) return { error: 'A profile called ' + dup.name + ' already exists. Pick another name.' };
  const p = makeProfile(name, null, profiles.list.length);
  profiles.list.push(p);
  saveProfiles();
  return { profile: p };
}

export function removeProfile(id) {
  profiles.list = profiles.list.filter((x) => x.id !== id);
  if (profiles.last === id) profiles.last = null;
  saveProfiles();
}

/* ---------- PIN ---------- */

function hashPin(pin, salt) {
  let h = sha256Hex(salt + '|' + pin);
  for (let i = 0; i < PIN_ROUNDS; i++) h = sha256Hex(h + salt);
  return h;
}

async function pbkdf2Hex(pin, saltHex, iterations) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => ('0' + b.toString(16)).slice(-2)).join('');
}

export async function pinMatches(p, pin) {
  if (!p.pinHash || !p.salt) return false;
  if (p.pinAlgo === 'pbkdf2') return (await pbkdf2Hex(pin, p.salt, p.pinIter || 20000)) === p.pinHash;
  return hashPin(pin, p.salt) === p.pinHash;
}

export function setPin(p, pin) {
  p.salt = randomHex(16);
  p.pinHash = hashPin(pin, p.salt);
  delete p.pinAlgo; delete p.pinIter;
  p.pinUpdatedAt = Date.now();
  p.fails = 0; p.lockUntil = 0;
  saveProfiles();
}

/** Takes the PIN a profile uses on the person's other devices (from the encrypted profile file). */
export function adoptPin(p, meta) {
  if (!meta || !meta.pin || !meta.pin.hash || !meta.pin.salt) return false;
  p.salt = meta.pin.salt;
  p.pinHash = meta.pin.hash;
  if (meta.pin.algo === 'pbkdf2') { p.pinAlgo = 'pbkdf2'; p.pinIter = Number(meta.pin.iter) || 20000; } else { delete p.pinAlgo; delete p.pinIter; }
  p.pinUpdatedAt = Number(meta.pinUpdatedAt) || Date.now();
  p.fails = 0; p.lockUntil = 0;
  saveProfiles();
  return true;
}

export function clearPin(p) {
  p.salt = null; p.pinHash = null; delete p.pinAlgo; delete p.pinIter;
  p.fails = 0; p.lockUntil = 0;
  saveProfiles();
}

/** Records a wrong PIN; returns tries left, or 0 when the keypad is now locked. */
export function recordWrongPin(p) {
  p.fails = (p.fails || 0) + 1;
  if (p.fails >= MAX_PIN_TRIES) { p.fails = 0; p.lockUntil = Date.now() + PIN_LOCK_MS; saveProfiles(); return 0; }
  saveProfiles();
  return MAX_PIN_TRIES - p.fails;
}
export function recordGoodPin(p) { p.fails = 0; p.lockUntil = 0; saveProfiles(); }
export function lockSecondsLeft(p) { return Math.max(0, Math.ceil(((p.lockUntil || 0) - Date.now()) / 1000)); }

/* ---------- session (per tab) ---------- */

export const sessionProfile = {
  get() { return session.get(SESSION_KEY); },
  set(id) { session.set(SESSION_KEY, id); }
};
