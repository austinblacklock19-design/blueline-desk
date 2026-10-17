'use strict';
// End-to-end: rebuild the whole season from an empty data folder using replayed API responses, then check
// the output against the data the live dashboard was verified with (NHL standings and club stats matched).
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { nhlReplay, oddsReplay } = require('./fixtures/replay');
const ROOT = path.join(__dirname, '..'), FX = path.join(__dirname, 'fixtures', 'oct17');
const J = f => JSON.parse(fs.readFileSync(f, 'utf8'));

function run(dataDir, extra = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-replay-'));
  fs.writeFileSync(path.join(tmp, 'nhl.json'), JSON.stringify(nhlReplay()));
  const o = oddsReplay(); fs.writeFileSync(path.join(tmp, 'odds.json'), JSON.stringify(o.out));
  const out = execFileSync('node', [path.join(ROOT, 'pipeline', 'refresh.js'), '--data', dataDir, '--replay', path.join(tmp, 'nhl.json'), '--odds-replay', path.join(tmp, 'odds.json'), '--now', '2026-10-17T16:00:00Z', '--props', ...extra], { encoding: 'utf8', env: Object.assign({}, process.env, { ODDS_API_KEY: '', GITHUB_STEP_SUMMARY: '', GITHUB_ACTIONS: '' }) });
  return { summary: JSON.parse(out.slice(out.indexOf('{'))), gameId: o.gameId };
}

test('full rebuild from nothing matches the verified season data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-data-'));
  const { summary, gameId } = run(dir);
  assert.strictEqual(summary.resultsAdded, 120);
  assert.strictEqual(summary.boxScoresLoaded, 120);
  const d = n => J(path.join(dir, n + '.json'));
  assert.deepStrictEqual(d('results').games, J(path.join(FX, 'results.json')).games);
  assert.ok(!/differences/.test(d('meta').sources), 'standings check should pass: ' + d('meta').sources);
  // player game logs: same rows as the dashboard's verified logs
  for (const t of ['COL', 'TOR', 'VAN', 'NYR']) {
    const want = J(path.join(FX, 'docs', 'logs-' + t + '.json'));
    const got = d('logs-' + t);
    const key = r => r.slice(0, 2).join(':');
    assert.deepStrictEqual(got.sk.slice().sort((a, b) => key(a).localeCompare(key(b))), want.sk.slice().sort((a, b) => key(a).localeCompare(key(b))), 'skater logs ' + t);
    assert.deepStrictEqual(got.gk.length, want.gk.filter(r => r[5] > 0 || r[6]).length, 'goalie logs ' + t);
  }
  // last season priors identical to the ones built straight from the club stats
  const pe = J(path.join(FX, 'priors-expected.json'));
  const pg = d('priors').sk; assert.deepStrictEqual(Object.keys(pg).sort(), Object.keys(pe.sk).sort());
  for (const [pid, v] of Object.entries(pe.sk)) { assert.deepStrictEqual(pg[pid].slice(0, 4), v.slice(0, 4), 'prior ' + pid); assert.ok(Math.abs(pg[pid][4] - v[4]) <= 1, 'ice time ' + pid); } // rounding of half-minutes differs
  assert.deepStrictEqual(d('priors').team, pe.team); assert.deepStrictEqual(d('priors').gk, pe.gk);
  // rosters: every rostered player active on his team
  const P = J(path.join(FX, 'players.json'));
  const players = d('players').players;
  P.teams.forEach((t, i) => P.ros[i].forEach(r => { assert.strictEqual(players[r[0]][1], t); assert.strictEqual(players[r[0]][6], 1); }));
  // schedule and game odds round-trip
  assert.deepStrictEqual(d('schedule').games, J(path.join(FX, 'schedule.json')).games);
  const want = J(path.join(FX, 'odds.json')).games, got = d('odds').games;
  for (const [gid, o] of Object.entries(want)) for (const [bk, b] of Object.entries(o.books)) if (bk !== 'Opener') {
    const g = got[gid] && got[gid].books[bk]; assert.ok(g, `odds ${gid} ${bk}`);
    if (b.ml) assert.deepStrictEqual(g.ml, b.ml, `ml ${gid} ${bk}`);
    if (b.tot) assert.deepStrictEqual(g.tot, b.tot, `tot ${gid} ${bk}`);
  }
  // props for the one game in the replay: consensus line, best over price, names matched to NHL ids
  const props = d('props').games[gameId];
  assert.ok(props, 'props for NYI @ TOR');
  assert.deepStrictEqual(props['8479318'].SOG, [3.5, -115, -115, 'FanDuel']); // Matthews: both books 3.5, FanDuel best over
  assert.deepStrictEqual(props['8479318'].G, [0.5, 150, null, 'DraftKings']);
  assert.deepStrictEqual(props['8479318'].PTS, [0.5, -165, 130, 'FanDuel']);
  assert.ok(props['8477500'].SOG, 'Horvat SOG');
  // the bundled feed holds every document the page reads
  const feed = d('feed');
  for (const k of ['meta', 'teams', 'results', 'schedule', 'odds', 'closing', 'players', 'priors', 'props', 'logs-COL']) assert.ok(feed[k], 'feed has ' + k);
});

test('a second run adds nothing and keeps the data stable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-data-'));
  run(dir);
  const before = J(path.join(dir, 'logs-EDM.json'));
  const { summary } = run(dir);
  assert.strictEqual(summary.resultsAdded, 0);
  assert.strictEqual(summary.boxScoresLoaded, 0);
  const after = J(path.join(dir, 'logs-EDM.json'));
  assert.deepStrictEqual(after.sk, before.sk);
});

test('an Odds API failure keeps the last lines and still saves the NHL data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-data-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-replay-'));
  fs.writeFileSync(path.join(tmp, 'nhl.json'), JSON.stringify(nhlReplay()));
  fs.writeFileSync(path.join(tmp, 'odds.json'), '{}'); // every odds request fails
  const out = execFileSync('node', [path.join(ROOT, 'pipeline', 'refresh.js'), '--data', dir, '--replay', path.join(tmp, 'nhl.json'), '--odds-replay', path.join(tmp, 'odds.json'), '--now', '2026-10-17T16:00:00Z', '--props'], { encoding: 'utf8', env: Object.assign({}, process.env, { ODDS_API_KEY: '', GITHUB_STEP_SUMMARY: '', GITHUB_ACTIONS: '' }) });
  const summary = JSON.parse(out.slice(out.indexOf('{')));
  assert.strictEqual(summary.resultsAdded, 120);
  assert.strictEqual(summary.boxScoresLoaded, 120);
  assert.ok(summary.notes.some(n => /^Odds API problem/.test(n)), 'reports the odds problem');
  assert.match(J(path.join(dir, 'meta.json')).sources, /Odds: not updated this run/);
  assert.deepStrictEqual(J(path.join(dir, 'odds.json')).games, {});
  assert.ok(J(path.join(dir, 'feed.json')).results.games.length === 120);
});
