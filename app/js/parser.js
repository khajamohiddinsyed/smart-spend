import { todayDate, makeDate, monthIndex, weekdayIndex, toISO, round2, DEFAULT_RATE, MAX_AMOUNT } from './core.js';
import { catOf, detectCategory, detectDirection } from './categories.js';

// Free-text parser: splitting, dates, amounts (Arabic digits, words, INR, qty x price),
// titles. Carried over unchanged from v1; ctx = { anchor, refYear, refMonth, forced, rate, learned }.

/* ======================================================================
   NLP parser
   ====================================================================== */
var MON = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
var WD = 'sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?';
var WD_FULL = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';
var PREP = '(?:\\b(?:on|at|dated|dt\\.?|for)\\s+)?(?:\\bthe\\s+)?';

/* ---------- Input normalization ---------- */
var SMALL_NUM = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
};
var SCALE_NUM = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, million: 1000000 };

function numKind(word) {
  var m = /^([A-Za-z]+(?:-[A-Za-z]+)?|\d+(?:\.\d+)?)([.,!?;:)]*)$/.exec(word);
  if (!m) return null;
  var core = m[1].toLowerCase(), trail = m[2];
  if (/^\d/.test(core)) return { kind: 'd', val: parseFloat(core), trail: trail };
  if (SMALL_NUM[core] != null) return { kind: 'n', val: SMALL_NUM[core], trail: trail };
  if (SCALE_NUM[core]) return { kind: 's', val: SCALE_NUM[core], trail: trail };
  if (core.indexOf('-') !== -1) {
    var parts = core.split('-');
    if (parts.every(function (p) { return SMALL_NUM[p] != null; })) {
      return { kind: 'n', val: parts.reduce(function (s, p) { return s + SMALL_NUM[p]; }, 0), trail: trail };
    }
    return null;
  }
  if (core === 'and') return { kind: 'and', trail: trail };
  if (core === 'a' || core === 'an') return { kind: 'a', trail: trail };
  return null;
}

// "two hundred and fifty" → 250, "twenty-five" → 25, "1.5 lakh" → 150000.
function scanNumberRun(words, start) {
  var total = 0, cur = 0, hasWord = false, end = -1, prev = null, trail = '';
  for (var i = start; i < words.length; i++) {
    var k = numKind(words[i]);
    if (!k) break;
    var next = i + 1 < words.length ? numKind(words[i + 1]) : null;
    if (k.kind === 'and') {
      if (!prev || prev.kind !== 's' || !next || (next.kind !== 'n' && next.kind !== 'd')) break;
      prev = k;
      continue;
    }
    if (k.kind === 'a') {
      if (i !== start || !next || next.kind !== 's') break;
      cur = 1; prev = k; end = i;
      continue;
    }
    if (k.kind === 'd' && i !== start) break;
    if (k.kind === 'd' && (!next || next.kind !== 's')) break;
    if (k.kind === 's') {
      if (!prev) break;
      if (k.val === 100) cur = (cur || 1) * 100;
      else { total += (cur || 1) * k.val; cur = 0; }
      hasWord = true;
    } else {
      if (k.kind === 'n') hasWord = true;
      cur += k.val;
    }
    prev = k;
    end = i;
    trail = k.trail;
    if (trail) break;
  }
  if (!hasWord || end < start || (prev && (prev.kind === 'and' || prev.kind === 'a'))) return null;
  if (end < 0) return null;
  return { text: String(total + cur) + trail, end: end };
}

function wordsToNumbers(s) {
  var parts = s.split(/(\s+)/), words = [], seps = [];
  for (var k = 0; k < parts.length; k++) { if (k % 2 === 0) words.push(parts[k]); else seps.push(parts[k]); }
  var out = '', w = 0;
  while (w < words.length) {
    var run = words[w] ? scanNumberRun(words, w) : null;
    if (run) { out += run.text + (seps[run.end] || ''); w = run.end + 1; }
    else { out += words[w] + (seps[w] || ''); w++; }
  }
  return out;
}

function normalizeInput(raw) {
  var s = String(raw || '');
  s = s.replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })      // Arabic-Indic digits
    .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); })          // Persian digits
    .replace(/٫/g, '.').replace(/٬/g, ',')                                                 // Arabic decimal / thousands
    .replace(/﷼/g, ' SAR ').replace(/ر\.\s?س\.?/g, ' SAR ')                                    // ﷼ and ر.س
    .replace(/₹/g, ' INR ')
    .replace(/[‒-―]/g, '-').replace(/[   ]/g, ' ')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  return wordsToNumbers(s);
}

/* ---------- Dates ---------- */
function daysAgo(n) { var d = todayDate(); d.setDate(d.getDate() - n); return d; }
function recentWeekday(name, strictlyPast) {
  var target = weekdayIndex(name);
  for (var i = strictlyPast ? 1 : 0; i <= 7; i++) { var d = daysAgo(i); if (d.getDay() === target) return d; }
  return null;
}

var DATE_PATTERNS = [
  { // 2026-09-24, 2026/09/24
    re: new RegExp(PREP + '\\b(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})\\b', 'gi'),
    fn: function (m) { return makeDate(+m[1], +m[2] - 1, +m[3]); }
  },
  { // 24/09, 24-09-2026, 09/24 (swapped only when unambiguous)
    re: new RegExp(PREP + '\\b(\\d{1,2})[\\/\\-](\\d{1,2})(?:[\\/\\-](\\d{4}|\\d{2}))?\\b', 'gi'),
    fn: function (m, ctx) {
      var a = +m[1], b = +m[2], day = a, mon = b;
      if (a <= 12 && b > 12) { day = b; mon = a; }
      var y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : ctx.refYear;
      return makeDate(y, mon - 1, day);
    }
  },
  { // 24.09.2026 (dots need a year, or a lead-in like "on", so 5.50 stays an amount)
    re: new RegExp('(?:(?:\\b(?:on|dated|dt\\.?)\\s+)(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}|\\d{2}))?|' + PREP + '\\b(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}))\\b', 'gi'),
    fn: function (m, ctx) {
      var d = +(m[1] || m[4]), mo = +(m[2] || m[5]), yr = m[3] || m[6];
      var y = yr ? (yr.length === 2 ? 2000 + +yr : +yr) : ctx.refYear;
      return makeDate(y, mo - 1, d);
    }
  },
  { // 24th sep, 24 of september, 24sep 2026
    re: new RegExp(PREP + '\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(' + MON + ')\\b\\.?(?:,?\\s*((?:19|20)\\d{2})\\b)?', 'gi'),
    fn: function (m, ctx) { return makeDate(m[3] ? +m[3] : ctx.refYear, monthIndex(m[2]), +m[1]); }
  },
  { // sep 24, september 24th, sep 24, 2026
    re: new RegExp(PREP + '\\b(' + MON + ')\\b\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*((?:19|20)\\d{2})\\b)?', 'gi'),
    fn: function (m, ctx) { return makeDate(m[3] ? +m[3] : ctx.refYear, monthIndex(m[1]), +m[2]); }
  },
  { // on the 24th, on 24th (month of the selected day)
    re: /(?:\bon\s+(?:the\s+)?|\bthe\s+)(\d{1,2})(?:st|nd|rd|th)\b/gi,
    fn: function (m, ctx) { return makeDate(ctx.refYear, ctx.refMonth, +m[1]); }
  },
  { // 3 days ago, a week ago, 2 weeks back
    re: new RegExp(PREP + '\\b(\\d{1,3}|an?)\\s+(days?|weeks?)\\s+(?:ago|back|before)\\b', 'gi'),
    fn: function (m) {
      var n = /^an?$/i.test(m[1]) ? 1 : +m[1];
      return n <= 400 ? daysAgo(n * (/^week/i.test(m[2]) ? 7 : 1)) : null;
    }
  },
  { // last week
    re: /\blast\s+week\b/gi,
    fn: function () { return daysAgo(7); }
  },
  { // last friday, this monday, on tue, past sunday
    re: new RegExp('\\b(last|this|on|past)\\s+(' + WD + ')\\b', 'gi'),
    fn: function (m) { return recentWeekday(m[2], /^(last|past)$/i.test(m[1])); }
  },
  { // monday (full names only when bare)
    re: new RegExp('\\b(' + WD_FULL + ')\\b', 'gi'),
    fn: function (m) { return recentWeekday(m[1], false); }
  },
  { // yesterday, yday, today, tonight, last night, day before yesterday, tomorrow
    re: new RegExp(PREP + '\\b(day\\s+before\\s+yesterday|yesterday|yday|yest|today|tonight|this\\s+(?:morning|afternoon|evening)|last\\s+night|tomorrow|tmrw|tmr)\\b', 'gi'),
    fn: function (m) {
      var w = m[1].toLowerCase().replace(/\s+/g, ' ');
      if (w === 'day before yesterday') return daysAgo(2);
      if (w === 'yesterday' || w === 'yday' || w === 'yest' || w === 'last night') return daysAgo(1);
      if (w === 'tomorrow' || w === 'tmrw' || w === 'tmr') return daysAgo(-1);
      return todayDate();
    }
  }
];

function extractDate(text, ctx) {
  for (var p = 0; p < DATE_PATTERNS.length; p++) {
    var pat = DATE_PATTERNS[p];
    pat.re.lastIndex = 0;
    var m;
    while ((m = pat.re.exec(text)) !== null) {
      var d = pat.fn(m, ctx);
      if (d) return { date: toISO(d), start: m.index, end: m.index + m[0].length };
      if (m[0].length === 0) pat.re.lastIndex++;
    }
  }
  return null;
}

/* ---------- Amounts ---------- */
var SAR_BEFORE = /(?:sar|sr|s\.r\.?|riyals?|rials?|ryals?)\s*$/i;
var SAR_AFTER = /^\s*(?:sar|sr|s\.r\.?|riyals?|rials?|ryals?)(?![a-z])/i;
var INR_BEFORE = /(?:inr|rs\.?|rupees?)\s*$/i;
var INR_AFTER = /^\s*(?:inr|rs\.?|rupees?|\/-)(?![a-z])/i;
var SCALE_SUFFIX = { k: 1000, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, million: 1000000 };

// Choose the amount: a quantity × price wins, then a number tagged with a
// currency, then the largest number. INR amounts are converted to SAR.
function extractAmount(text, rate) {
  var re = /(\d{1,3}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s?(?:k|lakhs?|lacs?|thousand|million)(?![a-z]))?/gi;
  var m, best = null, cands = [];
  while ((m = re.exec(text)) !== null) {
    var before = text.slice(0, m.index);
    var after = text.slice(m.index + m[0].length);
    if (/[a-z]$/i.test(before) && !/(?:sar|sr|rs|inr)$/i.test(before)) continue;           // A4, iphone15
    if (/[\d:]$/.test(before) || /^\s?%/.test(after) || /^:\d/.test(after)) continue;       // 10:30, 20%
    if (/^\s?(?:am|pm|st|nd|rd|th|x\d)\b/i.test(after)) continue;                           // 5pm, 2nd
    if (/^[a-z]/i.test(after) && !/^(?:sar|sr|inr|rs|riyals?|rupees?|k\b)/i.test(after)) continue; // 5g, 15pro
    var v = parseFloat(m[1].replace(/,/g, '') + (m[2] || ''));
    if (m[3]) v *= SCALE_SUFFIX[m[3].trim().toLowerCase()] || 1;
    if (!(v > 0)) continue;
    var cur = (SAR_BEFORE.test(before) || SAR_AFTER.test(after)) ? 'SAR' : ((INR_BEFORE.test(before) || INR_AFTER.test(after)) ? 'INR' : null);
    var sign = /(?:^|\s)\+\s*$/.test(before) ? '+' : (/(?:^|\s)[-−]\s*$/.test(before) ? '-' : '');
    cands.push({ value: v, cur: cur, sign: sign, index: m.index });
  }

  var product = null;
  var px = /(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)(?![\d.])/i.exec(text)
    || /\b(\d{1,3})\s+[a-z][a-z\s]{0,30}?@\s*(\d+(?:\.\d+)?)/i.exec(text)
    || /\b(\d{1,3})\s+[a-z][a-z\s]{0,30}?\b(\d+(?:\.\d+)?)\s*(?:sar|sr|riyals?)?\s*(?:each|per\s+(?:piece|item|unit)|apiece)\b/i.exec(text);
  if (px && +px[1] > 0 && +px[1] <= 1000 && +px[2] > 0) product = { value: +px[1] * +px[2], qty: +px[1], unit: +px[2] };
  if (!cands.length && !product) return null;
  if (!cands.length) cands.push({ value: product.value, cur: null, sign: '', index: 0 });

  cands.forEach(function (c) {
    if (!best || (c.cur && !best.cur) || (!!c.cur === !!best.cur && c.value > best.value)) best = c;
  });
  var cur = best.cur;
  var raw = product ? product.value : best.value;
  if (product && !cur) cur = (cands.filter(function (c) { return c.cur; })[0] || {}).cur || null;
  var sar = cur === 'INR' ? raw / (rate || DEFAULT_RATE) : raw;
  if (sar > MAX_AMOUNT) return null;
  return {
    value: round2(sar),
    cur: cur,
    original: round2(raw),
    sign: (cands.filter(function (c) { return c.sign; })[0] || {}).sign || '',
    product: product
  };
}

/* ---------- Titles ---------- */
var SMALL_WORDS = { a: 1, an: 1, and: 1, at: 1, by: 1, for: 1, from: 1, in: 1, of: 1, on: 1, or: 1, the: 1, to: 1, with: 1, via: 1, x: 1, each: 1, per: 1 };
var CASED_WORDS = { iphone: 'iPhone', ipad: 'iPad', airpods: 'AirPods', macbook: 'MacBook', icloud: 'iCloud', youtube: 'YouTube', chatgpt: 'ChatGPT', whatsapp: 'WhatsApp' };
var UPPER_WORDS = {
  sar: 1, sr: 1, inr: 1, usd: 1, aed: 1, atm: 1, stc: 1, kfc: 1, emi: 1, sec: 1, nwc: 1, dth: 1, lpg: 1, mri: 1, upi: 1, neft: 1,
  imps: 1, gst: 1, vat: 1, ikea: 1, 'h&m': 1, lc: 1, dg: 1, id: 1, tv: 1, ac: 1, eos: 1
};

function titleCase(s) {
  return s.split(' ').map(function (w, i) {
    if (!w) return w;
    var lw = w.toLowerCase();
    if (UPPER_WORDS[lw]) return w.toUpperCase();
    if (CASED_WORDS[lw]) return CASED_WORDS[lw];
    if (i > 0 && SMALL_WORDS[lw]) return lw;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function cleanTitle(t) {
  t = t.replace(/(^|\s)[+−-]\s*(?=\d)/g, '$1')                        // explicit sign
    .replace(/\/-/g, '')                                             // 500/-
    .replace(/([!?.,])\1+/g, '$1')                                  // !!! → !
    .replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\(\s*\)/g, '').trim();
  t = t.replace(/^(?:[,;:.\-–—+&*•·\s]|and\b|then\b|also\b|plus\b)+/i, '').trim();
  var prev;
  do {
    prev = t;
    t = t.replace(/(?:[\s,;:\-–—.&!?]+|\b(?:on|at|of|the|for|in|from|to|by|dated|dt|and|then)\s*)$/i, '').trim();
  } while (t !== prev && t.length);
  var letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) t = t.toLowerCase();  // SHOUTED INPUT
  return titleCase(t).slice(0, 120);
}

function analyzeSegment(seg, ctx) {
  var text = seg.replace(/\s+/g, ' ').trim()
    .replace(/^(?:[-*•·▪►]\s+|\d{1,2}[.)]\s+(?=[a-z]))/i, '');        // bullets and "1." list markers
  var dt = extractDate(text, ctx);
  var date = ctx.anchor, dated = false;
  if (dt) {
    text = (text.slice(0, dt.start) + ' ' + text.slice(dt.end)).replace(/\s+/g, ' ').trim();
    date = dt.date;
    dated = true;
  }
  var amt = extractAmount(text, ctx.rate);
  var det = detectCategory(text, ctx.learned);
  var category = ctx.forced || det.id;
  var type = detectDirection(text, category, amt ? amt.sign : '');
  var title = cleanTitle(text) || catOf(category).label;
  return {
    title: title,
    amount: amt ? amt.value : 0,
    currency: amt ? amt.cur : null,
    original: amt ? amt.original : 0,
    product: amt ? amt.product : null,
    type: type,
    category: category,
    forced: !!ctx.forced,
    catSource: ctx.forced ? 'forced' : det.source,
    catHint: det.hint,
    date: date,
    dated: dated,
    inherited: false
  };
}

// Splits on new lines, semicolons, bullets, commas (not thousands
// separators) and joining words: and, &, then, plus, also, after that, +.
var SPLIT_RE = /(\r?\n|;|•|,(?!\d)|\s+(?:and|&|then|plus|also|after\s+that|\+)\s+)/i;

function parseInput(raw, ctx) {
  var parts = normalizeInput(raw).split(SPLIT_RE);
  var segs = [], delims = [];
  for (var i = 0; i < parts.length; i++) {
    if (i % 2 === 0) segs.push(parts[i] || ''); else delims.push(parts[i]);
  }

  // Fragments without an amount are glued onto the next fragment
  // ("Marks and Spencer 200"), or onto the previous one when trailing
  // ("spent 40 on fuel and snacks", "paid 90, on 24th sep").
  var groups = [], carry = '', carryLead = '', line = 0;
  for (var s = 0; s < segs.length; s++) {
    if (s > 0 && /\n/.test(delims[s - 1])) {
      if (carry.trim()) {
        if (groups.length && groups[groups.length - 1].line === line) groups[groups.length - 1].text += carryLead + carry;
        else groups.push({ text: carry, line: line, orphan: true });
      }
      carry = ''; line++;
    }
    var piece = segs[s];
    var text = carry ? carry + (delims[s - 1] || ' ') + piece : piece;
    if (!text.trim()) { carry = ''; continue; }
    if (analyzeSegment(text, ctx).amount > 0) {
      groups.push({ text: text, line: line });
      carry = '';
    } else {
      if (!carry) carryLead = s > 0 ? (/\n/.test(delims[s - 1]) ? ' ' : delims[s - 1]) : ' ';
      carry = text;
    }
  }
  if (carry.trim()) {
    if (groups.length && groups[groups.length - 1].line === line && !groups[groups.length - 1].orphan) {
      groups[groups.length - 1].text += carryLead + carry;
    } else {
      groups.push({ text: carry, line: line, orphan: true });
    }
  }

  // An explicit date carries forward to later undated items on the same line.
  var items = [], skipped = [], ctxDate = null, ctxLine = -1;
  groups.forEach(function (g) {
    if (g.line !== ctxLine) { ctxDate = null; ctxLine = g.line; }
    var a = analyzeSegment(g.text, ctx);
    if (!(a.amount > 0)) { skipped.push(g.text.trim()); return; }
    if (a.dated) ctxDate = a.date;
    else if (ctxDate) { a.date = ctxDate; a.inherited = true; }
    items.push(a);
  });
  return { items: items, skipped: skipped };
}

export { parseInput, analyzeSegment, normalizeInput, extractDate, extractAmount, cleanTitle };
