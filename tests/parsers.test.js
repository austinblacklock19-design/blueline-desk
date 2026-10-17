'use strict';
const test = require('node:test'), assert = require('node:assert');
const NHL = require('../pipeline/lib/nhl'), ODDS = require('../pipeline/lib/odds');

test('team names from the odds feed map to NHL abbreviations', () => {
  const cases = { 'Montréal Canadiens': 'MTL', 'St Louis Blues': 'STL', 'St. Louis Blues': 'STL', 'Utah Mammoth': 'UTA', 'Utah Hockey Club': 'UTA', 'Toronto Maple Leafs': 'TOR', 'Detroit Red Wings': 'DET', 'Columbus Blue Jackets': 'CBJ', 'Vegas Golden Knights': 'VGK', 'New York Rangers': 'NYR', 'New York Islanders': 'NYI', 'Winnipeg Jets': 'WPG', 'Seattle Kraken': 'SEA' };
  for (const [n, a] of Object.entries(cases)) assert.strictEqual(ODDS.teamAbbrev(n), a, n);
});

test('box score checks catch bad totals', () => {
  const c = { a: 'AAA', h: 'HHH', as: 2, hs: 3, asog: 20, hsog: 25, per: 'REG', sk: [[1, 0, 2, 0, 20, 900], [2, 1, 3, 0, 25, 900]], gk: [[9, 0, 25, 22, 3, 3600, 1], [8, 1, 20, 18, 2, 3600, 1]] };
  assert.deepStrictEqual(NHL.checkBox(c), []);
  c.sk[1][2] = 2; // a goal missing
  assert.strictEqual(NHL.checkBox(c).length, 1);
  c.per = 'SO'; c.as = 3; c.sk[0][2] = 2; c.sk[1][2] = 2; c.hs = 2; // shootout: the winner's deciding goal is not a skater goal
  assert.deepStrictEqual(NHL.checkBox(c), []);
});

test('standings verification flags a missing game', () => {
  const results = [['2026-10-01', 1, 'AAA', 'HHH', 2, 3, 'REG']];
  const st = { AAA: { gp: 1, w: 0, l: 1, otl: 0, gf: 2, ga: 3 }, HHH: { gp: 1, w: 1, l: 0, otl: 0, gf: 3, ga: 2 } };
  assert.deepStrictEqual(NHL.verifyStandings(st, results), []);
  st.AAA.gp = 2; assert.strictEqual(NHL.verifyStandings(st, results).length, 1);
});

test('odds parsing drops prices with an impossible margin and a flipped puck line', () => {
  const sched = [['2026-10-17', 99, '2026-10-17T23:00:00Z', 'NYI', 'TOR', 'Arena']];
  const ev = [{ away_team: 'New York Islanders', home_team: 'Toronto Maple Leafs', commence_time: '2026-10-17T23:00:00Z', bookmakers: [
    { title: 'Good', markets: [{ key: 'h2h', outcomes: [{ name: 'Toronto Maple Leafs', price: -140 }, { name: 'New York Islanders', price: 120 }] }, { key: 'spreads', outcomes: [{ name: 'Toronto Maple Leafs', price: 170, point: -1.5 }, { name: 'New York Islanders', price: -205, point: 1.5 }] }] },
    { title: 'Bad', markets: [{ key: 'h2h', outcomes: [{ name: 'Toronto Maple Leafs', price: 140 }, { name: 'New York Islanders', price: 120 }] }, { key: 'spreads', outcomes: [{ name: 'Toronto Maple Leafs', price: -200, point: 1.5 }, { name: 'New York Islanders', price: 170, point: -1.5 }] }] }] }];
  const { games } = ODDS.parseGameOdds(ev, sched);
  assert.deepStrictEqual(games[99].books.Good.ml, [120, -140]);
  assert.deepStrictEqual(games[99].books.Good.pl, [1.5, -205, -1.5, 170]);
  assert.ok(!games[99].books.Bad, 'both plus-money moneyline prices and a puck line with -1.5 on the underdog are both dropped');
});

test('props are only pulled while game-line credits stay in reserve', () => {
  assert.strictEqual(ODDS.PROP_COST, 5);
  assert.deepStrictEqual(ODDS.propsBudget(null, 7, 280), { ok: true, left: null, cost: 35, reserve: 280 }); // usage unknown
  assert.strictEqual(ODDS.propsBudget(500, 7, 280).ok, true);   // a fresh free plan can afford one night
  assert.strictEqual(ODDS.propsBudget(315, 7, 280).ok, true);   // exactly the reserve left afterwards
  assert.strictEqual(ODDS.propsBudget(314, 7, 280).ok, false);  // one credit short
  assert.strictEqual(ODDS.propsBudget(19000, 14, 280).ok, true);
});
