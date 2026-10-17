/* Blueline model: opponent-adjusted Poisson goals model for NHL games.
   Works in the browser (window.BL) and in node (module.exports). */
(function (root) {
  const DEFAULTS = {
    priorGames: 20,     // weight of last season's rating, in games
    regress: 0.30,      // pull last season toward league average over the summer
    halfLife: 15,       // recent games count more; half-weight after this many games
    homeAdv: 0.05,      // home team scores ~5% more, road team ~5% less (split evenly)
    b2b: 0.04,          // back-to-back: 4% fewer goals for, 4% more against
    tieBoost: 1.35,     // NHL games tie after 60 min (~22%) more often than pure Poisson says
    eng: 0.18,          // share of 1-goal regulation leads that become 2 via empty net
    otShrink: 0.5,      // OT/SO is closer to a coin flip than regulation
    marketWeight: 0.5,  // blend: 1 = model only, 0 = market only
    minEdge: 0.02,      // minimum EV to flag a bet
    kelly: 0.25,        // fraction of full Kelly
    kellyCap: 0.03      // never stake more than 3% of bankroll
  };

  // ---------- odds helpers ----------
  const amToDec = a => a == null || isNaN(a) ? null : (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
  const amToProb = a => { const d = amToDec(a); return d ? 1 / d : null; };
  const probToAm = p => { if (!p || p <= 0 || p >= 1) return null; return p >= 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p); };
  const fmtAm = a => a == null ? '—' : (a > 0 ? '+' + a : '' + a);
  function noVig(a, b) { // two-way prices -> fair probabilities (multiplicative)
    const pa = amToProb(a), pb = amToProb(b);
    if (pa == null || pb == null) return null;
    const s = pa + pb; return { a: pa / s, b: pb / s, hold: s - 1 };
  }
  function ev(p, am) { const d = amToDec(am); return d ? p * d - 1 : null; }
  function kellyStake(p, am, prm) {
    const d = amToDec(am); if (!d) return 0;
    const f = (p * d - 1) / (d - 1);
    return Math.max(0, Math.min(prm.kellyCap, f * prm.kelly));
  }

  // ---------- schedule helpers ----------
  const dayBefore = d => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
  function playedOn(games, team, date) { return games.some(g => g.date === date && (g.away === team || g.home === team)); }

  // ---------- ratings ----------
  // results: [{date, away, home, as, hs, per}] ; last: {T:{gp,gf,ga}}
  function buildRatings(teamList, last, results, prm, beforeDate) {
    prm = Object.assign({}, DEFAULTS, prm || {});
    const games = beforeDate ? results.filter(g => g.date < beforeDate) : results.slice();
    // league scoring level: last season blended with this season's games
    let lg = 0, lgN = 0;
    for (const t of teamList) { const l = last[t]; if (l) { lg += l.gf; lgN += l.gp; } }
    const muLast = lgN ? lg / lgN : 3.0;
    let cur = 0; for (const g of games) cur += g.as + g.hs;
    const curN = games.length * 2;
    const mu = (muLast * 300 + cur) / (300 + curN); // ~150 games of prior on league level
    const R = {};
    for (const t of teamList) {
      const l = last[t];
      const aP = l ? 1 + (((l.gf / l.gp) / muLast) - 1) * (1 - prm.regress) : 1;
      const dP = l ? 1 + (((l.ga / l.gp) / muLast) - 1) * (1 - prm.regress) : 1;
      R[t] = { att: aP, def: dP, attPrior: aP, defPrior: dP, gp: 0 };
    }
    // per team game list, newest first, for recency weights
    const byTeam = {};
    for (const t of teamList) byTeam[t] = [];
    for (const g of games) {
      if (byTeam[g.away]) byTeam[g.away].push({ g, home: false });
      if (byTeam[g.home]) byTeam[g.home].push({ g, home: true });
    }
    for (const t of teamList) { byTeam[t].sort((x, y) => y.g.date.localeCompare(x.g.date)); R[t].gp = byTeam[t].length; }
    const hA = 1 + prm.homeAdv / 2, hR = 1 - prm.homeAdv / 2;
    for (let it = 0; it < 25; it++) {
      const next = {};
      for (const t of teamList) {
        let nA = prm.priorGames * R[t].attPrior, nD = prm.priorGames * R[t].defPrior, wS = prm.priorGames;
        byTeam[t].forEach((x, i) => {
          const w = Math.pow(0.5, i / prm.halfLife);
          const opp = x.home ? x.g.away : x.g.home;
          const gf = x.home ? x.g.hs : x.g.as, ga = x.home ? x.g.as : x.g.hs;
          const vF = x.home ? hA : hR, vA = x.home ? hR : hA;
          const o = R[opp] || { att: 1, def: 1 };
          nA += w * gf / (mu * o.def * vF);
          nD += w * ga / (mu * o.att * vA);
          wS += w;
        });
        next[t] = { att: nA / wS, def: nD / wS };
      }
      // normalise so the league average is exactly 1
      let sa = 0, sd = 0; for (const t of teamList) { sa += next[t].att; sd += next[t].def; }
      sa /= teamList.length; sd /= teamList.length;
      for (const t of teamList) { R[t].att = next[t].att / sa; R[t].def = next[t].def / sd; }
    }
    for (const t of teamList) R[t].power = Math.round(100 * (R[t].att / R[t].def - 1) * 10) / 10; // % better than avg
    return { mu, R, n: games.length };
  }

  // ---------- poisson ----------
  function poisson(l, max) { const p = [Math.exp(-l)]; for (let k = 1; k <= max; k++) p.push(p[k - 1] * l / k); return p; }

  // ctx: {away, home, awayB2B, homeB2B, awayGoalie, homeGoalie}; goalie = goals saved vs avg per game
  function predict(rt, ctx, prm) {
    prm = Object.assign({}, DEFAULTS, prm || {});
    const A = rt.R[ctx.away], H = rt.R[ctx.home];
    if (!A || !H) return null;
    const hA = 1 + prm.homeAdv / 2, hR = 1 - prm.homeAdv / 2;
    // ratings are built on final scores, which include the OT/SO winner and empty-net
    // goals; strip those (~0.27 goals a game) so the regulation model doesn't count them twice
    const reg = 1 - 0.27 / (2 * rt.mu);
    let lh = rt.mu * H.att * A.def * hA * reg;
    let la = rt.mu * A.att * H.def * hR * reg;
    if (ctx.homeB2B) { lh *= 1 - prm.b2b; la *= 1 + prm.b2b; }
    if (ctx.awayB2B) { la *= 1 - prm.b2b; lh *= 1 + prm.b2b; }
    la = Math.max(0.6, la - (ctx.homeGoalie || 0));
    lh = Math.max(0.6, lh - (ctx.awayGoalie || 0));
    const M = 12, ph = poisson(lh, M), pa = poisson(la, M);
    // regulation matrix m[h][a]
    let m = [], s = 0;
    for (let i = 0; i <= M; i++) { m.push([]); for (let j = 0; j <= M; j++) { let v = ph[i] * pa[j]; if (i === j) v *= prm.tieBoost; m[i].push(v); s += v; } }
    for (let i = 0; i <= M; i++) for (let j = 0; j <= M; j++) m[i][j] /= s;
    // empty-net shift: some 1-goal leads become 2-goal leads
    const m2 = m.map(r => r.slice());
    for (let i = 0; i <= M; i++) for (let j = 0; j <= M; j++) {
      if (i - j === 1 && i < M) { const x = m[i][j] * prm.eng; m2[i][j] -= x; m2[i + 1][j] += x; }
      if (j - i === 1 && j < M) { const x = m[i][j] * prm.eng; m2[i][j] -= x; m2[i][j + 1] += x; }
    }
    m = m2;
    let regH = 0, regA = 0, tie = 0, hBy2 = 0, aBy2 = 0;
    const totReg = new Array(2 * M + 2).fill(0); // final total incl. OT/SO goal
    for (let i = 0; i <= M; i++) for (let j = 0; j <= M; j++) {
      const v = m[i][j];
      if (i > j) regH += v; else if (j > i) regA += v; else tie += v;
      if (i - j >= 2) hBy2 += v; if (j - i >= 2) aBy2 += v;
      totReg[i + j + (i === j ? 1 : 0)] += v;
    }
    const share = lh / (lh + la);
    const pOT = 0.5 + (share - 0.5) * prm.otShrink;
    const pHome = regH + tie * pOT, pAway = regA + tie * (1 - pOT);
    function total(line) { // returns {over, under, push}
      let o = 0, u = 0, p = 0;
      totReg.forEach((v, k) => { if (k > line) o += v; else if (k < line) u += v; else p += v; });
      return { over: o, under: u, push: p };
    }
    // most likely final scores (regulation result, ties shown as OT)
    const scores = [];
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) scores.push({ h: i, a: j, p: m[i][j] });
    scores.sort((x, y) => y.p - x.p);
    return {
      lh, la, xTotal: lh + la + tie, pHome, pAway, regH, regA, tie, pOT,
      homeMinus15: hBy2, awayPlus15: 1 - hBy2, awayMinus15: aBy2, homePlus15: 1 - aBy2,
      total, totals: totReg, matrix: m, topScores: scores.slice(0, 6)
    };
  }

  // Evaluate every market for one game against a book line set.
  // book: {ml:[a,h], tot:[line,o,u], pl:[awayLine, awayPrice, homeLine, homePrice]}
  function evaluate(pred, book, prm) {
    prm = Object.assign({}, DEFAULTS, prm || {});
    const out = [];
    if (!pred || !book) return out;
    const w = prm.marketWeight;
    function add(market, side, label, pModel, price, pairPrice, extra) {
      if (price == null) return;
      const fair = pairPrice != null ? noVig(price, pairPrice) : null;
      const pMkt = fair ? fair.a : amToProb(price);
      const p = w * pModel + (1 - w) * pMkt;
      const e = ev(p, price);
      out.push(Object.assign({ market, side, label, pModel, pMkt, p, price, ev: e, edge: p - pMkt, kelly: kellyStake(p, price, prm), hold: fair ? fair.hold : null }, extra || {}));
    }
    if (book.ml) {
      add('ML', 'away', 'away', pred.pAway, book.ml[0], book.ml[1]);
      add('ML', 'home', 'home', pred.pHome, book.ml[1], book.ml[0]);
    }
    if (book.pl) {
      const [al, ap, hl, hp] = book.pl;
      const pa = al < 0 ? pred.awayMinus15 : pred.awayPlus15;
      const ph = hl < 0 ? pred.homeMinus15 : pred.homePlus15;
      add('PL', 'away', 'away ' + (al > 0 ? '+' : '') + al, pa, ap, hp, { line: al });
      add('PL', 'home', 'home ' + (hl > 0 ? '+' : '') + hl, ph, hp, ap, { line: hl });
    }
    if (book.tot) {
      const [line, o, u] = book.tot; const t = pred.total(line);
      const dn = 1 - t.push; // grade pushes as refunds: condition on no push
      add('TOT', 'over', 'Over ' + line, t.over / dn, o, u, { line });
      add('TOT', 'under', 'Under ' + line, t.under / dn, u, o, { line });
    }
    return out;
  }

  // Best price for each side across books
  function bestLines(books) {
    const best = { ml: [null, null], tot: {}, pl: {} };
    for (const [bk, b] of Object.entries(books || {})) {
      if (b.ml) for (let k = 0; k < 2; k++) if (b.ml[k] != null && (best.ml[k] == null || amToDec(b.ml[k]) > amToDec(best.ml[k].price))) best.ml[k] = { price: b.ml[k], book: bk };
      if (b.tot) { const L = b.tot[0]; best.tot[L] = best.tot[L] || [null, null];
        for (let k = 0; k < 2; k++) { const pr = b.tot[k + 1]; if (pr != null && (best.tot[L][k] == null || amToDec(pr) > amToDec(best.tot[L][k].price))) best.tot[L][k] = { price: pr, book: bk }; } }
      if (b.pl) { const key = b.pl[0] + '/' + b.pl[2]; best.pl[key] = best.pl[key] || [null, null];
        for (let k = 0; k < 2; k++) { const pr = b.pl[k * 2 + 1]; if (pr != null && (best.pl[key][k] == null || amToDec(pr) > amToDec(best.pl[key][k].price))) best.pl[key][k] = { price: pr, book: bk }; } }
    }
    return best;
  }

  // Walk-forward backtest of the moneyline model on finished games
  function backtest(teamList, last, results, prm) {
    const dates = [...new Set(results.map(g => g.date))].sort();
    let n = 0, hits = 0, ll = 0, br = 0, llBase = 0;
    const rows = [];
    for (const d of dates) {
      const rt = buildRatings(teamList, last, results, prm, d);
      for (const g of results.filter(x => x.date === d)) {
        const pr = predict(rt, { away: g.away, home: g.home, homeB2B: playedOn(results, g.home, dayBefore(d)), awayB2B: playedOn(results, g.away, dayBefore(d)) }, prm);
        if (!pr) continue;
        const hw = g.hs > g.as ? 1 : 0, p = pr.pHome;
        n++; if ((p >= 0.5) === (hw === 1)) hits++;
        ll += -Math.log(hw ? p : 1 - p); llBase += -Math.log(hw ? 0.535 : 0.465);
        br += (p - hw) * (p - hw);
        rows.push({ id: g.id, date: d, away: g.away, home: g.home, pHome: p, homeWon: hw, as: g.as, hs: g.hs, xTotal: pr.xTotal });
      }
    }
    return { n, acc: n ? hits / n : 0, logLoss: n ? ll / n : 0, logLossBase: n ? llBase / n : 0, brier: n ? br / n : 0, rows };
  }

  const api = { DEFAULTS, amToDec, amToProb, probToAm, fmtAm, noVig, ev, kellyStake, dayBefore, playedOn, buildRatings, predict, evaluate, bestLines, backtest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BL = api;
})(typeof window !== 'undefined' ? window : globalThis);
