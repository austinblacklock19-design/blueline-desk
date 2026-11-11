/* Blueline same-game parlay pricer.
   Prices any mix of game legs (moneyline, 60-minute result, puck line, totals, team totals) and player legs
   (goals, points, assists, shots) on one game, with the correlation that comes from the game itself: who wins
   and how, and how many goals each team scores.
   Player legs follow from their team's goal count. Each goal is scored by a player in proportion to his share of
   the team's goals and assisted by others at their assist rates, so two scorers on the same team need a
   high-scoring game, and a road scorer helps the road moneyline. Linemates setting each other up is not
   modelled, so a stack of linemates comes out a little less likely than it really is.
   Works in the browser (window.BLX) and in node (module.exports). */
(function (root) {
  const Q_OT = 0.68;      // share of tied games settled in overtime; the rest go to a shootout, which credits no goal
  const MAX_PLAYERS = 4;  // player legs per team
  const N_GOALS = 16;     // most goals one team is ever given

  // ---------- odds helpers ----------
  const amToDec = a => a == null || isNaN(a) || Math.abs(a) < 100 ? null : (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
  const decToAm = d => !(d > 1) ? null : d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
  // a profit boost multiplies the winnings, not the stake: +6840 with a 30% boost pays +8892
  const boostedDec = (am, boost) => { const d = amToDec(am); return d ? 1 + (d - 1) * (1 + (boost || 0)) : null; };
  // the shortest price (before the boost) at which a bet with chance p clears the given edge
  function minPrice(p, boost, edge) {
    if (!(p > 0)) return null;
    const need = (1 + (edge || 0)) / p;
    return decToAm(1 + (need - 1) / (1 + (boost || 0)));
  }

  // ---------- the game ----------
  // Every way the game can end, from the team model's regulation score grid (pred.matrix[home][away], pred.pOT).
  // hc/ac: goals credited to players (an overtime winner counts, a shootout doesn't);
  // hf/af: the official final score (the shootout winner gets one goal), which settles moneylines, puck lines and totals.
  function outcomes(pred, qOT) {
    qOT = qOT == null ? Q_OT : qOT;
    const m = pred.matrix, n = m.length, pOT = pred.pOT, out = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = m[i][j]; if (!(v > 1e-13)) continue;
      if (i !== j) { out.push({ p: v, hc: i, ac: j, hf: i, af: j, win: i > j ? 'home' : 'away', how: 'REG' }); continue; }
      out.push({ p: v * qOT * pOT, hc: i + 1, ac: j, hf: i + 1, af: j, win: 'home', how: 'OT' });
      out.push({ p: v * qOT * (1 - pOT), hc: i, ac: j + 1, hf: i, af: j + 1, win: 'away', how: 'OT' });
      out.push({ p: v * (1 - qOT) * pOT, hc: i, ac: j, hf: i + 1, af: j, win: 'home', how: 'SO' });
      out.push({ p: v * (1 - qOT) * (1 - pOT), hc: i, ac: j, hf: i, af: j + 1, win: 'away', how: 'SO' });
    }
    return out;
  }
  // distribution of goals credited to each team's players
  function goalDists(pred, qOT) {
    const home = new Array(N_GOALS + 1).fill(0), away = new Array(N_GOALS + 1).fill(0);
    for (const o of outcomes(pred, qOT)) { home[Math.min(o.hc, N_GOALS)] += o.p; away[Math.min(o.ac, N_GOALS)] += o.p; }
    return { home, away };
  }
  function gameLegHits(l, o) {
    const margin = l.side === 'home' ? o.hf - o.af : o.af - o.hf;
    switch (l.kind) {
      case 'ml': return o.win === l.side;
      case 'reg': return o.how === 'REG' && o.win === l.side;
      case 'pl': return margin + l.line > 0;
      case 'total': { const t = o.hf + o.af; return l.side === 'over' ? t > l.line : t < l.line; }
      case 'tt': { const t = l.team === 'home' ? o.hf : o.af; return l.side === 'over' ? t > l.line : t < l.line; }
    }
    throw new Error('unknown leg ' + l.kind);
  }
  const isPlayerLeg = l => l.kind === 'goal' || l.kind === 'point' || l.kind === 'assist' || l.kind === 'sog';

  // Nudge the two expected-goal numbers until the grid matches target chances for the road win and the over
  // (the market blend the dashboard uses). target: {awayWin, over, line}
  function tune(BL, lh, la, target, prm) {
    let p = BL.fromLambdas(lh, la, prm);
    for (let it = 0; it < 150; it++) {
      const dW = target.awayWin != null ? target.awayWin - p.pAway : 0;
      let dO = 0;
      if (target.over != null && target.line != null) { const t = p.total(target.line); dO = target.over - t.over / Math.max(1e-9, 1 - t.push); }
      if (Math.abs(dW) < 1e-6 && Math.abs(dO) < 1e-6) break;
      la *= Math.exp(0.7 * dW + 0.6 * dO); lh *= Math.exp(-0.7 * dW + 0.6 * dO);
      p = BL.fromLambdas(lh, la, prm);
    }
    return p;
  }

  // ---------- players ----------
  const atLeastOnce = (dist, x) => dist.reduce((t, p, n) => t + p * (1 - Math.pow(1 - x, n)), 0);
  function solveRate(dist, target) { // per-goal involvement that gives this chance of at least one
    if (!(target > 0)) return 0;
    let lo = 0, hi = 0.95;
    if (atLeastOnce(dist, hi) < target) return hi;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (atLeastOnce(dist, mid) < target) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  // A player's per-goal rates from his chance of 1+ goals and 1+ points, given his team's goal distribution:
  // s = he scores a given team goal, a = he assists on it. sog: {pmf, q} for shots legs (q = goals per shot).
  function playerRates(teamDist, pGoal, pPoint, sog) {
    const s = solveRate(teamDist, pGoal);
    const u = pPoint != null ? solveRate(teamDist, Math.max(pPoint, pGoal)) : s;
    return { s, a: Math.max(0, u - s), sog: sog || null };
  }
  function binom(n, k, p) { let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1); return c * Math.pow(p, k) * Math.pow(1 - p, n - k); }
  // P(shots >= k | goals = g) for g = 0..gcap (the last entry means gcap or more)
  function shotsGivenGoals(pmf, q, k, gcap) {
    const num = new Array(gcap + 1).fill(0), den = new Array(gcap + 1).fill(0);
    for (let s = 0; s < pmf.length; s++) { const ps = pmf[s]; if (!ps) continue;
      for (let g = 0; g <= s; g++) { const w = ps * binom(s, g, q), gi = Math.min(g, gcap); den[gi] += w; if (s >= k) num[gi] += w; } }
    return num.map((v, i) => den[i] > 0 ? v / den[i] : 1);
  }

  // P(every player leg on one team hits | the team scores n credited goals), for n = 0..N_GOALS
  function teamTable(legs, players) {
    const out = new Float64Array(N_GOALS + 1);
    if (!legs.length) { out.fill(1); return out; }
    const req = new Map();
    for (const l of legs) {
      const r = req.get(l.pid) || { g: 0, a: 0, pt: 0, sog: 0 };
      if (l.kind === 'goal') r.g = Math.max(r.g, l.k || 1);
      if (l.kind === 'assist') r.a = Math.max(r.a, l.k || 1);
      if (l.kind === 'point') r.pt = Math.max(r.pt, l.k || 1);
      if (l.kind === 'sog') r.sog = Math.max(r.sog, l.k || 1);
      req.set(l.pid, r);
    }
    const ids = [...req.keys()];
    if (ids.length > MAX_PLAYERS) throw new Error('At most ' + MAX_PLAYERS + ' players per team');
    const P = ids.map(id => { const x = players[id]; if (!x) throw new Error('No projection for player ' + id); return x; });
    const R = ids.map(id => req.get(id));
    const gc = R.map(r => Math.max(r.g, r.pt, r.sog ? 2 : 0)); // goals tracked up to this many
    const ac = R.map(r => Math.max(r.a, r.pt));               // assists tracked up to this many
    const sogC = R.map((r, i) => r.sog ? shotsGivenGoals(P[i].sog.pmf, P[i].sog.q, r.sog, gc[i]) : null);
    const rad = []; ids.forEach((_, i) => rad.push(gc[i] + 1, ac[i] + 1));
    const S = rad.reduce((x, y) => x * y, 1);
    const decode = st => { const t = []; for (const r of rad) { t.push(st % r); st = Math.floor(st / r); } return t; };
    const encode = t => { let st = 0, mul = 1; for (let i = 0; i < rad.length; i++) { st += t[i] * mul; mul *= rad[i]; } return st; };
    const sOther = Math.max(0, 1 - P.reduce((t, x) => t + x.s, 0));
    const alpha = P.map(x => Math.min(0.95, x.a / Math.max(1e-9, 1 - x.s))); // assists on a goal he didn't score
    const assisters = ids.map((_, i) => i).filter(i => ac[i] > 0);
    const okW = new Float64Array(S);
    for (let st = 0; st < S; st++) {
      const t = decode(st); let w = 1;
      for (let i = 0; i < ids.length && w; i++) {
        const g = t[2 * i], a = t[2 * i + 1], r = R[i];
        if (g < r.g || a < r.a || g + a < r.pt) w = 0; else if (r.sog) w *= sogC[i][Math.min(g, gc[i])];
      }
      okW[st] = w;
    }
    let dist = new Float64Array(S); dist[0] = 1;
    for (let n = 0; n <= N_GOALS; n++) {
      let ok = 0; for (let st = 0; st < S; st++) ok += dist[st] * okW[st];
      out[n] = ok;
      if (n === N_GOALS) break;
      const next = new Float64Array(S);
      for (let st = 0; st < S; st++) {
        const p = dist[st]; if (!p) continue;
        const t = decode(st);
        for (let sc = -1; sc < ids.length; sc++) { // -1: a teammate without a leg scores
          const ps = sc < 0 ? sOther : P[sc].s; if (!(ps > 0)) continue;
          const base = t.slice(); if (sc >= 0) base[2 * sc] = Math.min(base[2 * sc] + 1, gc[sc]);
          const el = assisters.filter(j => j !== sc);
          for (let mask = 0; mask < (1 << el.length); mask++) {
            let pa = 1; const tt = base.slice();
            for (let b = 0; b < el.length; b++) {
              const j = el[b];
              if ((mask >> b) & 1) { pa *= alpha[j]; tt[2 * j + 1] = Math.min(tt[2 * j + 1] + 1, ac[j]); } else pa *= 1 - alpha[j];
            }
            next[encode(tt)] += p * ps * pa;
          }
        }
      }
      dist = next;
    }
    return out;
  }

  // ---------- pricing ----------
  // Chance that every leg hits. legs: [{kind, side, line, team, pid, k}] (see the UI for the full list);
  // players: {pid: playerRates(...)}; player legs carry team: 'home' | 'away'.
  function chance(pred, legs, players, qOT) {
    const game = legs.filter(l => !isPlayerLeg(l));
    const tH = teamTable(legs.filter(l => isPlayerLeg(l) && l.team === 'home'), players);
    const tA = teamTable(legs.filter(l => isPlayerLeg(l) && l.team === 'away'), players);
    let p = 0;
    for (const o of outcomes(pred, qOT)) {
      if (!game.every(l => gameLegHits(l, o))) continue;
      p += o.p * tH[Math.min(o.hc, N_GOALS)] * tA[Math.min(o.ac, N_GOALS)];
    }
    return p;
  }
  // The whole parlay plus, for each leg, its own chance and its chance once the other legs have hit.
  function price(pred, legs, players, qOT) {
    const p = chance(pred, legs, players, qOT);
    const each = legs.map((l, i) => {
      const own = chance(pred, [l], players, qOT);
      const rest = legs.length > 1 ? chance(pred, legs.filter((_, j) => j !== i), players, qOT) : 1;
      return { own, givenOthers: rest > 0 ? p / rest : 0 };
    });
    const indep = each.reduce((t, x) => t * x.own, 1);
    return { p, each, indep, fairAm: decToAm(1 / p) };
  }
  function evaluate(p, am, boost) {
    const d = boostedDec(am, boost);
    return d ? { dec: d, am: decToAm(d), ev: p * d - 1, breakEven: 1 / d } : null;
  }

  const api = { Q_OT, MAX_PLAYERS, amToDec, decToAm, boostedDec, minPrice, outcomes, goalDists, tune, solveRate, playerRates, shotsGivenGoals, teamTable, chance, price, evaluate, isPlayerLeg, gameLegHits };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BLX = api;
})(typeof window !== 'undefined' ? window : this);
