// ---------- player props: headshots, projections, Props tab, player drawer ----------
const HEADS = window.__HEADS__ || null; // {size, cols, teams: {TEAM: [playerId, ...]}} for the p/<TEAM>.webp sheets
const HEAD_BASE = (window.BL_CONFIG && window.BL_CONFIG.assetBase) || '';
const headPos = {};
if (HEADS) for (const [t, ids] of Object.entries(HEADS.teams)) ids.forEach((id, i) => { if (id > 0) headPos[id] = [t, i]; });
const PM = BLP.MARKETS;
S.pparams = Object.assign({}, BLP.DEFAULTS, lsGet('bl.pparams.v1', {}));
S.myLines = lsGet('bl.mylines.v1', {});
S.propMkt = lsGet('bl.propmkt', 'SOG'); if (!PM[S.propMkt]) S.propMkt = 'SOG';
S.propGame = 'All'; S.propQ = ''; S.propSort = 'edge'; S.openPlayer = null;

function playerInfo(pid) { const P = S.feed && S.feed.players && S.feed.players.players; const v = P && P[pid]; return v ? { pid: String(pid), n: v[0], t: v[1], p: v[2], no: v[3], sh: v[4], bd: v[5], act: v[6] } : null; }
function initials(n) { const parts = String(n || '?').replace(/[^A-Za-zÀ-ÿ' -]/g, '').split(/\s+/).filter(Boolean); return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase(); }
function shortP(n) { const parts = String(n).split(' '); return parts.length > 1 ? parts[0][0] + '. ' + parts.slice(1).join(' ') : n; }
function head(pid, px, cls) {
  const pl = playerInfo(pid), pos = headPos[pid], team = pl ? pl.t : null, col = TC[team] || '#6b7d90';
  const el = h('span', { class: 'hs' + (cls ? ' ' + cls : ''), style: { width: px + 'px', height: px + 'px', '--tc': col }, 'aria-hidden': 'true' });
  if (pos && HEADS) {
    const [t, i] = pos, c = HEADS.cols, rows = Math.ceil(HEADS.teams[t].length / c);
    el.style.backgroundImage = `url("${HEAD_BASE}p/${t}.webp")`;
    el.style.backgroundSize = `${c * px}px ${rows * px}px`;
    el.style.backgroundPosition = `-${(i % c) * px}px -${Math.floor(i / c) * px}px`;
  } else { el.classList.add('init'); el.style.fontSize = Math.round(px * 0.36) + 'px'; el.textContent = initials(pl ? pl.n : '?'); }
  return el;
}
function ageOf(bd) { if (!bd) return null; const b = new Date(bd + 'T12:00:00'), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a; }
const POSN = { C: 'Center', L: 'Left wing', R: 'Right wing', D: 'Defense', G: 'Goalie' };

// model state built from the feed
function PP() {
  if (!D || !S.feed || !S.feed.players) return null;
  if (D.pp) return D.pp;
  const games = {}; for (const g of D.gamesArr) games[g.id] = { d: g.date, a: g.away, h: g.home };
  const data = BLP.fromFeed(S.feed, games);
  const M = BLP.build(data, S.pparams);
  // per team: game ids played, newest first (for "who dressed last game")
  const teamGames = {};
  for (const x of data.logs) { const a = teamGames[x.t] = teamGames[x.t] || {}; (a[x.g] = a[x.g] || { d: x.d, ids: new Set() }).ids.add(x.pid); }
  D.pp = { data, M, teamGames, cache: {} };
  return D.pp;
}
function dressed(team, beforeDate) { // skaters likely in tonight's lineup: dressed last game, or in 2 of the last 3
  const pp = PP(); const tg = pp.teamGames[team] || {};
  const games = Object.values(tg).filter(g => g.d < beforeDate).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 3);
  const cnt = {}; games.forEach((g, i) => g.ids.forEach(id => { cnt[id] = (cnt[id] || 0) + (i === 0 ? 2 : 1); }));
  return Object.keys(cnt).filter(id => cnt[id] >= 2 && (!playerInfo(id) || playerInfo(id).act !== 0 || true)).filter(id => { const pi = playerInfo(id); return pi && pi.act === 1 && pi.t === team; });
}
const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
function starterFor(g, side) {
  const team = g[side], pp = PP(), b = brief(g.id), want = b && b.goalies && b.goalies[side];
  const goalies = Object.values(pp.M.goalies).filter(x => x.team === team && playerInfo(x.pid) && playerInfo(x.pid).act === 1);
  if (want && want.name) {
    const w = norm(want.name), last = w.split(' ').pop();
    const hit = goalies.find(x => norm(playerInfo(x.pid).n) === w) || goalies.find(x => norm(playerInfo(x.pid).n).split(' ').pop() === last);
    if (hit) return { pid: hit.pid, status: want.status || 'Projected', adj: want.adj || 0 };
  }
  // fall back to the goalie with the most starts in the team's last 5 games
  const recent = pp.data.glogs.filter(x => x.t === team && x.st && x.d < g.date).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 5);
  const cnt = {}; recent.forEach(x => cnt[x.pid] = (cnt[x.pid] || 0) + 1);
  const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || (goalies.sort((a, b) => b.starts - a.starts)[0] || {}).pid;
  return best ? { pid: best, status: 'Likely', adj: 0 } : null;
}
function teamEnv(g, team) { // expected goals this game / vs an average opponent at a neutral rink
  const { pred, rt } = predFor(g); const home = g.home === team; const lam = home ? pred.lh : pred.la;
  const reg = 1 - 0.27 / (2 * rt.mu); const base = rt.mu * rt.R[team].att * reg;
  return base > 0 ? lam / base : 1;
}
function bookLine(gid, pid, mkt) {
  const my = S.myLines[gid + ':' + pid + ':' + mkt]; if (my) return { line: my[0], over: my[1], under: my[2], book: 'My book', mine: true };
  const p = S.feed.props && S.feed.props.games && S.feed.props.games[gid] && S.feed.props.games[gid][pid] && S.feed.props.games[gid][pid][mkt];
  return p ? { line: p[0], over: p[1], under: p[2], book: p[3] || 'Book' } : null;
}
function propEval(pmf, line, bk) { // probabilities, fair prices and (with a book line) EV for over and under
  const L = bk && bk.line != null ? bk.line : line;
  const ou = BLP.overUnder(pmf, L), dn = 1 - ou.push || 1;
  const pO = ou.over / dn, pU = ou.under / dn;
  const out = { line: L, pO, pU, fairO: BL.probToAm(pO), fairU: BL.probToAm(pU), book: bk || null };
  if (bk) {
    const w = S.pparams.propWeight;
    let fO = null, fU = null;
    if (bk.over != null && bk.under != null) { const nv = BL.noVig(bk.over, bk.under); if (nv) { fO = nv.a; fU = nv.b; } }
    else if (bk.over != null) fO = BL.amToProb(bk.over) / 1.1; // one-sided market (anytime goal): assume a ~10% margin
    if (bk.over != null) { const p = fO != null ? w * pO + (1 - w) * fO : pO; out.bO = p; out.evO = BL.ev(p, bk.over); out.kO = BL.kellyStake(p, bk.over, S.params); out.mO = fO; }
    if (bk.under != null) { const p = fU != null ? w * pU + (1 - w) * fU : pU; out.bU = p; out.evU = BL.ev(p, bk.under); out.kU = BL.kellyStake(p, bk.under, S.params); out.mU = fU; }
  }
  return out;
}
// every projected player for one game
function gameProps(g) {
  const pp = PP(); if (!pp) return null;
  const key = g.id + JSON.stringify(ctxFor(g)) + JSON.stringify(S.pparams) + Object.keys(S.myLines).length;
  if (pp.cache[key]) return pp.cache[key];
  const rows = [];
  for (const side of ['away', 'home']) {
    const team = g[side], opp = side === 'home' ? g.away : g.home, home = side === 'home';
    const env = teamEnv(g, team);
    for (const pid of dressed(team, g.date)) {
      const pr = BLP.project(pp.M, pid, { opp, home, env }); if (!pr) continue;
      const s = pp.M.skaters[pid];
      const pmf = { SOG: BLP.pmfFor(pp.M, pr, 'SOG'), PTS: BLP.pmfFor(pp.M, pr, 'PTS'), G: BLP.pmfFor(pp.M, pr, 'G'), A: BLP.pmfFor(pp.M, pr, 'A') };
      const mk = {};
      for (const m of ['SOG', 'PTS', 'G', 'A']) { const L = m === 'SOG' ? Math.max(1.5, BLP.mainLine(pmf.SOG)) : 0.5; mk[m] = propEval(pmf[m], L, bookLine(g.id, pid, m)); }
      rows.push({ pid, team, opp, side, g, pr, s, pmf, mk, mean: { SOG: pr.sog, PTS: pr.pts, G: pr.g, A: pr.a } });
    }
    const st = starterFor(g, side);
    if (st) {
      const pg = BLP.projectGoalie(pp.M, st.pid, { opp, home });
      if (pg) { const L = BLP.mainLine(pg.pmf); rows.push({ pid: st.pid, team, opp, side, g, goalie: true, status: st.status, pr: pg, s: pp.M.goalies[st.pid], pmf: { SV: pg.pmf }, mk: { SV: propEval(pg.pmf, L, bookLine(g.id, st.pid, 'SV')) }, mean: { SV: pg.saves } }); }
    }
  }
  return pp.cache[key] = rows;
}
function bestEdge(r, m) { const e = r.mk[m]; if (!e || !e.book) return null; const c = []; if (e.evO != null) c.push({ side: 'over', ev: e.evO }); if (e.evU != null) c.push({ side: 'under', ev: e.evU }); return c.sort((a, b) => b.ev - a.ev)[0] || null; }
function propLabel(pid, m, side, line) { const pl = playerInfo(pid); const nm = pl ? shortP(pl.n) : pid; if (m === 'G') return nm + ' anytime goal'; return nm + ' ' + (side === 'under' ? 'u' : 'o') + line + ' ' + PM[m].short; }
function last10(pid, m, goalie) {
  const pp = PP(); const arr = goalie ? pp.M.goalies[pid] && pp.M.goalies[pid].recent : pp.M.skaters[pid] && pp.M.skaters[pid].recent; if (!arr) return [];
  return arr.slice().reverse().map(x => ({ d: x.d, o: x.o, h: x.h, v: m === 'SOG' ? x.S : m === 'PTS' ? x.G + x.A : m === 'G' ? x.G : m === 'A' ? x.A : x.sv, st: x.st }));
}
function sparkBars(vals, line, w, hgt) { // tiny last-10 bars, over the line in green
  const max = Math.max(line + 1, ...vals.map(v => v.v), 1), bw = w / Math.max(10, vals.length);
  const svg = s('svg', { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, class: 'spark', 'aria-hidden': 'true' });
  vals.forEach((x, i) => { const bh = Math.max(1.5, x.v / max * (hgt - 2)); svg.append(s('rect', { x: i * bw + 1, y: hgt - bh, width: Math.max(1, bw - 2), height: bh, rx: 1.5, fill: x.v > line ? 'var(--good)' : 'var(--ink-3)', opacity: x.v > line ? 1 : 0.45 })); });
  const ly = hgt - (line / max) * (hgt - 2); svg.append(s('line', { x1: 0, x2: w, y1: ly, y2: ly, stroke: 'var(--ink)', 'stroke-width': 1, 'stroke-dasharray': '2 2', opacity: 0.6 }));
  return svg;
}

// ---------- Props tab ----------
function viewProps() {
  const pp = PP();
  if (!pp) return h('div', { class: 'view' }, h('div', { class: 'panel empty' }, h('strong', null, 'Player data is loading'), 'Props appear once the player feed arrives.'), footer());
  const { list, today } = slateDates();
  if (!S.slate || !list.includes(S.slate)) S.slate = list.find(d => d >= today) || list[list.length - 1];
  const date = S.slate, games = D.gamesArr.filter(g => g.date === date && !g.final);
  const m = S.propMkt;
  let rows = games.flatMap(g => (gameProps(g) || []).filter(r => (m === 'SV') === !!r.goalie));
  const allForDay = rows;
  if (S.propGame !== 'All') rows = rows.filter(r => String(r.g.id) === String(S.propGame));
  const q = norm(S.propQ); if (q) rows = rows.filter(r => norm((playerInfo(r.pid) || {}).n).includes(q) || norm(teamName(r.team)).includes(q) || r.team.toLowerCase() === q);
  const withLines = allForDay.filter(r => r.mk[m] && r.mk[m].book).length;
  const byProj = m === 'SOG' || m === 'SV'; // personal lines differ, so rank shots and saves by projection
  const strength = r => byProj ? r.mean[m] : r.mk[m].pO;
  const sorters = {
    edge: (a, b) => ((bestEdge(b, m) || { ev: -9 }).ev - (bestEdge(a, m) || { ev: -9 }).ev) || (strength(b) - strength(a)),
    proj: (a, b) => (b.mean[m] - a.mean[m]),
    prob: (a, b) => (b.mk[m].pO - a.mk[m].pO),
    name: (a, b) => (playerInfo(a.pid).n.split(' ').pop()).localeCompare(playerInfo(b.pid).n.split(' ').pop())
  };
  rows.sort(sorters[S.propSort] || sorters.edge);

  // spotlight: the model's three strongest calls for this market
  const spot = allForDay.slice().sort((a, b) => strength(b) - strength(a)).slice(0, 3);
  const spotCard = r => { const e = r.mk[m], pl = playerInfo(r.pid);
    return h('button', { class: 'panel spot', onclick: () => openPlayer(r.pid, r.g.id) },
      head(r.pid, 64, 'ring'),
      h('div', { class: 'spot-b' }, h('div', { class: 'eyebrow' }, r.team + ' vs ' + r.opp), h('div', { class: 'spot-n' }, pl.n),
        h('div', { class: 'spot-v' }, byProj ? [h('span', { class: 'big' }, r.mean[m].toFixed(1)), h('span', { class: 'small muted' }, ' ' + PM[m].short + ' projected · ' + pct(e.pO, 0) + ' over ' + e.line)] : [h('span', { class: 'big' }, pct(e.pO, 0)), h('span', { class: 'small muted' }, m === 'G' ? ' to score' : ' over ' + e.line + ' ' + PM[m].short)]),
        h('div', { class: 'small mono muted' }, 'fair ' + BL.fmtAm(e.fairO) + (e.book ? ' · ' + e.book.book + ' ' + BL.fmtAm(e.book.over) : ''))));
  };

  const ctrl = h('div', { class: 'prop-ctrl' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Market' }, Object.entries(PM).map(([k, v]) => h('button', { 'aria-pressed': String(m === k), onclick: () => { S.propMkt = k; lsSet('bl.propmkt', k); if (S.propSort === 'name') S.propSort = 'edge'; render(); } }, v.name))),
    h('select', { id: 'prop-game', 'aria-label': 'Game', onchange: e => { S.propGame = e.target.value; render(); } }, h('option', { value: 'All' }, 'All games'), games.map(g => h('option', { value: g.id, selected: String(S.propGame) === String(g.id) }, g.away + ' @ ' + g.home + ' · ' + fmtTime(g.start)))),
    h('input', { id: 'prop-q', type: 'search', placeholder: 'Find a player or team', value: S.propQ, 'aria-label': 'Search players', oninput: e => { S.propQ = e.target.value; clearTimeout(window.__pq); window.__pq = setTimeout(() => { render(); const el = document.getElementById('prop-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); } }),
    h('select', { id: 'prop-sort', 'aria-label': 'Sort', onchange: e => { S.propSort = e.target.value; render(); } }, [['edge', withLines ? 'Best value first' : 'Strongest first'], ['prob', 'Most likely over'], ['proj', 'Highest projection'], ['name', 'Name']].map(([v, t]) => h('option', { value: v, selected: S.propSort === v }, t))));

  const list_ = rows.length ? h('div', { class: 'plist', role: 'list' }, rows.slice(0, 160).map(r => propRow(r, m))) : h('div', { class: 'panel empty' }, h('strong', null, games.length ? 'No players match' : 'No games left on this date'), games.length ? 'Clear the search or pick another game.' : 'Pick another date above.');
  const linesNote = withLines ? withLines + ' players have a book line for ' + PM[m].name.toLowerCase() + '. Edges use the best line we have.' : 'No book lines are loaded for ' + PM[m].name.toLowerCase() + ' yet. Projections and fair prices are below; open a player and type in your book\'s line to price it.';
  return h('div', { class: 'view' },
    h('div', { class: 'slate-bar' }, h('div', null, h('div', { class: 'eyebrow' }, 'Player props · ' + fmtDay(date, true)), h('h1', { class: 'h-display', style: { fontSize: 'clamp(28px,4vw,40px)' } }, games.length + (games.length === 1 ? ' game' : ' games') + ', ' + allForDay.length + (m === 'SV' ? ' goalies' : ' players'))),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Choose a date' }, list.filter(d => d >= today).map(d => h('button', { class: 'chip', 'aria-pressed': String(d === date), onclick: () => { S.slate = d; S.propGame = 'All'; render(); } }, d === today ? 'Today' : fmtDay(d))))),
    spot.length ? h('div', { class: 'spots' }, spot.map(spotCard)) : null,
    h('section', { class: 'panel' },
      h('div', { class: 'panel-h' }, h('div', null, h('h2', null, PM[m].name), h('div', { class: 'small muted' }, linesNote))),
      h('div', { class: 'panel-b', style: { display: 'grid', gap: '12px' } }, ctrl,
        h('div', { class: 'plist-h', 'aria-hidden': 'true' }, h('span', null, 'Player'), h('span', null, 'Projection'), h('span', null, 'Model'), h('span', null, 'Book'), h('span', null, 'Last 10')),
        list_)),
    footer());
}
function propRow(r, m) {
  const pl = playerInfo(r.pid), e = r.mk[m], best = bestEdge(r, m), L = e.line;
  const l10 = last10(r.pid, m, r.goalie), hits = l10.filter(x => x.v > L).length;
  const projTxt = m === 'G' ? pct(e.pO, 0) + ' to score' : (r.mean[m]).toFixed(m === 'SV' ? 1 : 2) + ' ' + PM[m].short;
  const bookCell = e.book ? h('div', { class: 'pr-book' },
      h('div', { class: 'small' }, (m === 'G' ? 'Yes ' : 'o' + e.line + ' ') + BL.fmtAm(e.book.over) + (e.book.under != null ? ' / u ' + BL.fmtAm(e.book.under) : '')),
      best ? h('span', { class: 'pill ' + (best.ev >= S.params.minEdge ? 'good' : best.ev >= 0 ? 'neutral' : 'bad') }, (best.side === 'under' ? 'Under ' : m === 'G' ? 'Yes ' : 'Over ') + sgnPct(best.ev)) : null,
      h('div', { class: 'small muted' }, e.book.book))
    : h('div', { class: 'pr-book muted small' }, 'No line yet');
  return h('div', { class: 'prow', role: 'listitem', tabindex: '0', onclick: () => openPlayer(r.pid, r.g.id), onkeydown: ev => { if (ev.key === 'Enter') openPlayer(r.pid, r.g.id); } },
    h('div', { class: 'pr-who' }, head(r.pid, 44, 'ring'), h('div', { style: { minWidth: 0 } }, h('div', { class: 'pr-n' }, pl.n), h('div', { class: 'small muted pr-meta' }, badge(r.team), ' ' + (r.side === 'home' ? 'vs ' : '@ ') + r.opp + ' · ' + (r.goalie ? 'G · ' + r.status : (pl.p || '') + ' · ' + r.pr.toi.toFixed(1) + ' min')))),
    h('div', { class: 'pr-proj' }, h('div', { class: 'big' }, projTxt), h('div', { class: 'small muted' }, m === 'G' ? 'fair ' + BL.fmtAm(e.fairO) : 'line ' + L + (e.book ? '' : ' (model)'))),
    h('div', { class: 'pr-model' }, h('div', null, h('strong', null, pct(e.pO, 0)), h('span', { class: 'small muted' }, m === 'G' ? ' yes' : ' over')), h('div', { class: 'small mono muted' }, 'fair ' + BL.fmtAm(e.fairO) + (m === 'G' ? '' : ' / ' + BL.fmtAm(e.fairU)))),
    bookCell,
    h('div', { class: 'pr-l10' }, sparkBars(l10, L, 84, 26), h('div', { class: 'small muted' }, l10.length ? hits + '/' + l10.length + (m === 'G' ? ' scored' : ' over') : 'no games')));
}

// ---------- player drawer ----------
function openPlayer(pid, gid) { S.openPlayer = { pid: String(pid), gid: gid ? String(gid) : null, mkt: null }; renderPlayerDrawer(); }
function closePlayer() { S.openPlayer = null; renderPlayerDrawer(); }
function nextGameFor(team) { return D.gamesArr.find(g => !g.final && (g.away === team || g.home === team)); }
function renderPlayerDrawer() {
  const host = $('#pdrawer-host');
  if (!S.openPlayer || !PP()) { host.replaceChildren(); if (!S.open) document.body.style.overflow = ''; return; }
  const scroll = host.querySelector('.drawer') ? host.querySelector('.drawer').scrollTop : 0;
  const { pid } = S.openPlayer, pl = playerInfo(pid); if (!pl) { host.replaceChildren(); return; }
  const g = (S.openPlayer.gid && D.allGames[S.openPlayer.gid]) || nextGameFor(pl.t);
  const pp = PP(), goalie = pl.p === 'G';
  const row = g && !g.final ? (gameProps(g) || []).find(r => r.pid === pid) : null;
  const sk = goalie ? pp.M.goalies[pid] : pp.M.skaters[pid];
  const age = ageOf(pl.bd);
  const markets = goalie ? ['SV'] : ['SOG', 'PTS', 'G', 'A'];
  const curM = S.openPlayer.mkt && markets.includes(S.openPlayer.mkt) ? S.openPlayer.mkt : markets[0];

  const heroStats = goalie
    ? [['Saves', row ? row.mean.SV.toFixed(1) : '—'], ['Shots against', row ? row.pr.sa.toFixed(1) : '—'], ['Save %', sk ? (sk.sv).toFixed(3).replace(/^0/, '') : '—'], ['Status', row ? row.status : '—']]
    : [['Shots', row ? row.mean.SOG.toFixed(2) : '—'], ['Point', row ? pct(row.mk.PTS.pO, 0) : '—'], ['Goal', row ? pct(row.mk.G.pO, 0) : '—'], ['Ice time', row ? row.pr.toi.toFixed(1) + 'm' : '—']];
  const hero = h('section', { class: 'panel phero', style: { '--tc': TC[pl.t] || '#6b7d90' } },
    head(pid, 104, 'ring big'),
    h('div', { class: 'phero-b' },
      h('div', { class: 'eyebrow' }, [POSN[pl.p] || pl.p, pl.no ? '#' + pl.no : null, age ? age + ' yrs' : null, pl.sh ? (goalie ? 'catches ' : 'shoots ') + pl.sh : null].filter(Boolean).join(' · ')),
      h('h2', { class: 'h-display phero-n' }, pl.n),
      h('div', { class: 'small muted', style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, badge(pl.t), teamName(pl.t), g ? ' · ' + (g.home === pl.t ? 'vs ' + g.away : '@ ' + g.home) + ' · ' + fmtDay(g.date) + (g.start ? ' ' + fmtTime(g.start) : '') : ''),
      h('div', { class: 'phero-k' }, heroStats.map(([k, v]) => h('div', null, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k))))));

  // lines table for the current game
  let lines = null;
  if (row) {
    const lineSet = curM === 'SV' ? (() => { const L = row.mk.SV.line; return [L - 2, L - 1, L, L + 1, L + 2]; })() : curM === 'SOG' ? [1.5, 2.5, 3.5, 4.5] : curM === 'PTS' ? [0.5, 1.5, 2.5] : curM === 'A' ? [0.5, 1.5] : [0.5];
    const bk = bookLine(g.id, pid, curM);
    if (bk && !lineSet.includes(bk.line)) lineSet.push(bk.line);
    lineSet.sort((a, b) => a - b);
    lines = h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Line'), h('th', { class: 'r' }, curM === 'G' ? 'Scores' : 'Over'), h('th', { class: 'r' }, 'Fair'), curM === 'G' ? null : h('th', { class: 'r' }, 'Under'), curM === 'G' ? null : h('th', { class: 'r' }, 'Fair'), h('th', { class: 'r' }, 'Book'), h('th', { class: 'r' }, 'EV'), h('th', null, ''))),
      h('tbody', null, lineSet.map(L => { const e = propEval(row.pmf[curM], L, bk && bk.line === L ? bk : null); const best = e.book ? (e.evU != null && e.evU > (e.evO ?? -9) ? { side: 'under', ev: e.evU, k: e.kU, price: e.book.under, p: e.bU } : { side: 'over', ev: e.evO, k: e.kO, price: e.book.over, p: e.bO }) : null;
        return h('tr', { class: e.book ? 'best' : '' }, h('td', { class: 'num' }, curM === 'G' ? 'Anytime' : String(L)), h('td', { class: 'r num' }, pct(e.pO, 1)), h('td', { class: 'r num' }, BL.fmtAm(e.fairO)), curM === 'G' ? null : h('td', { class: 'r num' }, pct(e.pU, 1)), curM === 'G' ? null : h('td', { class: 'r num' }, BL.fmtAm(e.fairU)),
          h('td', { class: 'r num' }, e.book ? (BL.fmtAm(e.book.over) + (e.book.under != null ? ' / ' + BL.fmtAm(e.book.under) : '')) : '—', e.book ? h('div', { class: 'small muted' }, e.book.book) : null),
          h('td', { class: 'r' }, best && best.ev != null ? h('span', { class: 'pill ' + (best.ev >= S.params.minEdge ? 'good' : best.ev >= 0 ? 'neutral' : 'bad') }, (best.side === 'under' ? 'U ' : curM === 'G' ? '' : 'O ') + sgnPct(best.ev)) : '—'),
          h('td', null, best && best.price != null ? h('button', { class: 'btn sm', onclick: () => startPropSlip(g, pid, curM, best.side, L, best.price, e.book.book, best.p, best.ev, best.k) }, 'Track') : null)); })));
  }
  // price-your-line form
  const myKey = g ? g.id + ':' + pid + ':' + curM : null, my = myKey && S.myLines[myKey];
  const priceForm = row ? h('form', { class: 'form-grid', onsubmit: ev => { ev.preventDefault(); const f = new FormData(ev.target); const L = +f.get('line'), o = f.get('over') === '' ? null : +f.get('over'), u = f.get('under') === '' ? null : +f.get('under');
      if (!(L >= 0) || (o == null && u == null)) { delete S.myLines[myKey]; } else { if ((o != null && Math.abs(o) < 100) || (u != null && Math.abs(u) < 100)) { toast('Enter American odds like -115 or +130'); return; } S.myLines[myKey] = [L, o, u]; }
      lsSet('bl.mylines.v1', S.myLines); D.pp.cache = {}; renderPlayerDrawer(); render(); toast(S.myLines[myKey] ? 'Priced with your line' : 'Cleared your line'); } },
    h('div', { class: 'field' }, h('label', { for: 'pl-line' }, curM === 'G' ? 'Line' : 'Line'), h('input', { id: 'pl-line', name: 'line', inputmode: 'decimal', value: my ? my[0] : (curM === 'G' ? 0.5 : row.mk[curM].line), readonly: curM === 'G' })),
    h('div', { class: 'field' }, h('label', { for: 'pl-over' }, curM === 'G' ? 'Yes price' : 'Over price'), h('input', { id: 'pl-over', name: 'over', inputmode: 'numeric', placeholder: '-115', value: my && my[1] != null ? my[1] : '' })),
    curM === 'G' ? null : h('div', { class: 'field' }, h('label', { for: 'pl-under' }, 'Under price'), h('input', { id: 'pl-under', name: 'under', inputmode: 'numeric', placeholder: '-105', value: my && my[2] != null ? my[2] : '' })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Price it')) : null;

  // game log
  const logRows = goalie ? (sk ? sk.recent : []) : (sk ? sk.recent : []);
  const logT = h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Opp'), ...(goalie ? ['Shots', 'Saves', 'Sv%', 'Start'].map(x => h('th', { class: 'r' }, x)) : ['G', 'A', 'P', 'SOG', 'TOI'].map(x => h('th', { class: 'r' }, x))))),
    h('tbody', null, logRows.length ? logRows.map(x => h('tr', null, h('td', { class: 'num' }, fmtDay(x.d)), h('td', null, (x.h ? 'vs ' : '@ ') + x.o),
      ...(goalie ? [x.sa, x.sv, x.sa ? (x.sv / x.sa).toFixed(3).replace(/^0/, '') : '—', x.st ? 'Yes' : '—'] : [x.G, x.A, x.G + x.A, x.S, x.toi.toFixed(1)]).map(v => h('td', { class: 'r num' }, String(v))))) : h('tr', null, h('td', { colspan: 7, class: 'muted' }, 'No games this season yet.'))));
  const season = sk && sk.season, L = pp.data[goalie ? 'lastG' : 'last'][pid];
  const seasonT = goalie
    ? h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, ''), ...['GP', 'GS', 'Shots', 'Saves', 'Sv%'].map(x => h('th', { class: 'r' }, x)))),
        h('tbody', null, h('tr', null, h('td', null, 'This season'), ...[season ? season.gp : 0, season ? season.gs : 0, season ? season.sa : 0, season ? season.sv : 0, season && season.sa ? (season.sv / season.sa).toFixed(3).replace(/^0/, '') : '—'].map(v => h('td', { class: 'r num' }, String(v)))),
          L ? h('tr', null, h('td', null, 'Last season'), ...[L[0], L[1], L[2], L[3], L[2] ? (L[3] / L[2]).toFixed(3).replace(/^0/, '') : '—'].map(v => h('td', { class: 'r num' }, String(v)))) : null))
    : h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, ''), ...['GP', 'G', 'A', 'P', 'SOG', 'SOG/G', 'TOI'].map(x => h('th', { class: 'r' }, x)))),
        h('tbody', null, h('tr', null, h('td', null, 'This season'), ...(season ? [season.gp, season.G, season.A, season.G + season.A, season.S, season.gp ? (season.S / season.gp).toFixed(2) : '—', season.toi ? season.toi.toFixed(1) : '—'] : [0, 0, 0, 0, 0, '—', '—']).map(v => h('td', { class: 'r num' }, String(v)))),
          L ? h('tr', null, h('td', null, 'Last season'), ...[L[0], L[1], L[2], L[1] + L[2], L[3], L[0] ? (L[3] / L[0]).toFixed(2) : '—', L[0] ? (L[4] / L[0]).toFixed(1) : '—'].map(v => h('td', { class: 'r num' }, String(v)))) : null));
  const how = row ? (goalie
    ? `Expected shots against ${row.pr.sa.toFixed(1)}: ${teamName(row.opp)} take ${pp.M.team[row.opp] ? (pp.M.team[row.opp].off * 100).toFixed(0) : 100}% of the league's average shots and ${teamName(row.team)} allow ${pp.M.team[row.team] ? (pp.M.team[row.team].def * 100).toFixed(0) : 100}%. Save rate ${row.pr.sv.toFixed(3)} blends this season, last season and the league average. A ${Math.round(S.pparams.pullRate * 100)}% chance of being pulled early is built in.`
    : `${row.pr.toi.toFixed(1)} minutes expected. Shot rate ${sk.rS.toFixed(1)} per 60 (this season ${sk.season.toi ? (sk.season.S / (sk.season.toi * sk.season.gp) * 60).toFixed(1) : '—'}, blended with last season). ${teamName(row.opp)} allow ${(row.pr.oppDef * 100).toFixed(0)}% of the league's average shots. ${teamName(row.team)} are expected to score ${(row.pr.env * 100).toFixed(0)}% of their usual goals tonight, which scales his goal and assist chances. Shooting ${(sk.sh * 100).toFixed(1)}% after regression.`) : null;

  const aiKey = 'p' + pid + (g ? g.id : '');
  const aiOut = h('div', { class: 'ai-out' }, ...(S.ai[aiKey] ? renderMd(S.ai[aiKey]) : [h('p', { class: 'muted' }, 'Get a written read on this player\'s props from Claude.')]));
  const aiBtn = h('button', { class: 'btn primary', onclick: () => askClaude(aiKey, playerPrompt(pid, g), aiOut, [aiBtn]) }, 'Analyze his props');
  const drawer = h('div', { class: 'drawer pdrawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': pl.n },
    h('div', { class: 'drawer-h' }, head(pid, 30, 'ring'), h('strong', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, pl.n), h('button', { class: 'btn', onclick: closePlayer, 'aria-label': 'Close player' }, S.open ? 'Back to game' : 'Close')),
    h('div', { class: 'drawer-b' },
      hero,
      S.slip && S.slip.prop && S.slip.pid === pid ? slipPanel() : null,
      row ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Lines'), h('div', { class: 'seg' }, markets.map(k => h('button', { 'aria-pressed': String(curM === k), onclick: () => { S.openPlayer.mkt = k; renderPlayerDrawer(); } }, PM[k].name)))),
        h('div', { class: 'panel-b', style: { display: 'grid', gap: '12px' } }, h('div', { class: 'tbl-wrap' }, lines), h('div', { class: 'eyebrow' }, 'Your book\'s line'), priceForm)) : h('div', { class: 'note' }, g ? 'This game is final. Open an upcoming game to price his props.' : 'No upcoming game loaded for ' + teamName(pl.t) + '.'),
      row ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Analyst')), h('div', { class: 'panel-b ai' }, h('div', { class: 'brief-actions' }, aiBtn), aiOut)) : null,
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, goalie ? 'Saves by game' : PM[curM === 'SV' ? 'SOG' : curM].name + ' by game'), row ? h('span', { class: 'small muted' }, 'Line ' + row.mk[curM].line) : null),
        h('div', { class: 'panel-b' }, chartPlayerLog(last10(pid, curM, goalie), row ? row.mk[curM].line : null, goalie ? 'saves' : PM[curM].short))),
      h('div', { class: 'grid2' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Season')), h('div', { class: 'panel-b tbl-wrap' }, seasonT)),
        h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'How it\'s projected')), h('div', { class: 'panel-b prose small' }, h('p', null, how || 'No projection for this game.')))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Game log'), h('span', { class: 'small muted' }, 'Last 10')), h('div', { class: 'panel-b tbl-wrap' }, logT)),
      footer()));
  host.replaceChildren(h('div', { class: 'scrim', style: { zIndex: 42 }, onclick: closePlayer }), drawer);
  document.body.style.overflow = 'hidden';
  drawer.scrollTop = scroll;
}
function chartPlayerLog(vals, line, unit) {
  const wrap = h('div', { class: 'chart' });
  if (!vals.length) { wrap.append(h('p', { class: 'muted' }, 'No games yet.')); return wrap; }
  const W = 600, H = 170, pl = 26, pb = 22, pt = 10, n = vals.length, bw = (W - pl) / Math.max(n, 5);
  const max = Math.max(1, line != null ? line + 1 : 1, ...vals.map(v => v.v)), Y = v => pt + (H - pt - pb) * (1 - v / max);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': unit + ' by game' });
  const step = max > 20 ? 10 : max > 8 ? 2 : 1;
  for (let v = 0; v <= max; v += step) svg.append(s('line', { class: 'gridl', x1: pl, x2: W, y1: Y(v), y2: Y(v) }), s('text', { x: pl - 6, y: Y(v) + 3, 'text-anchor': 'end' }, v));
  vals.forEach((x, i) => { const over = line != null && x.v > line, xx = pl + i * bw + bw * 0.18, w = bw * 0.64, y0 = Y(x.v);
    svg.append(s('path', { d: `M${xx},${H - pb} V${Math.min(H - pb - 1, y0 + 4)} q0,-4 4,-4 H${xx + w - 4} q4,0 4,4 V${H - pb} Z`, fill: over ? 'var(--good)' : 'var(--away)', opacity: x.v === 0 ? 0.25 : 1 }));
    svg.append(s('text', { x: xx + w / 2, y: H - 8, 'text-anchor': 'middle' }, (x.h ? '' : '@') + x.o));
    svg.append(s('rect', { x: pl + i * bw, y: pt, width: bw, height: H - pt - pb, fill: 'transparent', onmousemove: () => showTip(wrap, (xx + w / 2) / W * wrap.clientWidth, y0 / H * wrap.clientHeight, [fmtDay(x.d) + ' ' + (x.h ? 'vs ' : '@ ') + x.o + ' ', h('b', null, x.v + ' ' + unit)]), onmouseleave: () => hideTip(wrap) })); });
  if (line != null) { const ly = Y(line); svg.append(s('line', { x1: pl, x2: W, y1: ly, y2: ly, stroke: 'var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }), s('text', { x: W - 4, y: ly - 4, 'text-anchor': 'end', style: 'fill:var(--ink)' }, 'line ' + line)); }
  wrap.append(svg, h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: 'var(--good)' } }), 'Over the line'), h('span', null, h('i', { style: { background: 'var(--away)' } }), 'At or under')));
  return wrap;
}
function playerPrompt(pid, g) {
  const pl = playerInfo(pid), row = g ? (gameProps(g) || []).find(r => r.pid === pid) : null, pp = PP(), goalie = pl.p === 'G';
  const sk = goalie ? pp.M.goalies[pid] : pp.M.skaters[pid];
  const mk = row ? Object.entries(row.mk).map(([k, e]) => `${PM[k].name} line ${e.line}: model over ${pct(e.pO)} (fair ${BL.fmtAm(e.fairO)})${e.book ? `, ${e.book.book} ${BL.fmtAm(e.book.over)}/${BL.fmtAm(e.book.under)}, EV over ${sgnPct(e.evO)} under ${sgnPct(e.evU)}` : ', no book line'}`).join('; ') : 'no projection';
  const log = sk ? sk.recent.map(x => goalie ? `${x.d} ${x.h ? 'vs' : '@'} ${x.o}: ${x.sv}/${x.sa}${x.st ? '' : ' (relief)'}` : `${x.d} ${x.h ? 'vs' : '@'} ${x.o}: ${x.G}G ${x.A}A ${x.S} SOG ${x.toi.toFixed(1)}m`).join('; ') : '';
  return 'You are a sharp, plain-spoken NHL props analyst. Use only the data below; do not invent injuries, lines or stats. Early-season samples are small.\n\nDATA\n' +
    `Player: ${pl.n} (${pl.t}, ${POSN[pl.p] || pl.p}). Game: ${g ? g.away + ' @ ' + g.home + ' ' + fmtDay(g.date, true) : 'none'}.\n` +
    (row ? (goalie ? `Projection: ${row.mean.SV.toFixed(1)} saves on ${row.pr.sa.toFixed(1)} shots, save rate ${row.pr.sv.toFixed(3)}, status ${row.status}.` : `Projection: ${row.pr.toi.toFixed(1)} min, ${row.mean.SOG.toFixed(2)} shots, ${row.mean.G.toFixed(2)} goals, ${row.mean.A.toFixed(2)} assists. Opponent shot factor ${row.pr.oppDef.toFixed(2)}, team scoring factor ${row.pr.env.toFixed(2)}.`) + '\n' : '') +
    `Markets: ${mk}.\nLast 10: ${log}.\n\nWrite under 170 words: "### The read" (2 sentences), "### Best angle" (the one prop you would play or "pass", with the reason), "### Risks" (2 bullets). Be honest when the edge is thin.`;
}

// ---------- props inside the game drawer ----------
function propsGameSection(g) {
  if (!PP() || g.final) return null;
  const rows = gameProps(g) || []; if (!rows.length) return null;
  const col = side => { const sk = rows.filter(r => r.side === side && !r.goalie).sort((a, b) => b.mean.SOG - a.mean.SOG).slice(0, 6), gk = rows.find(r => r.side === side && r.goalie);
    return h('div', { class: 'pg-col' }, h('div', { class: 'eyebrow' }, teamName(g[side])),
      sk.map(r => h('button', { class: 'pg-row', onclick: () => openPlayer(r.pid, g.id) }, head(r.pid, 34, 'ring'), h('span', { class: 'pg-n' }, shortP(playerInfo(r.pid).n)),
        h('span', { class: 'pg-s mono' }, r.mean.SOG.toFixed(1), h('small', null, ' SOG')), h('span', { class: 'pg-s mono' }, pct(r.mk.PTS.pO, 0), h('small', null, ' pt')), h('span', { class: 'pg-s mono' }, pct(r.mk.G.pO, 0), h('small', null, ' G')))),
      gk ? h('button', { class: 'pg-row goalie', onclick: () => openPlayer(gk.pid, g.id) }, head(gk.pid, 34, 'ring'), h('span', { class: 'pg-n' }, shortP(playerInfo(gk.pid).n), h('small', { class: 'muted' }, ' ' + gk.status)), h('span', { class: 'pg-s mono', style: { gridColumn: 'span 3' } }, gk.mean.SV.toFixed(1), h('small', null, ' saves · line ' + gk.mk.SV.line + ' · over ' + pct(gk.mk.SV.pO, 0)))) : null); };
  return h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Player props'), h('button', { class: 'btn sm', onclick: () => { S.tab = 'props'; S.slate = g.date; S.propGame = String(g.id); closeGame(); render(); window.scrollTo(0, 0); } }, 'All props for this game')),
    h('div', { class: 'panel-b grid2' }, col('away'), col('home')));
}

// ---------- prop bets ----------
function startPropSlip(g, pid, m, side, line, price, book, p, ev, k) {
  const bank = S.ledger.bankroll || 0;
  S.slip = { prop: true, pid, gameId: g.id, market: 'PROP', stat: m, side, line, price, book, p, ev, label: propLabel(pid, m, side, line), stake: Math.max(1, Math.round((k || 0) * bank) || S.ledger.unit || 10) };
  renderPlayerDrawer(); setTimeout(() => { const el = document.getElementById('slip'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
}
function gradeProp(b) {
  if (b.manual && b.status !== 'open') return b.status;
  const g = D && D.allGames[b.gameId]; if (!g || !g.final) return 'open';
  const pp = PP(); if (!pp) return 'open';
  const isG = b.stat === 'SV';
  const logs = isG ? pp.data.glogs : pp.data.logs;
  const teamHas = logs.some(x => String(x.g) === String(b.gameId)); if (!teamHas) return 'open'; // box score not in yet
  const r = logs.find(x => String(x.g) === String(b.gameId) && x.pid === String(b.pid));
  if (!r || (isG && !r.st) || (!isG && r.toi <= 0)) return 'void'; // did not play (or did not start in goal): books refund
  const v = b.stat === 'SOG' ? r.S : b.stat === 'PTS' ? r.G + r.A : b.stat === 'G' ? r.G : b.stat === 'A' ? r.A : r.sv;
  if (b.stat === 'G') return v >= 1 ? 'won' : 'lost';
  if (v === b.line) return 'push';
  return (b.side === 'over') === (v > b.line) ? 'won' : 'lost';
}

// ---------- props track record (Model tab) ----------
function propsLab() {
  const pp = PP(); if (!pp) return null;
  if (!D.propsBT) {
    const envFor = (d, t, o, home) => { const rt = D.ratingsAt(d); const p = home ? BL.predict(rt, { away: o, home: t }, S.params) : BL.predict(rt, { away: t, home: o }, S.params); if (!p) return 1; const lam = home ? p.lh : p.la; return lam / (rt.mu * rt.R[t].att * (1 - 0.27 / (2 * rt.mu))); };
    D.propsBT = BLP.backtest(pp.data, S.pparams, envFor);
  }
  const bt = D.propsBT;
  const better = (a, b) => b.ll > 0 ? 1 - a.ll / b.ll : 0;
  const defs = [
    ['propWeight', 'Props: model vs market', 0, 1, 0.05, v => Math.round(v * 100) + '% model', 'How much to trust the props model over the book\'s no-vig price when a line exists. Prop markets are softer than sides, but books still know about lineup news first.'],
    ['halfLife', 'Recent-form half-life', 3, 40, 1, v => v + ' games', 'A game this many games ago counts half as much as the latest one.'],
    ['shotPriorMin', 'Weight of last season (shots)', 0, 800, 10, v => v + ' min', 'Last season\'s shot rate counts as this many minutes of ice time. Higher trusts last season more.'],
    ['sogDisp', 'Shot spread', 3, 40, 1, v => v.toFixed(0), 'Lower numbers mean more game-to-game swing in a player\'s shots.']
  ];
  const sliders = defs.map(([k, label, min, max, step, fmt, help]) => { const id = 'pp-' + k;
    return h('div', { class: 'param' }, h('label', { for: id }, label), h('output', { id: id + '-o' }, fmt(S.pparams[k])),
      h('input', { id, type: 'range', min, max, step, value: S.pparams[k], oninput: e => { document.getElementById(id + '-o').textContent = fmt(+e.target.value); }, onchange: e => { S.pparams[k] = +e.target.value; lsSet('bl.pparams.v1', S.pparams); D.pp = null; D.propsBT = null; render(); } }), h('p', null, help)); });
  return h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'Props track record'), h('span', { class: 'small muted' }, bt.n.toLocaleString() + ' player-games, each predicted from earlier games only')),
    h('div', { class: 'panel-b', style: { display: 'grid', gap: '14px' } },
      h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(3, minmax(0,1fr))' } },
        h('div', { class: 'kpi' }, h('div', { class: 'v good' }, pct(better(bt.sog3.model, bt.sog3.base), 0)), h('div', { class: 'k' }, 'less error than season averages on 3+ shots')),
        h('div', { class: 'kpi' }, h('div', { class: 'v good' }, pct(better(bt.pts1.model, bt.pts1.base), 0)), h('div', { class: 'k' }, 'less error on 1+ point')),
        h('div', { class: 'kpi' }, h('div', { class: 'v' }, bt.sog3.model.brier.toFixed(3)), h('div', { class: 'k' }, 'Brier score, 3+ shots (lower is better)'))),
      chartCalibration(bt.rows.map(r => ({ pHome: r.pS3, homeWon: r.S >= 3 ? 1 : 0 })), 'model chance of 3+ shots'),
      h('div', { class: 'note' }, 'Error is log loss against a plain average of each player\'s season so far. The test can\'t check prices yet: closing prop lines are archived once they load, and then this shows how flagged props did against them.'),
      h('div', null, sliders),
      h('div', { class: 'prose small' }, h('p', null, 'Each skater gets an ice-time projection and per-60 rates for shots and assists, blended from this season (recent games weighted more), last season and his position\'s average. Shooting percentage is pulled hard toward average. Tonight\'s opponent scales his shots by how many they allow, and the team model\'s expected goals scales his goals and assists. Goalies get expected shots against from both teams\' shot rates and a save rate blended toward league average, with a small chance of being pulled.'))));
}

// ---------- team players (Teams tab) ----------
function teamPlayers(t) {
  const pp = PP(); if (!pp) return null;
  const rows = Object.values(pp.M.skaters).filter(s => s.team === t && playerInfo(s.pid) && playerInfo(s.pid).act === 1 && s.gp > 0).sort((a, b) => (b.season.G + b.season.A) - (a.season.G + a.season.A) || b.season.S - a.season.S);
  const gk = Object.values(pp.M.goalies).filter(g => g.team === t && g.gp > 0 && playerInfo(g.pid) && playerInfo(g.pid).act === 1).sort((a, b) => b.starts - a.starts);
  return h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' } }, 'Players'), h('div', { class: 'tbl-wrap' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, h('th', null, 'Player'), ...['GP', 'G', 'A', 'P', 'SOG/G', 'TOI'].map(x => h('th', { class: 'r' }, x)))),
    h('tbody', null, rows.slice(0, 14).map(s => h('tr', { class: 'click', onclick: () => openPlayer(s.pid) }, h('td', null, h('span', { class: 'who' }, head(s.pid, 28, 'ring'), playerInfo(s.pid).n, h('span', { class: 'muted small' }, ' ' + playerInfo(s.pid).p))),
        ...[s.season.gp, s.season.G, s.season.A, s.season.G + s.season.A, (s.season.S / s.season.gp).toFixed(2), s.season.toi.toFixed(1)].map(v => h('td', { class: 'r num' }, String(v))))),
      gk.map(g => h('tr', { class: 'click', onclick: () => openPlayer(g.pid) }, h('td', null, h('span', { class: 'who' }, head(g.pid, 28, 'ring'), playerInfo(g.pid).n, h('span', { class: 'muted small' }, ' G'))),
        h('td', { class: 'r num' }, String(g.gp)), h('td', { class: 'r num', colspan: 3 }, g.season.sv + ' saves on ' + g.season.sa), h('td', { class: 'r num' }, g.season.sa ? (g.season.sv / g.season.sa).toFixed(3).replace(/^0/, '') : '—'), h('td', { class: 'r num' }, g.starts + ' GS')))))));
}
function goalieHead(g, side) { const pp = PP(); if (!pp) return null; const st = starterFor(g, side); return st ? head(st.pid, 18, 'ring tiny') : null; }
