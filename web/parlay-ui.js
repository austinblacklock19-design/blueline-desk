// ---------- same-game parlay checker ----------
// Pick legs for one game, type in the book's price (and any profit boost), and see the real chance that every leg
// hits (the legs are priced together, not multiplied), the fair price, the expected value and a stake.
S.parlays = lsGet('bl.parlays.v1', {}); // gameId -> {legs, price, boost, stake}
S.homeBook = lsGet('bl.homebook', ''); // '' = best price across books
const PARLAY_BOOSTS = [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 1];
function parlayState(gid) {
  const st = S.parlays[gid] = S.parlays[gid] || { legs: [], price: '', boost: 0, stake: '' };
  if (!Array.isArray(st.legs)) st.legs = [];
  return st;
}
function saveParlays() { // keep only games that are still to come, so the list never grows without end
  for (const id of Object.keys(S.parlays)) { const g = D && D.allGames[id]; if (!g || g.final) delete S.parlays[id]; }
  lsSet('bl.parlays.v1', S.parlays);
}
function parsePrice(v) {
  if (typeof v === 'number') return Math.abs(v) >= 100 ? v : null;
  const t = String(v || '').replace(/[−–]/g, '-').replace(/[^0-9+\-.]/g, '');
  const n = parseFloat(t); return isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
}
function pName(pid) { const p = playerInfo(pid); return p ? shortP(p.n) : 'Player ' + pid; }
function legLabel(g, l) {
  const T = s => s === 'home' ? g.home : g.away;
  switch (l.kind) {
    case 'ml': return T(l.side) + ' moneyline';
    case 'reg': return T(l.side) + ' to win in regulation';
    case 'pl': return T(l.side) + ' ' + (l.line > 0 ? '+' : '') + l.line;
    case 'total': return (l.side === 'over' ? 'Over ' : 'Under ') + l.line + ' goals';
    case 'tt': return T(l.team) + (l.side === 'over' ? ' over ' : ' under ') + l.line + ' goals';
    case 'goal': return pName(l.pid) + (l.k > 1 ? ' ' + l.k + '+ goals' : ' to score');
    case 'point': return pName(l.pid) + ' ' + l.k + '+ point' + (l.k > 1 ? 's' : '');
    case 'assist': return pName(l.pid) + ' ' + l.k + '+ assist' + (l.k > 1 ? 's' : '');
    case 'sog': return pName(l.pid) + ' ' + l.k + '+ shots';
  }
  return l.kind;
}
// one leg per "slot": a new moneyline replaces the old one, a player's new goal leg replaces his old goal leg
const legSlot = l => BLX.isPlayerLeg(l) ? l.kind + ':' + l.pid : l.kind === 'tt' ? 'tt:' + l.team : l.kind === 'total' ? 'total' : l.kind;

// The game priced two ways: the model alone, and blended with the market the way the rest of the page does.
function parlayInputs(g) {
  const { pred } = predFor(g); if (!pred) return null;
  const rows = (gameProps(g) || []).filter(r => !r.goalie);
  const mk = marketsFor(g);
  const mlA = mk.find(m => m.market === 'ML' && m.side === 'away'), ov = mk.find(m => m.market === 'TOT' && m.side === 'over');
  const blendPred = mlA || ov ? BLX.tune(BL, pred.lh, pred.la, { awayWin: mlA ? mlA.p : null, over: ov ? ov.p : null, line: ov ? ov.line : null }, S.params) : null;
  const playersFor = (pr, useBook) => {
    const dist = BLX.goalDists(pr), out = {};
    for (const r of rows) {
      const g1 = useBook && r.mk.G.book && r.mk.G.line === 0.5 && r.mk.G.bO != null ? r.mk.G.bO : 1 - r.pmf.G[0];
      const p1 = useBook && r.mk.PTS.book && r.mk.PTS.line === 0.5 && r.mk.PTS.bO != null ? r.mk.PTS.bO : 1 - r.pmf.PTS[0];
      out[r.pid] = BLX.playerRates(dist[r.side], g1, p1, { pmf: r.pmf.SOG, q: r.mean.SOG > 0 ? Math.min(0.5, r.mean.G / r.mean.SOG) : 0.1 });
    }
    return out;
  };
  const versions = [{ key: 'model', label: 'Model', pred, players: playersFor(pred, false) }];
  if (blendPred) versions.push({ key: 'blend', label: 'Model + market', pred: blendPred, players: playersFor(blendPred, true) });
  return { rows, versions };
}
function parlayCalc(g, legs) {
  if (!legs.length) return null;
  const key = g.id + JSON.stringify(legs) + JSON.stringify(ctxFor(g)) + JSON.stringify(S.params) + JSON.stringify(S.pparams) + S.homeBook;
  D.parlayCache = D.parlayCache || {};
  if (D.parlayCache[key]) return D.parlayCache[key];
  const inp = parlayInputs(g); if (!inp) return null;
  try {
    const res = inp.versions.map(v => Object.assign({ key: v.key, label: v.label }, BLX.price(v.pred, legs.map(l => Object.assign({}, l)), v.players)));
    return D.parlayCache[key] = { res, use: res[res.length - 1] };
  } catch (e) { return { error: e.message }; }
}

function parlayGameOptions(g) {
  const mk = marketsFor(g), tot = mk.find(m => m.market === 'TOT'), lines = [5.5, 6.5];
  if (tot && !lines.includes(tot.line)) lines.push(tot.line);
  const o = [];
  for (const sd of ['away', 'home']) o.push([g[sd] + ' moneyline', { kind: 'ml', side: sd }]);
  for (const sd of ['away', 'home']) o.push([g[sd] + ' to win in regulation', { kind: 'reg', side: sd }]);
  for (const sd of ['away', 'home']) for (const ln of [-1.5, 1.5]) o.push([g[sd] + ' ' + (ln > 0 ? '+' : '') + ln, { kind: 'pl', side: sd, line: ln }]);
  for (const ln of lines.sort((a, b) => a - b)) for (const sd of ['over', 'under']) o.push([(sd === 'over' ? 'Over ' : 'Under ') + ln + ' goals', { kind: 'total', side: sd, line: ln }]);
  for (const t of ['away', 'home']) for (const ln of [2.5, 3.5]) for (const sd of ['over', 'under']) o.push([g[t] + (sd === 'over' ? ' over ' : ' under ') + ln + ' goals', { kind: 'tt', team: t, side: sd, line: ln }]);
  return o;
}
const PARLAY_PLAYER_MKTS = [['goal1', 'To score', { kind: 'goal', k: 1 }], ['goal2', '2+ goals', { kind: 'goal', k: 2 }], ['point1', '1+ point', { kind: 'point', k: 1 }], ['point2', '2+ points', { kind: 'point', k: 2 }],
  ['assist1', '1+ assist', { kind: 'assist', k: 1 }], ['sog2', '2+ shots', { kind: 'sog', k: 2 }], ['sog3', '3+ shots', { kind: 'sog', k: 3 }], ['sog4', '4+ shots', { kind: 'sog', k: 4 }], ['sog5', '5+ shots', { kind: 'sog', k: 5 }]];

function addParlayLeg(g, leg) {
  const st = parlayState(g.id);
  if (BLX.isPlayerLeg(leg)) {
    const sameTeam = new Set(st.legs.filter(l => BLX.isPlayerLeg(l) && l.team === leg.team && l.pid !== leg.pid).map(l => l.pid));
    if (sameTeam.size >= BLX.MAX_PLAYERS) { toast('Up to ' + BLX.MAX_PLAYERS + ' players per team'); return; }
  }
  if (st.legs.length >= 10) { toast('Up to 10 legs'); return; }
  st.legs = st.legs.filter(l => legSlot(l) !== legSlot(leg)).concat([leg]);
  saveParlays(); renderDrawer();
}
function removeParlayLeg(g, i) { const st = parlayState(g.id); st.legs.splice(i, 1); saveParlays(); renderDrawer(); }

function parlayVerdict(ev) {
  if (ev == null) return null;
  if (ev >= S.params.minEdge) return h('span', { class: 'pill good' }, 'Good bet');
  if (ev >= 0) return h('span', { class: 'pill neutral' }, 'About even');
  return h('span', { class: 'pill bad' }, 'Pass');
}
function parlayResults(g) {
  const st = parlayState(g.id), calc = parlayCalc(g, st.legs);
  const box = h('div', { id: 'parlay-results', class: 'parlay-results', 'aria-live': 'polite' });
  if (!calc) { box.append(h('p', { class: 'muted', style: { margin: 0 } }, 'Add two or more legs to price a parlay. Tip: legs that pull the same way (a team to win and its players to score) make the best parlays.')); return box; }
  if (calc.error) { box.append(h('p', { class: 'bad', style: { margin: 0 } }, calc.error)); return box; }
  const u = calc.use, price = parsePrice(st.price), boost = +st.boost || 0;
  const e = price != null ? BLX.evaluate(u.p, price, boost) : null;
  const bank = S.ledger.bankroll || 0;
  const kel = e ? BL.kellyStake(u.p, e.am, S.params) : 0;
  const breakEven = BLX.minPrice(u.p, boost, 0), clear = BLX.minPrice(u.p, boost, S.params.minEdge);
  const odds1 = p => p > 0 ? '1 in ' + (1 / p >= 100 ? Math.round(1 / p) : (1 / p).toFixed(1)) : '—';
  box.append(
    h('div', { class: 'kpis parlay-kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, pct(u.p, u.p < 0.1 ? 2 : 1)), h('div', { class: 'k' }, 'chance every leg hits (' + odds1(u.p) + ')')),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, BL.fmtAm(u.fairAm)), h('div', { class: 'k' }, 'fair odds')),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, BL.fmtAm(breakEven)), h('div', { class: 'k' }, boost ? 'worth it at this price or longer, before the ' + Math.round(boost * 100) + '% boost' : 'worth it at this price or longer'))),
    e ? h('div', { class: 'parlay-ev' },
      parlayVerdict(e.ev),
      h('span', null, 'At ' + BL.fmtAm(price) + (boost ? ' boosted to ' + BL.fmtAm(e.am) : '') + ' you need it to hit ' + pct(e.breakEven, 2) + ' of the time. Expected value ' + sgnPct(e.ev) + (st.stake > 0 ? ' (' + sMoney(e.ev * st.stake) + ' on ' + money(+st.stake, 2) + ')' : '') + '.'),
      h('span', { class: 'muted' }, kel * bank >= 0.5 ? 'Suggested stake ' + money(kel * bank, 2) + ' (' + pct(S.params.kelly, 0) + ' Kelly on a ' + money(bank) + ' bankroll).' : e.ev > 0 ? 'Long odds: keep it to small change.' : 'No stake: the price is short of fair.'))
      : h('p', { class: 'small muted', style: { margin: 0 } }, 'Type the price your sportsbook shows for these legs to see the expected value. Clears your ' + pct(S.params.minEdge, 1) + ' value bar at ' + BL.fmtAm(clear) + ' or longer.'),
    calc.res.length > 1 ? h('p', { class: 'small muted', style: { margin: 0 } }, calc.res.map(r => r.label + ' ' + pct(r.p, 2)).join(' · ') + '. Decisions use model + market.') : h('p', { class: 'small muted', style: { margin: 0 } }, 'No sportsbook lines are loaded for this game, so this is the model alone.'),
    h('p', { class: 'small muted', style: { margin: 0 } }, 'Priced as if the legs were independent: ' + pct(u.indep, 2) + '. ' + (u.p > u.indep * 1.05 ? 'These legs help each other.' : u.p < u.indep * 0.95 ? 'Some of these legs work against each other.' : 'These legs mostly cancel out.')));
  return box;
}
function parlayPanel(g) {
  if (g.final) return null;
  const st = parlayState(g.id), calc = parlayCalc(g, st.legs), inp = parlayInputs(g);
  if (!inp) return null;
  const legsList = st.legs.length ? h('div', { class: 'parlay-legs' }, st.legs.map((l, i) => {
    const each = calc && calc.use && calc.use.each ? calc.use.each[i] : null;
    return h('div', { class: 'parlay-leg' },
      h('div', { class: 'pl-name' }, legLabel(g, l)),
      h('div', { class: 'pl-num pl-own' }, each ? pct(each.own, 0) : '—', h('span', { class: 'muted' }, ' alone')),
      h('div', { class: 'pl-num pl-given' }, each && st.legs.length > 1 ? pct(each.givenOthers, 0) : '—', h('span', { class: 'muted' }, ' if the rest hit')),
      h('button', { class: 'btn sm ghost pl-x', 'aria-label': 'Remove ' + legLabel(g, l), onclick: () => removeParlayLeg(g, i) }, 'Remove'));
  })) : null;
  const gameSel = h('select', { id: 'pl-game', 'aria-label': 'Add a game leg', onchange: e => { const v = e.target.value; if (v === '') return; addParlayLeg(g, JSON.parse(v)); } },
    h('option', { value: '' }, 'Add a game leg…'), parlayGameOptions(g).map(([t, l]) => h('option', { value: JSON.stringify(l) }, t)));
  const byTeam = side => inp.rows.filter(r => r.side === side).sort((a, b) => b.mean.G - a.mean.G);
  const playerSel = h('select', { id: 'pl-player', 'aria-label': 'Player' }, h('option', { value: '' }, 'Player…'),
    ['away', 'home'].map(sd => h('optgroup', { label: teamName(g[sd]) }, byTeam(sd).map(r => h('option', { value: r.pid + ':' + sd }, playerInfo(r.pid).n)))));
  const mktSel = h('select', { id: 'pl-mkt', 'aria-label': 'Player market' }, PARLAY_PLAYER_MKTS.map(([k, t]) => h('option', { value: k }, t)));
  const addBtn = h('button', { class: 'btn', onclick: () => { if (!playerSel.value) { toast('Pick a player first'); return; } const [pid, side] = playerSel.value.split(':'); const m = PARLAY_PLAYER_MKTS.find(x => x[0] === mktSel.value); addParlayLeg(g, Object.assign({ pid, team: side }, m[2])); } }, 'Add');
  const refresh = () => { const box = document.getElementById('parlay-results'); if (box) box.replaceWith(parlayResults(g)); };
  const priceIn = h('input', { id: 'pl-price', inputmode: 'text', placeholder: '+750', value: st.price, oninput: e => { st.price = e.target.value; saveParlays(); refresh(); } });
  const boostSel = h('select', { id: 'pl-boost', onchange: e => { st.boost = +e.target.value; saveParlays(); refresh(); } }, PARLAY_BOOSTS.map(b => h('option', { value: b, selected: Math.abs((+st.boost || 0) - b) < 1e-9 }, b ? Math.round(b * 100) + '% profit boost' : 'No boost')));
  const stakeIn = h('input', { id: 'pl-stake', inputmode: 'decimal', placeholder: String(S.ledger.unit || 10), value: st.stake, oninput: e => { st.stake = e.target.value === '' ? '' : +e.target.value; saveParlays(); refresh(); } });
  const track = h('button', { class: 'btn primary', onclick: () => {
    const c = parlayCalc(g, st.legs), price = parsePrice(st.price), stake = +st.stake || S.ledger.unit || 10;
    if (!c || c.error || st.legs.length < 2) { toast('Add at least two legs'); return; }
    if (price == null) { toast('Enter the price your book shows, like +750'); return; }
    const boost = +st.boost || 0, e = BLX.evaluate(c.use.p, price, boost);
    S.ledger.bets.push({ id: 'b' + Date.now().toString(36), gameId: g.id, date: g.date, away: g.away, home: g.home, market: 'PARLAY', legs: st.legs.map(l => Object.assign({}, l)),
      price: e.am, basePrice: price, boost, stake, book: S.homeBook || 'Sportsbook', label: st.legs.map(l => legLabel(g, l)).join(' + ') + (boost ? ' (' + Math.round(boost * 100) + '% boost)' : ''),
      pAtBet: c.use.p, placedAt: new Date().toISOString(), status: 'open' });
    saveLedger(); toast('Parlay saved to My Bets'); render(); } }, 'Track parlay');
  return h('section', { class: 'panel', id: 'parlay' },
    h('div', { class: 'panel-h' }, h('h2', null, 'Same-game parlay'), st.legs.length ? h('button', { class: 'btn sm ghost', onclick: () => { st.legs = []; saveParlays(); renderDrawer(); } }, 'Clear') : h('span', { class: 'small muted' }, 'Legs priced together, not multiplied')),
    h('div', { class: 'panel-b parlay' },
      h('div', { class: 'parlay-pick' }, gameSel, h('div', { class: 'parlay-player' }, playerSel, mktSel, addBtn)),
      legsList,
      h('div', { class: 'form-grid parlay-inputs' },
        h('div', { class: 'field' }, h('label', { for: 'pl-price' }, (S.homeBook || 'Your book') + ' price'), priceIn),
        h('div', { class: 'field' }, h('label', { for: 'pl-boost' }, 'Boost'), boostSel),
        h('div', { class: 'field' }, h('label', { for: 'pl-stake' }, 'Stake ($)'), stakeIn),
        track),
      parlayResults(g),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Player legs follow from how many goals each team scores, so two scorers need a high-scoring game and a team\'s scorers help its moneyline. Linemates setting each other up isn\'t counted, so a stack of linemates is priced a little low. Set a backup goalie under "Your adjustments" first.')));
}

// The book you bet at: expected value and stakes use its prices only.
function homeBookPicker() {
  const seen = new Set(['FanDuel', 'DraftKings', 'BetMGM', 'Caesars', 'ESPN BET', 'BetRivers', 'Fanatics', 'bet365']);
  const odds = S.feed && S.feed.odds && S.feed.odds.games || {};
  for (const o of Object.values(odds)) for (const b of Object.keys(o.books || {})) if (b !== 'Opener') seen.add(b);
  if (S.homeBook) seen.add(S.homeBook);
  return h('div', { class: 'param' }, h('label', { for: 'p-homebook' }, 'Your sportsbook'), h('output', null, S.homeBook || 'Best price'),
    h('select', { id: 'p-homebook', onchange: e => { S.homeBook = e.target.value; lsSet('bl.homebook', S.homeBook); if (D) { D.parlayCache = {}; if (D.pp) D.pp.cache = {}; } render(); } },
      h('option', { value: '' }, 'Best price across books'), [...seen].sort((a, b) => a.localeCompare(b)).map(b => h('option', { value: b, selected: S.homeBook === b }, b))),
    h('p', null, 'Expected value and stakes use this book\'s prices, so only bets you can actually place get flagged. The fair price still comes from every book.'));
}

// Grade a tracked parlay from the final score and the box score.
function gradeParlay(b) {
  if (b.manual && b.status !== 'open') return b.status;
  const r = D && D.resById[b.gameId]; if (!r) return 'open';
  const o = { hf: r.hs, af: r.as, win: r.hs > r.as ? 'home' : 'away', how: r.per === 'REG' ? 'REG' : r.per };
  let pending = false;
  for (const l of b.legs || []) {
    if (!BLX.isPlayerLeg(l)) { if (!BLX.gameLegHits(l, o)) return 'lost'; continue; }
    const pp = PP(); if (!pp) { pending = true; continue; }
    const logs = pp.data.logs.filter(x => String(x.g) === String(b.gameId));
    if (!logs.length) { pending = true; continue; } // box score not in yet
    const x = logs.find(y => y.pid === String(l.pid));
    if (!x || x.toi <= 0) { pending = true; continue; } // didn't play: books re-price or void, grade it by hand
    const v = l.kind === 'goal' ? x.G : l.kind === 'assist' ? x.A : l.kind === 'point' ? x.G + x.A : x.S;
    if (v < (l.k || 1)) return 'lost';
  }
  return pending ? 'open' : 'won';
}
