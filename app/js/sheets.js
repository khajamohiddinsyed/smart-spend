// Bottom sheets: quick add, edit, budgets, online backup setup, passphrase, restore.

import { $, esc, plural, fmtDate, fromISO, round2, haptic, todayISO, MONTHS_FULL, pad } from './core.js';
import { CATEGORIES, catOf } from './categories.js';
import { parseInput } from './parser.js';
import {
  state, addItems, updateTxn, deleteTxn, restoreSnapshot, getBudgets, setBudget, readBackup, applyBackup
} from './ledger.js';
import {
  cloudCfg, setupCloud, forgetCloud, providePassphrase, passphrase, listBackups, fetchBackup, isEncryptedBackup,
  openEnvelope, syncNow, backupNow, tokenOwner, cleanRepo, DEFAULT_REPO_NAME, TOKEN_URL, NEW_REPO_URL, timeAgo, makeSetupLink
} from './sync.js';
import { slugOf } from './profiles.js';
import { ui } from './appstate.js';
import { icon, catIcon, openSheet, updateSheet, closeSheet, toast, money, moneyAlt, armed, prefs } from './ui.js';

const EXPENSE_CATS = CATEGORIES.filter((c) => c.id !== 'Salary' && c.id !== 'Freelance');

/* ============================== QUICK ADD ============================== */

let qa = null;

function catChips(selected) {
  return '<div class="chips" role="group" aria-label="Category">' +
    '<button class="chip auto" data-qa="cat" data-cat="" aria-pressed="' + !selected + '">' + icon('spark') + 'Auto</button>' +
    CATEGORIES.map((c) => '<button class="chip" data-qa="cat" data-cat="' + c.id + '" style="--cat:' + c.color + '" aria-pressed="' + (selected === c.id) + '"><i></i>' + esc(c.label) + '</button>').join('') + '</div>';
}

function qaCtx() {
  const d = fromISO(qa.date);
  return { anchor: qa.date, refYear: d.getFullYear(), refMonth: d.getMonth(), forced: qa.forced, rate: state.rate, learned: state.learned };
}

function qaPreview() {
  const box = $('#qaPreview');
  if (!box) return;
  const text = $('#qaText').value;
  if (!text.trim()) { box.innerHTML = ''; qa.items = []; syncQaButton(); return; }
  const res = parseInput(text, qaCtx());
  qa.items = res.items;
  let html = '<div class="pv-h">' + (res.items.length ? 'Will add ' + plural(res.items.length, 'entry', 'entries') : 'Add an amount, like “coffee 12”') + '</div>';
  html += res.items.map((it) => {
    const c = catOf(it.category);
    const when = dateLabel(it.date) + (it.dated ? ' · from your text' : '');
    const note = it.forced ? 'your pick' : it.catSource === 'learned' ? 'learned' : it.catSource === 'typo' ? it.catHint : '';
    return '<div class="pv-item">' + catIcon(it.category) +
      '<div style="min-width:0"><div class="pv-t">' + esc(it.title) + '</div><div class="pv-m"><span>' + esc(c.label) + (note ? ' · ' + esc(note) : '') + '</span><span>' + esc(when) + '</span>' +
      (it.currency === 'INR' ? '<span class="note">₹' + esc(it.original.toLocaleString('en-IN')) + ' converted</span>' : '') +
      (it.product ? '<span class="note">' + it.product.qty + ' × ' + esc(String(it.product.unit)) + '</span>' : '') + '</div></div>' +
      '<div class="pv-a num ' + (it.type === 'in' ? 'in-c' : '') + '">' + (it.type === 'in' ? '+' : '−') + esc(money(it.amount).replace(/^−/, '')) + '<small>' + esc(moneyAlt(it.amount)) + '</small></div></div>';
  }).join('');
  if (res.skipped.length) html += '<div class="pv-skip">No amount found in: ' + res.skipped.map((s) => '“' + esc(s) + '”').join(', ') + '</div>';
  box.innerHTML = html;
  syncQaButton();
}
function syncQaButton() {
  const b = document.querySelector('[data-qa="save"]');
  if (b) { b.disabled = !qa.items.length; b.textContent = qa.items.length > 1 ? 'Add ' + qa.items.length + ' entries' : 'Add entry'; }
}
function dateLabel(iso) { return iso === todayISO() ? 'Today' : fmtDate(iso); }
function yesterdayISO() { const d = fromISO(todayISO()); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function dateRow() {
  const t = todayISO(), y = yesterdayISO(), custom = qa.date !== t && qa.date !== y;
  return '<div class="qa-date" role="group" aria-label="Date">' +
    '<button type="button" data-qa="d-set" data-d="' + t + '" aria-pressed="' + (qa.date === t) + '">Today</button>' +
    '<button type="button" data-qa="d-set" data-d="' + y + '" aria-pressed="' + (qa.date === y) + '">Yesterday</button>' +
    '<label class="pick" aria-pressed="' + custom + '">' + icon('activity') + '<span>' + (custom ? esc(fmtDate(qa.date)) : 'Pick a date') + '</span>' +
    '<input type="date" id="qaDate" value="' + qa.date + '" aria-label="Pick a date"></label></div>';
}
function setQaDate(iso) { qa.date = iso; $('#qaDateRow').innerHTML = dateRow(); qaPreview(); }

export function openQuickAdd(prefill) {
  qa = { date: ui.selected, forced: null, items: [], timer: null };
  const body =
    '<label class="sr" for="qaText">What happened?</label>' +
    '<textarea class="input" id="qaText" data-autofocus rows="3" placeholder="e.g. Got cash 450 on 24th sep and spent 40 on fuel" autocomplete="off" spellcheck="false">' + esc(prefill || '') + '</textarea>' +
    '<div class="examples">' + ['spent 40 on fuel and 18 coffee', 'salary 14,500 credited', 'panda groceries 212.50 yesterday', '₹500 jio recharge'].map((e) => '<button data-qa="ex" data-ex="' + esc(e) + '">' + esc(e) + '</button>').join('') + '</div>' +
    '<div class="field-lbl">Date</div><div id="qaDateRow">' + dateRow() + '</div>' +
    '<p class="help" style="margin:6px 0 12px">A date you type, like “24th sep” or “yesterday”, still wins for that entry.</p>' +
    '<div class="field-lbl">Category</div>' +
    '<div id="qaCats">' + catChips(null) + '</div>' +
    '<div class="pv" id="qaPreview" aria-live="polite"></div>';
  openSheet({
    title: 'Add entry', body, focusOnTouch: true,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-qa="save" disabled>Add entry</button>',
    onOpen: () => { if (prefill) qaPreview(); },
    input: (e) => {
      if (e.target.id === 'qaText') { clearTimeout(qa.timer); qa.timer = setTimeout(qaPreview, 110); }
    },
    change: (e) => {
      if (e.target.id === 'qaDate' && e.target.value) setQaDate(e.target.value);
    },
    click: (e, t) => {
      const pick = t.closest('.qa-date .pick');
      if (pick && t.tagName !== 'INPUT') { const inp = $('#qaDate'); try { inp.showPicker(); } catch (err) { inp.focus(); } return; }
      const b = t.closest('[data-qa]');
      if (!b) return;
      const act = b.getAttribute('data-qa');
      if (act === 'ex') { $('#qaText').value = b.getAttribute('data-ex'); qaPreview(); }
      else if (act === 'd-set') setQaDate(b.getAttribute('data-d'));
      else if (act === 'cat') { const c = b.getAttribute('data-cat') || null; qa.forced = qa.forced === c ? null : c; $('#qaCats').innerHTML = catChips(qa.forced); qaPreview(); }
      else if (act === 'save') saveQuick();
    }
  });
  $('#qaText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveQuick(); } });
}

function saveQuick() {
  if (!qa || !qa.items.length) return;
  const snapBefore = { txns: state.txns.map((t) => Object.assign({}, t)), rate: state.rate, sample: state.sample, learned: JSON.parse(JSON.stringify(state.learned)) };
  const added = addItems(qa.items);
  added.forEach((t) => { ui.flash[t.id] = true; });
  haptic(12);
  closeSheet();
  const other = [...new Set(added.map((t) => t.date))].filter((d) => d !== ui.selected);
  toast('Added ' + plural(added.length, 'entry', 'entries') + (other.length === 1 ? ' · ' + fmtDate(other[0]) : ''), {
    tone: 'ok', actionLabel: 'Undo', onAction: () => { restoreSnapshot(snapBefore); toast('Removed'); }
  });
}

/* ================================ EDIT ================================ */

export function openEdit(id) {
  const t = state.txns.find((x) => x.id === id);
  if (!t) return;
  let type = t.type;
  const body = '<form class="form" id="editForm" novalidate>' +
    '<label class="field">Description<input class="input" id="edTitle" maxlength="120" value="' + esc(t.title) + '" autocomplete="off"></label>' +
    '<div class="row-2"><label class="field">Amount (SAR)<input class="input num" id="edAmt" type="number" inputmode="decimal" step="0.01" min="0.01" value="' + t.amount + '"><span class="help num" id="edInr">≈ ' + esc(moneyAlt(t.amount)) + '</span></label>' +
    '<label class="field">Date<input class="input" id="edDate" type="date" value="' + t.date + '"></label></div>' +
    '<div class="field">Type<div class="flow" id="edFlow"><button type="button" data-type="in" aria-pressed="' + (type === 'in') + '">' + icon('arrowIn') + 'Money in</button><button type="button" data-type="out" aria-pressed="' + (type === 'out') + '">' + icon('arrowOut') + 'Money out</button></div></div>' +
    '<label class="field">Category<select class="input" id="edCat">' + CATEGORIES.map((c) => '<option value="' + c.id + '"' + (c.id === t.category ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('') + '</select></label>' +
    '<div class="msg" id="edMsg" role="alert"></div></form>';
  openSheet({
    title: 'Edit entry', body,
    foot: '<button class="btn danger" data-ed="delete">' + icon('trash') + 'Delete</button><button class="btn primary" data-ed="save">Save</button>',
    input: (e) => { if (e.target.id === 'edAmt') { const v = parseFloat(e.target.value); $('#edInr').textContent = v > 0 ? '≈ ' + moneyAlt(v) : ''; } },
    submit: () => save(),
    click: (e, b) => {
      const f = b.closest('#edFlow [data-type]');
      if (f) { type = f.getAttribute('data-type'); document.querySelectorAll('#edFlow [data-type]').forEach((x) => x.setAttribute('aria-pressed', String(x === f))); return; }
      const a = b.closest('[data-ed]');
      if (!a) return;
      if (a.getAttribute('data-ed') === 'save') save();
      if (a.getAttribute('data-ed') === 'delete' && armed(a)) { closeSheet(); removeWithUndo(t.id); }
    }
  });
  function save() {
    const title = $('#edTitle').value.replace(/\s+/g, ' ').trim(), amount = round2(parseFloat($('#edAmt').value)), date = $('#edDate').value;
    const errs = [];
    $('#edTitle').classList.toggle('bad', !title); if (!title) errs.push('a description');
    const badAmt = !(amount > 0 && amount <= 1e9); $('#edAmt').classList.toggle('bad', badAmt); if (badAmt) errs.push('an amount above 0');
    const badDate = !/^\d{4}-\d{2}-\d{2}$/.test(date); $('#edDate').classList.toggle('bad', badDate); if (badDate) errs.push('a date');
    if (errs.length) { $('#edMsg').textContent = 'Please enter ' + errs.join(', ') + '.'; return; }
    updateTxn(t.id, { title: title.slice(0, 120), amount, date, type, category: $('#edCat').value });
    ui.flash[t.id] = true;
    closeSheet();
    toast('Saved', { tone: 'ok' });
  }
}

export function removeWithUndo(id) {
  const r = deleteTxn(id);
  if (!r) return;
  haptic(18);
  const title = r.removed.title.length > 26 ? r.removed.title.slice(0, 25) + '…' : r.removed.title;
  toast('Deleted “' + title + '”', { actionLabel: 'Undo', onAction: () => { restoreSnapshot(r.snap); toast('Restored', { tone: 'ok' }); } });
}

/* =============================== BUDGETS =============================== */

export function openBudgets() {
  const b = getBudgets();
  const body = '<p class="help" style="margin:0 0 14px">Monthly limits in SAR. Leave a box empty for no limit. You’ll see a warning at 80% and when you go over.</p>' +
    '<form class="form" id="budForm" novalidate>' + EXPENSE_CATS.map((c) =>
      '<label class="field" style="flex-direction:row;align-items:center;gap:12px">' + catIcon(c.id) + '<span style="flex:1;color:var(--text);font-size:15px">' + esc(c.label) + '</span>' +
      '<input class="input num" style="width:130px;text-align:right" type="number" inputmode="decimal" min="0" step="1" data-bud="' + c.id + '" value="' + (b[c.id] || '') + '" placeholder="No limit" aria-label="' + esc(c.label) + ' budget"></label>').join('') + '</form>';
  openSheet({
    title: 'Budgets', body,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-bud-save>Save budgets</button>',
    submit: () => saveB(),
    click: (e, t) => { if (t.closest('[data-bud-save]')) saveB(); }
  });
  function saveB() {
    document.querySelectorAll('[data-bud]').forEach((inp) => setBudget(inp.getAttribute('data-bud'), inp.value));
    closeSheet();
    toast('Budgets saved', { tone: 'ok' });
  }
}

/* =========================== ONLINE BACKUP SETUP =========================== */

export function openCloudSetup() {
  const p = ui.profile, c = cloudCfg(p.id), hasPass = !!passphrase(p.id, c);
  const flags = { publicOk: false, mismatchOk: false };
  const body =
    '<p class="help" style="margin:0 0 16px;font-size:13.5px">Your entries are encrypted on this device with a passphrase only you know, then saved to a private GitHub repository in <b>your own</b> account. Use the same repository and passphrase on your phone and computer to keep them in sync.</p>' +
    (c ? '' : '<div class="set-group" style="margin-bottom:16px">' +
      '<a class="set-row" href="' + NEW_REPO_URL + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit"><span class="set-ico">1</span><span class="set-main"><b>Create your backup repository</b><span>Opens GitHub with the name and “Private” filled in. Tick “Add a README”, then Create.</span></span><span class="chev">' + icon('next') + '</span></a>' +
      '<a class="set-row" href="' + TOKEN_URL + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit"><span class="set-ico">2</span><span class="set-main"><b>Create an access token</b><span>Opens GitHub with Contents: Read and write filled in. Under Repository access pick “Only select repositories” → smart-spend-backups, then Generate and copy it.</span></span><span class="chev">' + icon('next') + '</span></a></div>') +
    '<form class="form" id="cloudForm" novalidate>' +
    '<label class="field">' + (c ? '' : '3 · ') + 'GitHub access token<div style="display:flex;gap:8px"><input class="input" id="cfToken" type="password" autocomplete="off" spellcheck="false" placeholder="' + (c ? 'Saved. Leave blank to keep it' : 'github_pat_…') + '"><button type="button" class="btn sm" data-cf="check" style="min-height:48px">Check</button></div><span class="help" id="cfOwner"></span></label>' +
    '<label class="field">Repository<input class="input" id="cfRepo" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="yourname/' + DEFAULT_REPO_NAME + '" value="' + esc(c ? c.repo : '') + '"><span class="help">Filled in for you after Check. Saved in <code>backups/' + esc(slugOf(p)) + '/</code> and <code>sync/' + esc(slugOf(p)) + '/</code>.</span></label>' +
    '<label class="field">Backup passphrase<input class="input" id="cfPass" type="password" autocomplete="new-password" placeholder="' + (hasPass ? 'Saved. Leave blank to keep it' : 'At least 8 characters') + '"></label>' +
    '<label class="field">Confirm passphrase<input class="input" id="cfPass2" type="password" autocomplete="new-password"><span class="help">Use the same passphrase for ' + esc(p.name) + ' on every device. It can’t be recovered.</span></label>' +
    '<label class="check"><input type="checkbox" id="cfSync"' + (!c || c.sync !== false ? ' checked' : '') + '><span>Sync with my other devices<small>Entries merge automatically; when the same entry changed in two places, the latest edit wins.</small></span></label>' +
    '<label class="check"><input type="checkbox" id="cfRemember"' + (!c || c.remember ? ' checked' : '') + '><span>Remember the passphrase here<small>Needed for automatic sync. Turn off on a shared device.</small></span></label>' +
    '<label class="check"><input type="checkbox" id="cfAuto"' + (!c || c.auto ? ' checked' : '') + '><span>Keep daily backups<small>A dated snapshot at most once a day, only when something changed.</small></span></label>' +
    '<div class="msg" id="cfMsg" role="alert"></div></form>';
  openSheet({
    title: c ? 'Online backup' : 'Set up online backup', body,
    foot: (c ? '<button class="btn danger" data-cf="disconnect">Disconnect</button>' : '<button class="btn" data-close>Cancel</button>') + '<button class="btn primary" data-cf="save">Save and test</button>',
    submit: () => save(),
    click: (e, t) => {
      const b = t.closest('[data-cf]');
      if (!b) return;
      const act = b.getAttribute('data-cf');
      if (act === 'check') check();
      if (act === 'save') save();
      if (act === 'disconnect' && armed(b, 'Tap again to disconnect')) { forgetCloud(p.id); closeSheet(); toast('Disconnected. The token and passphrase were removed from this device; backups on GitHub are untouched.'); }
    }
  });
  const msg = (text, tone) => { const m = $('#cfMsg'); if (m) { m.className = 'msg' + (tone ? ' ' + tone : ''); m.textContent = text; } };
  async function check() {
    const tok = $('#cfToken').value.trim() || (c ? c.token : '');
    if (!tok) { msg('Paste the token first.'); return; }
    $('#cfOwner').textContent = 'Checking…';
    try {
      const owner = await tokenOwner(tok);
      $('#cfOwner').innerHTML = owner ? 'Token belongs to <b>' + esc(owner) + '</b>.' : 'Token accepted.';
      const r = $('#cfRepo');
      if (owner && (!r.value || !r.value.toLowerCase().startsWith(owner.toLowerCase() + '/'))) r.value = owner + '/' + DEFAULT_REPO_NAME;
      msg('');
    } catch (e) { $('#cfOwner').textContent = ''; msg(e.message); }
  }
  async function save() {
    const btn = document.querySelector('[data-cf="save"]');
    btn.disabled = true;
    msg('Checking access…', 'info');
    try {
      const res = await setupCloud(p, {
        repo: cleanRepo($('#cfRepo').value), token: $('#cfToken').value, pass: $('#cfPass').value, pass2: $('#cfPass2').value,
        sync: $('#cfSync').checked, remember: $('#cfRemember').checked, auto: $('#cfAuto').checked
      }, flags);
      closeSheet();
      toast('Online backup connected' + (res.owner ? ' · ' + res.owner : ''), { tone: 'ok' });
      const cfg = cloudCfg(p.id);
      if (cfg.sync !== false) await syncNow(p, false);
      if (!state.txns.length && res.found) { openRestore(); toast('Found ' + plural(res.found, 'backup') + ' for ' + p.name + '. Pick one to restore.', { tone: 'ok', duration: 6000 }); }
      else if (state.txns.length && !cfg.lastHash) backupNow(p, true);
    } catch (e) {
      btn.disabled = false;
      if (e.code === 'public') flags.publicOk = true;
      if (e.code === 'mismatch') flags.mismatchOk = true;
      if (e.code === 'owner' && e.suggest) $('#cfRepo').value = e.suggest;
      msg(e.message);
    }
  }
}

/* ============================ ADD ANOTHER DEVICE ============================ */

export async function openAddDevice() {
  const p = ui.profile;
  let link;
  try { link = await makeSetupLink(p); }
  catch (e) { if (e.code === 'need_pass') { askPassphrase(() => openAddDevice()); return; } toast(e.message, { tone: 'err' }); return; }
  const canShare = !!navigator.share;
  openSheet({
    title: 'Add another device',
    body: '<p class="help" style="margin:0 0 14px;font-size:14px">Send this link to yourself (for example on WhatsApp or by email) and open it on the new phone or computer. There you’ll only need your <b>backup passphrase</b>: the repository, token, entries and PIN come across by themselves.</p>' +
      '<label class="field">Setup link<textarea class="input" id="devLink" rows="4" readonly style="font-size:12.5px;min-height:92px">' + esc(link) + '</textarea></label>' +
      '<div class="msg info" id="devMsg" style="margin-top:6px"></div>' +
      '<div class="warnbox" style="margin-top:10px;background:var(--warn-soft);border-color:rgba(245,158,11,.35)">The token inside is encrypted with your passphrase, so the link alone can’t open anything. Still, only send it to yourself, and delete the message once you’ve used it.</div>',
    foot: (canShare ? '<button class="btn" data-dev="share">' + icon('upload') + 'Share</button>' : '') + '<button class="btn primary" data-dev="copy">Copy link</button>',
    click: async (e, t) => {
      const b = t.closest('[data-dev]');
      if (!b) return;
      if (b.getAttribute('data-dev') === 'copy') {
        try { await navigator.clipboard.writeText(link); $('#devMsg').textContent = 'Copied. Paste it into a message to yourself.'; }
        catch (err) { const ta = $('#devLink'); ta.focus(); ta.select(); $('#devMsg').textContent = 'Select all and copy the link above.'; }
      } else {
        try { await navigator.share({ title: 'Smart Spend setup link', text: 'Open on your new device to connect Smart Spend:', url: link }); } catch (err) { /* cancelled */ }
      }
    }
  });
}

/* ============================== PASSPHRASE ============================== */

export function askPassphrase(then) {
  const p = ui.profile, c = cloudCfg(p.id);
  openSheet({
    title: 'Backup passphrase',
    body: '<form class="form" id="ppForm" novalidate><p class="help" style="margin:0">Enter the backup passphrase for <b>' + esc(p.name) + '</b>.</p>' +
      '<input class="input" id="ppInput" type="password" autocomplete="current-password" data-autofocus>' +
      '<label class="check"><input type="checkbox" id="ppRemember"' + (c && c.remember ? ' checked' : '') + '><span>Remember on this device</span></label>' +
      '<div class="msg" id="ppMsg" role="alert"></div></form>',
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-pp>Continue</button>',
    focusOnTouch: true,
    submit: () => go(),
    click: (e, t) => { if (t.closest('[data-pp]')) go(); }
  });
  async function go() {
    const v = $('#ppInput').value;
    if (!v) { $('#ppMsg').textContent = 'Enter the passphrase.'; return; }
    $('#ppMsg').className = 'msg info'; $('#ppMsg').textContent = 'Checking…';
    try {
      if (!(await providePassphrase(p.id, v, $('#ppRemember').checked))) { $('#ppMsg').className = 'msg'; $('#ppMsg').textContent = 'That isn’t the passphrase set for this profile’s backups.'; return; }
      closeSheet();
      if (then) then();
    } catch (e) { $('#ppMsg').className = 'msg'; $('#ppMsg').textContent = e.message; }
  }
}

/* ================================ RESTORE ================================ */

let rs = null;

export function openRestore(fileText, fileName) {
  rs = { status: 'loading', list: [], error: null, pick: null };
  openSheet({
    title: 'Restore a backup', body: '',
    click: (e, t) => {
      const b = t.closest('[data-rs]');
      if (!b) return;
      const act = b.getAttribute('data-rs');
      if (act === 'pick') pick(b.getAttribute('data-path'));
      if (act === 'back') { rs.pick = null; render(); }
      if (act === 'file') document.getElementById('fileInput').click();
      if (act === 'setup') { closeSheet(); openCloudSetup(); }
      if (act === 'refresh') loadList();
      if (act === 'apply') apply();
    },
    submit: (e) => { if (e.target.id === 'unlockForm') unlock($('#ulPass').value); }
  });
  if (fileText != null) receive(fileText, fileName || 'Backup file'); else loadList();
}

function render() {
  if (!rs) return;
  const p = ui.profile, c = cloudCfg(p.id);
  if (rs.pick) { updateSheet(pickHtml(rs.pick), rs.pick.stage === 'ready' ? '<button class="btn" data-rs="back">Back</button><button class="btn primary" data-rs="apply">Restore this backup</button>' : null); return; }
  let html = '<div class="card-h" style="margin-bottom:10px"><h3>Online backups</h3>' + (c ? '<button class="btn sm" data-rs="refresh">' + icon('sync') + 'Refresh</button>' : '') + '</div>';
  if (!c) html += '<div class="empty" style="padding:22px"><b>Online backup isn’t set up</b>Connect a private GitHub repository to keep dated backups.<br><button class="btn sm primary" data-rs="setup">Set up</button></div>';
  else if (rs.status === 'loading') html += '<div class="empty" style="padding:22px">Loading backups from ' + esc(c.repo) + '…</div>';
  else if (rs.status === 'error') html += '<div class="empty" style="padding:22px">' + esc(rs.error) + '<br><button class="btn sm" data-rs="refresh">Try again</button></div>';
  else if (!rs.list.length) html += '<div class="empty" style="padding:22px">No online backups for ' + esc(p.name) + ' yet.</div>';
  else html += rs.list.slice(0, 60).map((b, i) => '<div class="bk' + (i === 0 ? ' latest' : '') + '"><div><b>' + esc(when(b.date)) + (i === 0 ? ' <span class="badge">Latest</span>' : '') + '</b><span>' + esc(timeAgo(b.date.getTime())) + ' · ' + (b.size / 1024).toFixed(1) + ' KB</span></div>' +
    '<button class="btn sm' + (i === 0 ? ' primary' : '') + '" data-rs="pick" data-path="' + esc(b.path) + '">Restore</button></div>').join('');
  html += '<div class="card-h" style="margin:22px 0 10px"><h3>From a file</h3></div><button class="btn block" data-rs="file">' + icon('download') + 'Choose a backup file</button>' +
    '<p class="help">Works with files from “Save a backup file”, encrypted online backups, and Android app backups.</p>';
  updateSheet(html, null);
}
function when(d) { return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
async function loadList() {
  const p = ui.profile, c = cloudCfg(p.id);
  rs.status = 'loading'; render();
  if (!c) return;
  try { rs.list = await listBackups(c, p); rs.status = 'ready'; } catch (e) { rs.status = 'error'; rs.error = e.message; }
  render();
}
async function pick(path) {
  const c = cloudCfg(ui.profile.id), item = rs.list.find((b) => b.path === path);
  if (!c || !item) return;
  rs.pick = { label: when(item.date), stage: 'fetching' }; render();
  try { await receiveData(await fetchBackup(c, path), rs.pick.label); } catch (e) { rs.pick = { label: rs.pick.label, stage: 'error', error: e.message }; render(); }
}
async function receive(text, label) {
  let data;
  try { data = JSON.parse(text); } catch (e) { rs.pick = { label, stage: 'error', error: 'That file isn’t valid JSON.' }; render(); return; }
  await receiveData(data, label);
}
async function receiveData(data, label) {
  if (isEncryptedBackup(data)) {
    rs.pick = { label, stage: 'unlock', env: data };
    try { ready(await openEnvelope(ui.profile.id, data, null), label); } catch (e) { render(); }
    return;
  }
  ready(data, label);
}
async function unlock(typed) {
  if (!rs.pick || !rs.pick.env) return;
  if (!typed) { rs.pick.error = 'Enter the passphrase.'; render(); return; }
  try { ready(await openEnvelope(ui.profile.id, rs.pick.env, typed), rs.pick.label); }
  catch (e) { rs.pick.error = e.message; render(); }
}
function ready(data, label) {
  const r = readBackup(data);
  if (r.error) { rs.pick = { label, stage: 'error', error: r.error }; render(); return; }
  const from = r.exportedAt && !isNaN(new Date(r.exportedAt)) ? when(new Date(r.exportedAt)) : label;
  rs.pick = { label: from, stage: 'ready', read: r };
  render();
}
function pickHtml(pk) {
  let h = '<button class="g-back" data-rs="back">' + icon('back') + 'All backups</button><h3 style="margin:4px 0 12px">' + esc(pk.label) + '</h3>';
  if (pk.stage === 'fetching') return h + '<p class="muted">Downloading…</p>';
  if (pk.stage === 'error') return h + '<div class="warnbox">' + esc(pk.error) + '</div>';
  if (pk.stage === 'unlock') return h + '<form class="form" id="unlockForm" novalidate><p class="help" style="margin:0">This backup is encrypted. Enter the passphrase it was saved with.</p>' +
    '<input class="input" id="ulPass" type="password" autocomplete="current-password" placeholder="Backup passphrase" data-autofocus>' +
    '<div class="msg" role="alert">' + esc(pk.error || '') + '</div><button class="btn primary" type="submit">Open backup</button></form>';
  const r = pk.read;
  return h + '<div class="set-group"><div class="set-row"><span class="set-ico">' + icon('activity') + '</span><span class="set-main"><b>' + plural(r.txns.length, 'record') + '</b><span>' +
    (r.rate ? 'Rate 1 SAR = ₹' + r.rate.toFixed(2) : '') + (r.profile ? ' · saved by ' + esc(r.profile) : '') + (r.dropped ? ' · ' + r.dropped + ' unreadable skipped' : '') + '</span></span></div></div>' +
    '<p class="help" style="margin-top:12px">Restoring replaces the ' + plural(state.txns.length, 'record') + ' in ' + esc(ui.profile.name) + ' here' + (cloudCfg(ui.profile.id) ? ', and syncs to your other devices' : '') + '. You can undo right after.</p>';
}
function apply() {
  const r = rs && rs.pick && rs.pick.read;
  if (!r) return;
  const snap = applyBackup(r);
  closeSheet();
  toast('Restored ' + plural(r.txns.length, 'record'), { tone: 'ok', actionLabel: 'Undo', onAction: () => { restoreSnapshot(snap); toast('Restore undone'); } });
}
