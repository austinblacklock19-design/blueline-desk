'use strict';
// Rebuilds NHL API / Odds API responses (in each API's own JSON shape) from the compact data captured on
// 2026-10-17, so the pipeline can be run end to end offline. The compact data itself came from the live APIs
// and was checked against NHL standings and club stats.
const fs = require('fs'), path = require('path');
const F = path.join(__dirname, 'oct17');
const J = f => JSON.parse(fs.readFileSync(path.join(F, f), 'utf8'));
const mmss = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
const split = n => { const i = n.indexOf(' '); return i < 0 ? { firstName: { default: n }, lastName: { default: '' } } : { firstName: { default: n.slice(0, i) }, lastName: { default: n.slice(i + 1) } }; };

function nhlReplay() {
  const box = J('box.json').box, P = J('players.json'), results = J('results.json').games, sched = J('schedule.json').games, teams = J('teams.json');
  const out = {};
  // score pages: finals from results, plus today's scheduled games
  const byDate = {};
  for (const r of results) (byDate[r[0]] = byDate[r[0]] || []).push({ id: r[1], gameType: 2, gameDate: r[0], gameState: 'OFF', startTimeUTC: r[0] + 'T23:00:00Z', awayTeam: { abbrev: r[2], score: r[4] }, homeTeam: { abbrev: r[3], score: r[5] }, gameOutcome: { lastPeriodType: r[6] } });
  for (const s of sched) (byDate[s[0]] = byDate[s[0]] || []).push({ id: s[1], gameType: 2, gameDate: s[0], gameState: 'FUT', startTimeUTC: s[2], awayTeam: { abbrev: s[3] }, homeTeam: { abbrev: s[4] } });
  for (let d = new Date('2026-09-29T12:00:00Z'); d <= new Date('2026-10-17T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) { const k = d.toISOString().slice(0, 10); out['/v1/score/' + k] = { currentDate: k, games: byDate[k] || [] }; }
  // box scores
  for (const b of box) {
    const side = flag => {
      const sk = b.sk.filter(r => r[1] === flag).map(r => ({ playerId: r[0], sweaterNumber: r[10], name: { default: r[12] }, position: r[11], goals: r[2], assists: r[3], points: r[2] + r[3], plusMinus: 0, pim: r[9], hits: r[7], powerPlayGoals: r[6], sog: r[4], faceoffWinningPctg: 0, toi: mmss(r[5]), blockedShots: r[8], shifts: 0, giveaways: 0, takeaways: 0 }));
      return { forwards: sk.filter(p => p.position !== 'D'), defense: sk.filter(p => p.position === 'D'),
        goalies: b.gk.filter(r => r[1] === flag).map(r => ({ playerId: r[0], sweaterNumber: r[8], name: { default: r[9] }, position: 'G', shotsAgainst: r[2], saves: r[3], goalsAgainst: r[4], toi: mmss(r[5]), starter: !!r[6], decision: r[7] || undefined })) };
    };
    out[`/v1/gamecenter/${b.id}/boxscore`] = { id: b.id, gameType: 2, gameDate: b.d, gameState: b.st, awayTeam: { abbrev: b.a, score: b.as, sog: b.asog }, homeTeam: { abbrev: b.h, score: b.hs, sog: b.hsog }, gameOutcome: { lastPeriodType: b.per }, playerByGameStats: { awayTeam: side(0), homeTeam: side(1) } };
  }
  // rosters and last season's club stats
  P.teams.forEach((t, i) => {
    const ros = P.ros[i].map(([id, name, num, pos, sh, bd, hs]) => Object.assign({ id, headshot: hs, sweaterNumber: num, positionCode: pos, shootsCatches: sh, birthDate: bd }, split(name)));
    out[`/v1/roster/${t}/current`] = { forwards: ros.filter(p => 'CLR'.includes(p.positionCode)), defensemen: ros.filter(p => p.positionCode === 'D'), goalies: ros.filter(p => p.positionCode === 'G') };
    const L = P.last[i];
    out[`/v1/club-stats/${t}/20252026/2`] = { season: '20252026', gameType: 2,
      skaters: L.sk.map(p => Object.assign({ playerId: p[0], positionCode: p[2], gamesPlayed: p[3], goals: p[4], assists: p[5], shots: p[6], avgTimeOnIcePerGame: p[7], powerPlayGoals: p[8] }, split(p[1]))),
      goalies: L.gk.map(p => Object.assign({ playerId: p[0], gamesPlayed: p[2], gamesStarted: p[3], shotsAgainst: p[4], saves: p[5], goalsAgainst: p[6], timeOnIce: p[7] }, split(p[1]))) };
  });
  // standings: now (computed from results, so the check should pass) and at the end of last season
  const calc = {};
  for (const [, , a, h, as, hs, per] of results) for (const [t, f, g] of [[a, as, hs], [h, hs, as]]) { const x = calc[t] = calc[t] || { gp: 0, w: 0, l: 0, otl: 0, gf: 0, ga: 0 }; x.gp++; x.gf += f; x.ga += g; if (f > g) x.w++; else if (per !== 'REG') x.otl++; else x.l++; }
  const row = (t, x) => { const tm = teams.teams.find(y => y.a === t); return { teamAbbrev: { default: t }, teamName: { default: tm.name }, conferenceName: tm.conf, divisionName: tm.div, gamesPlayed: x.gp, wins: x.w, losses: x.l, otLosses: x.otl, points: 2 * x.w + x.otl, goalFor: x.gf, goalAgainst: x.ga }; };
  out['/v1/standings/now'] = { standings: Object.entries(calc).map(([t, x]) => row(t, x)) };
  out['/v1/standings/2026-04-16'] = { standings: Object.entries(teams.last).map(([t, x]) => row(t, x)) };
  // schedule weeks
  const week = start => { const days = {}; for (const s of sched) if (s[0] >= start && s[0] < new Date(Date.parse(start + 'T12:00:00Z') + 7 * 864e5).toISOString().slice(0, 10)) (days[s[0]] = days[s[0]] || []).push({ id: s[1], gameType: 2, startTimeUTC: s[2], gameState: 'FUT', awayTeam: { abbrev: s[3] }, homeTeam: { abbrev: s[4] }, venue: { default: s[5] } });
    return { gameWeek: Object.entries(days).sort().map(([date, games]) => ({ date, games })) }; };
  out['/v1/schedule/2026-10-17'] = week('2026-10-17'); out['/v1/schedule/2026-10-24'] = week('2026-10-24');
  return out;
}

// The Odds API shape, rebuilt from the sportsbook lines the dashboard holds for those games
function oddsReplay() {
  const odds = J('odds.json').games, sched = J('schedule.json').games, teams = J('teams.json').teams;
  const full = a => teams.find(t => t.a === a).name;
  const events = [];
  for (const s of sched) {
    const o = odds[s[1]]; if (!o) continue;
    const bookmakers = Object.entries(o.books).filter(([b]) => b !== 'Opener').map(([title, b]) => ({ key: title.toLowerCase(), title, markets: [
      b.ml ? { key: 'h2h', outcomes: [{ name: full(s[3]), price: b.ml[0] }, { name: full(s[4]), price: b.ml[1] }] } : null,
      b.pl ? { key: 'spreads', outcomes: [{ name: full(s[3]), price: b.pl[1], point: b.pl[0] }, { name: full(s[4]), price: b.pl[3], point: b.pl[2] }] } : null,
      b.tot ? { key: 'totals', outcomes: [{ name: 'Over', price: b.tot[1], point: b.tot[0] }, { name: 'Under', price: b.tot[2], point: b.tot[0] }] } : null].filter(Boolean) }));
    events.push({ id: 'ev' + s[1], sport_key: 'icehockey_nhl', commence_time: s[2], away_team: full(s[3]), home_team: full(s[4]), bookmakers });
  }
  const q = 'regions=us&oddsFormat=american&dateFormat=iso&apiKey=replay';
  const out = { [`/v4/sports/icehockey_nhl/odds?markets=h2h,spreads,totals&${q}`]: events,
    [`/v4/sports/icehockey_nhl/events?dateFormat=iso&apiKey=replay`]: events.map(e => ({ id: e.id, commence_time: e.commence_time, away_team: e.away_team, home_team: e.home_team })) };
  // one game's player props, in the API's outcome format (Over/Under with a description naming the player)
  const g = sched.find(x => x[3] === 'NYI' && x[4] === 'TOR');
  out[`/v4/sports/icehockey_nhl/events/ev${g[1]}/odds?markets=player_shots_on_goal,player_points,player_goal_scorer_anytime,player_assists,player_total_saves&${q}`] = {
    id: 'ev' + g[1], commence_time: g[2], away_team: full('NYI'), home_team: full('TOR'), bookmakers: [
      { key: 'draftkings', title: 'DraftKings', markets: [
        { key: 'player_shots_on_goal', outcomes: [{ name: 'Over', description: 'Auston Matthews', price: -120, point: 3.5 }, { name: 'Under', description: 'Auston Matthews', price: -110, point: 3.5 }, { name: 'Over', description: 'Bo Horvat', price: +105, point: 3.5 }, { name: 'Under', description: 'Bo Horvat', price: -135, point: 3.5 }] },
        { key: 'player_goal_scorer_anytime', outcomes: [{ name: 'Yes', description: 'Auston Matthews', price: +150 }, { name: 'Yes', description: 'Not A Player', price: +900 }] }] },
      { key: 'fanduel', title: 'FanDuel', markets: [
        { key: 'player_shots_on_goal', outcomes: [{ name: 'Over', description: 'Auston Matthews', price: -115, point: 3.5 }, { name: 'Under', description: 'Auston Matthews', price: -115, point: 3.5 }, { name: 'Over', description: 'Bo Horvat', price: -150, point: 2.5 }, { name: 'Under', description: 'Bo Horvat', price: +120, point: 2.5 }] },
        { key: 'player_points', outcomes: [{ name: 'Over', description: 'Auston Matthews', price: -165, point: 0.5 }, { name: 'Under', description: 'Auston Matthews', price: +130, point: 0.5 }] }] }] };
  return { out, gameId: g[1] };
}

module.exports = { nhlReplay, oddsReplay };
