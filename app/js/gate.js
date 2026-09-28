// Profile picker and PIN keypad: pick → (create | enter) PIN → ledger. Also change PIN and delete.

import { $, esc, plural, haptic } from './core.js';
import {
  profiles, findProfile, addProfile, removeProfile, pinMatches, setPin, clearPin, recordWrongPin, recordGoodPin,
  lockSecondsLeft, PIN_LEN, initialOf
} from './profiles.js';
import { countFor, removeProfileData, DATA_PREFIX } from './ledger.js';
import { forgetCloud, inspectExisting, setupCloud, tokenOwner, cleanRepo, DEFAULT_REPO_NAME, TOKEN_URL, parseSetupLink, openSetupLink } from './sync.js';
import { adoptPin, saveProfiles } from './profiles.js';
import { icon, avatar } from './ui.js';
import { store } from './core.js';
import { isNative } from './native.js';

const g = { open: false, screen: 'list', pid: null, mode: null, step: null, entry: '', first: null, err: '', info: false, busy: false, armed: false, overlay: false, link: null };
let hooks = { onUnlock: () => {}, onClose: () => {}, onDeleted: () => {} };
let ticker = null;

export function initGate(h) {
  hooks = Object.assign(hooks, h);
  const root = $('#gate');
  root.addEventListener('click', (e) => {
    const k = e.target.closest('[data-key]');
    if (k) { press(k.getAttribute('data-key')); return; }
    const a = e.target.closest('[data-g]');
    if (a) action(a.getAttribute('data-g'), a);
  });
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'jnLink') return;
    const env = parseSetupLink(e.target.value);
    if (env) show('join', { link: env });
    else if (e.target.value.trim().length > 20) { const m = $('#jnMsg'); if (m) m.textContent = 'That doesn’t look like a Smart Spend setup link.'; }
  });
  root.addEventListener('submit', (e) => { e.preventDefault(); if (e.target.id === 'addForm') add($('#newName').value); if (e.target.id === 'joinForm') join(); });
  document.addEventListener('keydown', (e) => {
    if (!g.open) return;
    if (g.screen === 'pin' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); return; }
      if (e.key === 'Backspace') { e.preventDefault(); press('del'); return; }
    }
    if (e.key === 'Escape') {
      if (g.overlay) { e.preventDefault(); close(); }
      else if (g.screen === 'forgot') show('pin', { pid: g.pid, mode: 'unlock' });
      else if (g.screen !== 'list') show('list');
    }
  });
}

export const gateOpen = () => g.open;
export const gateScreen = () => g.screen;

export function show(screen, o = {}) {
  Object.assign(g, { open: true, screen, pid: o.pid || null, mode: o.mode || null, step: o.step || null, entry: '', first: null,
    err: o.err || '', info: !!o.info, busy: false, armed: false, overlay: !!o.overlay, link: o.link || (screen === 'join' ? g.link : null) });
  const root = $('#gate');
  root.hidden = false;
  $('#app').setAttribute('inert', '');
  render();
  setTimeout(() => { const f = root.querySelector('[data-autofocus]') || root.querySelector('button'); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } } }, 40);
}

export function close() {
  g.open = false;
  clearInterval(ticker);
  $('#gate').hidden = true;
  $('#app').removeAttribute('inert');
  hooks.onClose();
}

const checking = () => g.mode === 'unlock' || g.step === 'current';

function prompt() {
  if (g.mode === 'unlock') return 'Enter your ' + PIN_LEN + '-digit PIN';
  if (g.mode === 'create') return g.step === 'confirm' ? 'Enter the same PIN again' : 'Create a ' + PIN_LEN + '-digit PIN to lock this profile';
  if (g.step === 'current') return 'Enter your current PIN';
  return g.step === 'confirm' ? 'Enter the new PIN again' : 'Choose a new ' + PIN_LEN + '-digit PIN';
}

function render() {
  clearInterval(ticker);
  const p = findProfile(g.pid);
  const brand = '<div class="brand"><span class="logo">' + icon('logo') + '</span>Smart Spend</div>';
  let h = '';
  if (g.screen === 'list') {
    h = brand + '<h1 class="g-title">Who’s tracking?</h1><p class="g-sub">Each profile keeps its own ledger and PIN on this device.</p><div class="pgrid">' +
      profiles.list.map((pr, i) => '<button class="pcard" data-g="pick" data-pid="' + esc(pr.id) + '"' + (i === 0 ? ' data-autofocus' : '') + '>' + avatar(pr, 56) +
        '<span class="pn">' + esc(pr.name) + '</span>' + (pr.pinHash ? '<span class="ps">' + icon('lock') + 'PIN locked</span>' : '<span class="ps new">New · set a PIN</span>') + '</button>').join('') +
      '<button class="pcard add" data-g="add"><span class="av" style="width:56px;height:56px;font-size:26px">+</span><span class="pn">Add profile</span><span class="ps">Separate ledger</span></button></div>' +
      '<button class="btn block" style="margin-top:14px" data-g="join">' + icon('cloud') + 'I already use Smart Spend on another device</button>';
  } else if (g.screen === 'add') {
    h = '<button class="g-back" data-g="to-list">' + icon('back') + 'Profiles</button>' + brand +
      '<h1 class="g-title">Add a profile</h1><p class="g-sub">Give it a name. You’ll set its PIN next.</p>' +
      '<form class="form" id="addForm" novalidate><input class="input" id="newName" maxlength="24" autocomplete="off" autocapitalize="words" placeholder="Name" data-autofocus aria-label="Profile name">' +
      '<div class="msg" id="addErr" role="alert">' + esc(g.err) + '</div><button class="btn primary block" type="submit">Continue</button></form>';
  } else if (g.screen === 'join' && g.link) {
    h = '<button class="g-back" data-g="to-list">' + icon('back') + 'Profiles</button>' + brand +
      '<h1 class="g-title">Setup link found</h1><p class="g-sub">Enter your backup passphrase to bring your entries, PIN and online backup to this device.</p>' +
      '<form class="form" id="joinForm" novalidate>' +
      '<label class="field">Backup passphrase<input class="input" id="jnPass" type="password" autocomplete="current-password" data-autofocus></label>' +
      '<label class="check"><input type="checkbox" id="jnRemember" checked><span>Remember the passphrase here<small>Needed for automatic sync. Turn off on a shared device.</small></span></label>' +
      '<div class="msg" id="jnMsg" role="alert"></div><button class="btn primary block" type="submit" id="jnGo">Connect</button>' +
      '<button class="gate-link" type="button" data-g="join-manual">Enter the details by hand instead</button></form>';
  } else if (g.screen === 'join') {
    h = '<button class="g-back" data-g="to-list">' + icon('back') + 'Profiles</button>' + brand +
      '<h1 class="g-title">Connect to your data</h1><p class="g-sub">Use the same details as on your other device. Your entries and your PIN come across.</p>' +
      '<form class="form" id="joinForm" novalidate>' +
      '<label class="field">Have a setup link?<input class="input" id="jnLink" autocomplete="off" spellcheck="false" placeholder="Paste it here"><span class="help">Create one on your other device: Settings → Add another device.</span></label>' +
      '<div class="dim" style="text-align:center;font-size:12.5px;font-weight:650">or enter the details</div>' +
      '<label class="field">Profile name<input class="input" id="jnName" autocomplete="off" autocapitalize="words" placeholder="e.g. Sharooq" data-autofocus></label>' +
      '<label class="field">GitHub access token<div style="display:flex;gap:8px"><input class="input" id="jnToken" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"><button type="button" class="btn sm" data-g="join-check" style="min-height:48px">Check</button></div>' +
      '<span class="help" id="jnOwner">The token you made for Smart Spend. Lost it? <a href="' + TOKEN_URL + '" target="_blank" rel="noopener noreferrer">Create a new one</a> with the same settings.</span></label>' +
      '<label class="field">Repository<input class="input" id="jnRepo" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="yourname/' + DEFAULT_REPO_NAME + '"><span class="help">Shown on your other device under Settings → Online backup.</span></label>' +
      '<label class="field">Backup passphrase<input class="input" id="jnPass" type="password" autocomplete="current-password"></label>' +
      '<label class="check"><input type="checkbox" id="jnRemember" checked><span>Remember the passphrase here<small>Needed for automatic sync. Turn off on a shared device.</small></span></label>' +
      '<div class="msg" id="jnMsg" role="alert"></div><button class="btn primary block" type="submit" id="jnGo">Connect</button></form>';
  } else if (g.screen === 'pin' && p) {
    const secs = checking() ? lockSecondsLeft(p) : 0;
    const err = secs ? 'Too many wrong tries. Try again in ' + secs + 's.' : g.err;
    let dots = '';
    for (let i = 0; i < PIN_LEN; i++) dots += '<i' + (i < g.entry.length ? ' class="on"' : '') + '></i>';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => '<button class="key" data-key="' + k + '"' + (secs ? ' disabled' : '') + '>' + k + '</button>').join('') +
      '<span></span><button class="key" data-key="0"' + (secs ? ' disabled' : '') + '>0</button><button class="key ghost" data-key="del" aria-label="Delete last digit"' + (secs ? ' disabled' : '') + '>' + icon('del') + '</button>';
    h = '<button class="g-back" data-g="' + (g.overlay ? 'cancel' : 'to-list') + '">' + icon('back') + (g.overlay ? 'Cancel' : 'Profiles') + '</button>' +
      '<div class="pin-head">' + avatar(p, 68) + '<div class="pn">' + esc(p.name) + '</div><div class="pp" id="pinPrompt">' + esc(prompt()) + '</div></div>' +
      '<div class="dots-row" id="pinDots" role="img" aria-label="' + g.entry.length + ' of ' + PIN_LEN + ' digits entered">' + dots + '</div>' +
      '<div class="pin-err' + (g.info && !secs ? ' info' : '') + '" id="pinErr" role="alert">' + esc(err) + '</div>' +
      '<div class="keypad">' + keys + '</div>' +
      (g.mode === 'unlock' ? '<button class="gate-link" data-g="forgot">Forgot PIN?</button>' : '');
    if (secs) ticker = setInterval(() => { if (lockSecondsLeft(p) <= 0) g.err = ''; render(); }, 1000);
  } else if ((g.screen === 'forgot' || g.screen === 'delete') && p) {
    const n = countFor(p.id), del = g.screen === 'delete';
    h = '<button class="g-back" data-g="' + (del ? 'cancel' : 'back-pin') + '">' + icon('back') + (del ? 'Cancel' : 'Back') + '</button>' +
      '<div class="pin-head">' + avatar(p, 68) + '<div class="pn">' + esc(p.name) + '</div></div>' +
      '<h1 class="g-title" style="text-align:center;font-size:24px">' + (del ? 'Delete this profile?' : 'Reset the PIN?') + '</h1>' +
      '<div class="warnbox">' + (del ? 'This removes <b>' + esc(p.name) + '</b>, its PIN and its ' + plural(n, 'record') + ' from this device.'
        : 'A PIN can’t be recovered. Resetting erases <b>' + esc(p.name) + '</b>’s ' + plural(n, 'record') + ' and online-backup settings on this device, then you choose a new PIN. Online backups stay on GitHub and can be restored with the backup passphrase.') + ' This can’t be undone.</div>' +
      '<div style="display:flex;gap:10px;margin-top:18px"><button class="btn" style="flex:1" data-g="' + (del ? 'cancel' : 'back-pin') + '" data-autofocus>Cancel</button>' +
      '<button class="btn danger' + (g.armed ? ' armed' : '') + '" style="flex:1" data-g="' + (del ? 'confirm-delete' : 'confirm-reset') + '">' + (g.armed ? 'Tap again to confirm' : del ? 'Delete profile' : 'Erase and reset') + '</button></div>';
  } else { g.screen = 'list'; render(); return; }
  $('#gate').innerHTML = '<div class="gate-card">' + h + '</div>' + (g.screen === 'list' && /^https?:$/.test(location.protocol) && !isNative ? '<a class="gate-foot" href="../">Get the Android app</a>' : '');
}

function dotsUpdate(shake) {
  const d = $('#pinDots');
  if (!d) { render(); return; }
  Array.from(d.children).forEach((x, i) => x.classList.toggle('on', i < g.entry.length));
  d.setAttribute('aria-label', g.entry.length + ' of ' + PIN_LEN + ' digits entered');
  if (shake) { d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); }
}

function fail(msg) {
  haptic([30, 40, 30]);
  dotsUpdate(true);
  setTimeout(() => { g.entry = ''; g.err = msg; g.info = false; g.busy = false; render(); }, 380);
}
function step(next, info) { setTimeout(() => { g.step = next; g.entry = ''; g.err = info || ''; g.info = !!info; g.busy = false; render(); }, 150); }

function press(k) {
  if (!g.open || g.screen !== 'pin' || g.busy) return;
  const p = findProfile(g.pid);
  if (!p || (checking() && lockSecondsLeft(p) > 0)) return;
  if (k === 'del') { g.entry = g.entry.slice(0, -1); dotsUpdate(); return; }
  if (!/^\d$/.test(k) || g.entry.length >= PIN_LEN) return;
  g.entry += k;
  haptic(6);
  if (g.err && !g.info) { g.err = ''; const e = $('#pinErr'); if (e) e.textContent = ''; }
  dotsUpdate();
  if (g.entry.length === PIN_LEN) { g.busy = true; setTimeout(submit, 110); }
}

async function submit() {
  const p = findProfile(g.pid);
  if (!p) { show('list'); return; }
  const pin = g.entry;
  if (checking()) {
    let ok = false;
    try { ok = await pinMatches(p, pin); } catch (e) { ok = false; }
    if (!ok) {
      const left = recordWrongPin(p);
      fail(left ? 'Wrong PIN. ' + plural(left, 'try', 'tries') + ' left.' : '');
      return;
    }
    recordGoodPin(p);
    if (g.mode === 'unlock') { unlock(p); return; }
    step('new');
    return;
  }
  if (g.step === 'new') { g.first = pin; step('confirm'); return; }
  if (pin !== g.first) { g.first = null; g.step = 'new'; fail('Those PINs didn’t match. Choose the PIN again.'); return; }
  setPin(p, pin);
  if (hooks.onPinChanged) hooks.onPinChanged(p);
  if (g.mode === 'change') { close(); hooks.onToast && hooks.onToast('PIN changed for ' + p.name); }
  else unlock(p, 'PIN set. Use it to open ' + p.name + ' next time.');
}

function unlock(p, message) {
  haptic(10);
  g.open = false;
  clearInterval(ticker);
  $('#gate').hidden = true;
  $('#app').removeAttribute('inert');
  hooks.onUnlock(p, message);
}

function armGate() {
  if (g.armed) return true;
  g.armed = true; render();
  setTimeout(() => { if (g.open) { g.armed = false; render(); } }, 3500);
  return false;
}

function action(act, el) {
  const p = findProfile(g.pid);
  if (act === 'pick') {
    const pr = findProfile(el.getAttribute('data-pid'));
    if (pr) show('pin', pr.pinHash ? { pid: pr.id, mode: 'unlock' } : { pid: pr.id, mode: 'create', step: 'new' });
  } else if (act === 'add') show('add');
  else if (act === 'join') show('join');
  else if (act === 'join-manual') { g.link = null; show('join'); }
  else if (act === 'join-check') joinCheck();
  else if (act === 'to-list') show('list');
  else if (act === 'cancel') close();
  else if (act === 'forgot' && p) show('forgot', { pid: p.id });
  else if (act === 'back-pin' && p) show('pin', { pid: p.id, mode: 'unlock' });
  else if (act === 'confirm-reset' && p && armGate()) {
    store.setJSON(DATA_PREFIX + p.id, { v: 1, transactions: [] });
    forgetCloud(p.id);                               // someone without the PIN must not inherit the token or passphrase
    clearPin(p);
    show('pin', { pid: p.id, mode: 'create', step: 'new', err: 'Data erased. Choose a new PIN.', info: true });
  } else if (act === 'confirm-delete' && p && armGate()) {
    removeProfileData(p.id);
    forgetCloud(p.id);
    removeProfile(p.id);
    hooks.onDeleted(p);
    show('list');
  }
}

function add(name) {
  const r = addProfile(name);
  if (r.error) { g.err = r.error; const box = $('#addErr'); if (box) box.textContent = r.error; const i = $('#newName'); if (i) { i.classList.add('bad'); i.focus(); } return; }
  show('pin', { pid: r.profile.id, mode: 'create', step: 'new' });
}

/* ---------- "I already use Smart Spend" ---------- */

const jmsg = (t, tone) => { const m = $('#jnMsg'); if (m) { m.className = 'msg' + (tone ? ' ' + tone : ''); m.textContent = t; } };

async function joinCheck() {
  const tok = $('#jnToken').value.trim();
  if (!tok) { jmsg('Paste the token first.'); return; }
  $('#jnOwner').textContent = 'Checking…';
  try {
    const owner = await tokenOwner(tok);
    $('#jnOwner').innerHTML = owner ? 'Token belongs to <b>' + esc(owner) + '</b>.' : 'Token accepted.';
    const r = $('#jnRepo');
    if (owner && !r.value) r.value = owner + '/' + DEFAULT_REPO_NAME;
    jmsg('');
  } catch (e) { $('#jnOwner').textContent = ''; jmsg(e.message); }
}

async function join() {
  const btn = $('#jnGo');
  let input;
  if (g.link) {
    const pass = $('#jnPass').value;
    if (!pass) { jmsg('Enter your backup passphrase.'); return; }
    btn.disabled = true;
    jmsg('Opening the setup link…', 'info');
    try {
      const d = await openSetupLink(g.link, pass);
      input = { name: d.name, token: d.token, repo: d.repo, pass, remember: $('#jnRemember').checked };
    } catch (e) { btn.disabled = false; jmsg(e.message); return; }
  } else {
    input = { name: $('#jnName').value, token: $('#jnToken').value, repo: cleanRepo($('#jnRepo').value), pass: $('#jnPass').value, remember: $('#jnRemember').checked };
  }
  btn.disabled = true;
  jmsg('Checking your details… this takes a few seconds.', 'info');
  try {
    const found = await inspectExisting(input);
    const name = input.name.replace(/\s+/g, ' ').trim();
    // Reuse a matching profile that has no PIN yet (e.g. the built-in Sharooq); never take over one that does.
    let p = profiles.list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (p && p.pinHash) throw new Error('A profile called ' + p.name + ' is already set up on this device. Open it, then connect online backup from Settings.');
    if (!p) { const r = addProfile(name); if (r.error) throw new Error(r.error); p = r.profile; }
    await setupCloud(p, { repo: found.repo, token: found.token, pass: input.pass, pass2: input.pass, sync: true, remember: input.remember, auto: true },
      { publicOk: true, mismatchOk: false });
    if (found.meta && adoptPin(p, found.meta)) {
      g.link = null;
      unlock(p, 'Welcome back, ' + p.name + '. Your entries are syncing, and your PIN is the same as on your other device.');
    } else {
      saveProfiles();
      g.link = null;
      show('pin', { pid: p.id, mode: 'create', step: 'new', err: 'Connected. Your other device hasn’t shared a PIN yet, so choose one for this device.', info: true });
    }
  } catch (e) {
    btn.disabled = false;
    jmsg(e.code === 'mismatch' || e.code === 'bad_pass' ? 'That passphrase doesn’t open the data for this profile. Use the passphrase from your other device.' : e.message);
  }
}

export { initialOf };
