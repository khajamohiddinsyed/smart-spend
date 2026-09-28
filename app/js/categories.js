// Category knowledge base, keyword matching (plurals, prefixes, typos) and
// learning from the user's corrections. Carried over unchanged from v1.

// Category knowledge base. A "~" prefix marks a generic word (weight 1).
// Plain words weigh 2 and multi-word phrases 3, so "coffee beans" beats
// "coffee" and "credit card" beats "credit". Words match with plural and
// tense endings; words of 6+ letters also match as prefixes
// (electric → electricity) and tolerate one typo (resturant → restaurant).
var CATEGORIES = [
  { id: 'Groceries', label: 'Groceries', color: '#a3e635',
    kw: ['supermarket', 'hypermarket', 'grocery', 'groceries', 'mart', 'minimart', 'mini market', 'baqala', 'bakala', 'provisions',
      'tamimi', 'danube', 'othaim', 'al othaim', 'panda', 'lulu', 'lulu hypermarket', 'carrefour', 'nesto', 'bin dawood', 'farm superstores',
      'manuel', 'spar', 'al raya', 'ninja', 'dmart', 'bigbasket', 'big basket', 'blinkit', 'zepto', 'instamart', 'jiomart',
      'reliance fresh', 'natures basket', 'vegetables', 'veggies', 'vegetable', 'fruits', 'fruit', 'sabzi', 'bakery',
      'nova water', 'berain', 'water bottle', 'coffee beans', 'gas cylinder refill',
      '~milk', '~eggs', '~bread', '~rice', '~chicken', '~meat', '~mutton', '~fish', '~dates', '~oil', '~sugar', '~atta', '~flour',
      '~dal', '~laban', '~yogurt', '~curd', '~cheese', '~butter', '~onions', '~tomatoes', '~potatoes', '~household', '~detergent', '~tissues'] },
  { id: 'Dining', label: 'Dining', color: '#fb923c',
    kw: ['restaurant', 'cafe', 'cafeteria', 'coffee', 'starbucks', 'dunkin', 'tim hortons', 'barns', 'half million', 'dr cafe', 'costa',
      'java time', 'caribou', 'lunch', 'dinner', 'breakfast', 'brunch', 'supper', 'snacks', 'snack', 'shawarma', 'shawarmer', 'mandi',
      'kabsa', 'biryani', 'broast', 'falafel', 'burger', 'pizza', 'mcdonald', 'mcdonalds', 'kfc', 'albaik', 'al baik', 'kudu', 'herfy',
      'burger king', 'hardees', 'pizza hut', 'dominos', 'domino', 'maestro pizza', 'little caesars', 'subway', 'five guys', 'shake shack',
      'hungerstation', 'hunger station', 'jahez', 'toyou', 'mrsool', 'the chefz', 'chefz', 'keeta', 'swiggy', 'zomato', 'careem food',
      'talabat', 'chai', 'karak', 'juice', 'dessert', 'ice cream', 'kunafa', 'takeaway', 'take away', 'dine out', 'eating out',
      'canteen', 'mess bill', 'sandwich', 'noodles', 'tea stall', '~food', '~tea', '~meal', '~meals', '~treat'] },
  { id: 'Transport', label: 'Transport', color: '#60a5fa',
    kw: ['uber', 'careem', 'bolt', 'jeeny', 'ola', 'rapido', 'taxi', 'cab', 'fuel', 'petrol', 'diesel', 'gas station', 'aldrees',
      'sasco', 'naft', 'petrol pump', 'metro', 'saptco', 'train', 'haramain', 'flight', 'flights', 'airline', 'flynas', 'flyadeal',
      'saudia', 'indigo', 'air india', 'emirates', 'air arabia', 'airport', 'parking', 'toll', 'car wash', 'car service', 'oil change',
      'tyre', 'tire', 'tyres', 'tires', 'mechanic', 'car rental', 'rent a car', 'yelo', 'theeb', 'traffic fine', 'saher',
      'car insurance', 'boarding pass', 'commute', '~gas', '~fare', '~bus', '~ride'] },
  { id: 'Utilities', label: 'Utilities', color: '#a78bfa',
    kw: ['electricity', 'electric', 'electricity bill', 'water bill', 'nwc', 'internet', 'wifi', 'wi fi', 'broadband', 'fiber', 'fibre',
      'stc', 'mobily', 'zain', 'virgin mobile', 'lebara', 'salam mobile', 'jawwy', 'airtel', 'jio', 'vodafone', 'bsnl', 'recharge',
      'topup', 'top up', 'postpaid', 'prepaid', 'phone bill', 'mobile bill', 'rent', 'ejar', 'house rent', 'room rent',
      'maintenance fee', 'service charge', 'gas cylinder', 'lpg', 'dth', 'tata sky', 'netflix', 'spotify', 'shahid', 'osn',
      'youtube premium', 'apple music', 'icloud', 'google one', 'amazon prime', 'disney plus', 'chatgpt', 'subscription', 'sec bill',
      '~water', '~bill', '~bills', '~phone', '~rental', '~utility'] },
  { id: 'Cash', label: 'Cash/ATM', color: '#2dd4bf',
    kw: ['atm', 'withdrew', 'withdrawal', 'withdrawn', 'cash withdrawal', 'got cash', 'cash deposit', 'cash in hand', '~cash'] },
  { id: 'Shopping', label: 'Shopping', color: '#f472b6',
    kw: ['shopping', 'amazon', 'noon', 'namshi', 'shein', 'jarir', 'extra store', 'ikea', 'centrepoint', 'centerpoint', 'max fashion',
      'h&m', 'zara', 'lc waikiki', 'nike', 'adidas', 'puma', 'apple store', 'sharaf dg', 'virgin megastore', 'flipkart', 'myntra',
      'ajio', 'meesho', 'nykaa', 'decathlon', 'home centre', 'home center', 'saco', 'ace hardware', 'toys r us', 'clothes', 'clothing',
      'shoes', 'sneakers', 'shirt', 'tshirt', 't shirt', 'jeans', 'dress', 'abaya', 'thobe', 'shemagh', 'perfume', 'cosmetics',
      'makeup', 'electronics', 'gadget', 'laptop', 'iphone', 'headphones', 'earbuds', 'airpods', 'charger', 'phone case', 'furniture',
      'toys', 'stationery', 'books', 'watch strap', '~mall', '~gift', '~gifts'] },
  { id: 'Healthcare', label: 'Healthcare', color: '#f87171',
    kw: ['pharmacy', 'chemist', 'nahdi', 'al dawaa', 'dawaa', 'whites pharmacy', 'doctor', 'clinic', 'hospital', 'dental', 'dentist',
      'medicine', 'medicines', 'tablets', 'blood test', 'x ray', 'xray', 'scan', 'mri', 'health insurance', 'medical insurance', 'bupa',
      'tawuniya', 'medgulf', 'apollo', 'pharmeasy', '1mg', 'practo', 'optician', 'glasses', 'contact lenses', 'physio',
      'physiotherapy', 'vaccine', 'vaccination', 'gym', 'fitness time', 'gold gym', 'fitness', 'vitamins', 'supplements', 'medical',
      '~health', '~lab', '~consultation', '~checkup'] },
  { id: 'Salary', label: 'Salary', color: '#10b981',
    kw: ['salary', 'payroll', 'wage', 'wages', 'stipend', 'paycheck', 'increment', 'allowance', 'overtime', 'end of service',
      'gratuity', 'housing allowance', '~bonus'] },
  { id: 'Freelance', label: 'Freelance', color: '#38bdf8',
    kw: ['freelance', 'freelancing', 'invoice', 'upwork', 'fiverr', 'toptal', 'gig', 'consulting', 'consultancy', 'commission',
      'side hustle', 'client payment', '~client', '~project', '~contract', '~tutoring'] },
  { id: 'General', label: 'General', color: '#94a3b8', kw: [] }
];
var CAT_BY_ID = {};
CATEGORIES.forEach(function (c) { CAT_BY_ID[c.id] = c; });

var INFLOW_KW = ['salary', 'received', 'receive', 'receiving', 'got', 'earned', 'earn', 'earnings', 'income', 'credited', 'credit',
  'refund', 'refunded', 'cashback', 'cash back', 'bonus', 'client', 'dividend', 'dividends', 'interest', 'deposit', 'deposited',
  'collected', 'cash in', 'inflow', 'reimbursed', 'reimbursement', 'gift', 'gifted', 'sold', 'paid me', 'sent me', 'gave me',
  'transferred me', 'repaid me', 'returned my', 'borrowed', 'allowance', 'stipend', 'profit', 'winnings', 'won', 'prize',
  'rent received', 'incoming'];
var OUTFLOW_KW = ['spent', 'spend', 'spending', 'paid', 'pay', 'paying', 'payed', 'bought', 'buy', 'buying', 'purchase', 'purchased',
  'bill', 'fee', 'fees', 'gave', 'give', 'cost', 'costs', 'lent', 'lend', 'outflow', 'order', 'ordered', 'charge', 'charged',
  'subscription', 'donated', 'donation', 'zakat', 'sadaqah', 'sadaqa', 'charity', 'sent to', 'transferred to', 'transfer to',
  'remittance', 'sent home', 'emi', 'installment', 'instalment', 'tip', 'fine', 'penalty', 'credit card', 'debited', 'debit',
  'withdrew', '~rent', '~recharge', '~top up', '~transfer'];

// Words that never identify a merchant; they are skipped by typo matching
// and never learned.
var STOP_WORDS = {};
('a an the and or of on at to for from in into by with via my our his her their me us you it is was were be been this that these ' +
  'those some any all one two few more most other just only also then than too very really new old big small item items thing things ' +
  'stuff store shop shops market place online app card payment amount total today yesterday tomorrow morning evening night week month ' +
  'year day days ago back last next sar sr riyal riyals rial rials inr rs rupee rupees each per worth approx around about nearly ' +
  'jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november ' +
  'december sun mon tue wed thu fri sat sunday monday tuesday wednesday thursday friday saturday')
  .split(' ').forEach(function (w) { STOP_WORDS[w] = 1; });

/* ======================================================================
   Keyword matching engine
   ====================================================================== */
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function normText(s) {
  return String(s).toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9&؀-ۿ]+/g, ' ').trim();
}

function buildIndex(entries, weights) {
  var idx = { exact: {}, prefix: [], phrases: [], fuzzy: [] };
  entries.forEach(function (en) {
    var k = en.kw, w = null;
    if (k.charAt(0) === '~') { k = k.slice(1); w = weights.generic; }
    k = normText(k);
    if (!k) return;
    if (k.indexOf(' ') !== -1) {
      idx.phrases.push({ re: new RegExp('(?:^| )' + escRe(k) + '(?:s|es)?(?= |$)'), key: en.key, w: w == null ? weights.phrase : w, kw: k });
      return;
    }
    w = w == null ? weights.word : w;
    (idx.exact[k] || (idx.exact[k] = [])).push({ key: en.key, w: w, kw: k });
    if (k.length >= 6) { idx.prefix.push({ key: en.key, w: w, kw: k }); idx.fuzzy.push({ key: en.key, w: w, kw: k }); }
  });
  return idx;
}

var CAT_INDEX = buildIndex([].concat.apply([], CATEGORIES.map(function (c) {
  return c.kw.map(function (k) { return { kw: k, key: c.id }; });
})), { generic: 1, word: 2, phrase: 3 });
var DIR_INDEX = buildIndex(
  INFLOW_KW.map(function (k) { return { kw: k, key: 'in' }; }).concat(OUTFLOW_KW.map(function (k) { return { kw: k, key: 'out' }; })),
  { generic: 0.5, word: 1, phrase: 2 });

function wordVariants(t) {
  var v = [t];
  if (t.length > 3 && /s$/.test(t)) v.push(t.slice(0, -1));
  if (t.length > 4 && /es$/.test(t)) v.push(t.slice(0, -2));
  if (t.length > 4 && /ed$/.test(t)) { v.push(t.slice(0, -2)); v.push(t.slice(0, -1)); }
  if (t.length > 5 && /ing$/.test(t)) { v.push(t.slice(0, -3)); v.push(t.slice(0, -3) + 'e'); }
  return v;
}

function exactHits(idx, t) {
  var v = wordVariants(t);
  for (var i = 0; i < v.length; i++) if (idx.exact[v[i]]) return idx.exact[v[i]];
  var out = [];
  for (var j = 0; j < idx.prefix.length; j++) {
    var p = idx.prefix[j];
    if (t.length > p.kw.length && t.indexOf(p.kw) === 0) out.push(p);
  }
  return out;
}

// Optimal-string-alignment distance, bailing out once it exceeds `max`.
function withinEdits(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  var prev2 = null, prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    var rowMin = i;
    for (j = 1; j <= b.length; j++) {
      var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length] <= max;
}

function isKnownWord(t) {
  return !!(STOP_WORDS[t] || exactHits(CAT_INDEX, t).length || exactHits(DIR_INDEX, t).length);
}

function fuzzyHit(idx, t) {
  if (t.length < 6 || /\d/.test(t) || isKnownWord(t)) return null;
  for (var i = 0; i < idx.fuzzy.length; i++) {
    var f = idx.fuzzy[i];
    if (f.kw.charAt(0) !== t.charAt(0) && f.kw.charAt(1) !== t.charAt(1)) continue;
    if (withinEdits(t, f.kw, t.length >= 9 && f.kw.length >= 9 ? 2 : 1)) return f;
  }
  return null;
}

function bump(res, key, w, pos, kind, hint) {
  var r = res[key] || (res[key] = { score: 0, first: Infinity, kinds: {}, hint: null });
  r.score += w;
  if (pos < r.first) r.first = pos;
  r.kinds[kind] = (r.kinds[kind] || 0) + w;
  if (hint && !r.hint) r.hint = hint;
}

function scoreText(idx, joined, toks) {
  var res = {};
  idx.phrases.forEach(function (p) {
    var m = p.re.exec(joined);
    if (!m) return;
    var start = m.index + (m[0].charAt(0) === ' ' ? 1 : 0);
    bump(res, p.key, p.w, (joined.slice(0, start).match(/ /g) || []).length, 'kw');
  });
  toks.forEach(function (t, pos) {
    if (/^\d/.test(t)) return;
    var hits = exactHits(idx, t);
    if (hits.length) {
      var seen = {};
      hits.forEach(function (h) { if (!seen[h.key]) { seen[h.key] = 1; bump(res, h.key, h.w, pos, 'kw'); } });
      return;
    }
    var f = fuzzyHit(idx, t);
    if (f) bump(res, f.key, f.w * 0.75, pos, 'fuzzy', t + ' → ' + f.kw);
  });
  return res;
}

function bestOf(res) {
  var best = null;
  Object.keys(res).forEach(function (k) {
    var r = res[k];
    if (!best || r.score > res[best].score || (r.score === res[best].score && r.first < res[best].first)) best = k;
  });
  return best;
}

/* ---------- Learning from the user's own corrections ---------- */
// phrases: the whole cleaned title → category (strongest signal)
// tokens:  words the dictionaries don't know (e.g. a local shop's name)
function learnKey(text) {
  return normText(text).split(' ').filter(function (t) { return t && !/\d/.test(t) && !STOP_WORDS[t] && !exactHits(DIR_INDEX, t).length; }).join(' ');
}
function learnCategory(L, title, cat) {
  if (!CAT_BY_ID[cat] || !L) return;
  var key = learnKey(title);
  if (!key) return;
  L.phrases[key] = { c: cat, n: Math.min(20, ((L.phrases[key] && L.phrases[key].c === cat) ? L.phrases[key].n : 0) + 1) };
  key.split(' ').forEach(function (t) {
    if (t.length < 3 || exactHits(CAT_INDEX, t).length) return;
    var e = L.tokens[t] || (L.tokens[t] = {});
    Object.keys(e).forEach(function (c) { if (c !== cat) e[c] = Math.max(0, e[c] - 1); });
    e[cat] = Math.min(20, (e[cat] || 0) + 2);
  });
  pruneLearned(L);
}
function pruneLearned(L) {
  var tk = Object.keys(L.tokens);
  if (tk.length > 400) {
    tk.sort(function (a, b) { return maxCount(L.tokens[a]) - maxCount(L.tokens[b]); })
      .slice(0, tk.length - 400).forEach(function (t) { delete L.tokens[t]; });
  }
  var ph = Object.keys(L.phrases);
  if (ph.length > 300) {
    ph.sort(function (a, b) { return L.phrases[a].n - L.phrases[b].n; })
      .slice(0, ph.length - 300).forEach(function (p) { delete L.phrases[p]; });
  }
}
function maxCount(e) { var m = 0; for (var c in e) if (e[c] > m) m = e[c]; return m; }
function sanitizeLearned(raw) {
  var out = { tokens: {}, phrases: {} };
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw.tokens || {}).slice(0, 400).forEach(function (t) {
    var e = raw.tokens[t], clean = {};
    if (!e || typeof e !== 'object') return;
    Object.keys(e).forEach(function (c) { if (CAT_BY_ID[c] && e[c] > 0) clean[c] = Math.min(20, Number(e[c]) || 0); });
    if (Object.keys(clean).length) out.tokens[normText(t)] = clean;
  });
  Object.keys(raw.phrases || {}).slice(0, 300).forEach(function (p) {
    var e = raw.phrases[p];
    if (e && CAT_BY_ID[e.c]) out.phrases[normText(p)] = { c: e.c, n: Math.min(20, Number(e.n) || 1) };
  });
  return out;
}

// Returns { id, source: 'learned' | 'keyword' | 'typo' | 'default', hint }.
function detectCategory(text, learned) {
  var joined = normText(text);
  var toks = joined ? joined.split(' ') : [];
  var res = scoreText(CAT_INDEX, joined, toks);
  if (learned) {
    var key = learnKey(text);
    var ph = key && learned.phrases[key];
    if (ph) bump(res, ph.c, 8 + Math.min(ph.n, 4), 0, 'learned');
    toks.forEach(function (t, pos) {
      var e = learned.tokens[t];
      if (!e) return;
      var c = null;
      for (var k in e) if (e[k] > 0 && (!c || e[k] > e[c])) c = k;
      if (c) bump(res, c, 2 + Math.min(e[c], 6) * 0.5, pos, 'learned');
    });
  }
  var best = bestOf(res);
  if (!best) return { id: 'General', source: 'default', hint: null };
  var kinds = res[best].kinds;
  var source = (kinds.learned || 0) >= (kinds.kw || 0) && kinds.learned ? 'learned' : (kinds.kw ? 'keyword' : 'typo');
  return { id: best, source: source, hint: source === 'typo' ? res[best].hint : null };
}

function detectDirection(text, category, sign) {
  if (sign === '+') return 'in';
  if (sign === '-') return 'out';
  var joined = normText(text);
  var res = scoreText(DIR_INDEX, joined, joined ? joined.split(' ') : []);
  var i = res['in'] || { score: 0, first: Infinity }, o = res.out || { score: 0, first: Infinity };
  if (i.score > o.score) return 'in';
  if (o.score > i.score) return 'out';
  if (i.score > 0) return i.first <= o.first ? 'in' : 'out';
  return (category === 'Salary' || category === 'Freelance') ? 'in' : 'out';
}


function catOf(id) { return CAT_BY_ID[id] || CAT_BY_ID.General; }

export { CATEGORIES, CAT_BY_ID, catOf, normText, detectCategory, detectDirection, learnCategory, sanitizeLearned, STOP_WORDS };
