/* Blueline props model: player shots on goal, goals, assists, points and goalie saves.
   Gamma-Poisson style shrinkage of each player's per-60 rates toward last season and his position,
   game context from the team model (opponent shot suppression, expected team goals), negative binomial
   game distributions. Works in the browser (window.BLP) and in node (module.exports). */
(function (root) {
  const DEFAULTS = {
    halfLife: 10,          // a game this many games ago counts half as much as the latest one
    toiPriorGames: 2,      // last season's ice time counts as this many games
    shotPriorMin: 250,     // prior shot rate counts as this many minutes of ice time
    lastShrinkMin: 150,    // last season's rate is pulled toward the position average by this many minutes
    astPriorMin: 300,
    shPriorShots: 120,     // shooting % is pulled toward the position average by this many shots
    teamPriorGames: 12,    // last season's team shot rates count as this many games
    homeShot: 0.02,        // home teams shoot about 2% more
    sogDisp: 10,           // negative binomial size for skater shots (variance = m + m^2/10)
    ptsDisp: 8,
    saDisp: 60,            // shots against a goalie
    svPriorShots: 2000,    // goalie save % is pulled toward league average by this many shots
    pullRate: 0.06,        // chance a starter is pulled; he then faces ~55% of the shots
    propWeight: 0.5        // blend with the market's no-vig price when a line exists
  };
  const MARKETS = {
    SOG: { name: 'Shots on goal', short: 'SOG', lines: [1.5, 2.5, 3.5, 4.5] },
    PTS: { name: 'Points', short: 'PTS', lines: [0.5, 1.5, 2.5] },
    G: { name: 'Anytime goal', short: 'Goal', lines: [0.5] },
    A: { name: 'Assists', short: 'AST', lines: [0.5, 1.5] },
    SV: { name: 'Saves', short: 'Saves', lines: [] }
  };
  const isF = p => p === 'C' || p === 'L' || p === 'R' || p === 'F';

  // ---------- distributions ----------
  function nbPmf(mean, r, max) { // negative binomial with mean and size r
    mean = Math.max(1e-6, mean); max = max || Math.max(12, Math.ceil(mean * 3 + 12));
    const q = mean / (r + mean), out = [Math.pow(r / (r + mean), r)];
    for (let k = 0; k < max; k++) out.push(out[k] * (k + r) / (k + 1) * q);
    return out;
  }
  function poisPmf(mean, max) { mean = Math.max(1e-9, mean); max = max || Math.max(10, Math.ceil(mean * 3 + 10)); const out = [Math.exp(-mean)]; for (let k = 1; k <= max; k++) out.push(out[k - 1] * mean / k); return out; }
  function overUnder(pmf, line) { // P(over), P(under), P(push) for a line like 2.5 or 3
    let o = 0, u = 0, p = 0;
    pmf.forEach((v, k) => { if (k > line + 1e-9) o += v; else if (k < line - 1e-9) u += v; else p += v; });
    const tot = o + u + p; return { over: o / tot, under: u / tot, push: p / tot };
  }
  const mix = (a, b, w) => { const n = Math.max(a.length, b.length), out = []; for (let k = 0; k < n; k++) out.push((1 - w) * (a[k] || 0) + w * (b[k] || 0)); return out; };

  // ---------- rates ----------
  // data = {players:{pid:{n,t,p}}, logs:[{g:gameId,d:date,t:team,o:opp,h:home(0/1),pid,G,A,S,toi(min)}],
  //         glogs:[{g,d,t,o,h,pid,sa,sv,toi,st}], last:{pid:[gp,G,A,S,toiTotalMin]}, lastG:{pid:[gp,gs,sa,sv]},
  //         lastTeam:{T:[gp,sf,sa]}}
  function build(data, prm, beforeDate) {
    prm = Object.assign({}, DEFAULTS, prm || {});
    const logs = beforeDate ? data.logs.filter(x => x.d < beforeDate) : data.logs;
    const glogs = (beforeDate ? data.glogs.filter(x => x.d < beforeDate) : data.glogs).filter(x => x.toi > 0 || x.st); // backups who never played don't count
    // position averages from this season (fall back to typical NHL values)
    const pos = { F: { S: 0, T: 0, G: 0, A: 0 }, D: { S: 0, T: 0, G: 0, A: 0 } };
    for (const x of logs) { const pl = data.players[x.pid]; if (!pl) continue; const k = isF(pl.p) ? 'F' : 'D'; const a = pos[k]; a.S += x.S; a.T += x.toi; a.G += x.G; a.A += x.A; }
    const posRate = {};
    for (const k of ['F', 'D']) {
      const a = pos[k], dflt = k === 'F' ? { s: 7.6, sh: 0.105, a: 1.2, t: 15.2 } : { s: 4.3, sh: 0.05, a: 1.0, t: 20.3 };
      posRate[k] = a.T > 3000 ? { s: a.S / a.T * 60, sh: a.S ? a.G / a.S : dflt.sh, a: a.A / a.T * 60, t: dflt.t } : dflt;
    }
    // per player, newest first
    const by = {};
    for (const x of logs) (by[x.pid] = by[x.pid] || []).push(x);
    const out = {};
    const ids = new Set([...Object.keys(by), ...Object.keys(data.players).filter(id => data.players[id].p !== 'G')]);
    for (const pid of ids) {
      const pl = data.players[pid]; if (!pl || pl.p === 'G') continue;
      const k = isF(pl.p) ? 'F' : 'D', pr = posRate[k];
      const games = (by[pid] || []).slice().sort((a, b) => b.d.localeCompare(a.d) || b.g - a.g);
      let N = 0, T = 0, S = 0, A = 0, Tw = 0, rawS = 0, rawG = 0, rawA = 0, rawT = 0;
      games.forEach((x, i) => { const w = Math.pow(0.5, i / prm.halfLife); N += w; Tw += w * x.toi; T += w * x.toi; S += w * x.S; A += w * x.A; rawS += x.S; rawG += x.G; rawA += x.A; rawT += x.toi; });
      const L = data.last[pid]; // [gp, G, A, S, toiMin]
      const lastToi = L && L[0] >= 5 ? L[4] / L[0] : null;
      const tPrior = lastToi != null ? lastToi : (games.length ? Tw / N : pr.t * 0.8);
      const toi = (Tw + prm.toiPriorGames * tPrior) / (N + prm.toiPriorGames);
      const sLast = L && L[4] > 0 ? (L[3] + pr.s / 60 * prm.lastShrinkMin) / (L[4] + prm.lastShrinkMin) * 60 : pr.s * 0.9;
      const aLast = L && L[4] > 0 ? (L[2] + pr.a / 60 * prm.lastShrinkMin) / (L[4] + prm.lastShrinkMin) * 60 : pr.a * 0.85;
      const rS = (S + sLast / 60 * prm.shotPriorMin) / (T + prm.shotPriorMin) * 60;
      const rA = (A + aLast / 60 * prm.astPriorMin) / (T + prm.astPriorMin) * 60;
      const sh = (rawG + (L ? L[1] : 0) + pr.sh * prm.shPriorShots) / (rawS + (L ? L[3] : 0) + prm.shPriorShots);
      out[pid] = { pid, pos: pl.p, team: pl.t, gp: games.length, toi, rS, rA, sh, lastToi,
        season: { gp: games.length, G: rawG, A: rawA, S: rawS, toi: games.length ? rawT / games.length : 0 },
        recent: games.slice(0, 10).map(x => ({ d: x.d, g: x.g, o: x.o, h: x.h, G: x.G, A: x.A, S: x.S, toi: x.toi })) };
    }
    // team shots for / against this season, blended with last season
    const tg = {};
    const gameTeam = {};
    for (const x of logs) { const key = x.g + ':' + x.t; gameTeam[key] = gameTeam[key] || { t: x.t, o: x.o, sf: 0 }; gameTeam[key].sf += x.S; }
    for (const v of Object.values(gameTeam)) { const a = tg[v.t] = tg[v.t] || { gp: 0, sf: 0, sa: 0 }; a.gp++; a.sf += v.sf; const b = tg[v.o] = tg[v.o] || { gp: 0, sf: 0, sa: 0 }; b.sa += v.sf; }
    const teams = new Set([...Object.keys(tg), ...Object.keys(data.lastTeam || {})]);
    let lsf = 0, ln = 0;
    for (const t of teams) { const l = (data.lastTeam || {})[t]; if (l && l[0]) { lsf += l[1] / l[0]; ln++; } }
    const leagueLast = ln ? lsf / ln : 28.5;
    let curSf = 0, curN = 0; for (const v of Object.values(tg)) { curSf += v.sf; curN += v.gp; }
    const league = (leagueLast * 32 * prm.teamPriorGames + curSf) / (32 * prm.teamPriorGames + curN);
    const team = {};
    for (const t of teams) {
      const c = tg[t] || { gp: 0, sf: 0, sa: 0 }, l = (data.lastTeam || {})[t];
      const pf = l && l[0] ? l[1] / l[0] * league / leagueLast : league, pa = l && l[0] ? l[2] / l[0] * league / leagueLast : league;
      const K = prm.teamPriorGames;
      // shots against are counted only from games where we have the opponent's logs, so use the same gp
      const gpA = Object.values(gameTeam).filter(v => v.o === t).length;
      team[t] = { sf: (c.sf + pf * K) / (c.gp + K), sa: (c.sa + pa * K) / (gpA + K), gp: c.gp };
      team[t].off = team[t].sf / league; team[t].def = team[t].sa / league;
    }
    // goalies
    const gby = {};
    for (const x of glogs) (gby[x.pid] = gby[x.pid] || []).push(x);
    let lgSa = 0, lgSv = 0; for (const x of glogs) { lgSa += x.sa; lgSv += x.sv; }
    for (const v of Object.values(data.lastG || {})) { lgSa += v[2]; lgSv += v[3]; }
    const leagueSv = lgSa > 5000 ? lgSv / lgSa : 0.902;
    const goalies = {};
    for (const [pid, pl] of Object.entries(data.players)) {
      if (pl.p !== 'G') continue;
      const gs = (gby[pid] || []).slice().sort((a, b) => b.d.localeCompare(a.d));
      let sa = 0, sv = 0, starts = 0; for (const x of gs) { sa += x.sa; sv += x.sv; if (x.st) starts++; }
      const L = (data.lastG || {})[pid];
      const svp = (sv + (L ? L[3] : 0) + leagueSv * prm.svPriorShots) / (sa + (L ? L[2] : 0) + prm.svPriorShots);
      goalies[pid] = { pid, team: pl.t, gp: gs.length, starts, sv: svp, season: { gp: gs.length, sa, sv, gs: starts }, last: L || null,
        recent: gs.slice(0, 10).map(x => ({ d: x.d, g: x.g, o: x.o, h: x.h, sa: x.sa, sv: x.sv, st: x.st, toi: x.toi })) };
    }
    return { prm, skaters: out, goalies, team, league, leagueSv, posRate, n: logs.length };
  }

  // ctx: {opp, home (bool), env (expected team goals this game / vs an average opponent)}
  function project(M, pid, ctx) {
    const s = M.skaters[pid]; if (!s) return null;
    const prm = M.prm, opp = M.team[ctx.opp] || { def: 1 };
    const hf = ctx.home ? 1 + prm.homeShot / 2 : 1 - prm.homeShot / 2;
    const env = ctx.env || 1;
    const t = s.toi / 60;
    const sog = s.rS * t * opp.def * hf;
    const g = s.rS * t * s.sh * env;
    const a = s.rA * t * env;
    return { pid, toi: s.toi, sog, g, a, pts: g + a, oppDef: opp.def, env };
  }
  function pmfFor(M, proj, market) {
    const prm = M.prm;
    if (market === 'SOG') return nbPmf(proj.sog, prm.sogDisp);
    if (market === 'G') return poisPmf(proj.g);
    if (market === 'A') return poisPmf(proj.a);
    if (market === 'PTS') return nbPmf(proj.pts, prm.ptsDisp);
    if (market === 'SV') return proj.pmf;
    return null;
  }
  // ctx: {opp, home}; the goalie's team is M.goalies[pid].team
  function projectGoalie(M, pid, ctx) {
    const g = M.goalies[pid]; if (!g) return null;
    const prm = M.prm, opp = M.team[ctx.opp] || { off: 1 }, own = M.team[g.team] || { def: 1 };
    const hf = ctx.home ? 1 - prm.homeShot / 2 : 1 + prm.homeShot / 2; // the opponent is the road team when the goalie is home
    const sa = M.league * opp.off * own.def * hf;
    const full = nbPmf(sa * g.sv, prm.saDisp, Math.ceil(sa * 2 + 20));
    const pulled = nbPmf(sa * g.sv * 0.55, prm.saDisp, Math.ceil(sa * 2 + 20));
    const pmf = mix(full, pulled, prm.pullRate);
    let mean = 0; pmf.forEach((v, k) => mean += v * k);
    return { pid, sa, sv: g.sv, saves: mean, pmf };
  }
  function mainLine(pmf) { // the half-point line whose over is closest to 50%
    let best = 0.5, bd = 9;
    for (let L = 0.5; L < pmf.length - 1; L += 1) { const p = overUnder(pmf, L).over; if (Math.abs(p - 0.5) < bd) { bd = Math.abs(p - 0.5); best = L; } }
    return best;
  }

  // ---------- walk-forward backtest ----------
  // envFor(date, team, opp, home) -> expected goals ratio from the team model at that date
  function backtest(data, prm, envFor) {
    const dates = [...new Set(data.logs.map(x => x.d))].sort();
    const rows = [];
    for (const d of dates.slice(3)) {
      const M = build(data, prm, d);
      for (const x of data.logs.filter(y => y.d === d)) {
        const s = M.skaters[x.pid]; if (!s) continue;
        const pr = project(M, x.pid, { opp: x.o, home: !!x.h, env: envFor ? envFor(d, x.t, x.o, !!x.h) : 1 });
        // naive baseline: season-to-date average (or the position average) as a Poisson mean
        const base = s.gp ? s.season.S / s.gp : M.posRate[isF(s.pos) ? 'F' : 'D'].s * (s.toi / 60);
        const basePts = s.gp ? (s.season.G + s.season.A) / s.gp : 0.45;
        rows.push({ d, pid: x.pid, S: x.S, P: x.G + x.A, G: x.G, toi: x.toi, toiHat: s.toi,
          pS3: overUnder(nbPmf(pr.sog, M.prm.sogDisp), 2.5).over, pS2: overUnder(nbPmf(pr.sog, M.prm.sogDisp), 1.5).over,
          pP1: overUnder(nbPmf(pr.pts, M.prm.ptsDisp), 0.5).over, pG1: 1 - Math.exp(-pr.g),
          bS3: overUnder(poisPmf(Math.max(0.05, base)), 2.5).over, bP1: 1 - Math.exp(-Math.max(0.03, basePts)) });
      }
    }
    const score = (pk, hit) => { let ll = 0, br = 0; for (const r of rows) { const p = Math.min(0.995, Math.max(0.005, r[pk])), y = hit(r) ? 1 : 0; ll += -Math.log(y ? p : 1 - p); br += (p - y) * (p - y); } return { ll: ll / rows.length, brier: br / rows.length }; };
    const n = rows.length;
    return {
      n, rows,
      sog3: { model: score('pS3', r => r.S >= 3), base: score('bS3', r => r.S >= 3), rate: rows.filter(r => r.S >= 3).length / Math.max(1, n) },
      pts1: { model: score('pP1', r => r.P >= 1), base: score('bP1', r => r.P >= 1), rate: rows.filter(r => r.P >= 1).length / Math.max(1, n) },
      goal: { model: score('pG1', r => r.G >= 1), rate: rows.filter(r => r.G >= 1).length / Math.max(1, n) }
    };
  }

  // Adapter: dashboard feed documents -> model input. games: {gameId: {d, a, h}} from results + schedule.
  function fromFeed(docs, games) {
    const players = {}, logs = [], glogs = [];
    const pl = (docs.players && docs.players.players) || {};
    for (const [pid, v] of Object.entries(pl)) players[pid] = { n: v[0], t: v[1], p: v[2], no: v[3], sh: v[4], bd: v[5], act: v[6] };
    for (const [id, d] of Object.entries(docs)) {
      if (!id.startsWith('logs-') || !d) continue;
      const t = d.team || id.slice(5);
      for (const r of d.sk || []) { const g = games[r[0]]; if (!g) continue; const home = g.h === t;
        logs.push({ g: r[0], d: g.d, t, o: home ? g.a : g.h, h: home ? 1 : 0, pid: String(r[1]), G: r[2], A: r[3], S: r[4], toi: r[5] / 60, ppg: r[6], hit: r[7], blk: r[8] }); }
      for (const r of d.gk || []) { const g = games[r[0]]; if (!g) continue; const home = g.h === t;
        glogs.push({ g: r[0], d: g.d, t, o: home ? g.a : g.h, h: home ? 1 : 0, pid: String(r[1]), sa: r[2], sv: r[3], ga: r[4], toi: r[5] / 60, st: r[6] }); }
    }
    const pr = docs.priors || {};
    return { players, logs, glogs, last: pr.sk || {}, lastG: pr.gk || {}, lastTeam: pr.team || {} };
  }

  const api = { fromFeed, DEFAULTS, MARKETS, nbPmf, poisPmf, overUnder, build, project, projectGoalie, pmfFor, mainLine, backtest, isF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BLP = api;
})(typeof window !== 'undefined' ? window : globalThis);
