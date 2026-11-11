'use strict';
// Same-game parlay pricer: reproduces a hand-checked real case, agrees with the single-market prices,
// and its goal-by-goal calculation matches a brute-force count.
const test = require('node:test');
const assert = require('node:assert');
const BL = require('../model/team');
const BLX = require('../model/parlay');
const ODDS = require('../pipeline/lib/odds');

// Nashville at Los Angeles, Nov 10 2026, as the dashboard had it (LA's backup in net):
// regulation expected goals and each player's model chance to score
const PRED = BL.fromLambdas(2.8410182538225723, 3.1836031448828415);
const GOAL = { STAM: 0.4069410064633048, FORS: 0.3599630978778723, PANA: 0.33335447451210487, KEMP: 0.3635174322180825 };
const D = BLX.goalDists(PRED);
const PL = { STAM: BLX.playerRates(D.away, GOAL.STAM), FORS: BLX.playerRates(D.away, GOAL.FORS), PANA: BLX.playerRates(D.home, GOAL.PANA), KEMP: BLX.playerRates(D.home, GOAL.KEMP) };
const goal = (pid, team) => ({ kind: 'goal', pid, team });

test('reproduces the hand-checked 5-leg and 3-leg prices', () => {
  const five = [{ kind: 'ml', side: 'away' }, goal('STAM', 'away'), goal('FORS', 'away'), goal('PANA', 'home'), goal('KEMP', 'home')];
  const r5 = BLX.price(PRED, five, PL);
  assert.ok(Math.abs(r5.p - 0.00969) < 0.00005, 'five legs ' + r5.p);
  assert.ok(Math.abs(r5.indep - 0.00984) < 0.00005, 'independent ' + r5.indep);
  const e = BLX.evaluate(r5.p, 6840, 0.30); // FanDuel's +6840 with a 30% profit boost
  assert.strictEqual(e.am, 8892);
  assert.ok(Math.abs(e.ev - (-0.129)) < 0.002, 'EV ' + e.ev);
  const r3 = BLX.price(PRED, five.slice(0, 3), PL);
  assert.ok(Math.abs(r3.p - 0.1154) < 0.0002, 'core ' + r3.p);
  assert.strictEqual(BLX.minPrice(r3.p, 0.30, 0), 590);
  // two Kings scorers work against a Nashville win; two Nashville scorers help it
  assert.ok(r5.each[0].givenOthers < r5.each[0].own);
  assert.ok(r3.each[0].givenOthers > r3.each[0].own);
});

test('one leg on its own matches the single-market price', () => {
  const one = l => BLX.chance(PRED, [l], PL);
  assert.ok(Math.abs(one({ kind: 'ml', side: 'away' }) - PRED.pAway) < 1e-9);
  assert.ok(Math.abs(one({ kind: 'ml', side: 'home' }) - PRED.pHome) < 1e-9);
  const t = PRED.total(6.5);
  assert.ok(Math.abs(one({ kind: 'total', side: 'over', line: 6.5 }) - t.over) < 1e-9);
  assert.ok(Math.abs(one({ kind: 'reg', side: 'away' }) - PRED.regA) < 1e-9);
  assert.ok(Math.abs(one({ kind: 'pl', side: 'away', line: -1.5 }) - PRED.awayMinus15) < 1e-9, 'away -1.5 is a regulation win by 2+');
  assert.ok(Math.abs(one({ kind: 'pl', side: 'home', line: 1.5 }) - PRED.homePlus15) < 1e-9);
  for (const [pid, team] of [['STAM', 'away'], ['PANA', 'home']]) assert.ok(Math.abs(one(goal(pid, team)) - GOAL[pid]) < 1e-6, pid);
  // the regulation win and a 60-minute tie can't both happen; ML and its opposite can't both happen
  assert.strictEqual(BLX.chance(PRED, [{ kind: 'ml', side: 'away' }, { kind: 'ml', side: 'home' }], PL), 0);
});

test('adding a leg never makes a parlay more likely', () => {
  const legs = [{ kind: 'ml', side: 'away' }, goal('STAM', 'away'), { kind: 'total', side: 'over', line: 5.5 }, goal('KEMP', 'home'), { kind: 'tt', team: 'away', side: 'over', line: 3.5 }];
  let prev = 1;
  for (let i = 1; i <= legs.length; i++) { const p = BLX.chance(PRED, legs.slice(0, i), PL); assert.ok(p <= prev + 1e-12, 'leg ' + i); prev = p; }
});

test('the goal-by-goal calculation matches a brute-force count', () => {
  // two players: A needs 1+ point, B needs a goal and 3+ shots; a teammate without a leg takes the rest
  const sogPmf = [0.08, 0.17, 0.22, 0.2, 0.15, 0.1, 0.05, 0.03];
  const A = { s: 0.14, a: 0.22, sog: null }, B = { s: 0.12, a: 0.1, sog: { pmf: sogPmf, q: 0.12 } };
  const legs = [{ kind: 'point', pid: 'A', team: 'home', k: 1 }, { kind: 'goal', pid: 'B', team: 'home', k: 1 }, { kind: 'sog', pid: 'B', team: 'home', k: 3 }];
  const table = BLX.teamTable(legs, { A, B });
  const cond = BLX.shotsGivenGoals(sogPmf, 0.12, 3, 2);
  const alphaA = A.a / (1 - A.s), alphaB = B.a / (1 - B.s);
  for (let n = 0; n <= 4; n++) {
    // every sequence of n goals: scorer (A, B or other) and who of A/B assists
    let total = 0;
    const walk = (k, gA, aA, gB, p) => {
      if (k === n) { const ok = gA + aA >= 1 && gB >= 1; total += ok ? p * cond[Math.min(gB, 2)] : 0; return; }
      for (const [sc, ps] of [['A', A.s], ['B', B.s], ['O', 1 - A.s - B.s]]) {
        const asA = sc === 'A' ? [[0, 1]] : [[1, alphaA], [0, 1 - alphaA]];
        for (const [xa, pa] of asA) walk(k + 1, gA + (sc === 'A' ? 1 : 0), aA + xa, gB + (sc === 'B' ? 1 : 0), p * ps * pa);
      }
    };
    walk(0, 0, 0, 0, 1);
    assert.ok(Math.abs(table[n] - total) < 1e-12, `n=${n}: ${table[n]} vs ${total}`);
  }
  void alphaB;
});

test('boost and break-even prices', () => {
  assert.ok(Math.abs(BLX.boostedDec(6840, 0.3) - 89.92) < 1e-9);
  assert.strictEqual(BLX.decToAm(2), 100);
  assert.strictEqual(BLX.decToAm(1.5), -200);
  const p = 0.1022;
  const am = BLX.minPrice(p, 0.3, 0);
  assert.ok(Math.abs(BLX.evaluate(p, am, 0.3).ev) < 0.002, 'break-even price gives about zero EV');
  assert.ok(BLX.evaluate(p, am + 50, 0.3).ev > 0 && BLX.evaluate(p, am - 50, 0.3).ev < 0);
});

test('a game leg settles on the official final score', () => {
  const so = { hf: 3, af: 4, win: 'away', how: 'SO' }; // a 3-3 game the road team won in the shootout
  assert.ok(BLX.gameLegHits({ kind: 'ml', side: 'away' }, so));
  assert.ok(!BLX.gameLegHits({ kind: 'reg', side: 'away' }, so));
  assert.ok(!BLX.gameLegHits({ kind: 'pl', side: 'away', line: -1.5 }, so));
  assert.ok(BLX.gameLegHits({ kind: 'pl', side: 'home', line: 1.5 }, so));
  assert.ok(BLX.gameLegHits({ kind: 'total', side: 'over', line: 6.5 }, so));
  assert.ok(BLX.gameLegHits({ kind: 'tt', team: 'away', side: 'over', line: 3.5 }, so));
});

test('props keep your own book\'s line next to the best one', () => {
  const game = [ '2026-11-10', 2026020292, '2026-11-11T03:00:00Z', 'NSH', 'LAK' ];
  const players = { 8474564: ['Steven Stamkos', 'NSH'] };
  const ev = { bookmakers: [
    { title: 'DraftKings', markets: [{ key: 'player_goal_scorer_anytime', outcomes: [{ name: 'Yes', description: 'Steven Stamkos', price: 160 }] }, { key: 'player_shots_on_goal', outcomes: [{ name: 'Over', description: 'Steven Stamkos', point: 2.5, price: -105 }, { name: 'Under', description: 'Steven Stamkos', point: 2.5, price: -125 }] }] },
    { title: 'FanDuel', markets: [{ key: 'player_goal_scorer_anytime', outcomes: [{ name: 'Yes', description: 'Steven Stamkos', price: 145 }] }, { key: 'player_shots_on_goal', outcomes: [{ name: 'Over', description: 'Steven Stamkos', point: 2.5, price: 100 }, { name: 'Under', description: 'Steven Stamkos', point: 2.5, price: -130 }] }] }] };
  const r = ODDS.parseEventProps(ev, game, players, 'FanDuel').props['8474564'];
  assert.deepStrictEqual(r.G, [0.5, 160, null, 'DraftKings', ['FanDuel', 0.5, 145, null]]);
  assert.deepStrictEqual(r.SOG, [2.5, 100, -130, 'FanDuel']); // FanDuel is the best over already
  assert.deepStrictEqual(ODDS.parseEventProps(ev, game, players).props['8474564'].G, [0.5, 160, null, 'DraftKings']);
});
