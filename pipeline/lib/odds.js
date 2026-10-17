'use strict';
// The Odds API (the-odds-api.com, v4) -> the dashboard's odds and props documents.
// Credits: each odds request costs (markets x regions). Game lines here use 3 markets x 1 region = 3 credits per call;
// player props use 5 markets x 1 region = 5 credits per game.

const SPORT = 'icehockey_nhl';
const GAME_MARKETS = 'h2h,spreads,totals';
const PROP_MARKETS = { player_shots_on_goal: 'SOG', player_points: 'PTS', player_goal_scorer_anytime: 'G', player_assists: 'A', player_total_saves: 'SV' };

// team nicknames are unique in the NHL, so match on the end of the name
const NICK = { 'ducks': 'ANA', 'bruins': 'BOS', 'sabres': 'BUF', 'flames': 'CGY', 'hurricanes': 'CAR', 'blackhawks': 'CHI', 'avalanche': 'COL', 'blue jackets': 'CBJ',
  'stars': 'DAL', 'red wings': 'DET', 'oilers': 'EDM', 'panthers': 'FLA', 'kings': 'LAK', 'wild': 'MIN', 'canadiens': 'MTL', 'predators': 'NSH', 'devils': 'NJD',
  'islanders': 'NYI', 'rangers': 'NYR', 'senators': 'OTT', 'flyers': 'PHI', 'penguins': 'PIT', 'sharks': 'SJS', 'kraken': 'SEA', 'blues': 'STL', 'lightning': 'TBL',
  'maple leafs': 'TOR', 'mammoth': 'UTA', 'hockey club': 'UTA', 'canucks': 'VAN', 'golden knights': 'VGK', 'capitals': 'WSH', 'jets': 'WPG' };
const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
function teamAbbrev(name) {
  const n = norm(name); let best = null;
  for (const [k, v] of Object.entries(NICK)) if ((n === k || n.endsWith(' ' + k)) && (!best || k.length > best[0].length)) best = [k, v];
  return best ? best[1] : null;
}
const dec = a => a > 0 ? 1 + a / 100 : 1 + 100 / -a;
const hold = (a, b) => 1 / dec(a) + 1 / dec(b) - 1;
const okHold = (a, b) => a != null && b != null && Math.abs(a) >= 100 && Math.abs(b) >= 100 && hold(a, b) >= -0.01 && hold(a, b) <= 0.12;

// match an API event to a scheduled game by team abbreviations and start time (within 12 hours)
function matchGame(ev, schedule) {
  const a = teamAbbrev(ev.away_team), h = teamAbbrev(ev.home_team); if (!a || !h) return null;
  const t = Date.parse(ev.commence_time);
  return schedule.find(g => g[3] === a && g[4] === h && Math.abs(Date.parse(g[2]) - t) < 12 * 3600e3) || null;
}

// /v4/sports/icehockey_nhl/odds -> {gameId: {books: {Book: {ml, pl, tot}}}}
function parseGameOdds(events, schedule) {
  const out = {}, report = [];
  for (const ev of events || []) {
    const g = matchGame(ev, schedule); if (!g) { report.push(`no scheduled game for ${ev.away_team} @ ${ev.home_team}`); continue; }
    const books = {};
    for (const bk of ev.bookmakers || []) {
      const b = {};
      for (const m of bk.markets || []) {
        const o = m.outcomes || [];
        if (m.key === 'h2h') { const aw = o.find(x => teamAbbrev(x.name) === g[3]), hm = o.find(x => teamAbbrev(x.name) === g[4]); if (aw && hm && okHold(aw.price, hm.price)) b.ml = [aw.price, hm.price]; }
        if (m.key === 'spreads') { const aw = o.find(x => teamAbbrev(x.name) === g[3]), hm = o.find(x => teamAbbrev(x.name) === g[4]); if (aw && hm && aw.point === -hm.point && Math.abs(aw.point) === 1.5 && okHold(aw.price, hm.price)) b.pl = [aw.point, aw.price, hm.point, hm.price]; }
        if (m.key === 'totals') { const ov = o.find(x => x.name === 'Over'), un = o.find(x => x.name === 'Under'); if (ov && un && ov.point === un.point && ov.point >= 4 && ov.point <= 9 && okHold(ov.price, un.price)) b.tot = [ov.point, ov.price, un.price]; }
      }
      if (Object.keys(b).length) books[bk.title || bk.key] = b;
    }
    // the -1.5 side must be the favourite: judged by the book's own moneyline, else by the other books' consensus
    const homeP = Object.values(books).filter(b => b.ml).map(b => (1 / dec(b.ml[1])) / (1 / dec(b.ml[0]) + 1 / dec(b.ml[1]))).sort((x, y) => x - y);
    const consensusHomeFav = homeP.length ? homeP[Math.floor((homeP.length - 1) / 2)] > 0.5 : null;
    for (const [title, b] of Object.entries(books)) {
      if (!b.pl) continue;
      const homeFav = b.ml ? dec(b.ml[1]) < dec(b.ml[0]) : consensusHomeFav;
      if (homeFav == null || (b.pl[2] < 0) !== homeFav) { delete b.pl; report.push(`dropped ${title} puck line for ${g[3]} @ ${g[4]}: -1.5 is not on the favourite`); }
      if (!Object.keys(b).length) delete books[title];
    }
    if (Object.keys(books).length) out[g[1]] = { books };
  }
  return { games: out, report };
}

// one event's prop markets -> {playerId: {SOG: [line, over, under, book], ...}}
// For each player and market the line most books offer is used, at the book with the best over price.
function parseEventProps(ev, game, players) {
  const team = { [game[3]]: 1, [game[4]]: 1 };
  const byName = {};
  for (const [pid, p] of Object.entries(players)) if (team[p[1]]) { const n = norm(p[0]); byName[n] = byName[n] || []; byName[n].push(pid); }
  const findPid = name => { const n = norm(name); if (byName[n] && byName[n].length === 1) return byName[n][0];
    const parts = n.split(' '), last = parts[parts.length - 1], first = parts[0][0];
    const hits = Object.entries(byName).filter(([k]) => k.split(' ').pop() === last && k[0] === first).flatMap(([, v]) => v);
    return hits.length === 1 ? hits[0] : null; };
  const offers = {}; const unmatched = new Set();
  for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
    const mk = PROP_MARKETS[m.key]; if (!mk) continue;
    const groups = {};
    for (const o of m.outcomes || []) { const key = (o.description || '') + '|' + (o.point != null ? o.point : 0.5); (groups[key] = groups[key] || {}).name = o.description; groups[key].point = o.point != null ? o.point : 0.5; groups[key][String(o.name).toLowerCase()] = o.price; }
    for (const g of Object.values(groups)) {
      const pid = findPid(g.name); if (!pid) { unmatched.add(g.name); continue; }
      const over = g.over != null ? g.over : g.yes, under = g.under != null ? g.under : (g.no != null ? g.no : null);
      if (over == null || Math.abs(over) < 100) continue;
      if (under != null && !okHold(over, under)) continue;
      ((offers[pid] = offers[pid] || {})[mk] = offers[pid][mk] || []).push({ line: g.point, over, under, book: bk.title || bk.key });
    }
  }
  const out = {};
  for (const [pid, mks] of Object.entries(offers)) for (const [mk, list] of Object.entries(mks)) {
    const cnt = {}; list.forEach(x => cnt[x.line] = (cnt[x.line] || 0) + 1);
    const line = +Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || Math.abs(a - 2.5) - Math.abs(b - 2.5))[0];
    const best = list.filter(x => x.line === line).sort((a, b) => dec(b.over) - dec(a.over))[0];
    (out[pid] = out[pid] || {})[mk] = [line, best.over, best.under, best.book];
  }
  return { props: out, unmatched: [...unmatched] };
}

// Player props are the expensive part (up to 5 credits per game). Pull them only while enough credits stay in
// reserve for game lines (about 9 a day: 3 credits x 3 runs), so a small plan never runs dry on game lines.
const PROP_COST = Object.keys(PROP_MARKETS).length;
function propsBudget(left, games, reserve) {
  const cost = games * PROP_COST;
  if (left == null || !isFinite(left)) return { ok: true, left: null, cost, reserve }; // usage unknown (offline replay)
  return { ok: left - cost >= reserve, left, cost, reserve };
}

module.exports = { SPORT, GAME_MARKETS, PROP_MARKETS, PROP_COST, teamAbbrev, matchGame, parseGameOdds, parseEventProps, propsBudget, okHold, norm };
