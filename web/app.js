(function () {
'use strict';
const BL = window.BL;

// ---------- tiny DOM helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); }
  for (const c of kids.flat()) { if (c == null) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const $ = sel => document.querySelector(sel);
const pct = (p, d = 1) => p == null || isNaN(p) ? '—' : (p * 100).toFixed(d) + '%';
const sgnPct = (p, d = 1) => p == null || isNaN(p) ? '—' : (p >= 0 ? '+' : '') + (p * 100).toFixed(d) + '%';
const money = (x, d = 0) => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const sMoney = x => (x > 0 ? '+' : '') + money(x, 2);
const SITE = !!(window.BL_CONFIG && window.BL_CONFIG.mode === 'site'); // hosted site build vs Claude artifact
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function toast(msg) { const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2400); }
function localDate(d) { const x = d || new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
function fmtDay(ds, long) { const d = new Date(ds + 'T12:00:00'); return d.toLocaleDateString(undefined, long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtTime(iso) { if (!iso) return ''; const d = new Date(iso); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function fmtStamp(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }

// ---------- team identity (colors are each club's primary) ----------
const TC = { ANA: '#F47A38', BOS: '#FFB81C', BUF: '#003087', CGY: '#C8102E', CAR: '#CC0000', CHI: '#CF0A2C', COL: '#6F263D', CBJ: '#002654', DAL: '#006847', DET: '#CE1126', EDM: '#FF4C00', FLA: '#C8102E', LAK: '#111111', MIN: '#154734', MTL: '#AF1E2D', NSH: '#FFB81C', NJD: '#CE1126', NYI: '#00539B', NYR: '#0038A8', OTT: '#B79257', PHI: '#F74902', PIT: '#FCB514', SJS: '#006D75', SEA: '#99D9D9', STL: '#002F87', TBL: '#002868', TOR: '#00205B', UTA: '#6CACE4', VAN: '#00843D', VGK: '#B4975A', WSH: '#041E42', WPG: '#041E42' };
function lum(hex) { const n = parseInt(hex.slice(1), 16); const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
function badge(a, lg) { const c = TC[a] || '#6b7d90'; return h('span', { class: 'tb' + (lg ? ' lg' : ''), style: { background: c, color: lum(c) > 0.6 ? '#0d1824' : '#ffffff' }, title: teamName(a) }, a); }
function teamName(a) { const t = S.teamMap[a]; return t ? t.name : a; }
function shortName(a) { const parts = teamName(a).split(' '); return parts.length > 2 && ['Maple', 'Golden', 'Red', 'Blue'].includes(parts[parts.length - 2]) ? parts.slice(-2).join(' ') : parts[parts.length - 1]; }

// ---------- state ----------
const S = {
  feed: null, feedState: 'loading', tab: 'board', slate: null,
  params: Object.assign({}, BL.DEFAULTS, lsGet('bl.params.v1', {})),
  ledger: { bankroll: 1000, unit: 10, bets: [] }, ledgerMode: null, uid: null,
  adj: lsGet('bl.adj.v1', {}), open: null, slip: null,
  teamSort: { k: 'power', dir: -1 }, teamConf: 'All', selTeam: null,
  valueMkt: 'All', betFilter: 'All', ai: {}, teamMap: {}
};
let D = null; // derived data

function derive() {
  const F = S.feed; if (!F || !F.teams || !F.results) { D = null; return; }
  S.teamMap = {}; for (const t of F.teams.teams) S.teamMap[t.a] = t;
  const teams = F.teams.teams.map(t => t.a);
  const results = F.results.games.map(g => ({ date: g[0], id: g[1], away: g[2], home: g[3], as: g[4], hs: g[5], per: g[6] }));
  const resById = {}; results.forEach(r => resById[r.id] = r);
  const sched = (F.schedule ? F.schedule.games : []).map(g => ({ date: g[0], id: g[1], start: g[2], away: g[3], home: g[4], venue: g[5] }));
  const allGames = {}; // id -> game
  for (const r of results) allGames[r.id] = { date: r.date, id: r.id, away: r.away, home: r.home, start: null, venue: null };
  for (const g of sched) allGames[g.id] = Object.assign(allGames[g.id] || {}, g);
  for (const id in allGames) { const r = resById[id]; if (r) allGames[id].final = r; }
  const gamesArr = Object.values(allGames).sort((a, b) => a.date.localeCompare(b.date) || String(a.start).localeCompare(String(b.start)));
  const rtCache = {};
  const ratingsAt = date => rtCache[date] || (rtCache[date] = BL.buildRatings(teams, F.teams.last, results, S.params, date));
  const rtNow = BL.buildRatings(teams, F.teams.last, results, S.params);
  D = { teams, results, resById, gamesArr, allGames, ratingsAt, rtNow, stats: teamStats(teams, results, F.teams.last), predCache: {} };
}

function teamStats(teams, results, last) {
  const st = {};
  for (const t of teams) st[t] = { gp: 0, w: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0, hw: 0, hl: 0, hot: 0, rw: 0, rl: 0, rot: 0, rw60: 0, otg: 0, tot: 0, o55: 0, o65: 0, p15: 0, m15: 0, log: [] };
  for (const g of results) {
    for (const side of ['away', 'home']) {
      const t = g[side], x = st[t]; if (!x) continue;
      const gf = side === 'home' ? g.hs : g.as, ga = side === 'home' ? g.as : g.hs, win = gf > ga, ot = g.per !== 'REG';
      x.gp++; x.gf += gf; x.ga += ga; x.tot += g.as + g.hs;
      if (win) { x.w++; x.pts += 2; if (!ot) x.rw60++; } else if (ot) { x.otl++; x.pts++; } else x.l++;
      if (side === 'home') { if (win) x.hw++; else if (ot) x.hot++; else x.hl++; } else { if (win) x.rw++; else if (ot) x.rot++; else x.rl++; }
      if (ot) x.otg++;
      if (g.as + g.hs > 5.5) x.o55++; if (g.as + g.hs > 6.5) x.o65++;
      if (gf - ga >= -1) x.p15++; if (gf - ga >= 2) x.m15++;
      x.log.push({ date: g.date, id: g.id, opp: side === 'home' ? g.away : g.home, home: side === 'home', gf, ga, per: g.per, res: win ? 'W' : ot ? 'OTL' : 'L' });
    }
  }
  for (const t of teams) {
    const x = st[t]; x.log.sort((a, b) => a.date.localeCompare(b.date));
    const l10 = x.log.slice(-10); x.l10 = [l10.filter(g => g.res === 'W').length, l10.filter(g => g.res === 'L').length, l10.filter(g => g.res === 'OTL').length];
    let k = 0; const lastR = x.log.length ? x.log[x.log.length - 1].res : null;
    for (let i = x.log.length - 1; i >= 0 && x.log[i].res === lastR; i--) k++;
    x.streak = lastR ? (lastR === 'OTL' ? 'OT' : lastR) + k : '—';
    const e = 2.05; x.pyth = x.gf + x.ga ? Math.pow(x.gf, e) / (Math.pow(x.gf, e) + Math.pow(x.ga, e)) : 0.5;
    x.ptsPct = x.gp ? x.pts / (2 * x.gp) : 0; x.luck = x.gp ? x.ptsPct - x.pyth : 0;
    x.last = last[t];
  }
  return st;
}

// ---------- per-game predictions and markets ----------
function playedDayBefore(team, date) { const d = BL.dayBefore(date); return D.gamesArr.some(g => g.date === d && (g.away === team || g.home === team)); }
function restDays(team, date) { const prev = D.gamesArr.filter(g => g.date < date && (g.away === team || g.home === team)); if (!prev.length) return null; const d = prev[prev.length - 1].date; return Math.round((new Date(date) - new Date(d)) / 864e5) - 1; }
function brief(id) { const b = S.feed && S.feed.brief; return b && b.games && b.games[id] || null; }
function ctxFor(g) {
  const a = S.adj[g.id] || {}, b = brief(g.id) || {}, gl = b.goalies || {};
  return {
    away: g.away, home: g.home,
    awayB2B: a.awayB2B != null ? a.awayB2B : playedDayBefore(g.away, g.date),
    homeB2B: a.homeB2B != null ? a.homeB2B : playedDayBefore(g.home, g.date),
    awayGoalie: a.awayGoalie != null ? a.awayGoalie : (gl.away && gl.away.adj) || 0,
    homeGoalie: a.homeGoalie != null ? a.homeGoalie : (gl.home && gl.home.adj) || 0
  };
}
function predFor(g) {
  const ctx = ctxFor(g), key = g.id + JSON.stringify(ctx);
  if (D.predCache[key]) return D.predCache[key];
  const rt = g.final ? D.ratingsAt(g.date) : D.rtNow;
  return D.predCache[key] = { pred: BL.predict(rt, ctx, S.params), ctx, rt };
}
function booksFor(g) {
  const F = S.feed, out = {};
  const o = F.odds && F.odds.games && F.odds.games[g.id];
  if (o && o.books) Object.assign(out, o.books);
  const c = F.closing && F.closing.games && F.closing.games[g.id];
  if (c && !Object.keys(out).length) out[(c.book || 'Book') + ' close'] = c;
  const my = S.adj[g.id] && S.adj[g.id].my;
  if (my && (my.ml || my.tot || my.pl)) out['My book'] = my;
  return out;
}
function coverProb(pred, side, line) { // side 'home'|'away', line e.g. -1.5
  let win = 0, push = 0; const m = pred.matrix, n = m.length;
  const addM = (margin, p) => { const v = margin + line; if (v > 1e-9) win += p; else if (Math.abs(v) < 1e-9) push += p; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = m[i][j]; if (!v) continue;
    const hm = i - j;
    if (hm === 0) { const pw = side === 'home' ? pred.pOT : 1 - pred.pOT; addM(1, v * pw); addM(-1, v * (1 - pw)); }
    else addM(side === 'home' ? hm : -hm, v);
  }
  return push < 1 ? win / (1 - push) : 0;
}
function mode(arr) { const c = {}; let best = null, bc = 0; for (const x of arr) { c[x] = (c[x] || 0) + 1; if (c[x] > bc) { bc = c[x]; best = x; } } return best; }
function marketsFor(g) {
  const { pred } = predFor(g); if (!pred) return [];
  const books = booksFor(g), P = S.params, w = P.marketWeight, out = [];
  const entries = Object.entries(books).filter(([k]) => k !== 'Opener'); // the opening line is history, not a price you can take
  function push(market, side, label, line, pModel, sidePrices, fairList) {
    const valid = sidePrices.filter(x => x.price != null);
    if (!valid.length) return;
    let best = valid[0]; for (const x of valid) if (BL.amToDec(x.price) > BL.amToDec(best.price)) best = x;
    const pFair = fairList.length ? fairList.reduce((a, b) => a + b, 0) / fairList.length : BL.amToProb(best.price);
    const p = w * pModel + (1 - w) * pFair;
    const ev = BL.ev(p, best.price);
    out.push({ g, market, side, label, line, pModel, pFair, p, best, ev, kelly: BL.kellyStake(p, best.price, P), nBooks: valid.length });
  }
  // moneyline
  const ml = entries.filter(([, b]) => b.ml);
  if (ml.length) {
    const fa = [], fh = []; ml.forEach(([, b]) => { const f = BL.noVig(b.ml[0], b.ml[1]); if (f) { fa.push(f.a); fh.push(f.b); } });
    push('ML', 'away', g.away + ' ML', null, pred.pAway, ml.map(([k, b]) => ({ book: k, price: b.ml[0] })), fa);
    push('ML', 'home', g.home + ' ML', null, pred.pHome, ml.map(([k, b]) => ({ book: k, price: b.ml[1] })), fh);
  }
  // puck line at the most common line
  const pl = entries.filter(([, b]) => b.pl);
  if (pl.length) {
    const key = mode(pl.map(([, b]) => b.pl[0] + '/' + b.pl[2]));
    const at = pl.filter(([, b]) => b.pl[0] + '/' + b.pl[2] === key);
    const [al, , hl] = at[0][1].pl;
    const fa = [], fh = []; at.forEach(([, b]) => { const f = BL.noVig(b.pl[1], b.pl[3]); if (f) { fa.push(f.a); fh.push(f.b); } });
    push('PL', 'away', g.away + ' ' + (al > 0 ? '+' : '') + al, al, coverProb(pred, 'away', al), at.map(([k, b]) => ({ book: k, price: b.pl[1] })), fa);
    push('PL', 'home', g.home + ' ' + (hl > 0 ? '+' : '') + hl, hl, coverProb(pred, 'home', hl), at.map(([k, b]) => ({ book: k, price: b.pl[3] })), fh);
  }
  // total at the most common line
  const tt = entries.filter(([, b]) => b.tot);
  if (tt.length) {
    const L = +mode(tt.map(([, b]) => b.tot[0]));
    const at = tt.filter(([, b]) => b.tot[0] === L);
    const t = pred.total(L), dn = 1 - t.push;
    const fo = [], fu = []; at.forEach(([, b]) => { const f = BL.noVig(b.tot[1], b.tot[2]); if (f) { fo.push(f.a); fu.push(f.b); } });
    push('TOT', 'over', 'Over ' + L, L, t.over / dn, at.map(([k, b]) => ({ book: k, price: b.tot[1] })), fo);
    push('TOT', 'under', 'Under ' + L, L, t.under / dn, at.map(([k, b]) => ({ book: k, price: b.tot[2] })), fu);
  }
  return out;
}
const MKT_NAME = { ML: 'Moneyline', PL: 'Puck line', TOT: 'Total' };

// ---------- ledger (bets) ----------
let dbRef = null, ledgerTimer = null;
function saveLedger() {
  clearTimeout(ledgerTimer);
  ledgerTimer = setTimeout(async () => {
    const body = JSON.parse(JSON.stringify(S.ledger)); body.updated = new Date().toISOString();
    if (S.ledgerMode === 'db' && dbRef) {
      try { await dbRef.set(body); } catch (e) { S.ledgerMode = 'local'; lsSet('bl.ledger.v1', S.ledger); toast('Saved in this browser. Ask the owner for edit access to keep bets with your account.'); render(); }
    } else lsSet('bl.ledger.v1', S.ledger);
  }, 350);
}
function gradeBet(b) {
  if (b.market === 'PROP') return gradeProp(b);
  if (b.manual && b.status !== 'open') return b.status;
  const r = D && D.resById[b.gameId]; if (!r) return 'open';
  if (b.market === 'ML') { const hw = r.hs > r.as; return (b.side === 'home') === hw ? 'won' : 'lost'; }
  if (b.market === 'PL') { let m = r.hs - r.as; if (b.side === 'away') m = -m; const v = m + b.line; return v > 0 ? 'won' : v < 0 ? 'lost' : 'push'; }
  if (b.market === 'TOT') { const t = r.as + r.hs; if (t === b.line) return 'push'; return (b.side === 'over') === (t > b.line) ? 'won' : 'lost'; }
  return 'open';
}
function betPnl(b, st) { st = st || gradeBet(b); if (st === 'won') return b.stake * (BL.amToDec(b.price) - 1); if (st === 'lost') return -b.stake; return 0; }
function betClv(b) { // closing line value vs the archived closing price
  if (b.market === 'PROP') return null;
  const c = S.feed && S.feed.closing && S.feed.closing.games && S.feed.closing.games[b.gameId]; if (!c) return null;
  let f = null;
  if (b.market === 'ML' && c.ml) { const nv = BL.noVig(c.ml[0], c.ml[1]); if (nv) f = b.side === 'away' ? nv.a : nv.b; }
  if (b.market === 'TOT' && c.tot && c.tot[0] === b.line) { const nv = BL.noVig(c.tot[1], c.tot[2]); if (nv) f = b.side === 'over' ? nv.a : nv.b; }
  if (b.market === 'PL' && c.pl) { const ln = b.side === 'away' ? c.pl[0] : c.pl[2]; if (ln === b.line) { const nv = BL.noVig(c.pl[1], c.pl[3]); if (nv) f = b.side === 'away' ? nv.a : nv.b; } }
  return f == null ? null : BL.amToDec(b.price) * f - 1;
}

// ---------- charts ----------
function tipFor(wrap) { let t = wrap.querySelector('.tip'); if (!t) { t = h('div', { class: 'tip', hidden: true }); wrap.append(t); } return t; }
function showTip(wrap, x, y, nodes) { const t = tipFor(wrap); t.replaceChildren(...nodes); t.hidden = false; const W = wrap.clientWidth; t.style.left = Math.max(60, Math.min(W - 60, x)) + 'px'; t.style.top = y + 'px'; }
function hideTip(wrap) { const t = wrap.querySelector('.tip'); if (t) t.hidden = true; }

function chartTotals(pred, line) {
  const wrap = h('div', { class: 'chart' });
  const N = 13, W = 560, H = 190, pl = 30, pb = 26, pt = 10, bw = (W - pl) / N;
  const vals = pred.totals.slice(0, N - 1); vals.push(pred.totals.slice(N - 1).reduce((a, b) => a + b, 0));
  const max = Math.max(...vals) * 1.1, y = v => pt + (H - pt - pb) * (1 - v / max);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Distribution of total goals' });
  [0.05, 0.1, 0.15, 0.2].filter(v => v < max).forEach(v => { svg.append(s('line', { class: 'gridl', x1: pl, x2: W, y1: y(v), y2: y(v) }), s('text', { x: pl - 6, y: y(v) + 3, 'text-anchor': 'end' }, Math.round(v * 100) + '%')); });
  vals.forEach((v, k) => {
    const over = line != null && k > line;
    const x = pl + k * bw + 2, top = y(v), base = H - pb;
    const r = s('path', { d: `M${x},${base} V${top + 4} q0,-4 4,-4 H${x + bw - 8} q4,0 4,4 V${base} Z`, fill: over ? 'var(--home)' : 'var(--away)', opacity: line == null ? 1 : 0.9 });
    const hit = s('rect', { x: pl + k * bw, y: pt, width: bw, height: H - pt - pb, fill: 'transparent',
      onmousemove: () => showTip(wrap, (pl + k * bw + bw / 2) / W * wrap.clientWidth, top / H * wrap.clientHeight, [(k === N - 1 ? '12+' : k) + ' goals: ', h('b', null, pct(v))]), onmouseleave: () => hideTip(wrap) });
    svg.append(r, s('text', { x: pl + k * bw + bw / 2, y: H - 8, 'text-anchor': 'middle' }, k === N - 1 ? '12+' : k), hit);
  });
  if (line != null) { const lx = pl + (line + 0.5) * bw; svg.append(s('line', { x1: lx, x2: lx, y1: pt, y2: H - pb, stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-dasharray': '4 3' }), s('text', { x: lx + 4, y: pt + 10, style: 'fill:var(--ink)' }, 'line ' + line)); }
  wrap.append(svg, h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: 'var(--away)' } }), 'Under'), h('span', null, h('i', { style: { background: 'var(--home)' } }), 'Over'), h('span', { class: 'muted' }, 'A tie after 60 minutes adds one goal for the OT/shootout winner.')));
  return wrap;
}

function heatGrid(pred, g) {
  const n = 7, m = pred.matrix; let max = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) max = Math.max(max, m[i][j]);
  const grid = h('div', { class: 'heat', style: { gridTemplateColumns: `28px repeat(${n}, minmax(0, 1fr))` } });
  grid.append(h('div', { class: 'hd' }, ''));
  for (let j = 0; j < n; j++) grid.append(h('div', { class: 'hd' }, g.away + ' ' + j));
  for (let i = 0; i < n; i++) {
    grid.append(h('div', { class: 'hd' }, g.home + ' ' + i));
    for (let j = 0; j < n; j++) {
      const v = m[i][j], t = v / max;
      grid.append(h('div', { title: `${g.home} ${i}, ${g.away} ${j} after 60 min: ${pct(v)}`, style: { background: `color-mix(in oklab, var(--heat-1) ${Math.round(t * 85)}%, var(--heat-0))`, color: t > 0.55 ? 'var(--board)' : 'var(--ink-2)', outline: i === j ? '1px dashed var(--ink-3)' : '' } }, (v * 100).toFixed(1)));
    }
  }
  return h('div', { style: { overflowX: 'auto' } }, h('div', { style: { minWidth: '360px' } }, grid));
}

function chartGameLog(log) {
  const wrap = h('div', { class: 'chart' });
  const W = 600, H = 170, pl = 26, pb = 22, pt = 10, n = Math.max(log.length, 1), bw = (W - pl) / n;
  const maxD = Math.max(3, ...log.map(g => Math.abs(g.gf - g.ga)));
  const mid = pt + (H - pt - pb) / 2, sc = (H - pt - pb) / 2 / maxD;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Goal differential by game' });
  for (let v = -maxD; v <= maxD; v++) if (v % (maxD > 4 ? 2 : 1) === 0) svg.append(s('line', { class: 'gridl', x1: pl, x2: W, y1: mid - v * sc, y2: mid - v * sc }), s('text', { x: pl - 6, y: mid - v * sc + 3, 'text-anchor': 'end' }, v > 0 ? '+' + v : v));
  svg.append(s('line', { x1: pl, x2: W, y1: mid, y2: mid, stroke: 'var(--ink-3)', 'stroke-width': 1 }));
  log.forEach((g, k) => {
    const d = g.gf - g.ga, x = pl + k * bw + Math.max(1, bw * 0.18), w = Math.max(2, bw * 0.64), hgt = Math.max(2, Math.abs(d) * sc);
    const col = d > 0 ? 'var(--good)' : 'var(--bad)';
    const y0 = d > 0 ? mid - hgt : mid;
    svg.append(s('rect', { x, y: y0, width: w, height: hgt, rx: Math.min(4, w / 2), fill: col, opacity: g.per !== 'REG' ? 0.55 : 1 }));
    svg.append(s('rect', { x: pl + k * bw, y: pt, width: bw, height: H - pt - pb, fill: 'transparent',
      onmousemove: () => showTip(wrap, (x + w / 2) / W * wrap.clientWidth, y0 / H * wrap.clientHeight, [fmtDay(g.date) + ' ' + (g.home ? 'vs ' : '@ ') + g.opp + ' ', h('b', null, g.res + ' ' + g.gf + '–' + g.ga + (g.per !== 'REG' ? ' ' + g.per : ''))]),
      onmouseleave: () => hideTip(wrap) }));
  });
  wrap.append(svg, h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: 'var(--good)' } }), 'Won by'), h('span', null, h('i', { style: { background: 'var(--bad)' } }), 'Lost by'), h('span', { class: 'muted' }, 'Faded bars went to OT or a shootout.')));
  return wrap;
}

function chartBankroll(points, start) {
  const wrap = h('div', { class: 'chart' });
  const W = 600, H = 200, pl = 52, pb = 24, pt = 12, pr = 12;
  const vals = points.map(p => p.v); const lo = Math.min(start, ...vals), hi = Math.max(start, ...vals); const pad = Math.max(10, (hi - lo) * 0.15);
  const y0 = lo - pad, y1 = hi + pad, n = points.length;
  const X = i => pl + (W - pl - pr) * (n <= 1 ? 0.5 : i / (n - 1)), Y = v => pt + (H - pt - pb) * (1 - (v - y0) / (y1 - y0));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Bankroll over time' });
  const ticks = 4; for (let k = 0; k <= ticks; k++) { const v = y0 + (y1 - y0) * k / ticks; svg.append(s('line', { class: 'gridl', x1: pl, x2: W - pr, y1: Y(v), y2: Y(v) }), s('text', { x: pl - 6, y: Y(v) + 3, 'text-anchor': 'end' }, money(v))); }
  svg.append(s('line', { x1: pl, x2: W - pr, y1: Y(start), y2: Y(start), stroke: 'var(--ink-3)', 'stroke-dasharray': '3 3' }));
  if (n) {
    const d = points.map((p, i) => (i ? 'L' : 'M') + X(i) + ',' + Y(p.v)).join(' ');
    svg.append(s('path', { d: d + ` L${X(n - 1)},${H - pb} L${X(0)},${H - pb} Z`, fill: 'var(--blue)', opacity: 0.08 }));
    svg.append(s('path', { d, fill: 'none', stroke: 'var(--blue)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    const last = points[n - 1]; svg.append(s('circle', { cx: X(n - 1), cy: Y(last.v), r: 4.5, fill: 'var(--blue)', stroke: 'var(--board)', 'stroke-width': 2 }));
    points.forEach((p, i) => svg.append(s('rect', { x: X(i) - (W / n) / 2, y: pt, width: W / n, height: H - pt - pb, fill: 'transparent',
      onmousemove: () => showTip(wrap, X(i) / W * wrap.clientWidth, Y(p.v) / H * wrap.clientHeight, [p.label + ' ', h('b', null, money(p.v, 2))]), onmouseleave: () => hideTip(wrap) })));
    [0, n - 1].filter((v, i, a) => a.indexOf(v) === i).forEach(i => svg.append(s('text', { x: X(i), y: H - 6, 'text-anchor': i ? 'end' : 'start' }, points[i].date ? fmtDay(points[i].date) : '')));
  }
  wrap.append(svg); return wrap;
}

function chartCalibration(rows, label) {
  const wrap = h('div', { class: 'chart' });
  const bins = []; for (let b = 0; b < 10; b++) bins.push({ n: 0, p: 0, a: 0 });
  rows.forEach(r => { const b = Math.min(9, Math.floor(r.pHome * 10)); bins[b].n++; bins[b].p += r.pHome; bins[b].a += r.homeWon; });
  const W = 360, H = 260, pl = 40, pb = 30, pt = 10, pr = 10;
  const X = v => pl + (W - pl - pr) * v, Y = v => pt + (H - pt - pb) * (1 - v);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Calibration of home win probability' });
  [0, .25, .5, .75, 1].forEach(v => svg.append(s('line', { class: 'gridl', x1: X(0), x2: X(1), y1: Y(v), y2: Y(v) }), s('text', { x: pl - 6, y: Y(v) + 3, 'text-anchor': 'end' }, Math.round(v * 100) + '%'), s('text', { x: X(v), y: H - 12, 'text-anchor': 'middle' }, Math.round(v * 100) + '%')));
  svg.append(s('line', { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), stroke: 'var(--ink-3)', 'stroke-dasharray': '4 4' }));
  svg.append(s('text', { x: X(.5), y: H, 'text-anchor': 'middle' }, label || 'model home win %'));
  bins.forEach(b => { if (!b.n) return; const px = b.p / b.n, ay = b.a / b.n, r = 4 + Math.sqrt(b.n) * 1.6;
    svg.append(s('circle', { cx: X(px), cy: Y(ay), r, fill: 'var(--away)', opacity: 0.85, stroke: 'var(--board)', 'stroke-width': 2,
      onmousemove: () => showTip(wrap, X(px) / W * wrap.clientWidth, (Y(ay) - r) / H * wrap.clientHeight, [b.n + ' games · model ' + pct(px, 0) + ' · actual ', h('b', null, pct(ay, 0))]), onmouseleave: () => hideTip(wrap) })); });
  wrap.append(svg, h('div', { class: 'legend' }, h('span', { class: 'muted' }, 'Dots on the dashed line mean the model is well calibrated. Bigger dots hold more games.')));
  return wrap;
}

// ---------- AI analyst (sample capability) ----------
let samplePromise = null;
function getSample() { if (!samplePromise) samplePromise = (window.claude && window.claude.use ? window.claude.use('sample') : Promise.resolve(null)).catch(() => null).then(x => x || window.BL_SAMPLE || null); return samplePromise; }
function renderMd(text) { // small, safe markdown: headings, bullets, bold
  const out = []; let ul = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+/.test(line);
    if (!bullet && ul) { out.push(ul); ul = null; }
    if (!line.trim()) continue;
    const inline = str => { const parts = str.split(/\*\*(.+?)\*\*/g); return parts.map((p, i) => i % 2 ? h('strong', null, p) : p); };
    if (/^#{1,4}\s/.test(line)) out.push(h('h4', null, line.replace(/^#+\s*/, '')));
    else if (bullet) { ul = ul || h('ul'); ul.append(h('li', null, inline(line.replace(/^\s*[-*•]\s+/, '')))); }
    else out.push(h('p', null, inline(line)));
  }
  if (ul) out.push(ul); return out;
}
async function askClaude(key, prompt, outEl, btns) {
  const sample = await getSample();
  if (!sample) { outEl.replaceChildren(h('p', { class: 'muted' }, SITE ? 'The analyst isn\'t switched on for this site yet. The owner can turn it on in the project settings.' : 'The analyst needs this page opened inside Claude. Open it from your Claude artifacts to use it.')); return; }
  btns.forEach(b => b.disabled = true);
  outEl.replaceChildren(h('p', { class: 'thinking' }, 'Reading the numbers…'));
  try {
    const res = await sample(prompt, { modelTier: 'default', onText: ({ text }) => { S.ai[key] = text; outEl.replaceChildren(...renderMd(text)); } });
    S.ai[key] = res.text; outEl.replaceChildren(...renderMd(res.text));
  } catch (e) {
    const msg = e && e.code === 'not_granted' ? 'Claude access was declined for this page, so the analyst is off for this visit.' : e && e.code === 'rate_limited' ? 'Too many questions at once. Wait a minute and try again.' : 'The analyst could not answer: ' + (e && e.message || 'unknown error');
    outEl.replaceChildren(h('p', { class: 'muted' }, msg));
  } finally { btns.forEach(b => b.disabled = false); }
}
function gameContext(g) {
  const { pred, ctx, rt } = predFor(g), A = D.stats[g.away], H = D.stats[g.home], mk = marketsFor(g), b = brief(g.id);
  const tline = (t, x) => `${teamName(t)} (${t}): ${x.w}-${x.l}-${x.otl}, ${x.pts} pts in ${x.gp} GP; GF/G ${(x.gf / Math.max(1, x.gp)).toFixed(2)}, GA/G ${(x.ga / Math.max(1, x.gp)).toFixed(2)}; home ${x.hw}-${x.hl}-${x.hot}, road ${x.rw}-${x.rl}-${x.rot}; L10 ${x.l10.join('-')}; streak ${x.streak}; OT games ${x.otg}; avg game total ${(x.tot / Math.max(1, x.gp)).toFixed(2)}; points% minus goal-based expectation ${sgnPct(x.luck)}. Last season ${x.last ? x.last.w + '-' + x.last.l + '-' + x.last.otl + ', GF ' + x.last.gf + ', GA ' + x.last.ga : 'n/a'}. Model power ${rt.R[t].power > 0 ? '+' : ''}${rt.R[t].power}% (attack ${rt.R[t].att.toFixed(2)}, defense ${rt.R[t].def.toFixed(2)}; 1.00 = league average, lower defense is better).`;
  const h2h = D.results.filter(r => (r.away === g.away && r.home === g.home) || (r.away === g.home && r.home === g.away)).map(r => `${r.date}: ${r.away} ${r.as} @ ${r.home} ${r.hs} ${r.per}`).join('; ') || 'none this season';
  return [
    `Game: ${teamName(g.away)} at ${teamName(g.home)}, ${fmtDay(g.date, true)}${g.venue ? ', ' + g.venue : ''}.`,
    tline(g.away, A), tline(g.home, H),
    `Rest: ${g.away} back-to-back ${ctx.awayB2B ? 'yes' : 'no'}, ${g.home} back-to-back ${ctx.homeB2B ? 'yes' : 'no'}. Goalie adjustments (goals saved vs average): ${g.away} ${ctx.awayGoalie}, ${g.home} ${ctx.homeGoalie}.`,
    b ? `Scouting note: ${b.note || ''} Goalies: ${g.away} ${b.goalies && b.goalies.away ? b.goalies.away.name + ' (' + b.goalies.away.status + ', ' + (b.goalies.away.line || '') + ')' : 'unknown'}; ${g.home} ${b.goalies && b.goalies.home ? b.goalies.home.name + ' (' + b.goalies.home.status + ', ' + (b.goalies.home.line || '') + ')' : 'unknown'}.` : 'No scouting note today.',
    `Head to head this season: ${h2h}.`,
    `Model: expected goals ${g.away} ${pred.la.toFixed(2)}, ${g.home} ${pred.lh.toFixed(2)}; win ${g.away} ${pct(pred.pAway)}, ${g.home} ${pct(pred.pHome)}; tied after 60 ${pct(pred.tie)}.`,
    'Markets (model / no-vig market / blended / best price / EV): ' + (mk.map(m => `${m.label}: ${pct(m.pModel)} / ${pct(m.pFair)} / ${pct(m.p)} / ${BL.fmtAm(m.best.price)} at ${m.best.book} / ${sgnPct(m.ev)}`).join('; ') || 'no odds posted yet'),
    `Model blend weight ${S.params.marketWeight}; value threshold ${pct(S.params.minEdge)} EV.`
  ].join('\n');
}
function matchupPrompt(g, question) {
  const base = 'You are a sharp, plain-spoken NHL betting analyst helping one person decide whether to bet a game. Use only the data below; do not invent injuries, lines or stats. Small early-season samples are noisy, so weigh last season and the market accordingly.\n\nDATA\n' + gameContext(g) + '\n\n';
  if (question) return base + 'QUESTION: ' + question + '\nAnswer in under 150 words.';
  return base + 'Write a breakdown in under 220 words with these short sections: "### The read" (2-3 sentences on how the game should play out), "### Where the value is" (bullets: each market the numbers favour, or say there is none), "### Risks" (bullets), "### Verdict" (one line: the play or "pass", with a confidence of low/medium/high and a suggested stake in units from 0 to 2). Be honest when the edge is thin.';
}
function slatePrompt(date) {
  const games = D.gamesArr.filter(g => g.date === date && !g.final);
  const lines = games.map(g => { const { pred } = predFor(g); const mk = marketsFor(g).filter(m => m.ev != null).sort((a, b) => b.ev - a.ev)[0]; const b = brief(g.id);
    return `${g.away} @ ${g.home}: model ${g.away} ${pct(pred.pAway)} / ${g.home} ${pct(pred.pHome)}, xGoals ${pred.la.toFixed(2)}-${pred.lh.toFixed(2)}; best EV market ${mk ? mk.label + ' ' + BL.fmtAm(mk.best.price) + ' at ' + sgnPct(mk.ev) : 'no odds yet'}${b && b.note ? '. Note: ' + b.note : ''}`; }).join('\n');
  return 'You are a disciplined NHL betting analyst. Here is the slate for ' + fmtDay(date, true) + ' with model outputs and the best-EV market per game. EV uses a blend of model and market. Do not invent facts.\n\n' + lines + '\n\nWrite under 200 words: "### Best spots" (up to 3 bullets ranked, each with the reason and a confidence), "### Traps" (bullets: games that look tempting but where you would pass), "### Card" (one line: total units you would risk today). If nothing clears the bar, say so plainly.';
}

// ---------- views ----------
function render() {
  const view = $('#view'); const y = window.scrollY;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === S.tab)));
  const openCt = S.ledger.bets.filter(b => gradeBet(b) === 'open').length;
  $('#bets-ct').textContent = openCt ? String(openCt) : '';
  renderStatus();
  if (!D) { view.replaceChildren(S.feedState === 'off' ? emptyNoFeed() : h('div', { class: 'view' }, h('div', { class: 'skel', style: { height: '140px' } }), h('div', { class: 'games' }, h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel' })))); return; }
  const fn = { board: viewBoard, props: viewProps, teams: viewTeams, bets: viewBets, model: viewModel }[S.tab];
  view.replaceChildren(fn());
  window.scrollTo(0, y);
  renderDrawer();
  renderPlayerDrawer();
}
function renderStatus() {
  const el = $('#feed-status'); const m = S.feed && S.feed.meta;
  if (S.feedState === 'loading') { el.replaceChildren(h('span', { class: 'dot' }), 'Loading live data…'); return; }
  if (!m) { el.replaceChildren(h('span', { class: 'dot off' }), 'No live data'); return; }
  if (S.feedState === 'snapshot') { el.replaceChildren(h('span', { class: 'dot stale' }), 'Snapshot from ' + fmtStamp(m.updated) + ' · sign in to Claude for live lines'); return; }
  const age = (Date.now() - new Date(m.updated)) / 36e5;
  el.replaceChildren(h('span', { class: 'dot ' + (age < 20 ? 'ok' : 'stale') }), 'Odds & stats ' + fmtStamp(m.updated) + (age >= 20 ? ' · stale' : ''));
}
function emptyNoFeed() {
  return h('div', { class: 'panel empty' }, h('strong', null, 'Live data isn\'t reachable here'), h('span', null, 'Stats, lines and the daily brief load from your Claude account. Open this page from Claude while signed in, then it fills in on its own.'));
}

function slateDates() {
  const today = localDate();
  const dates = [...new Set(D.gamesArr.map(g => g.date))].sort();
  const past = dates.filter(d => d < today).slice(-2), fut = dates.filter(d => d >= today).slice(0, 6);
  return { list: past.concat(fut), today };
}

function viewBoard() {
  const { list, today } = slateDates();
  if (!S.slate || !list.includes(S.slate)) S.slate = list.find(d => d >= today) || list[list.length - 1];
  const date = S.slate;
  const games = D.gamesArr.filter(g => g.date === date);
  const allMk = games.filter(g => !g.final).flatMap(marketsFor);
  const flagged = allMk.filter(m => m.ev != null && m.ev >= S.params.minEdge).sort((a, b) => b.ev - a.ev);
  const B = S.feed.brief, isBriefDay = B && B.date === date;
  const openBets = S.ledger.bets.filter(b => gradeBet(b) === 'open');

  const aiOut = h('div', { class: 'ai-out', hidden: !S.ai['slate' + date] }, ...(S.ai['slate' + date] ? renderMd(S.ai['slate' + date]) : []));
  const aiBtn = h('button', { class: 'btn primary', onclick: () => { aiOut.hidden = false; askClaude('slate' + date, slatePrompt(date), aiOut, [aiBtn]); } }, 'Break down this slate');
  const finals = games.filter(g => g.final).length;
  const head = h('div', { class: 'board-head' },
    h('div', { class: 'panel brief' },
      h('div', { class: 'eyebrow' }, fmtDay(date, true) + (date === today ? ' · Tonight' : '')),
      h('h1', { class: 'h-display' }, isBriefDay && B.headline ? B.headline : games.length + (games.length === 1 ? ' game' : ' games') + (finals === games.length && finals ? ', all final' : ' on the slate')),
      isBriefDay && B.summary ? h('p', null, B.summary) : h('p', null, finals === games.length && finals ? 'Results are in. Open a game to see how the model priced it.' : 'Lines and model prices for every game. Open a game for the full breakdown, line shopping and the analyst.'),
      h('div', { class: 'brief-actions' }, aiBtn, isBriefDay && B.sources ? h('span', { class: 'small muted' }, 'Brief sources: ', ...B.sources.map((x, i) => [i ? ' · ' : '', h('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.title)])) : null),
      aiOut),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(games.length)), h('div', { class: 'k' }, 'games on ' + fmtDay(date))),
      h('div', { class: 'kpi' }, h('div', { class: 'v' + (flagged.length ? ' good' : '') }, String(flagged.length)), h('div', { class: 'k' }, 'bets clear your ' + pct(S.params.minEdge, 1) + ' EV bar')),
      h('div', { class: 'kpi' }, h('div', { class: 'v' + (flagged[0] ? ' good' : '') }, flagged[0] ? sgnPct(flagged[0].ev) : '—'), h('div', { class: 'k' }, flagged[0] ? 'best: ' + flagged[0].label + ' ' + BL.fmtAm(flagged[0].best.price) : 'best expected value')),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(openBets.length)), h('div', { class: 'k' }, 'open bets · ' + money(openBets.reduce((a, b) => a + b.stake, 0)) + ' at risk'))));

  const rail = h('div', { class: 'slate-bar' },
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Choose a date' }, list.map(d => h('button', { class: 'chip', 'aria-pressed': String(d === date), onclick: () => { S.slate = d; render(); } }, d === today ? 'Today' : fmtDay(d), h('small', null, String(D.gamesArr.filter(g => g.date === d).length))))),
    h('span', { class: 'small muted' }, 'Times shown in your time zone'));

  const cards = games.length ? h('div', { class: 'games' }, games.map(gameCard)) : h('div', { class: 'panel empty' }, h('strong', null, 'No games this day'), 'Pick another date above.');
  const intro = lsGet('bl.intro.v1', false) ? null : h('div', { class: 'intro' },
    h('div', { style: { minWidth: 0 } }, h('strong', null, 'New here? '), 'Each card shows the model\'s win chances and the best price for each bet. Green EV means the price beats the model. Tap a game for the full breakdown, or ',
      h('button', { class: 'linkish', onclick: () => { C.open = true; renderChatShell(); } }, 'ask the desk'), ' for a pick. Track bets to see how you\'re doing.'),
    h('button', { class: 'btn sm ghost', onclick: () => { lsSet('bl.intro.v1', true); render(); } }, 'Got it'));
  return h('div', { class: 'view' }, intro, head, rail, cards, valueTable(allMk), footer());
}

function gameCard(g) {
  const { pred, ctx } = predFor(g); const A = D.stats[g.away], H = D.stats[g.home];
  const mk = g.final ? [] : marketsFor(g);
  const bestBy = k => mk.filter(m => m.market === k).sort((a, b) => (b.ev ?? -9) - (a.ev ?? -9))[0];
  const flag = mk.some(m => m.ev != null && m.ev >= S.params.minEdge);
  const row = (t, st, p, sc) => h('div', { class: 'trow' }, badge(t), h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm' }, teamName(t)), h('div', { class: 'rec' }, `${st.w}-${st.l}-${st.otl} · L10 ${st.l10.join('-')}`)), sc != null ? h('div', { class: 'sc' }, String(sc)) : h('span'), h('div', { class: 'wp' }, pct(p, 0)));
  const mcell = k => { const m = bestBy(k); if (!m) return h('div', { class: 'mkt' }, h('div', { class: 'lab' }, MKT_NAME[k]), h('div', { class: 'pick muted' }, 'Not posted'), h('div', { class: 'meta' }, '—'));
    const good = m.ev >= S.params.minEdge;
    return h('div', { class: 'mkt' }, h('div', { class: 'lab' }, MKT_NAME[k]), h('div', { class: 'pick' }, m.label + ' ' + BL.fmtAm(m.best.price)), h('div', { class: 'meta' }, h('span', { class: good ? 'best-price' : '' }, 'EV ' + sgnPct(m.ev)), ' · fair ' + pct(m.pFair, 0))); };
  const b = brief(g.id);
  const foot = [];
  if (ctx.awayB2B) foot.push(h('span', { class: 'pill warn' }, g.away + ' back-to-back'));
  if (ctx.homeB2B) foot.push(h('span', { class: 'pill warn' }, g.home + ' back-to-back'));
  if (b && b.goalies) ['away', 'home'].forEach(sd => { const gl = b.goalies[sd]; if (gl) foot.push(h('span', { class: 'pill ' + (/^confirmed/i.test(gl.status) ? 'good' : 'neutral') }, goalieHead(g, sd), g[sd] + ' G: ' + gl.name.split(' ').slice(-1)[0] + (/^confirmed/i.test(gl.status) ? ' ✓' : ' (proj.)'))); });
  if (flag) foot.push(h('span', { class: 'pill good' }, 'Value'));
  if (g.final) { const hw = g.final.hs > g.final.as, fav = pred.pHome >= 0.5; foot.push(h('span', { class: 'pill ' + (hw === fav ? 'good' : 'bad') }, hw === fav ? 'Model had the winner' : 'Model missed')); }
  return h('button', { class: 'panel game' + (flag ? ' flag' : ''), onclick: () => openGame(g.id), 'aria-label': `Open ${teamName(g.away)} at ${teamName(g.home)}` },
    h('div', { class: 'game-top' }, h('span', null, g.final ? h('span', { class: 'pill live' }, 'Final' + (g.final.per !== 'REG' ? '/' + g.final.per : '')) : fmtTime(g.start)), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, g.venue || ''), h('span', { class: 'mono' }, 'xG ' + pred.la.toFixed(1) + '–' + pred.lh.toFixed(1))),
    h('div', { class: 'game-teams' }, row(g.away, A, pred.pAway, g.final ? g.final.as : null), row(g.home, H, pred.pHome, g.final ? g.final.hs : null)),
    h('div', { class: 'wpbar', 'aria-hidden': 'true' }, h('i', { class: 'a', style: { width: pct(pred.pAway) } }), h('i', { class: 'h', style: { width: pct(pred.pHome) } })),
    g.final ? null : h('div', { class: 'mkts' }, mcell('ML'), mcell('PL'), mcell('TOT')),
    foot.length ? h('div', { class: 'game-foot' }, foot) : null);
}

function valueTable(allMk) {
  const filt = S.valueMkt;
  const rows = allMk.filter(m => m.ev != null && (filt === 'All' || m.market === filt)).sort((a, b) => b.ev - a.ev);
  const bank = S.ledger.bankroll || 0;
  const tbl = h('table', { class: 't' },
    h('thead', null, h('tr', null, h('th', null, 'Bet'), h('th', null, 'Game'), h('th', { class: 'r' }, 'Best price'), h('th', null, 'Book'), h('th', { class: 'r' }, 'Model'), h('th', { class: 'r' }, 'Market'), h('th', { class: 'r' }, 'Blend'), h('th', { class: 'r' }, 'EV'), h('th', { class: 'r' }, 'Kelly stake'), h('th', null, ''))),
    h('tbody', null, rows.length ? rows.map(m => h('tr', { class: 'click', onclick: e => { if (e.target.closest('button')) return; openGame(m.g.id); } },
      h('td', null, h('strong', null, m.label)), h('td', null, m.g.away + ' @ ' + m.g.home), h('td', { class: 'r num' }, BL.fmtAm(m.best.price)), h('td', { class: 'small muted' }, m.best.book + (m.nBooks > 1 ? ' (' + m.nBooks + ' books)' : '')),
      h('td', { class: 'r num' }, pct(m.pModel)), h('td', { class: 'r num' }, pct(m.pFair)), h('td', { class: 'r num' }, pct(m.p)),
      h('td', { class: 'r num' }, h('span', { class: m.ev >= S.params.minEdge ? 'pill good' : m.ev >= 0 ? 'pill neutral' : 'pill bad' }, sgnPct(m.ev))),
      h('td', { class: 'r num' }, m.kelly * bank >= 0.5 ? money(m.kelly * bank) : '—'),
      h('td', null, h('button', { class: 'btn sm', onclick: () => { openGame(m.g.id); startSlip(m); } }, 'Track')))) : h('tr', null, h('td', { colspan: 10, class: 'muted' }, 'No lines posted for these games yet. The morning refresh adds them.'))));
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('div', null, h('h2', null, 'Value finder'), h('div', { class: 'small muted' }, 'Every posted market, ranked by expected value at the best price across books.')),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Market' }, ['All', 'ML', 'PL', 'TOT'].map(k => h('button', { 'aria-pressed': String(filt === k), onclick: () => { S.valueMkt = k; render(); } }, k === 'All' ? 'All' : MKT_NAME[k])))),
    h('div', { class: 'panel-b tbl-wrap' }, tbl));
}

// ---------- matchup drawer ----------
function openGame(id) { S.open = id; S.slip = null; renderDrawer(); }
function closeGame() { S.open = null; S.slip = null; renderDrawer(); }
function startSlip(m) {
  const bank = S.ledger.bankroll || 0;
  S.slip = { gameId: m.g.id, market: m.market, side: m.side, line: m.line, price: m.best.price, book: m.best.book, stake: Math.max(1, Math.round(m.kelly * bank) || S.ledger.unit || 10), label: m.label, p: m.p, ev: m.ev };
  renderDrawer(); setTimeout(() => { const el = document.getElementById('slip'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
}
function setAdj(id, patch) { S.adj[id] = Object.assign({}, S.adj[id] || {}, patch); lsSet('bl.adj.v1', S.adj); D.predCache = {}; renderDrawer(); }

function renderDrawer() {
  const host = $('#drawer-host');
  if (!S.open || !D || !D.allGames[S.open]) { host.replaceChildren(); document.body.style.overflow = ''; return; }
  const g = D.allGames[S.open], scroll = host.querySelector('.drawer') ? host.querySelector('.drawer').scrollTop : 0;
  const { pred, ctx } = predFor(g); const A = D.stats[g.away], H = D.stats[g.home];
  const mk = marketsFor(g); const books = booksFor(g); const b = brief(g.id);
  const mlMk = mk.filter(m => m.market === 'ML');
  const mktHome = mlMk.find(m => m.side === 'home');
  const rest = t => { const r = restDays(t, g.date); return r == null ? '—' : r === 0 ? 'back-to-back' : r + (r === 1 ? ' day' : ' days') + ' rest'; };

  const hero = h('section', { class: 'panel matchup-hero' },
    h('div', { class: 'mh-team away' }, badge(g.away, true), h('div', { class: 'nm' }, shortName(g.away)), h('div', { class: 'pct' }, pct(pred.pAway, 0)), h('div', { class: 'small muted' }, `${A.w}-${A.l}-${A.otl} · ${rest(g.away)}`)),
    h('div', { class: 'mh-mid' }, h('div', { class: 'at' }, g.final ? g.final.as + '–' + g.final.hs : '@'), h('div', { class: 'small muted' }, g.final ? 'Final' + (g.final.per !== 'REG' ? ' (' + g.final.per + ')' : '') : fmtDay(g.date) + ' · ' + fmtTime(g.start)), h('div', { class: 'small muted' }, 'xG ' + pred.la.toFixed(2) + ' – ' + pred.lh.toFixed(2))),
    h('div', { class: 'mh-team home' }, badge(g.home, true), h('div', { class: 'nm' }, shortName(g.home)), h('div', { class: 'pct' }, pct(pred.pHome, 0)), h('div', { class: 'small muted' }, `${H.w}-${H.l}-${H.otl} · ${rest(g.home)}`)),
    h('div', { class: 'bigbar', 'aria-hidden': 'true' }, h('i', { class: 'a', style: { width: pct(pred.pAway) } }), h('i', { class: 'h', style: { width: pct(pred.pHome) } }), mktHome ? h('span', { class: 'mk', style: { left: pct(1 - mktHome.pFair) }, title: 'Market' }) : null),
    h('div', { class: 'bigbar-legend' }, h('span', null, 'Model win probability. Tie after 60 min: ' + pct(pred.tie, 0) + '.'), mktHome ? h('span', null, '│ marker = market no-vig (' + g.home + ' ' + pct(mktHome.pFair, 0) + ')') : null));

  // markets table
  const bank = S.ledger.bankroll || 0;
  const mTable = mk.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, h('th', null, 'Market'), h('th', { class: 'r' }, 'Model'), h('th', { class: 'r' }, 'Market'), h('th', { class: 'r' }, 'Blend'), h('th', { class: 'r' }, 'Fair odds'), h('th', { class: 'r' }, 'Best'), h('th', { class: 'r' }, 'EV'), h('th', { class: 'r' }, 'Stake'), h('th', null, ''))),
    h('tbody', null, mk.map(m => h('tr', null, h('td', null, h('div', { style: { fontWeight: 600 } }, m.label), h('div', { class: 'small muted' }, MKT_NAME[m.market])),
      h('td', { class: 'r num' }, pct(m.pModel)), h('td', { class: 'r num' }, pct(m.pFair)), h('td', { class: 'r num' }, pct(m.p)), h('td', { class: 'r num' }, BL.fmtAm(BL.probToAm(m.p))),
      h('td', { class: 'r num' }, BL.fmtAm(m.best.price), h('div', { class: 'small muted' }, m.best.book)),
      h('td', { class: 'r' }, h('span', { class: m.ev >= S.params.minEdge ? 'pill good' : m.ev >= 0 ? 'pill neutral' : 'pill bad' }, sgnPct(m.ev))),
      h('td', { class: 'r num' }, m.kelly * bank >= 0.5 ? money(m.kelly * bank) : '—'),
      h('td', null, g.final ? null : h('button', { class: 'btn sm', onclick: () => startSlip(m) }, 'Track bet'))))))) : h('div', { class: 'empty' }, h('strong', null, 'No lines for this game yet'), 'Add your book\'s prices below to price it now.');

  // line shopping
  const bkEntries = Object.entries(books);
  const best = BL.bestLines(Object.fromEntries(bkEntries.filter(([k]) => k !== 'Opener')));
  const isBest = (v, b) => b && v === b.price;
  const shop = bkEntries.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, h('th', null, 'Book'), h('th', { class: 'r' }, g.away + ' ML'), h('th', { class: 'r' }, g.home + ' ML'), h('th', { class: 'r' }, 'Puck line'), h('th', { class: 'r' }, 'Total'), h('th', { class: 'r' }, 'Over'), h('th', { class: 'r' }, 'Under'), h('th', { class: 'r' }, 'ML hold'))),
    h('tbody', null, bkEntries.map(([k, x]) => { const nv = x.ml ? BL.noVig(x.ml[0], x.ml[1]) : null; const plKey = x.pl ? x.pl[0] + '/' + x.pl[2] : null; const tb = x.tot && k !== 'Opener' ? best.tot[x.tot[0]] : null;
      return h('tr', null, h('td', null, k === 'Opener' ? h('span', { class: 'muted' }, 'Opening line') : k),
        h('td', { class: 'r num' + (k !== 'Opener' && x.ml && isBest(x.ml[0], best.ml[0]) ? ' best-price' : '') }, x.ml ? BL.fmtAm(x.ml[0]) : '—'),
        h('td', { class: 'r num' + (k !== 'Opener' && x.ml && isBest(x.ml[1], best.ml[1]) ? ' best-price' : '') }, x.ml ? BL.fmtAm(x.ml[1]) : '—'),
        h('td', { class: 'r num' }, x.pl ? `${g.away} ${x.pl[0] > 0 ? '+' : ''}${x.pl[0]} ${BL.fmtAm(x.pl[1])} / ${BL.fmtAm(x.pl[3])}` : '—'),
        h('td', { class: 'r num' }, x.tot ? String(x.tot[0]) : '—'),
        h('td', { class: 'r num' + (tb && isBest(x.tot[1], tb[0]) ? ' best-price' : '') }, x.tot ? BL.fmtAm(x.tot[1]) : '—'),
        h('td', { class: 'r num' + (tb && isBest(x.tot[2], tb[1]) ? ' best-price' : '') }, x.tot ? BL.fmtAm(x.tot[2]) : '—'),
        h('td', { class: 'r num' }, nv ? pct(nv.hold) : '—')); })))) : h('p', { class: 'muted' }, 'No books have posted this game yet.');

  // comparison
  const per = (x, k) => x.gp ? x[k] / x.gp : 0;
  const cmp = (label, a, hm, fmt, higherBetter = true) => { const aw = higherBetter ? a > hm : a < hm, hw = higherBetter ? hm > a : hm < a;
    return h('div', { class: 'stat-row' }, h('div', { class: 'l ' + (aw ? 'win' : 'lose') }, fmt(a)), h('div', { class: 'c' }, label), h('div', { class: 'r ' + (hw ? 'win' : 'lose') }, fmt(hm))); };
  const rt = predFor(g).rt;
  const f2 = v => v.toFixed(2), fp = v => pct(v, 0), fs = v => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  const compare = h('div', null,
    h('div', { class: 'stat-row' }, h('div', { class: 'l' }, badge(g.away)), h('div', { class: 'c' }, 'This season'), h('div', { class: 'r' }, badge(g.home))),
    cmp('Model power', rt.R[g.away].power, rt.R[g.home].power, fs),
    cmp('Goals for / game', per(A, 'gf'), per(H, 'gf'), f2), cmp('Goals against / game', per(A, 'ga'), per(H, 'ga'), f2, false),
    cmp('Points %', A.ptsPct, H.ptsPct, fp), cmp('Luck (pts% vs goals)', A.luck, H.luck, v => sgnPct(v, 0)),
    cmp(g.away + ' road / ' + g.home + ' home pts%', (A.rw * 2 + A.rot) / Math.max(1, 2 * (A.rw + A.rl + A.rot)), (H.hw * 2 + H.hot) / Math.max(1, 2 * (H.hw + H.hl + H.hot)), fp),
    cmp('Covers +1.5', per(A, 'p15'), per(H, 'p15'), fp), cmp('Wins by 2+', per(A, 'm15'), per(H, 'm15'), fp),
    cmp('Games over 6.5', per(A, 'o65'), per(H, 'o65'), fp), cmp('Went to OT', per(A, 'otg'), per(H, 'otg'), fp),
    cmp('Last season pts', A.last ? A.last.pts : 0, H.last ? H.last.pts : 0, v => String(v)));
  const h2h = D.results.filter(r => (r.away === g.away && r.home === g.home) || (r.away === g.home && r.home === g.away));

  // adjustments
  const adj = S.adj[g.id] || {};
  const goalieRow = (side) => { const v = ctx[side + 'Goalie']; const id = 'gadj-' + side;
    return h('div', { class: 'adj-row' }, h('label', { for: id }, g[side] + ' goalie'), h('input', { id, type: 'range', min: -0.6, max: 0.6, step: 0.05, value: v, oninput: e => { e.target.nextSibling.textContent = (+e.target.value > 0 ? '+' : '') + (+e.target.value).toFixed(2); }, onchange: e => setAdj(g.id, { [side + 'Goalie']: +e.target.value }) }), h('output', null, (v > 0 ? '+' : '') + v.toFixed(2))); };
  const b2bToggle = side => h('label', { class: 'chip', style: { cursor: 'pointer' } }, h('input', { type: 'checkbox', id: 'b2b-' + side, checked: ctx[side + 'B2B'], onchange: e => setAdj(g.id, { [side + 'B2B']: e.target.checked }) }), g[side] + ' on a back-to-back');
  const my = adj.my || {};
  const num = v => v === '' || v == null ? null : +v;
  const myForm = h('form', { class: 'form-grid', onsubmit: e => { e.preventDefault(); const f = new FormData(e.target);
      const o = {}; const ma = num(f.get('ma')), mh = num(f.get('mh')); if (ma != null && mh != null) o.ml = [ma, mh];
      const tl = num(f.get('tl')), to = num(f.get('to')), tu = num(f.get('tu')); if (tl != null && to != null && tu != null) o.tot = [tl, to, tu];
      const pa = num(f.get('pa')), ph = num(f.get('ph')), pl = num(f.get('pl')); if (pl != null && pa != null && ph != null) o.pl = [pl, pa, -pl, ph];
      setAdj(g.id, { my: o }); toast(Object.keys(o).length ? 'Your prices are in the comparison' : 'Cleared your prices'); } },
    h('div', { class: 'field' }, h('label', { for: 'my-ma' }, g.away + ' ML'), h('input', { id: 'my-ma', name: 'ma', inputmode: 'numeric', placeholder: '+150', value: my.ml ? my.ml[0] : '' })),
    h('div', { class: 'field' }, h('label', { for: 'my-mh' }, g.home + ' ML'), h('input', { id: 'my-mh', name: 'mh', inputmode: 'numeric', placeholder: '-170', value: my.ml ? my.ml[1] : '' })),
    h('div', { class: 'field' }, h('label', { for: 'my-tl' }, 'Total line'), h('input', { id: 'my-tl', name: 'tl', inputmode: 'decimal', placeholder: '6.5', value: my.tot ? my.tot[0] : '' })),
    h('div', { class: 'field' }, h('label', { for: 'my-to' }, 'Over price'), h('input', { id: 'my-to', name: 'to', inputmode: 'numeric', placeholder: '-110', value: my.tot ? my.tot[1] : '' })),
    h('div', { class: 'field' }, h('label', { for: 'my-tu' }, 'Under price'), h('input', { id: 'my-tu', name: 'tu', inputmode: 'numeric', placeholder: '-110', value: my.tot ? my.tot[2] : '' })),
    h('div', { class: 'field' }, h('label', { for: 'my-pl' }, g.away + ' puck line'), h('select', { id: 'my-pl', name: 'pl' }, h('option', { value: '' }, '—'), h('option', { value: '1.5', selected: my.pl && my.pl[0] === 1.5 }, '+1.5'), h('option', { value: '-1.5', selected: my.pl && my.pl[0] === -1.5 }, '-1.5'))),
    h('div', { class: 'field' }, h('label', { for: 'my-pa' }, g.away + ' PL price'), h('input', { id: 'my-pa', name: 'pa', inputmode: 'numeric', placeholder: '-180', value: my.pl ? my.pl[1] : '' })),
    h('div', { class: 'field' }, h('label', { for: 'my-ph' }, g.home + ' PL price'), h('input', { id: 'my-ph', name: 'ph', inputmode: 'numeric', placeholder: '+150', value: my.pl ? my.pl[3] : '' })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Price it'));

  const aiKey = 'g' + g.id, aiOut = h('div', { class: 'ai-out' }, ...(S.ai[aiKey] ? renderMd(S.ai[aiKey]) : [h('p', { class: 'muted' }, 'Get a written read on this game from Claude, built from every number on this page.')]));
  const aiBtn = h('button', { class: 'btn primary', onclick: () => askClaude(aiKey, matchupPrompt(g), aiOut, [aiBtn, askBtn]) }, 'Analyze this game');
  const q = h('input', { id: 'ai-q', placeholder: 'Ask about this game, e.g. "Is the under live if Dostal starts?"', 'aria-label': 'Question for the analyst' });
  const askBtn = h('button', { class: 'btn', onclick: () => { if (q.value.trim()) askClaude(aiKey, matchupPrompt(g, q.value.trim()), aiOut, [aiBtn, askBtn]); } }, 'Ask');
  q.addEventListener('keydown', e => { if (e.key === 'Enter') askBtn.click(); });

  const scout = b ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Scouting'), h('span', { class: 'small muted' }, 'From the daily brief')),
    h('div', { class: 'panel-b', style: { display: 'grid', gap: '10px' } },
      b.goalies ? h('div', { class: 'goalies' }, ['away', 'home'].map(sd => { const gl = b.goalies[sd]; return gl ? h('div', { class: 'goalie' }, h('div', { class: 'eyebrow' }, g[sd] + ' starter'), h('div', { class: 'gn' }, gl.name), h('div', { class: 'small' }, h('span', { class: 'pill ' + (/^confirmed/i.test(gl.status) ? 'good' : 'neutral') }, gl.status), ' ', h('span', { class: 'mono muted' }, gl.line || ''))) : null; })) : null,
      b.note ? h('div', { class: 'note' }, b.note) : null)) : null;

  const drawer = h('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${teamName(g.away)} at ${teamName(g.home)}` },
    h('div', { class: 'drawer-h' }, badge(g.away), h('span', { class: 'muted' }, '@'), badge(g.home), h('strong', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, g.venue || ''), h('button', { class: 'btn', onclick: closeGame, 'aria-label': 'Close' }, 'Close')),
    h('div', { class: 'drawer-b' },
      hero,
      S.slip && S.slip.gameId === g.id && !S.slip.prop ? slipPanel() : null,
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Markets'), h('span', { class: 'small muted' }, 'Stake = ' + pct(S.params.kelly, 0) + ' Kelly on a ' + money(bank) + ' bankroll, capped at ' + pct(S.params.kellyCap, 1))), h('div', { class: 'panel-b' }, mTable)),
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Analyst')), h('div', { class: 'panel-b ai' }, h('div', { class: 'brief-actions' }, aiBtn), aiOut, h('div', { class: 'ai-ask' }, q, askBtn))),
      scout,
      propsGameSection(g),
      h('div', { class: 'grid2' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Total goals'), h('span', { class: 'small muted' }, 'Expected ' + pred.xTotal.toFixed(2))), h('div', { class: 'panel-b' }, chartTotals(pred, (mk.find(m => m.market === 'TOT') || {}).line))),
        h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Score after 60'), h('span', { class: 'small muted' }, '% chance of each regulation score')), h('div', { class: 'panel-b' }, heatGrid(pred, g)))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Line shopping'), h('span', { class: 'small muted' }, 'Green is the best price for that side')), h('div', { class: 'panel-b' }, shop)),
      h('div', { class: 'grid2' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Head to head')), h('div', { class: 'panel-b' }, compare,
          h('div', { class: 'small muted', style: { marginTop: '10px' } }, h2h.length ? 'Earlier this season: ' + h2h.map(r => `${fmtDay(r.date)} ${r.away} ${r.as}–${r.hs} ${r.home}${r.per !== 'REG' ? ' ' + r.per : ''}`).join(' · ') : 'First meeting this season.'))),
        h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Your adjustments'), h('button', { class: 'btn sm ghost', onclick: () => { delete S.adj[g.id]; lsSet('bl.adj.v1', S.adj); D.predCache = {}; renderDrawer(); } }, 'Reset')),
          h('div', { class: 'panel-b adj' },
            h('p', { class: 'small muted', style: { margin: 0 } }, 'Goalie slider: goals the starter saves above an average goalie this game. Use about −0.3 for a backup, +0.3 for a hot starter.'),
            goalieRow('away'), goalieRow('home'), h('div', { class: 'chips' }, b2bToggle('away'), b2bToggle('home')),
            h('div', { class: 'eyebrow', style: { marginTop: '6px' } }, 'Your book\'s prices (American odds)'), myForm))),
      footer()));
  host.replaceChildren(h('div', { class: 'scrim', onclick: closeGame }), drawer);
  document.body.style.overflow = 'hidden';
  drawer.scrollTop = scroll;
}

function slipPanel() {
  const sl = S.slip, g = D.allGames[sl.gameId];
  const update = (k, v) => { sl[k] = v; };
  return h('section', { class: 'slip', id: 'slip' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' } }, h('h3', null, 'Track: ' + sl.label), h('span', { class: 'small' }, 'Blend ' + pct(sl.p) + ' · EV ' + sgnPct(sl.ev))),
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', { for: 'slip-price' }, 'Price you got'), h('input', { id: 'slip-price', inputmode: 'numeric', value: sl.price, oninput: e => update('price', +e.target.value) })),
      h('div', { class: 'field' }, h('label', { for: 'slip-stake' }, 'Stake ($)'), h('input', { id: 'slip-stake', inputmode: 'decimal', value: sl.stake, oninput: e => update('stake', +e.target.value) })),
      h('div', { class: 'field' }, h('label', { for: 'slip-book' }, 'Book'), h('input', { id: 'slip-book', value: sl.book, oninput: e => update('book', e.target.value) })),
      h('button', { class: 'btn primary', onclick: () => {
        if (!sl.price || isNaN(sl.price) || Math.abs(sl.price) < 100) { toast('Enter American odds like -110 or +145'); return; }
        if (!(sl.stake > 0)) { toast('Enter a stake above $0'); return; }
        S.ledger.bets.push(Object.assign({ id: 'b' + Date.now().toString(36), gameId: g.id, date: g.date, away: g.away, home: g.home, market: sl.market, side: sl.side, line: sl.line, price: sl.price, stake: sl.stake, book: sl.book, label: sl.label, pAtBet: sl.p, placedAt: new Date().toISOString(), status: 'open' }, sl.prop ? { pid: sl.pid, stat: sl.stat } : {}));
        saveLedger(); S.slip = null; toast('Bet saved to My Bets'); render(); } }, 'Save bet'),
      h('button', { class: 'btn ghost', onclick: () => { S.slip = null; renderDrawer(); renderPlayerDrawer(); } }, 'Cancel')),
    h('div', { class: 'small muted' }, 'This only records the bet here. Place it with your sportsbook yourself.'));
}

// ---------- teams ----------
function viewTeams() {
  const rt = D.rtNow;
  let rows = D.teams.map(t => { const x = D.stats[t], tm = S.teamMap[t]; return { t, conf: tm.conf, div: tm.div, x, power: rt.R[t].power, att: rt.R[t].att, def: rt.R[t].def, gfg: x.gp ? x.gf / x.gp : 0, gag: x.gp ? x.ga / x.gp : 0, gd: x.gf - x.ga, pts: x.pts, ptsPct: x.ptsPct, luck: x.luck, o65: x.gp ? x.o65 / x.gp : 0, p15: x.gp ? x.p15 / x.gp : 0, ot: x.gp ? x.otg / x.gp : 0, tot: x.gp ? x.tot / x.gp : 0 }; });
  if (S.teamConf !== 'All') rows = rows.filter(r => r.conf === S.teamConf || r.div === S.teamConf);
  const k = S.teamSort.k, dir = S.teamSort.dir;
  rows.sort((a, b) => ((a[k] > b[k]) - (a[k] < b[k])) * dir || b.power - a.power);
  const cols = [['t', 'Team', 0], ['x', 'Record', 0], ['pts', 'Pts', 1], ['power', 'Power', 1], ['att', 'Attack', 1], ['def', 'Defense', 1], ['gfg', 'GF/G', 1], ['gag', 'GA/G', 1], ['gd', 'Diff', 1], ['luck', 'Luck', 1], ['tot', 'Avg total', 1], ['o65', 'Over 6.5', 1], ['p15', '+1.5 cover', 1], ['ot', 'OT %', 1], ['l10', 'L10', 0], ['st', 'Streak', 0]];
  const th = cols.map(([key, label, sortable]) => h('th', { class: (sortable ? 'sortable r' : '') + (k === key ? ' sorted' : ''), onclick: sortable ? () => { S.teamSort = { k: key, dir: k === key ? -dir : (key === 'def' || key === 'gag' ? 1 : -1) }; render(); } : null, title: label }, label + (k === key ? (dir < 0 ? ' ↓' : ' ↑') : '')));
  const tbody = h('tbody', null, rows.map((r, i) => h('tr', { class: 'click', onclick: () => { S.selTeam = r.t; render(); setTimeout(() => { const el = document.getElementById('team-detail'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 30); } },
    h('td', null, h('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'mono muted', style: { width: '18px', textAlign: 'right' } }, String(i + 1)), badge(r.t), h('span', null, teamName(r.t)))),
    h('td', { class: 'num' }, `${r.x.w}-${r.x.l}-${r.x.otl}`), h('td', { class: 'r num' }, String(r.pts)),
    h('td', { class: 'r num' }, h('span', { class: 'pill ' + (r.power > 5 ? 'good' : r.power < -5 ? 'bad' : 'neutral') }, (r.power > 0 ? '+' : '') + r.power.toFixed(1))),
    h('td', { class: 'r num' }, r.att.toFixed(2)), h('td', { class: 'r num' }, r.def.toFixed(2)), h('td', { class: 'r num' }, r.gfg.toFixed(2)), h('td', { class: 'r num' }, r.gag.toFixed(2)),
    h('td', { class: 'r num' }, (r.gd > 0 ? '+' : '') + r.gd), h('td', { class: 'r num' }, sgnPct(r.luck, 0)), h('td', { class: 'r num' }, r.tot.toFixed(1)), h('td', { class: 'r num' }, pct(r.o65, 0)), h('td', { class: 'r num' }, pct(r.p15, 0)), h('td', { class: 'r num' }, pct(r.ot, 0)),
    h('td', { class: 'num' }, r.x.l10.join('-')), h('td', { class: 'num' }, r.x.streak))));
  const groups = ['All', 'Eastern', 'Western', 'Atlantic', 'Metropolitan', 'Central', 'Pacific'];
  const table = h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('div', null, h('h2', null, 'Power rankings & trends'), h('div', { class: 'small muted' }, 'Power is the model\'s rating: % better or worse than an average team, adjusted for opponents. Luck is points % minus what goal differential predicts; big positive numbers tend to cool off.')),
      h('div', { class: 'chips' }, groups.map(gp => h('button', { class: 'chip', 'aria-pressed': String(S.teamConf === gp), onclick: () => { S.teamConf = gp; render(); } }, gp)))),
    h('div', { class: 'panel-b tbl-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, th)), tbody)));
  return h('div', { class: 'view' }, table, S.selTeam ? teamDetail(S.selTeam) : h('div', { class: 'panel empty' }, h('strong', null, 'Pick a team'), 'Click any row for its game log, form and upcoming schedule with model odds.'), footer());
}
function teamDetail(t) {
  const x = D.stats[t], r = D.rtNow.R[t];
  const upcoming = D.gamesArr.filter(g => !g.final && (g.away === t || g.home === t)).slice(0, 8);
  const up = upcoming.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Opponent'), h('th', null, 'Rest'), h('th', { class: 'r' }, 'Model win %'), h('th', { class: 'r' }, 'Best ML'), h('th', { class: 'r' }, 'EV'))),
    h('tbody', null, upcoming.map(g => { const home = g.home === t, { pred, ctx } = predFor(g); const m = marketsFor(g).find(mm => mm.market === 'ML' && mm.side === (home ? 'home' : 'away'));
      return h('tr', { class: 'click', onclick: () => openGame(g.id) }, h('td', null, fmtDay(g.date)), h('td', null, home ? 'vs ' : '@ ', badge(home ? g.away : g.home)),
        h('td', null, ctx[home ? 'homeB2B' : 'awayB2B'] ? h('span', { class: 'pill warn' }, 'B2B') : h('span', { class: 'muted small' }, (restDays(t, g.date) ?? '—') + 'd')),
        h('td', { class: 'r num' }, pct(home ? pred.pHome : pred.pAway)), h('td', { class: 'r num' }, m ? BL.fmtAm(m.best.price) : '—'), h('td', { class: 'r' }, m ? h('span', { class: 'pill ' + (m.ev >= S.params.minEdge ? 'good' : m.ev >= 0 ? 'neutral' : 'bad') }, sgnPct(m.ev)) : '—')); }))) : h('p', { class: 'muted' }, 'No scheduled games loaded yet.');
  const splits = [['Home', `${x.hw}-${x.hl}-${x.hot}`], ['Road', `${x.rw}-${x.rl}-${x.rot}`], ['Regulation wins', String(x.rw60)], ['Went to OT', `${x.otg} of ${x.gp}`], ['Last season', x.last ? `${x.last.w}-${x.last.l}-${x.last.otl}, ${x.last.pts} pts` : '—'], ['Attack / defense', r.att.toFixed(2) + ' / ' + r.def.toFixed(2)]];
  return h('section', { class: 'panel team-detail', id: 'team-detail' },
    h('div', { class: 'panel-h' }, h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, badge(t, true), h('div', null, h('h2', null, teamName(t)), h('div', { class: 'small muted' }, `${S.teamMap[t].div} · ${x.w}-${x.l}-${x.otl} · ${x.pts} pts · streak ${x.streak}`))), h('button', { class: 'btn sm ghost', onclick: () => { S.selTeam = null; render(); } }, 'Close')),
    h('div', { class: 'panel-b', style: { display: 'grid', gap: '16px' } },
      h('div', { class: 'grid2' },
        h('div', null, h('div', { class: 'eyebrow' }, 'Goal differential, game by game'), chartGameLog(x.log)),
        h('div', null, h('div', { class: 'eyebrow' }, 'Splits'), h('div', null, splits.map(([k, v]) => h('div', { class: 'stat-row', style: { gridTemplateColumns: '1fr auto' } }, h('div', null, k), h('div', { class: 'r' }, v)))))),
      teamPlayers(t),
      h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' } }, 'Up next'), h('div', { class: 'tbl-wrap' }, up))));
}

// ---------- bets ----------
function viewBets() {
  const L = S.ledger; const bets = L.bets.map(b => ({ b, st: gradeBet(b) }));
  const settled = bets.filter(x => ['won', 'lost', 'push'].includes(x.st));
  const pnl = settled.reduce((a, x) => a + betPnl(x.b, x.st), 0), risked = settled.reduce((a, x) => a + x.b.stake, 0);
  const w = settled.filter(x => x.st === 'won').length, l = settled.filter(x => x.st === 'lost').length, p = settled.filter(x => x.st === 'push').length;
  const clvs = bets.map(x => betClv(x.b)).filter(v => v != null);
  const open = bets.filter(x => x.st === 'open');
  // bankroll series
  const ord = settled.slice().sort((a, b) => a.b.date.localeCompare(b.b.date) || a.b.placedAt.localeCompare(b.b.placedAt));
  let run = L.bankroll; const pts = [{ v: run, label: 'Start', date: ord[0] ? ord[0].b.date : null }];
  ord.forEach(x => { run += betPnl(x.b, x.st); pts.push({ v: run, label: x.b.label + ' (' + x.st + ')', date: x.b.date }); });
  const byMkt = ['ML', 'PL', 'TOT'].map(k => { const xs = settled.filter(x => x.b.market === k); const pl = xs.reduce((a, x) => a + betPnl(x.b, x.st), 0), rk = xs.reduce((a, x) => a + x.b.stake, 0); return { k, n: xs.length, pl, roi: rk ? pl / rk : null }; });

  const settings = h('form', { class: 'form-grid', onsubmit: e => { e.preventDefault(); const f = new FormData(e.target); const br = +f.get('br'), un = +f.get('un'); if (br > 0) L.bankroll = br; if (un > 0) L.unit = un; saveLedger(); toast('Bankroll saved'); render(); } },
    h('div', { class: 'field' }, h('label', { for: 'bk-br' }, 'Starting bankroll ($)'), h('input', { id: 'bk-br', name: 'br', inputmode: 'decimal', value: L.bankroll })),
    h('div', { class: 'field' }, h('label', { for: 'bk-un' }, 'Unit size ($)'), h('input', { id: 'bk-un', name: 'un', inputmode: 'decimal', value: L.unit })),
    h('button', { class: 'btn', type: 'submit' }, 'Save'));

  const kpis = h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
    h('div', { class: 'kpi' }, h('div', { class: 'v ' + (pnl > 0 ? 'good' : pnl < 0 ? 'bad' : '') }, sMoney(pnl)), h('div', { class: 'k' }, 'profit · ' + (L.unit ? (pnl / L.unit).toFixed(1) + ' units' : ''))),
    h('div', { class: 'kpi' }, h('div', { class: 'v ' + (pnl > 0 ? 'good' : pnl < 0 ? 'bad' : '') }, risked ? sgnPct(pnl / risked) : '—'), h('div', { class: 'k' }, 'ROI on ' + money(risked) + ' settled')),
    h('div', { class: 'kpi' }, h('div', { class: 'v' }, `${w}-${l}${p ? '-' + p : ''}`), h('div', { class: 'k' }, 'record (W-L' + (p ? '-P' : '') + ')')),
    h('div', { class: 'kpi' }, h('div', { class: 'v ' + (clvs.length ? (clvs.reduce((a, b) => a + b, 0) / clvs.length > 0 ? 'good' : 'bad') : '') }, clvs.length ? sgnPct(clvs.reduce((a, b) => a + b, 0) / clvs.length) : '—'), h('div', { class: 'k' }, 'avg closing line value (' + clvs.length + ' bets)')),
    h('div', { class: 'kpi' }, h('div', { class: 'v' }, money(L.bankroll + pnl)), h('div', { class: 'k' }, 'bankroll now · ' + money(open.reduce((a, x) => a + x.b.stake, 0)) + ' open')));

  const filt = S.betFilter;
  const list = bets.filter(x => filt === 'All' || (filt === 'Open' ? x.st === 'open' : x.st !== 'open')).sort((a, b) => b.b.date.localeCompare(a.b.date) || b.b.placedAt.localeCompare(a.b.placedAt));
  const confirmDel = {};
  const tbl = h('table', { class: 't' },
    h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Bet'), h('th', null, 'Game'), h('th', { class: 'r' }, 'Price'), h('th', { class: 'r' }, 'Stake'), h('th', null, 'Book'), h('th', null, 'Result'), h('th', { class: 'r' }, 'P/L'), h('th', { class: 'r' }, 'CLV'), h('th', null, ''))),
    h('tbody', null, list.length ? list.map(({ b, st }) => { const r = D.resById[b.gameId]; const pl = betPnl(b, st), clv = betClv(b);
      const sel = h('select', { 'aria-label': 'Result', onchange: e => { const v = e.target.value; if (v === 'auto') { b.manual = false; b.status = 'open'; } else { b.manual = true; b.status = v; } saveLedger(); render(); } },
        ['auto', 'won', 'lost', 'push', 'void'].map(v => h('option', { value: v, selected: (b.manual ? b.status : 'auto') === v }, v === 'auto' ? 'Auto: ' + st : v)));
      const del = h('button', { class: 'btn sm ghost', onclick: e => { if (!confirmDel[b.id]) { confirmDel[b.id] = 1; e.target.textContent = 'Confirm delete'; return; } L.bets = L.bets.filter(x => x.id !== b.id); saveLedger(); toast('Bet deleted'); render(); } }, 'Delete');
      return h('tr', null, h('td', { class: 'num' }, fmtDay(b.date)), h('td', null, h('strong', null, b.label)), h('td', null, b.away + ' @ ' + b.home + (r ? ` (${r.as}–${r.hs}${r.per !== 'REG' ? ' ' + r.per : ''})` : '')),
        h('td', { class: 'r num' }, BL.fmtAm(b.price)), h('td', { class: 'r num' }, money(b.stake, 2)), h('td', { class: 'small' }, b.book || ''),
        h('td', null, h('span', { class: 'pill ' + (st === 'won' ? 'good' : st === 'lost' ? 'bad' : 'neutral') + ' bet-status' }, st), ' ', sel),
        h('td', { class: 'r num pnl ' + (pl > 0 ? 'good' : pl < 0 ? 'bad' : '') }, st === 'open' ? '—' : sMoney(pl)),
        h('td', { class: 'r num' }, clv == null ? '—' : sgnPct(clv)), h('td', null, del)); }) : h('tr', null, h('td', { colspan: 10 }, h('div', { class: 'empty' }, h('strong', null, 'No bets tracked yet'), 'Open any game and press "Track bet", or add one below. Results grade themselves when the final score comes in.')))));

  // manual add
  const upcoming = D.gamesArr.filter(g => !g.final).slice(0, 40);
  const addForm = h('form', { class: 'form-grid', onsubmit: e => { e.preventDefault(); const f = new FormData(e.target); const g = D.allGames[f.get('g')]; if (!g) return;
      const [market, side] = f.get('ms').split(':'); const line = f.get('line') === '' ? null : +f.get('line'); const price = +f.get('price'), stake = +f.get('stake');
      if (market !== 'ML' && line == null) { toast('Enter the line for puck line or total bets'); return; }
      if (!(Math.abs(price) >= 100)) { toast('Enter American odds like -110 or +145'); return; }
      if (!(stake > 0)) { toast('Enter a stake above $0'); return; }
      const team = side === 'away' ? g.away : side === 'home' ? g.home : null;
      const label = market === 'ML' ? team + ' ML' : market === 'PL' ? team + ' ' + (line > 0 ? '+' : '') + line : (side === 'over' ? 'Over ' : 'Under ') + line;
      L.bets.push({ id: 'b' + Date.now().toString(36), gameId: g.id, date: g.date, away: g.away, home: g.home, market, side, line: market === 'ML' ? null : line, price, stake, book: f.get('book') || '', label, placedAt: new Date().toISOString(), status: 'open' });
      saveLedger(); toast('Bet saved'); render(); } },
    h('div', { class: 'field', style: { gridColumn: 'span 2' } }, h('label', { for: 'add-g' }, 'Game'), h('select', { id: 'add-g', name: 'g' }, upcoming.map(g => h('option', { value: g.id }, fmtDay(g.date) + ' · ' + g.away + ' @ ' + g.home)))),
    h('div', { class: 'field' }, h('label', { for: 'add-ms' }, 'Bet'), h('select', { id: 'add-ms', name: 'ms' }, [['ML:away', 'Away ML'], ['ML:home', 'Home ML'], ['PL:away', 'Away puck line'], ['PL:home', 'Home puck line'], ['TOT:over', 'Over'], ['TOT:under', 'Under']].map(([v, t]) => h('option', { value: v }, t)))),
    h('div', { class: 'field' }, h('label', { for: 'add-line' }, 'Line'), h('input', { id: 'add-line', name: 'line', inputmode: 'decimal', placeholder: '-1.5 or 6.5' })),
    h('div', { class: 'field' }, h('label', { for: 'add-price' }, 'Price'), h('input', { id: 'add-price', name: 'price', inputmode: 'numeric', placeholder: '-110' })),
    h('div', { class: 'field' }, h('label', { for: 'add-stake' }, 'Stake ($)'), h('input', { id: 'add-stake', name: 'stake', inputmode: 'decimal', value: L.unit })),
    h('div', { class: 'field' }, h('label', { for: 'add-book' }, 'Book'), h('input', { id: 'add-book', name: 'book', placeholder: 'DraftKings' })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Add bet'));

  const storeNote = S.ledgerMode === 'db' ? 'Saved to your Claude account, so it follows you across devices. Only you can see it.' : SITE ? 'Saved in this browser. Export them to move to another device.' : 'Saved in this browser only. Open this page from Claude while signed in to keep bets with your account.';
  const io = SITE ? h('div', { class: 'brief-actions' },
    h('button', { class: 'btn sm', onclick: () => { const blob = new Blob([JSON.stringify(S.ledger, null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: 'blueline-bets-' + localDate() + '.json' }); document.body.append(a); a.click(); a.remove(); } }, 'Export bets'),
    h('label', { class: 'btn sm', style: { cursor: 'pointer' } }, 'Import bets', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { const d = JSON.parse(t); if (!d || !Array.isArray(d.bets)) throw new Error('not a bets file'); S.ledger = { bankroll: d.bankroll || 1000, unit: d.unit || 10, bets: d.bets }; saveLedger(); render(); toast('Imported ' + d.bets.length + ' bets'); }).catch(() => toast('That file is not a Blueline bets export')); } }))) : null;
  return h('div', { class: 'view' },
    h('div', { class: 'slate-bar' }, h('div', null, h('div', { class: 'eyebrow' }, 'My bets'), h('h1', { class: 'h-display', style: { fontSize: 'clamp(28px,4vw,40px)' } }, 'Bankroll & results')), h('div', { style: { display: 'grid', gap: '6px', justifyItems: 'end' } }, h('span', { class: 'small muted', style: { maxWidth: '46ch' } }, storeNote), io)),
    kpis,
    h('div', { class: 'grid2' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Bankroll')), h('div', { class: 'panel-b' }, settled.length ? chartBankroll(pts, L.bankroll) : h('div', { class: 'empty' }, 'Your bankroll line starts after your first settled bet.'))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'By market')), h('div', { class: 'panel-b' },
        byMkt.map(m => h('div', { class: 'stat-row', style: { gridTemplateColumns: '1fr auto auto' } }, h('div', null, MKT_NAME[m.k]), h('div', { class: 'r muted' }, m.n + ' bets'), h('div', { class: 'r pnl ' + (m.pl > 0 ? 'good' : m.pl < 0 ? 'bad' : '') }, sMoney(m.pl) + (m.roi != null ? ' (' + sgnPct(m.roi) + ')' : '')))),
        h('div', { class: 'eyebrow', style: { margin: '14px 0 6px' } }, 'Bankroll settings'), settings))),
    h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Bet history'), h('div', { class: 'seg' }, ['All', 'Open', 'Settled'].map(k => h('button', { 'aria-pressed': String(filt === k), onclick: () => { S.betFilter = k; render(); } }, k)))), h('div', { class: 'panel-b tbl-wrap' }, tbl)),
    h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Add a bet by hand')), h('div', { class: 'panel-b' }, addForm)),
    footer());
}

// ---------- model lab ----------
let btCache = null, btKey = '';
function viewModel() {
  const P = S.params;
  const defs = [
    ['marketWeight', 'Model vs market', 0, 1, 0.05, v => Math.round(v * 100) + '% model', 'How much to trust the model over the betting market. Books are sharp; early in the season keep this at 50% or lower.'],
    ['minEdge', 'Value bar', 0, 0.1, 0.005, v => pct(v, 1), 'Minimum expected value before a bet is flagged as value.'],
    ['kelly', 'Kelly fraction', 0.05, 1, 0.05, v => pct(v, 0), 'Share of the full Kelly stake to suggest. 25% keeps swings survivable.'],
    ['kellyCap', 'Max stake', 0.005, 0.1, 0.005, v => pct(v, 1) + ' of bankroll', 'Hard cap on any single suggested stake.'],
    ['priorGames', 'Last season weight', 0, 60, 1, v => v + ' games', 'Last season counts as this many games of evidence. As the season goes on, current results take over.'],
    ['regress', 'Summer regression', 0, 0.6, 0.05, v => pct(v, 0), 'How far to pull last season toward average to account for roster turnover.'],
    ['halfLife', 'Recency half-life', 3, 82, 1, v => v + ' games', 'A game this many games ago counts half as much as the latest one.'],
    ['homeAdv', 'Home ice', 0, 0.15, 0.005, v => pct(v, 1), 'Total scoring swing toward the home team.'],
    ['b2b', 'Back-to-back penalty', 0, 0.1, 0.005, v => pct(v, 1), 'Fewer goals for and more against when a team played the day before.'],
    ['tieBoost', 'Regulation ties', 1, 1.6, 0.01, v => v.toFixed(2) + '×', 'NHL games tie after 60 minutes more often than a plain Poisson model expects (about 22% of games).'],
    ['eng', 'Empty-net goals', 0, 0.4, 0.01, v => pct(v, 0), 'Share of one-goal regulation leads that end as two-goal wins. Matters most for the puck line.'],
    ['otShrink', 'OT skill', 0, 1, 0.05, v => pct(v, 0), 'How much the better team keeps its edge in overtime and the shootout. 0% is a coin flip.']
  ];
  const key = JSON.stringify([P.priorGames, P.regress, P.halfLife, P.homeAdv, P.b2b, P.tieBoost, P.eng, P.otShrink, D.results.length]);
  if (key !== btKey) { btCache = BL.backtest(D.teams, S.feed.teams.last, D.results, P); btKey = key; }
  const bt = btCache;
  // closing-line check on archived lines
  const clos = S.feed.closing && S.feed.closing.games || {}; let cn = 0, cpl = 0; const cRows = [];
  for (const [id, c] of Object.entries(clos)) { const g = D.allGames[id]; if (!g || !g.final) continue;
    const gg = Object.assign({}, g); const books = { [c.book || 'Close']: c };
    const { pred } = predFor(gg); if (!pred) continue;
    const ev = BL.evaluate(pred, books, P).filter(e => e.ev >= P.minEdge);
    ev.forEach(e => { const st = gradeBet({ gameId: g.id, market: e.market, side: e.side, line: e.line != null ? e.line : null, price: e.price, stake: 1 }); const pl = st === 'won' ? BL.amToDec(e.price) - 1 : st === 'lost' ? -1 : 0; cn++; cpl += pl; cRows.push({ g, e, st, pl }); });
  }
  const sliders = defs.map(([k, label, min, max, step, fmt, help]) => { const id = 'p-' + k;
    return h('div', { class: 'param' }, h('label', { for: id }, label), h('output', { id: id + '-o' }, fmt(P[k])),
      h('input', { id, type: 'range', min, max, step, value: P[k], oninput: e => { document.getElementById(id + '-o').textContent = fmt(+e.target.value); }, onchange: e => { P[k] = +e.target.value; lsSet('bl.params.v1', P); derive(); render(); } }), h('p', null, help)); });
  return h('div', { class: 'view' },
    h('div', { class: 'slate-bar' }, h('div', null, h('div', { class: 'eyebrow' }, 'Model'), h('h1', { class: 'h-display', style: { fontSize: 'clamp(28px,4vw,40px)' } }, 'How the numbers are made')), h('button', { class: 'btn', onclick: () => { S.params = Object.assign({}, BL.DEFAULTS); lsSet('bl.params.v1', S.params); derive(); render(); toast('Model reset to defaults'); } }, 'Reset to defaults')),
    h('div', { class: 'lab-grid' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Dials')), h('div', { class: 'panel-b' }, sliders)),
      h('div', { style: { display: 'grid', gap: '20px', alignContent: 'start' } },
        h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Track record'), h('span', { class: 'small muted' }, 'Walk-forward: each game predicted using only earlier games')), h('div', { class: 'panel-b', style: { display: 'grid', gap: '14px' } },
          h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(3, minmax(0,1fr))' } },
            h('div', { class: 'kpi' }, h('div', { class: 'v' }, pct(bt.acc, 1)), h('div', { class: 'k' }, 'picked the winner (' + bt.n + ' games)')),
            h('div', { class: 'kpi' }, h('div', { class: 'v ' + (bt.logLoss < bt.logLossBase ? 'good' : 'bad') }, bt.logLoss.toFixed(3)), h('div', { class: 'k' }, 'log loss vs ' + bt.logLossBase.toFixed(3) + ' for "home 53.5%"')),
            h('div', { class: 'kpi' }, h('div', { class: 'v' }, bt.brier.toFixed(3)), h('div', { class: 'k' }, 'Brier score (lower is better)'))),
          chartCalibration(bt.rows),
          h('div', { class: 'note' }, cn ? `Against archived closing lines, the value bar flagged ${cn} bets that went ${cRows.filter(r => r.st === 'won').length}-${cRows.filter(r => r.st === 'lost').length} for ${cpl >= 0 ? '+' : ''}${cpl.toFixed(2)} units. That is a tiny sample; judge the model on closing line value over hundreds of bets, not on a week of results.` : 'Closing lines are archived each morning. Once there are some, this shows how flagged bets did against them.'))),
        propsLab(),
        h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Method')), h('div', { class: 'panel-b prose' },
          h('p', null, 'Each team gets an attack and a defense rating from goals scored and allowed, adjusted for who they played and where, with recent games weighted more. Last season, pulled toward average, acts as a starting point so a hot first week does not run away with the ratings.'),
          h('p', null, 'For a game, the ratings give each team\'s expected goals. A Poisson model turns those into the chance of every regulation score, with extra weight on ties and a share of one-goal leads turned into empty-net wins. Ties go to OT and the shootout, where the better team keeps only part of its edge.'),
          h('p', null, 'That score grid prices the moneyline, puck line and total. The market\'s price, with the bookmaker\'s margin removed and averaged across books, is blended in by the dial on the left. Expected value uses that blend at the best price available. Stakes come from fractional Kelly with a cap.'),
          h('p', null, SITE ? 'Three times a day a scheduled job pulls new results, box scores, rosters and the schedule from the NHL, checks them against the official standings, and pulls lines and player props from The Odds API, then rebuilds this page. Starting goalies are projected from recent starts.' : 'Twice a day a scheduled Claude run pulls new results, box scores, standings, lines from several books and goalie news, then writes a short brief for each game.'))))),
    footer());
}

function footer() {
  return h('div', { class: 'foot' }, h('span', null, 'For adults of legal betting age. Model output is an estimate, not a guarantee. Bet only what you can afford to lose. Problem gambling help: 1-800-GAMBLER (call or text).'),
    h('span', null, (window.BL_CONFIG && window.BL_CONFIG.sources) || 'Data: NHL stats API, Sportsbook Review, Covers, Daily Faceoff.'));
}

/*PROPS*/
/*CHAT*/
// ---------- boot ----------
function setFeed(docs) {
  const F = {}; for (const d of docs) if (d.exists) F[d.id] = d.data();
  if (!F.teams || !F.results) { S.feedState = 'off'; S.feed = null; D = null; render(); return; }
  S.feed = F; S.feedState = 'ok'; derive(); render();
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { S.tab = t.dataset.tab; lsSet('bl.tab', S.tab); render(); window.scrollTo(0, 0); }));
document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (S.openPlayer) closePlayer(); else if (S.open) closeGame(); });
const TABS = ['board', 'props', 'teams', 'bets', 'model'];
S.tab = lsGet('bl.tab', 'board'); if (!TABS.includes(S.tab)) S.tab = 'board';
if (location.hash && TABS.includes(location.hash.slice(1))) S.tab = location.hash.slice(1);
S.ledger = Object.assign(S.ledger, lsGet('bl.ledger.v1', {})); S.ledgerMode = 'local';
render();

(async function connect() {
  const feedUrl = (window.BL_CONFIG && window.BL_CONFIG.feedUrl) || 'feed.json';
  let snapP = null;
  const useSnapshot = async () => {
    if (S.feedState === 'ok') return;
    snapP = snapP || fetch(feedUrl, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const snap = await snapP; if (S.feedState === 'ok') return;
    if (!snap || !snap.teams) { S.feedState = 'off'; render(); return; }
    S.feed = snap; S.feedState = (window.BL_CONFIG && window.BL_CONFIG.mode === 'site') ? 'ok' : 'snapshot'; derive(); render(); };
  const has = window.claude && window.claude.use;
  const db = has ? await window.claude.use('db').catch(() => null) : null;
  if (!db) { useSnapshot(); return; }
  const fallbackTimer = setTimeout(useSnapshot, 6000);
  db.collection('data/nhl/feed').onSnapshot(sn => { const docs = sn.docs.filter(d => d.exists); if (!docs.length) { useSnapshot(); return; } clearTimeout(fallbackTimer); setFeed(sn.docs); }, () => { clearTimeout(fallbackTimer); useSnapshot(); });
  const user = await window.claude.use('user').catch(() => null);
  const uid = user ? await user.id().catch(() => null) : null;
  if (!uid) return;
  const canWrite = user.can ? await Promise.resolve(user.can('data.write')).catch(() => null) : null;
  if (canWrite === false) return; // view-only visitors keep bets in this browser
  S.uid = uid; dbRef = db.doc('data/users/' + uid + '/ledger');
  let first = true;
  dbRef.onSnapshot(sn => {
    if (sn.exists) { const d = sn.data(); S.ledger = { bankroll: d.bankroll || 1000, unit: d.unit || 10, bets: (d.bets || []).map(b => Object.assign({}, b)) }; S.ledgerMode = 'db'; }
    else if (first) { S.ledgerMode = 'db'; if (S.ledger.bets.length) saveLedger(); }
    first = false; render();
  }, () => {});
})();
renderChatShell();
})();
