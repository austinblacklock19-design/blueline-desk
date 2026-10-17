'use strict';
// NHL stats API (api-web.nhle.com) client. Every function that touches the network takes a `get(path)`
// function so tests can replay recorded responses; the pure parsers below turn raw JSON into the
// dashboard's compact rows.

const TEAMS = ['ANA', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NSH',
  'NJD', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SJS', 'SEA', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WSH', 'WPG'];

const toSec = t => { if (t == null) return 0; const [m, s] = String(t).split(':').map(Number); return (m || 0) * 60 + (s || 0); };
const nm = p => [p.firstName && p.firstName.default, p.lastName && p.lastName.default].filter(Boolean).join(' ');
const FINAL = new Set(['OFF', 'FINAL']);

// /v1/score/{date} -> games of any type with their state and score
function parseScore(json, date) {
  return (json.games || []).map(g => ({
    id: g.id, date: g.gameDate || date, type: g.gameType, state: g.gameState,
    away: g.awayTeam && g.awayTeam.abbrev, home: g.homeTeam && g.homeTeam.abbrev,
    as: g.awayTeam ? g.awayTeam.score : null, hs: g.homeTeam ? g.homeTeam.score : null,
    per: g.gameOutcome ? g.gameOutcome.lastPeriodType : (g.periodDescriptor && g.periodDescriptor.periodType) || null,
    start: g.startTimeUTC || null
  }));
}

// /v1/schedule/{date} -> regular-season games in that week that are not final
function parseSchedule(json) {
  const out = [];
  for (const day of json.gameWeek || []) for (const g of day.games || []) {
    if (g.gameType !== 2 || FINAL.has(g.gameState)) continue;
    out.push([day.date, g.id, g.startTimeUTC, g.awayTeam.abbrev, g.homeTeam.abbrev, g.venue ? g.venue.default : '']);
  }
  return out;
}

// /v1/gamecenter/{id}/boxscore -> compact box score
function parseBox(b) {
  const pg = b.playerByGameStats || {}, sk = [], gk = [];
  for (const [side, flag] of [['awayTeam', 0], ['homeTeam', 1]]) {
    const t = pg[side] || {};
    for (const p of [...(t.forwards || []), ...(t.defense || [])])
      sk.push([p.playerId, flag, p.goals | 0, p.assists | 0, p.sog | 0, toSec(p.toi), p.powerPlayGoals | 0, p.hits | 0, p.blockedShots | 0, p.pim | 0, p.sweaterNumber, p.position, p.name && p.name.default]);
    for (const p of t.goalies || [])
      gk.push([p.playerId, flag, p.shotsAgainst | 0, p.saves | 0, p.goalsAgainst | 0, toSec(p.toi), p.starter ? 1 : 0, p.decision || '', p.sweaterNumber, p.name && p.name.default]);
  }
  return { id: b.id, d: b.gameDate, type: b.gameType, a: b.awayTeam.abbrev, h: b.homeTeam.abbrev, as: b.awayTeam.score, hs: b.homeTeam.score,
    asog: b.awayTeam.sog, hsog: b.homeTeam.sog, per: b.gameOutcome && b.gameOutcome.lastPeriodType, st: b.gameState, sk, gk };
}

// Sanity checks a box score must pass before it is stored. Empty-net goals are shots a goalie never
// faced, so only the skater side is checked against the team totals.
function checkBox(c) {
  const problems = [];
  for (const [flag, score, opp, sog] of [[0, c.as, c.hs, c.asog], [1, c.hs, c.as, c.hsog]]) {
    const rows = c.sk.filter(r => r[1] === flag);
    const goals = rows.reduce((a, r) => a + r[2], 0), shots = rows.reduce((a, r) => a + r[4], 0);
    const soWin = c.per === 'SO' && score > opp ? 1 : 0;
    if (goals !== score - soWin) problems.push(`${flag ? c.h : c.a}: skater goals ${goals} vs score ${score - soWin}`);
    if (Math.abs(shots - sog) > 1) problems.push(`${flag ? c.h : c.a}: skater shots ${shots} vs team ${sog}`);
    if (c.gk.filter(r => r[1] === flag && r[6]).length !== 1) problems.push(`${flag ? c.h : c.a}: starting goalie missing`);
  }
  return problems;
}

// /v1/roster/{team}/current -> [[id, name, number, position, shoots, birthDate, headshotUrl]]
function parseRoster(r) {
  return [...(r.forwards || []), ...(r.defensemen || []), ...(r.goalies || [])]
    .map(p => [p.id, nm(p), p.sweaterNumber, p.positionCode, p.shootsCatches || '', p.birthDate || '', p.headshot || '']);
}

// /v1/club-stats/{team}/{season}/2 -> season totals
function parseClubStats(r) {
  return {
    sk: (r.skaters || []).map(p => [p.playerId, nm(p), p.positionCode, p.gamesPlayed, p.goals, p.assists, p.shots, Math.round(p.avgTimeOnIcePerGame || 0)]),
    gk: (r.goalies || []).map(p => [p.playerId, nm(p), p.gamesPlayed, p.gamesStarted, p.shotsAgainst, p.saves, p.goalsAgainst])
  };
}

// /v1/standings/{date|now} -> {ABBR: {name, conf, div, gp, w, l, otl, pts, gf, ga}}
function parseStandings(s) {
  const out = {};
  for (const t of s.standings || []) {
    const a = t.teamAbbrev && t.teamAbbrev.default; if (!a) continue;
    out[a] = { name: t.teamName && t.teamName.default, conf: t.conferenceName, div: t.divisionName, gp: t.gamesPlayed, w: t.wins, l: t.losses, otl: t.otLosses, pts: t.points, gf: t.goalFor, ga: t.goalAgainst };
  }
  return out;
}

// Compare standings with what our results imply. Returns a list of mismatches (empty = all good).
function verifyStandings(standings, results) {
  const calc = {};
  for (const [, , a, h, as, hs, per] of results) for (const [t, f, g] of [[a, as, hs], [h, hs, as]]) {
    const x = calc[t] = calc[t] || { gp: 0, w: 0, l: 0, otl: 0, gf: 0, ga: 0 };
    x.gp++; x.gf += f; x.ga += g; if (f > g) x.w++; else if (per !== 'REG') x.otl++; else x.l++;
  }
  const bad = [];
  for (const [t, s] of Object.entries(standings)) {
    const c = calc[t] || { gp: 0, w: 0, l: 0, otl: 0, gf: 0, ga: 0 };
    for (const k of ['gp', 'w', 'l', 'otl', 'gf', 'ga']) if (c[k] !== s[k]) { bad.push(`${t} ${k}: results ${c[k]}, standings ${s[k]}`); break; }
  }
  return bad;
}

module.exports = { TEAMS, toSec, parseScore, parseSchedule, parseBox, checkBox, parseRoster, parseClubStats, parseStandings, verifyStandings, FINAL };
