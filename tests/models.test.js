'use strict';
// Model checks on this season's real games (walk-forward: every prediction uses only earlier games).
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const BL = require('../model/team'), BLP = require('../model/props');
const FX = path.join(__dirname, 'fixtures', 'oct17'), DATA = path.join(FX, 'docs'); // fixed snapshot, so live data can't change the result
const J = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const teamsDoc = J(path.join(FX, 'teams.json')), results = J(path.join(FX, 'results.json')).games;
const teams = teamsDoc.teams.map(t => t.a);
const res = results.map(g => ({ date: g[0], id: g[1], away: g[2], home: g[3], as: g[4], hs: g[5], per: g[6] }));

test('score grid probabilities add up and prices convert both ways', () => {
  const rt = BL.buildRatings(teams, teamsDoc.last, res, {});
  const p = BL.predict(rt, { away: 'PIT', home: 'COL' }, {});
  assert.ok(Math.abs(p.pHome + p.pAway - 1) < 1e-9);
  const t = p.total(6.5); assert.ok(Math.abs(t.over + t.under + t.push - 1) < 1e-9);
  assert.ok(Math.abs(BL.amToProb(BL.probToAm(0.6)) - 0.6) < 0.002);
  const nv = BL.noVig(-110, -110); assert.ok(Math.abs(nv.a - 0.5) < 1e-9);
});

test('team model beats always picking the home team', () => {
  const bt = BL.backtest(teams, teamsDoc.last, res, {});
  assert.ok(bt.n >= 100);
  assert.ok(bt.logLoss < bt.logLossBase, `log loss ${bt.logLoss} vs baseline ${bt.logLossBase}`);
});

test('props model distributions are valid and it beats season averages', () => {
  const pmf = BLP.nbPmf(2.8, 10); const s = pmf.reduce((a, b) => a + b, 0); assert.ok(Math.abs(s - 1) < 1e-6);
  const ou = BLP.overUnder(pmf, 2.5); assert.ok(Math.abs(ou.over + ou.under - 1) < 1e-9);
  const docs = {}; for (const f of fs.readdirSync(DATA)) if (/^(logs-|players|priors)/.test(f)) docs[f.slice(0, -5)] = J(path.join(DATA, f));
  const games = {}; for (const r of results) games[r[1]] = { d: r[0], a: r[2], h: r[3] };
  const data = BLP.fromFeed(docs, games);
  const bt = BLP.backtest(data, {}, null);
  assert.ok(bt.n > 3000, 'player-games ' + bt.n);
  assert.ok(bt.sog3.model.ll < bt.sog3.base.ll, 'shots 3+: model ' + bt.sog3.model.ll + ' vs base ' + bt.sog3.base.ll);
  assert.ok(bt.pts1.model.ll < bt.pts1.base.ll, 'points 1+');
});
