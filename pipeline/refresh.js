#!/usr/bin/env node
'use strict';
// Blueline Desk data pipeline. Reads the documents in data/, brings them up to date from the NHL stats API
// (and The Odds API when ODDS_API_KEY is set), and writes them back plus data/feed.json for the site.
//
//   node pipeline/refresh.js                 normal run
//   node pipeline/refresh.js --props         also pull player prop lines (5 credits per game)
//   node pipeline/refresh.js --rosters       force a roster refresh
//   node pipeline/refresh.js --replay f.json --now 2026-10-17T20:00:00Z   offline run against recorded NHL responses
const fs = require('fs');
const path = require('path');
const { makeGetter } = require('./lib/http');
const NHL = require('./lib/nhl');
const ODDS = require('./lib/odds');
const CFG = require('./config.json');

const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const DATA = path.resolve(opt('data') || path.join(__dirname, '..', 'data'));
const WEB = path.resolve(path.join(__dirname, '..', 'web'));
const NOW = opt('now') ? new Date(opt('now')) : new Date();
const PROPS = flag('props') || process.env.PROPS === 'true';
const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const dayIn = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const readJSON = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;

async function main() {
  const nhl = makeGetter({ base: 'https://api-web.nhle.com', replay: opt('replay'), record: opt('record') });
  const notes = [];
  const today = dayIn(NOW, CFG.leagueTimeZone);
  const docs = {};
  for (const f of fs.readdirSync(DATA)) if (f.endsWith('.json') && f !== 'feed.json' && !f.startsWith('_') && !['rosters.json', 'props-closing.json', 'heads-needed.json'].includes(f)) docs[f.slice(0, -5)] = readJSON(path.join(DATA, f));
  const stamp = iso(NOW);

  // ---------- results ----------
  const results = (docs.results && docs.results.games) || [];
  const have = new Set(results.map(r => r[1]));
  let d = results.length ? results[results.length - 1][0] : CFG.seasonStart; // re-read the last date for games that ended late
  const added = [];
  while (d <= today) {
    const sc = await nhl('/v1/score/' + d);
    for (const g of NHL.parseScore(sc, d)) if (g.type === 2 && NHL.FINAL.has(g.state) && !have.has(g.id)) { results.push([g.date, g.id, g.away, g.home, g.as, g.hs, g.per]); have.add(g.id); added.push(g.id); }
    d = addDays(d, 1);
  }
  results.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  docs.results = { updated: stamp, games: results };

  // ---------- standings check ----------
  const standings = NHL.parseStandings(await nhl('/v1/standings/now'));
  const mismatch = NHL.verifyStandings(standings, results);
  if (mismatch.length) notes.push('standings check: ' + mismatch.slice(0, 5).join('; '));

  // ---------- teams (32 clubs + last season's records) ----------
  if (!docs.teams || !docs.teams.last || Object.keys(docs.teams.last).length < 32) {
    const lastSt = NHL.parseStandings(await nhl('/v1/standings/' + CFG.lastSeasonEnd));
    docs.teams = { updated: stamp, teams: Object.entries(standings).map(([a, s]) => ({ a, name: s.name, conf: s.conf, div: s.div })),
      last: Object.fromEntries(Object.entries(lastSt).map(([a, s]) => [a, { gp: s.gp, w: s.w, l: s.l, otl: s.otl, pts: s.pts, gf: s.gf, ga: s.ga }])) };
  }

  // ---------- box scores -> player game logs ----------
  const logs = {}; for (const t of NHL.TEAMS) logs[t] = docs['logs-' + t] || { team: t, sk: [], gk: [] };
  const logged = new Set(); for (const t of NHL.TEAMS) for (const r of logs[t].sk) logged.add(r[0]);
  const players = (docs.players && docs.players.players) || {};
  let boxes = 0, newPlayers = 0;
  for (const [, gid] of results) {
    if (logged.has(gid)) continue;
    const c = NHL.parseBox(await nhl(`/v1/gamecenter/${gid}/boxscore`));
    const issues = NHL.checkBox(c); if (issues.length) notes.push(`box ${gid}: ${issues.join('; ')}`);
    for (const [flagSide, team] of [[0, c.a], [1, c.h]]) {
      const L = logs[team];
      L.sk = L.sk.filter(r => r[0] !== gid).concat(c.sk.filter(r => r[1] === flagSide).map(r => [gid, r[0], r[2], r[3], r[4], r[5], r[6], r[7], r[8]]));
      L.gk = L.gk.filter(r => r[0] !== gid).concat(c.gk.filter(r => r[1] === flagSide && (r[5] > 0 || r[6])).map(r => [gid, r[0], r[2], r[3], r[4], r[5], r[6]]));
      L.updated = stamp;
      for (const r of c.sk.filter(x => x[1] === flagSide)) if (!players[r[0]]) { players[r[0]] = [r[12] || String(r[0]), team, r[11], r[10], '', '', 1]; newPlayers++; }
      for (const r of c.gk.filter(x => x[1] === flagSide)) if (!players[r[0]]) { players[r[0]] = [r[9] || String(r[0]), team, 'G', r[8], '', '', 1]; newPlayers++; }
    }
    logged.add(gid); boxes++;
  }
  for (const t of NHL.TEAMS) docs['logs-' + t] = logs[t];

  // ---------- rosters (who is on each team now) ----------
  const rosterAge = docs.players && docs.players.rostersAt ? (NOW - Date.parse(docs.players.rostersAt)) / 36e5 : 1e9;
  if (flag('rosters') || newPlayers || rosterAge > CFG.rosterRefreshHours) {
    const rosters = {};
    for (const p of Object.values(players)) p[6] = 0;
    for (const t of NHL.TEAMS) {
      const r = await nhl(`/v1/roster/${t}/current`);
      rosters[t] = [];
      for (const [id, name, num, pos, sh, bd, hs] of NHL.parseRoster(r)) { players[id] = [name, t, pos, num, sh, bd, 1]; rosters[t].push([id, hs]); }
    }
    fs.writeFileSync(path.join(DATA, 'rosters.json'), JSON.stringify(rosters));
    docs.players = { updated: stamp, rostersAt: stamp, players };
    // headshot sheets that no longer match the roster get rebuilt by pipeline/headshots.py
    const idx = readJSON(path.join(WEB, 'p', 'index.json'));
    const stale = NHL.TEAMS.filter(t => { const have = new Set(((idx && idx.teams[t]) || []).map(Math.abs)); return rosters[t].some(([id]) => !have.has(id)); });
    fs.writeFileSync(path.join(DATA, 'heads-needed.json'), JSON.stringify(stale));
    if (stale.length) notes.push('headshots to rebuild: ' + stale.join(', '));
  } else docs.players = Object.assign({}, docs.players, { updated: stamp, players });

  // ---------- last season's player totals (once a season) ----------
  if (!docs.priors || docs.priors.season !== CFG.lastSeason) {
    const sk = {}, gk = {}, team = {};
    for (const t of NHL.TEAMS) {
      const cs = NHL.parseClubStats(await nhl(`/v1/club-stats/${t}/${CFG.lastSeason}/2`));
      let sf = 0, sa = 0;
      for (const p of cs.sk) { const a = sk[p[0]] = sk[p[0]] || [0, 0, 0, 0, 0]; a[0] += p[3]; a[1] += p[4]; a[2] += p[5]; a[3] += p[6]; a[4] += p[3] * p[7] / 60; sf += p[6]; }
      for (const p of cs.gk) { const a = gk[p[0]] = gk[p[0]] || [0, 0, 0, 0]; a[0] += p[2]; a[1] += p[3]; a[2] += p[4]; a[3] += p[5]; sa += p[4]; }
      team[t] = [82, sf, sa];
    }
    for (const a of Object.values(sk)) a[4] = Math.round(a[4]);
    docs.priors = { updated: stamp, season: CFG.lastSeason, sk, gk, team };
  }

  // ---------- schedule (next ~8 days) ----------
  const seen = new Set(), sched = [];
  for (const start of [today, addDays(today, 7)]) for (const g of NHL.parseSchedule(await nhl('/v1/schedule/' + start)))
    if (!seen.has(g[1]) && !have.has(g[1]) && g[0] >= today) { seen.add(g[1]); sched.push(g); }
  sched.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
  const prevSched = (docs.schedule && docs.schedule.games) || [];
  docs.schedule = { updated: stamp, games: sched };

  // ---------- sportsbook lines (The Odds API) ----------
  const key = process.env.ODDS_API_KEY;
  let oddsNote = 'unchanged (no ODDS_API_KEY set)';
  if (key || opt('odds-replay')) {
    const odds = makeGetter({ base: 'https://api.the-odds-api.com', replay: opt('odds-replay'), minGapMs: 250 });
    const prev = (docs.odds && docs.odds.games) || {}, closing = (docs.closing && docs.closing.games) || {};
    const startOf = {}; for (const g of prevSched.concat(sched)) startOf[g[1]] = g[2];
    for (const [gid, o] of Object.entries(prev)) {
      const started = have.has(+gid) || (startOf[gid] && Date.parse(startOf[gid]) <= NOW.getTime());
      if (!started || closing[gid]) continue;
      const bk = o.books.DraftKings ? 'DraftKings' : Object.keys(o.books).find(b => b !== 'Opener' && o.books[b].ml);
      if (bk) closing[gid] = Object.assign({ book: bk }, o.books[bk]);
    }
    docs.closing = { updated: stamp, games: closing };
    const q = `regions=us&oddsFormat=american&dateFormat=iso&apiKey=${key || 'replay'}`;
    const evs = await odds(`/v4/sports/${ODDS.SPORT}/odds?markets=${ODDS.GAME_MARKETS}&${q}`);
    const { games, report } = ODDS.parseGameOdds(evs, sched);
    for (const [gid, o] of Object.entries(games)) { // the first line we ever saw for a game is kept as the "Opener"
      const was = prev[gid] && prev[gid].books && prev[gid].books.Opener;
      const first = o.books.DraftKings || o.books[Object.keys(o.books)[0]];
      o.books.Opener = was || JSON.parse(JSON.stringify(first));
    }
    docs.odds = { updated: stamp, games };
    oddsNote = `${Object.keys(games).length} games from ${new Set(Object.values(games).flatMap(o => Object.keys(o.books))).size - 1} books`;
    if (report.length) notes.push(...report.slice(0, 5));
    if (PROPS) {
      const propsPrev = (docs.props && docs.props.games) || {};
      const archive = readJSON(path.join(DATA, 'props-closing.json')) || {};
      for (const [gid, p] of Object.entries(propsPrev)) { const st = startOf[gid]; if ((have.has(+gid) || (st && Date.parse(st) <= NOW.getTime())) && !archive[gid]) archive[gid] = p; }
      fs.writeFileSync(path.join(DATA, 'props-closing.json'), JSON.stringify(archive));
      const events = await odds(`/v4/sports/${ODDS.SPORT}/events?dateFormat=iso&apiKey=${key || 'replay'}`);
      const out = {}; let unmatched = 0;
      for (const ev of events || []) {
        const g = ODDS.matchGame(ev, sched); if (!g) continue;
        const t = Date.parse(g[2]); if (t <= NOW.getTime() || t - NOW.getTime() > CFG.propsWindowHours * 3600e3) continue;
        const evOdds = await odds(`/v4/sports/${ODDS.SPORT}/events/${ev.id}/odds?markets=${Object.keys(ODDS.PROP_MARKETS).join(',')}&${q}`, { optional: true });
        if (!evOdds) continue;
        const r = ODDS.parseEventProps(evOdds, g, players); out[g[1]] = r.props; unmatched += r.unmatched.length;
      }
      // keep earlier lines for games that already started, so bets on them can still be read back
      for (const [gid, p] of Object.entries(propsPrev)) if (!out[gid] && sched.some(g => String(g[1]) === gid)) out[gid] = p;
      docs.props = { updated: stamp, source: 'The Odds API', games: out };
      oddsNote += `; props for ${Object.keys(out).length} games` + (unmatched ? ` (${unmatched} names not matched)` : '');
    }
    const left = odds.lastHeaders && odds.lastHeaders.get && odds.lastHeaders.get('x-requests-remaining');
    if (left) oddsNote += `; ${left} credits left this month`;
  }
  if (!docs.props) docs.props = { updated: stamp, source: '', games: {} };
  if (!docs.odds) docs.odds = { updated: stamp, games: {} };
  if (!docs.closing) docs.closing = { updated: stamp, games: {} };

  docs.meta = { updated: stamp, season: CFG.season, by: 'Blueline Desk pipeline', sources: `NHL stats API (api-web.nhle.com): results, box scores, rosters, schedule; standings check ${mismatch.length ? 'found ' + mismatch.length + ' differences' : 'matched all 32 teams'}. Odds: ${oddsNote}.` };

  // ---------- write ----------
  for (const [k, v] of Object.entries(docs)) fs.writeFileSync(path.join(DATA, k + '.json'), JSON.stringify(v));
  const feed = {}; for (const [k, v] of Object.entries(docs)) feed[k] = v;
  fs.writeFileSync(path.join(DATA, 'feed.json'), JSON.stringify(feed));
  nhl.save();
  const summary = { at: stamp, today, resultsAdded: added.length, results: results.length, boxScoresLoaded: boxes, newPlayers, schedule: sched.length, odds: oddsNote, requests: nhl.calls(), notes };
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Blueline Desk refresh\n\n- Results added: ${added.length} (season total ${results.length})\n- Box scores loaded: ${boxes}\n- Upcoming games: ${sched.length}\n- Odds: ${oddsNote}\n${notes.map(n => '- ' + n).join('\n')}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
