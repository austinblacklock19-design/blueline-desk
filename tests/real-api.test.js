'use strict';
// Parsers against real NHL API responses captured on 2026-10-17 (tests/fixtures/real/_all.json).
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const NHL = require('../pipeline/lib/nhl');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'real', '_all.json'), 'utf8')).out;

test('score pages: finals with scores and how they ended', () => {
  const g = NHL.parseScore(A['/v1/score/2026-10-16'], '2026-10-16');
  assert.deepStrictEqual(g.map(x => [x.id, x.away, x.home, x.as, x.hs, x.per, x.state]), [[2026020119, 'PIT', 'COL', 2, 5, 'REG', 'OFF'], [2026020120, 'BOS', 'ANA', 4, 2, 'REG', 'OFF']]);
  const today = NHL.parseScore(A['/v1/score/2026-10-17'], '2026-10-17');
  assert.strictEqual(today.length, 14);
  assert.ok(today.every(x => x.type === 2 && x.date === '2026-10-17'));
});

test('schedule: upcoming games only', () => {
  const s = NHL.parseSchedule(A['/v1/schedule/2026-10-17']);
  assert.ok(s.length > 30);
  assert.ok(s.every(r => r.length === 6 && /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r[2].endsWith('Z')));
});

test('standings: now and last season', () => {
  const now = NHL.parseStandings(A['/v1/standings/now']), last = NHL.parseStandings(A['/v1/standings/2026-04-16']);
  assert.strictEqual(Object.keys(now).length, 32);
  assert.deepStrictEqual(last.COL, { name: 'Colorado Avalanche', conf: 'Western', div: 'Central', gp: 82, w: 55, l: 16, otl: 11, pts: 121, gf: 302, ga: 203 });
});

test('box score, roster and club stats', () => {
  const b = NHL.parseBox(A['/v1/gamecenter/2026020120/boxscore']);
  assert.deepStrictEqual([b.a, b.as, b.h, b.hs, b.per], ['BOS', 4, 'ANA', 2, 'REG']);
  assert.strictEqual(b.sk.length, 36); assert.deepStrictEqual(NHL.checkBox(b), []);
  const r = NHL.parseRoster(A['/v1/roster/COL/current']);
  assert.ok(r.length >= 20 && r.every(p => p[6].startsWith('https://assets.nhle.com/')));
  const cs = NHL.parseClubStats(A['/v1/club-stats/COL/20252026/2']);
  assert.deepStrictEqual(cs.sk.find(p => p[0] === 8470613).slice(0, 7), [8470613, 'Brent Burns', 'D', 82, 12, 23, 172]);
});
