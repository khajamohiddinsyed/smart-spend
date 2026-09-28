// Online backup and sync through a private GitHub repository (docs/SYNC_SPEC.md).
// Everything is encrypted on the device (AES-256-GCM, PBKDF2-SHA256 key) before upload.
// UI-agnostic: reports through events ('cloud', 'toast'); the screens decide what to show.

import { store, emit, pad, randomHex, plural, sha256Hex, fmtDate, toISO } from './core.js';
import { state, persist, sanitizeTxn, validRate, buildBackupPayload } from './ledger.js';
import { slugOf, adoptPin } from './profiles.js';

const CLOUD_PREFIX = 'smartspend.cloud.p.';
export const DEFAULT_REPO_NAME = 'smart-spend-backups';
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=Smart+Spend+backup' +
  '&description=Backup+and+sync+for+Smart+Spend&expires_in=366&contents=write';
export const NEW_REPO_URL = 'https://github.com/new?name=smart-spend-backups&description=Encrypted+Smart+Spend+backups&visibility=private';
const ENC_FORMAT = 'smartspend-encrypted';
const KDF_ITERATIONS = 310000;
const AUTO_BACKUP_MS = 20 * 3600 * 1000;

const GH_ROOT = (() => {
  try {
    const inApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (!inApp && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {   // the Android app is served from localhost too
      const o = localStorage.getItem('smartspend.devApi');         // local test server only
      if (o && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o)) return o;
    }
  } catch (e) { /* storage blocked */ }
  return 'https://api.github.com';
})();

/* ---------- settings per profile ---------- */

export function cloudCfg(pid) {
  if (!pid) return null;
  const c = store.getJSON(CLOUD_PREFIX + pid, null);
  return c && c.repo && c.token ? c : null;
}
function saveCfg(pid, c) { store.setJSON(CLOUD_PREFIX + pid, c); emit('cloud'); }
function patchCfg(pid, patch) { const c = cloudCfg(pid); if (c) saveCfg(pid, Object.assign(c, patch)); }
export function forgetCloud(pid) { store.remove(CLOUD_PREFIX + pid); if (passFor === pid) { sessionPass = null; passFor = null; } emit('cloud'); }

let sessionPass = null, passFor = null;
export function passphrase(pid, c = cloudCfg(pid)) { if (c && c.pass) return c.pass; return passFor === pid ? sessionPass : null; }
function rememberSessionPass(pid, pass) { sessionPass = pass; passFor = pid; }
export function forgetSessionPass() { sessionPass = null; passFor = null; }
export const hasWebCrypto = () => !!(window.crypto && window.crypto.subtle && window.TextEncoder);

export const status = { syncing: false, backingUp: false };

/* ---------- encryption envelope ---------- */

function bufToB64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
function deriveKey(pass, salt, iterations) {
  return window.crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']).then((base) =>
    window.crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
}
export function encryptBackup(obj, pass) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  return deriveKey(pass, salt, KDF_ITERATIONS)
    .then((key) => window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))))
    .then((ct) => ({ format: ENC_FORMAT, v: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS,
      salt: bufToB64(salt), iv: bufToB64(iv), data: bufToB64(ct), createdAt: new Date().toISOString() }));
}
export function decryptBackup(env, pass) {
  const iterations = Math.min(Math.max(Number(env.iterations) || KDF_ITERATIONS, 100000), 5000000);
  let salt, iv, data;
  try { salt = b64ToBytes(env.salt); iv = b64ToBytes(env.iv); data = b64ToBytes(env.data); }
  catch (e) { return Promise.reject(new Error('That backup file is damaged.')); }
  return deriveKey(pass, salt, iterations)
    .then((key) => window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data))
    .then((pt) => {
      try { return JSON.parse(new TextDecoder().decode(pt)); } catch (e) { throw new Error('That backup opened, but its contents are damaged.'); }
    }, () => { const err = new Error('That passphrase doesn’t open this backup.'); err.code = 'bad_pass'; throw err; });
}
export const isEncryptedBackup = (d) => !!(d && d.format === ENC_FORMAT && d.data && d.iv && d.salt);

/* ---------- GitHub REST ---------- */

function ghError(status, body, repo) {
  let msg = '';
  try { msg = JSON.parse(body).message || ''; } catch (e) { msg = ''; }
  const says = msg ? ' GitHub says: “' + msg + '”.' : '';
  if (status === 401) return 'GitHub rejected the access token. It may be mistyped, expired or revoked.';
  if (status === 403 && /rate limit/i.test(msg)) return 'GitHub is limiting requests right now. Wait a few minutes and try again.';
  if (status === 403) return 'The token isn’t allowed to read or write files in ' + repo + '. On GitHub, open the token: under Repository permissions it should list “Read and Write access to code” (that is Contents, not Actions).' + says;
  if (status === 404) return 'Repository ' + repo + ' wasn’t found, or the token can’t access it. The repository must belong to the same GitHub account as the token, and be selected under the token’s Repository access.';
  if (status === 409 || status === 422) return 'GitHub refused the upload.' + says + ' Try again.';
  return 'GitHub returned an error (' + status + ').' + says;
}
function request(url, token, method, body, raw, repo) {
  const headers = { Authorization: 'Bearer ' + token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then((res) => {
      if (res.ok) return raw ? res.text() : res.json();
      return res.text().then((t) => { const e = new Error(ghError(res.status, t, repo)); e.status = res.status; throw e; });
    }, () => { throw new Error('Couldn’t reach GitHub. Check the internet connection and try again.'); });
}
function gh(c, method, path, body, raw) {
  return request(GH_ROOT + '/repos/' + c.repo + path, c.token, method, body, raw, c.repo);
}
/** The GitHub username the token belongs to. */
export function tokenOwner(token) {
  return request(GH_ROOT + '/user', token, 'GET', null, false, 'your account').then((u) => (u && u.login) || null);
}
const contentsPath = (p) => '/contents/' + p.split('/').map(encodeURIComponent).join('/');
const backupFolder = (p) => 'backups/' + slugOf(p);
const syncPath = (p) => 'sync/' + slugOf(p) + '/ledger.json';
const profilePath = (p) => 'sync/' + slugOf(p) + '/profile.json';
function newBackupName() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z-' + randomHex(2) + '.json';
}
export function backupDate(name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(name);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}
export function listBackups(c, p) {
  return gh(c, 'GET', contentsPath(backupFolder(p))).then((arr) => (Array.isArray(arr) ? arr : [])
    .filter((f) => f.type === 'file' && /\.json$/i.test(f.name) && backupDate(f.name))
    .map((f) => ({ name: f.name, path: f.path, size: f.size, date: backupDate(f.name) }))
    .sort((a, b) => (a.name < b.name ? 1 : -1)), (e) => {
    if (e.status !== 404) throw e;
    return gh(c, 'GET', '').then(() => []);                            // repo fine, folder not created yet
  });
}
export function fetchBackup(c, path) {
  return gh(c, 'GET', contentsPath(path), null, true).then((t) => { try { return JSON.parse(t); } catch (e) { throw new Error('That backup file isn’t valid JSON.'); } });
}
function uploadBackup(c, p, env) {
  const path = backupFolder(p) + '/' + newBackupName();
  return gh(c, 'PUT', contentsPath(path), { message: 'Smart Spend backup (' + slugOf(p) + ')', content: btoa(JSON.stringify(env)) }).then(() => path);
}

/* ---------- merge (shared contract with the Android app) ---------- */
/* SYNC-MERGE-BEGIN */
var TOMBSTONE_TTL_MS = 180 * 86400000;
function recCanon(r) {
  return [r.title || '', (Number(r.amount) || 0).toFixed(2), r.type || '', r.category || '', r.date || ''].join('|');
}
function pickNewer(a, b) {
  var au = Number(a.updatedAt) || 0, bu = Number(b.updatedAt) || 0;
  if (au !== bu) return au > bu ? a : b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return recCanon(a) >= recCanon(b) ? a : b;
}
function mergeLedgers(local, remote, now) {
  var byId = {};
  (remote.records || []).forEach(function (r) { if (r && r.id) byId[r.id] = r; });
  (local.records || []).forEach(function (r) { if (r && r.id) byId[r.id] = byId[r.id] ? pickNewer(r, byId[r.id]) : r; });
  var cutoff = now - TOMBSTONE_TTL_MS;
  var records = Object.keys(byId).sort().map(function (k) { return byId[k]; })
    .filter(function (r) { return !(r.deleted && (Number(r.updatedAt) || 0) < cutoff); });
  var lr = Number(local.rateUpdatedAt) || 0, rr = Number(remote.rateUpdatedAt) || 0;
  var rate = lr > rr || remote.rate == null ? local.rate : remote.rate;
  return { records: records, rate: rate, rateUpdatedAt: Math.max(lr, rr) };
}
function ledgerCanon(l) {
  var rows = (l.records || []).map(function (r) {
    return [r.id, Number(r.updatedAt) || 0, r.deleted ? 1 : 0, r.deleted ? '' : recCanon(r)].join('#');
  }).sort();
  return JSON.stringify([rows, Number(l.rate) || 0]);
}
/* SYNC-MERGE-END */
export { mergeLedgers, ledgerCanon };

function localLedger() {
  const records = state.txns.map((t) => ({ id: t.id, title: t.title, amount: t.amount, type: t.type, category: t.category, date: t.date,
    createdAt: t.createdAt, updatedAt: t.updatedAt || t.createdAt, deleted: false }));
  Object.keys(state.deleted).forEach((id) => records.push({ id, deleted: true, updatedAt: state.deleted[id] }));
  return { records, rate: state.rate, rateUpdatedAt: state.rateUpdatedAt || 0 };
}

function applyMerged(merged) {
  const before = ledgerCanon(localLedger());
  const live = [], dead = {};
  merged.records.forEach((r) => {
    if (r.deleted) { dead[r.id] = Number(r.updatedAt) || Date.now(); return; }
    const t = sanitizeTxn(r);
    if (t) { t.id = r.id; live.push(t); }
  });
  state.txns = live;
  state.deleted = dead;
  if (validRate(merged.rate)) { state.rate = merged.rate; state.rateUpdatedAt = merged.rateUpdatedAt || 0; }
  const changed = before !== ledgerCanon(localLedger());
  persist('sync');
  return changed;
}

function fetchRemoteLedger(c, p, pass) {
  const path = syncPath(p);
  return gh(c, 'GET', contentsPath(path)).then((meta) => gh(c, 'GET', contentsPath(path), null, true).then((text) => {
    let env;
    try { env = JSON.parse(text); } catch (e) { throw new Error('The synced ledger on GitHub isn’t valid JSON.'); }
    return decryptBackup(env, pass).then((payload) => ({
      sha: meta && meta.sha,
      ledger: { records: Array.isArray(payload.records) ? payload.records : [], rate: payload.rate, rateUpdatedAt: payload.rateUpdatedAt }
    }), (e) => {
      if (e.code === 'bad_pass') {
        const er = new Error('Your passphrase doesn’t open the synced ledger for ' + p.name + '. Use the same passphrase as on your other devices.');
        er.code = 'bad_pass'; throw er;
      }
      throw e;
    });
  }), (e) => {
    if (e.status === 404) return { sha: null, ledger: { records: [], rate: null, rateUpdatedAt: 0 } };
    throw e;
  });
}

let again = false, syncTimer = null, backupTimer = null;

/** Pulls, merges and pushes. `manual` shows errors; automatic runs stay quiet unless the passphrase is wrong. */
export async function syncNow(p, manual) {
  if (!p) return false;
  const c = cloudCfg(p.id);
  if (!c || c.sync === false) { if (manual) emit('need-setup'); return false; }
  if (!hasWebCrypto()) { if (manual) emit('toast', { msg: 'This browser can’t encrypt on this page. Open the app from its https address.', tone: 'err' }); return false; }
  const pass = passphrase(p.id, c);
  if (!pass) { if (manual) emit('need-pass', { then: () => syncNow(p, true) }); return false; }
  if (status.syncing) { again = true; return false; }
  clearTimeout(syncTimer);
  status.syncing = true; emit('cloud');
  let attempt = 0, pulled = false;
  const round = async () => {
    attempt++;
    const remote = await fetchRemoteLedger(c, p, pass);
    if (state.profileId !== p.id) { const gone = new Error('switched'); gone.code = 'switched'; throw gone; }
    const merged = mergeLedgers(localLedger(), remote.ledger, Date.now());
    const mustPush = remote.sha ? ledgerCanon(merged) !== ledgerCanon(remote.ledger) : merged.records.length > 0;
    pulled = ledgerCanon(merged) !== ledgerCanon(localLedger());
    if (mustPush) {
      const env = await encryptBackup({ app: 'smart-spend-sync', version: 1, profile: p.name, updatedAt: Date.now(),
        rate: merged.rate, rateUpdatedAt: merged.rateUpdatedAt, records: merged.records }, pass);
      const body = { message: 'Smart Spend sync (' + slugOf(p) + ')', content: btoa(JSON.stringify(env)) };
      if (remote.sha) body.sha = remote.sha;
      try { await gh(c, 'PUT', contentsPath(syncPath(p)), body); }
      catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 3) return round(); throw e; }
    }
    return merged;
  };
  try {
    const merged = await round();
    const final = mergeLedgers(localLedger(), merged, Date.now());      // keep edits made mid-flight
    const changed = applyMerged(final);
    if (ledgerCanon(final) !== ledgerCanon(merged)) again = true;
    patchCfg(p.id, { syncAt: Date.now(), syncError: null });
    await syncProfileMeta(p, cloudCfg(p.id), pass);
    if (manual) emit('toast', { msg: 'Synced · ' + plural(state.txns.length, 'record') + (changed ? ' · changes from another device applied' : ''), tone: 'ok' });
    else if (changed && pulled) emit('toast', { msg: 'Synced changes from your other device', tone: 'ok' });
    return true;
  } catch (e) {
    if (e.code === 'switched') return false;
    patchCfg(p.id, { syncError: e.message });
    if (manual || e.code === 'bad_pass') emit('toast', { msg: 'Sync failed. ' + e.message, tone: 'err', duration: 8000 });
    return false;
  } finally {
    status.syncing = false; emit('cloud');
    if (again) { again = false; scheduleSync(p, 1500); }
  }
}

export function scheduleSync(p, delay) {
  if (!p) return;
  const c = cloudCfg(p.id);
  if (!c || c.sync === false || !passphrase(p.id, c)) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(p, false), delay || 4000);
}

/* ---------- snapshot backups ---------- */

export async function backupNow(p, auto) {
  if (!p) return false;
  const c = cloudCfg(p.id);
  if (!c) { if (!auto) emit('need-setup'); return false; }
  if (status.backingUp || !hasWebCrypto()) return false;
  const pass = passphrase(p.id, c);
  if (!pass) { if (!auto) emit('need-pass', { then: () => backupNow(p, false) }); return false; }
  status.backingUp = true; emit('cloud');
  const hash = sha256Hex(JSON.stringify([state.rate, state.txns])), count = state.txns.length;
  try {
    const env = await encryptBackup(buildBackupPayload(p.name), pass);
    const path = await uploadBackup(c, p, env);
    patchCfg(p.id, { lastAt: Date.now(), lastHash: hash, lastPath: path, lastError: null });
    emit('toast', { msg: (auto ? 'Daily backup saved online' : 'Backed up online') + ' · ' + plural(count, 'record'), tone: 'ok' });
    return true;
  } catch (e) {
    patchCfg(p.id, { lastError: e.message });
    emit('toast', { msg: (auto ? 'Daily backup failed. ' : '') + e.message, tone: 'err', duration: 8000 });
    return false;
  } finally {
    status.backingUp = false; emit('cloud');
  }
}

export function scheduleAutoBackup(p, delay) {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    const c = p && cloudCfg(p.id);
    if (!c || !c.auto || status.backingUp || !passphrase(p.id, c) || !hasWebCrypto()) return;
    if (Date.now() - (c.lastAt || 0) < AUTO_BACKUP_MS) return;
    if (!state.txns.length && !c.lastHash) return;
    if (sha256Hex(JSON.stringify([state.rate, state.txns])) === c.lastHash) return;
    backupNow(p, true);
  }, delay || 8000);
}

export function cancelTimers() { clearTimeout(syncTimer); clearTimeout(backupTimer); }

/* ---------- profile file: the PIN, shared by the person's devices ----------
   Kept in its own encrypted file (sync/<slug>/profile.json) rather than in the
   ledger, because the Android app v1.1 rewrites the ledger and would drop it. */

function profileMeta(p) {
  return {
    app: 'smart-spend-profile', version: 1, name: p.name, color: p.color, updatedAt: Date.now(),
    pinUpdatedAt: p.pinUpdatedAt || 0,
    pin: p.pinHash ? { salt: p.salt, hash: p.pinHash, algo: p.pinAlgo === 'pbkdf2' ? 'pbkdf2' : 'sha256x2000', iter: p.pinIter || null } : null
  };
}
async function fetchProfileMeta(c, p, pass) {
  let meta;
  try { meta = await gh(c, 'GET', contentsPath(profilePath(p))); } catch (e) { if (e.status === 404) return { sha: null, data: null }; throw e; }
  const text = await gh(c, 'GET', contentsPath(profilePath(p)), null, true);
  return { sha: meta.sha, data: await decryptBackup(JSON.parse(text), pass) };
}
async function pushProfileMeta(p, c, pass, sha) {
  const env = await encryptBackup(profileMeta(p), pass);
  const body = { message: 'Smart Spend profile (' + slugOf(p) + ')', content: btoa(JSON.stringify(env)) };
  if (sha) body.sha = sha;
  const res = await gh(c, 'PUT', contentsPath(profilePath(p)), body);
  patchCfg(p.id, { profileSha: res && res.content ? res.content.sha : null });
}
/** Newest PIN wins: adopt the other devices' PIN if it changed later, or publish ours. Best effort. */
async function syncProfileMeta(p, c, pass) {
  if (!c || !pass) return;
  try {
    let sha = null;
    try { sha = (await gh(c, 'GET', contentsPath(profilePath(p)))).sha; } catch (e) { if (e.status !== 404) throw e; }
    if (!sha) { if (p.pinHash) await pushProfileMeta(p, c, pass, null); return; }
    if (sha === c.profileSha) return;                              // unchanged since we last looked
    const cur = await fetchProfileMeta(c, p, pass);
    const remoteAt = (cur.data && cur.data.pinUpdatedAt) || 0, localAt = p.pinUpdatedAt || 0;
    if (cur.data && cur.data.pin && remoteAt > localAt) { adoptPin(p, cur.data); emit('pin-updated', p); }
    else if (p.pinHash && localAt > remoteAt) { await pushProfileMeta(p, c, pass, cur.sha); return; }
    patchCfg(p.id, { profileSha: cur.sha });
  } catch (e) { /* the ledger synced; the PIN will follow next time */ }
}
/** Publishes a PIN change right away (if online backup is set up and the passphrase is known). */
export function publishPin(p) {
  const c = cloudCfg(p.id), pass = passphrase(p.id, c);
  if (!c || !pass || !hasWebCrypto()) return Promise.resolve();
  return syncProfileMeta(p, Object.assign({}, c, { profileSha: null }), pass);
}

/**
 * "I already use Smart Spend": checks the details and reads what the person's other
 * devices saved for this profile name, without changing anything on this device.
 * Returns { repo, token, owner, meta, found }.
 */
export async function inspectExisting(input) {
  const name = String(input.name || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Enter your profile name exactly as it appears on your other device.');
  const token = (input.token || '').trim();
  if (token.length < 20 || /\s/.test(token)) throw new Error('Paste your GitHub access token.');
  if (!input.pass) throw new Error('Enter your backup passphrase.');
  if (!hasWebCrypto()) throw new Error('This browser can’t decrypt on this page. Open the app from its https address.');
  const temp = { id: '_join', name };
  let owner = null;
  try { owner = await tokenOwner(token); } catch (e) { if (e.status === 401) throw e; }
  const rp = repoParts(cleanRepo(input.repo) || (owner ? owner + '/' + DEFAULT_REPO_NAME : ''));
  if (!rp) throw new Error('Enter the repository as owner/name, for example ' + (owner || 'yourname') + '/' + DEFAULT_REPO_NAME + '.');
  const c = { repo: rp.owner + '/' + rp.name, token };
  if (owner && owner.toLowerCase() !== rp.owner.toLowerCase()) throw new Error('This token belongs to ' + owner + ', but ' + c.repo + ' is in ' + rp.owner + '’s account. Use ' + owner + '/' + DEFAULT_REPO_NAME + '.');
  await gh(c, 'GET', '');
  const [ledger, found] = await Promise.all([fetchRemoteLedger(c, temp, input.pass), listBackups(c, temp)]);
  let meta = null;
  try { meta = (await fetchProfileMeta(c, temp, input.pass)).data; } catch (e) { if (e.code === 'bad_pass') throw e; }
  if (!ledger.sha && !found.length && !meta) throw new Error('Nothing was found for “' + name + '” in ' + c.repo + '. Check the profile name matches your other device exactly.');
  if (!ledger.sha && found.length) {                                  // no synced ledger yet: prove the passphrase on a backup
    const env = await fetchBackup(c, found[0].path);
    if (isEncryptedBackup(env)) await decryptBackup(env, input.pass).catch((e) => { if (e.code === 'bad_pass') { const er = new Error('That passphrase doesn’t open the data for ' + name + '.'); er.code = 'bad_pass'; throw er; } throw e; });
  }
  return { repo: c.repo, token, owner, meta, found: found.length };
}

/* ---------- setup links: bring a new device over with only the passphrase ----------
   The link carries { name, repo, token } encrypted with the backup passphrase, in the
   URL fragment (after #), which browsers never send to the server. */

export const PUBLIC_APP_URL = 'https://khajamohiddinsyed.github.io/smart-spend/app/';
const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return atob(s); };

export async function makeSetupLink(p) {
  const c = cloudCfg(p.id), pass = passphrase(p.id, c);
  if (!c) throw new Error('Set up online backup first.');
  if (!pass) { const e = new Error('Enter the backup passphrase first.'); e.code = 'need_pass'; throw e; }
  const env = await encryptBackup({ app: 'smart-spend-link', v: 1, name: p.name, repo: c.repo, token: c.token, createdAt: Date.now() }, pass);
  // Links always open the public web app (the Android app accepts them pasted too).
  const onPublicSite = location.protocol === 'https:' && location.hostname.endsWith('github.io') && !window.Capacitor;
  const base = onPublicSite ? location.origin + location.pathname : PUBLIC_APP_URL;
  return base + '#join=' + b64url(JSON.stringify(env));
}

/** Pulls the encrypted part out of a pasted link (or the bare code). Null when it isn't one. */
export function parseSetupLink(text) {
  const m = /(?:^|#|[?&])join=([A-Za-z0-9_-]{40,})/.exec(String(text || '').trim()) || /^([A-Za-z0-9_-]{120,})$/.exec(String(text || '').trim());
  if (!m) return null;
  try { const env = JSON.parse(unb64url(m[1])); return isEncryptedBackup(env) ? env : null; } catch (e) { return null; }
}

export async function openSetupLink(env, pass) {
  const d = await decryptBackup(env, pass).catch((e) => {
    if (e.code === 'bad_pass') { const er = new Error('That passphrase doesn’t open this setup link. Use the backup passphrase from your other device.'); er.code = 'bad_pass'; throw er; }
    throw e;
  });
  if (!d || d.app !== 'smart-spend-link' || !d.name || !d.repo || !d.token) throw new Error('That setup link isn’t complete. Create a new one on your other device.');
  return d;
}

/* ---------- setup ---------- */

function repoParts(repo) {
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(String(repo || '').trim());
  return m ? { owner: m[1], name: m[2] } : null;
}
export function cleanRepo(v) {
  return String(v || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
}

/**
 * Tests access and saves the settings. Throws an Error whose `code` is
 * 'public' or 'mismatch' when pressing Save again should override it.
 * Returns { found } (number of existing backups).
 */
export async function setupCloud(p, input, flags) {
  const old = cloudCfg(p.id);
  const repo = cleanRepo(input.repo);
  const token = (input.token || '').trim() || (old ? old.token : '');
  if (!token) throw new Error('Paste a GitHub access token.');
  if (token.length < 20 || /\s/.test(token)) throw new Error('That doesn’t look like a GitHub access token.');
  const keep = !input.pass && !input.pass2 ? passphrase(p.id, old) : null;
  if (!keep) {
    if ((input.pass || '').length < 8) throw new Error('Choose a passphrase of at least 8 characters.');
    if (input.pass !== input.pass2) throw new Error('The two passphrases don’t match.');
  }
  const usePass = keep || input.pass;
  if (!hasWebCrypto()) throw new Error('This browser can’t encrypt on this page. Open the app from its https address.');

  // Who owns the token? A token can only reach repositories of its own account.
  let owner = null;
  try { owner = await tokenOwner(token); } catch (e) { if (e.status === 401) throw e; }
  const rp = repoParts(repo || (owner ? owner + '/' + DEFAULT_REPO_NAME : ''));
  if (!rp) throw new Error('Enter the repository as owner/name, for example ' + (owner || 'yourname') + '/' + DEFAULT_REPO_NAME + '.');
  const fullRepo = rp.owner + '/' + rp.name;
  if (owner && owner.toLowerCase() !== rp.owner.toLowerCase()) {
    const e = new Error('This token belongs to ' + owner + ', but ' + fullRepo + ' is in ' + rp.owner + '’s account. A token can only reach its own account’s repositories. Use ' + owner + '/' + DEFAULT_REPO_NAME + ' (create it first if needed).');
    e.code = 'owner'; e.suggest = owner + '/' + DEFAULT_REPO_NAME; throw e;
  }
  const sameRepo = old && old.repo === fullRepo;
  const cfg = {
    repo: fullRepo, token, owner, auto: !!input.auto, sync: input.sync !== false, remember: !!input.remember,
    pass: input.remember ? usePass : null, verifier: null, syncAt: sameRepo ? old.syncAt : 0,
    lastAt: sameRepo ? old.lastAt : 0, lastHash: sameRepo ? old.lastHash : null, lastPath: sameRepo ? old.lastPath : null, lastError: null
  };
  const info = await gh(cfg, 'GET', '');
  if (info && info.private === false && !flags.publicOk) { const e = new Error(fullRepo + ' is a public repository. The backups would still be encrypted, but anyone could copy them and see when each profile is used. Press Save again to use it anyway.'); e.code = 'public'; throw e; }
  const found = await listBackups(cfg, p);
  if (!flags.mismatchOk) {
    try {
      const remote = await fetchRemoteLedger(cfg, p, usePass);
      if (!remote.sha && found.length) {
        const env = await fetchBackup(cfg, found[0].path);
        if (isEncryptedBackup(env)) await decryptBackup(env, usePass);
      }
    } catch (e) {
      if (e.code === 'bad_pass') { const er = new Error('This passphrase doesn’t open the existing online data for ' + p.name + '. Enter the passphrase you used on your other devices, or press Save again to start fresh with this one.'); er.code = 'mismatch'; throw er; }
      throw e;
    }
  }
  cfg.verifier = await encryptBackup({ check: 'smart-spend' }, usePass);
  saveCfg(p.id, cfg);
  rememberSessionPass(p.id, usePass);
  await syncProfileMeta(p, cfg, usePass);
  return { found: found.length, owner };
}

/** Checks a typed passphrase against this profile's; remembers it on success. */
export async function providePassphrase(pid, pass, remember) {
  const c = cloudCfg(pid);
  if (c && c.verifier) {
    try { await decryptBackup(c.verifier, pass); } catch (e) { if (e.code === 'bad_pass') return false; throw e; }
  }
  rememberSessionPass(pid, pass);
  if (c) { c.remember = remember; c.pass = remember ? pass : null; saveCfg(pid, c); }
  return true;
}

export async function openEnvelope(pid, env, typed) {
  const pass = typed || passphrase(pid);
  if (!pass) { const e = new Error('Enter the passphrase.'); e.code = 'need_pass'; throw e; }
  return decryptBackup(env, pass);
}

/* ---------- status line ---------- */

export function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return plural(h, 'hour') + ' ago';
  const d = Math.round(h / 24);
  return d < 30 ? plural(d, 'day') + ' ago' : fmtDate(toISO(new Date(ms)));
}

/** { level: 'off'|'ok'|'busy'|'warn'|'error', title, detail } for the sync indicator and card. */
export function describe(pid) {
  const c = cloudCfg(pid);
  if (!c) return { level: 'off', title: 'Not set up', detail: 'Keep an encrypted copy in your private GitHub repository and sync with your other devices.' };
  if (status.syncing) return { level: 'busy', title: 'Syncing…', detail: c.repo };
  if (status.backingUp) return { level: 'busy', title: 'Backing up…', detail: c.repo };
  if (!passphrase(pid, c)) return { level: 'warn', title: 'Passphrase needed', detail: 'Enter the backup passphrase to sync and back up.' };
  if (c.sync !== false && c.syncError) return { level: 'error', title: 'Sync failed', detail: c.syncError };
  const parts = [];
  if (c.sync !== false) parts.push(c.syncAt ? 'Synced ' + timeAgo(c.syncAt) : 'Not synced yet');
  parts.push(c.lastAt ? 'backup ' + timeAgo(c.lastAt) : 'no backup yet');
  return { level: c.lastError ? 'warn' : 'ok', title: parts[0], detail: c.repo + ' · ' + parts.slice(1).join(' · ') + (c.lastError ? ' · last backup failed' : '') };
}
