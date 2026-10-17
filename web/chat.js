// ---------- chat assistant ----------
const CHAT_KEY = 'bl.chat.v1';
const C = Object.assign({ open: false, turns: [], ui: [], busy: false, ctl: null }, (() => { const v = lsGet(CHAT_KEY, null); return v ? { turns: v.turns || [], ui: v.ui || [] } : {}; })());
let chatTools = null; // null = unknown, true/false after limits()
function chatSave() { lsSet(CHAT_KEY, { turns: C.turns.slice(-20), ui: C.ui.slice(-40) }); }

const CHAT_RULES = `You are the assistant inside "Blueline Desk", an NHL betting dashboard. You help the person find bets, understand the numbers, size stakes, and record bets in their tracker.
Rules:
- Use only the LIVE DATA and tool results. Never invent lines, injuries, goalies or stats. If something isn't in the data, say you don't have it.
- You cannot place bets at a sportsbook. You CAN put a bet slip in front of the person with propose_bet; they confirm it to record it in My Bets, then place it with their own book. Call propose_bet only when they ask for a bet, a card, or agree to one you suggested. One call per bet.
- EV = blended win probability × decimal odds − 1, at the best available price. "Blend" mixes the model and the no-vig market by the weight in the data. A bet is "value" when EV clears the person's value bar.
- Stakes: use the Kelly stake in the data (it already applies their Kelly fraction and cap). If they want to chase losses, bet more than the cap, or bet money they can't afford, push back plainly and suggest a smaller stake.
- Early-season samples are small; say so when it matters. Never promise a result.
- Be brief: under 140 words unless asked for more. Bullets for lists. American odds. Name the game like "PIT @ COL".
- Player props (shots on goal, points, anytime goal, assists, goalie saves): the PROPS section lists the model's top projections. Use player_report for one player's projection, every line and his game log, and price_prop to price a specific line and price. If no book line is loaded, give the fair price and ask what their book offers.
- Prop bets are void if the player doesn't play (or the goalie doesn't start); say so when it matters.
- If gambling seems to be causing problems, mention 1-800-GAMBLER. This tool is for adults of legal betting age.`;

function chatData() {
  const today = localDate();
  const dates = [...new Set(D.gamesArr.filter(g => !g.final && g.date >= today).map(g => g.date))].sort().slice(0, 2);
  const slate = dates.map(d => '## ' + fmtDay(d, true) + '\n' + D.gamesArr.filter(g => g.date === d && !g.final).map(g => {
    const { pred, ctx } = predFor(g); const b = brief(g.id); const A = D.stats[g.away], H = D.stats[g.home];
    const mk = marketsFor(g).map(m => `${m.label} ${BL.fmtAm(m.best.price)} @${m.best.book} model ${pct(m.pModel, 0)} mkt ${pct(m.pFair, 0)} EV ${sgnPct(m.ev)}${m.kelly * (S.ledger.bankroll || 0) >= 0.5 ? ' kelly ' + money(m.kelly * S.ledger.bankroll) : ''}`).join('; ');
    const gl = b && b.goalies ? ` Goalies: ${['away', 'home'].map(sd => b.goalies[sd] ? g[sd] + ' ' + b.goalies[sd].name + ' (' + b.goalies[sd].status + ')' : '').filter(Boolean).join(', ')}.` : '';
    return `- [${g.id}] ${g.away} (${A.w}-${A.l}-${A.otl}) @ ${g.home} (${H.w}-${H.l}-${H.otl}) ${fmtTime(g.start)}. Model ${g.away} ${pct(pred.pAway, 0)} / ${g.home} ${pct(pred.pHome, 0)}, xG ${pred.la.toFixed(2)}-${pred.lh.toFixed(2)}${ctx.awayB2B ? ', ' + g.away + ' on B2B' : ''}${ctx.homeB2B ? ', ' + g.home + ' on B2B' : ''}. Lines: ${mk || 'not posted yet'}.${gl}`;
  }).join('\n')).join('\n');
  const last = D.gamesArr.filter(g => g.final).slice(-12).map(g => `${g.away} ${g.final.as}-${g.final.hs} ${g.home}${g.final.per !== 'REG' ? ' ' + g.final.per : ''}`).join('; ');
  const pw = D.teams.slice().sort((a, b) => D.rtNow.R[b].power - D.rtNow.R[a].power);
  const bets = S.ledger.bets.map(b => ({ b, st: gradeBet(b) }));
  const settled = bets.filter(x => x.st !== 'open' && x.st !== 'void');
  const pnl = settled.reduce((a, x) => a + betPnl(x.b, x.st), 0);
  const open = bets.filter(x => x.st === 'open').slice(-10).map(x => `${x.b.label} (${x.b.away} @ ${x.b.home}) ${BL.fmtAm(x.b.price)} ${money(x.b.stake)}`).join('; ');
  const g = S.open && D.allGames[S.open];
  return [
    `Now: ${new Date().toLocaleString()}. Person is on the "${S.tab}" tab${g ? ', looking at ' + g.away + ' @ ' + g.home + ' [' + g.id + ']' : ''}.`,
    `Their settings: model weight ${Math.round(S.params.marketWeight * 100)}%, value bar ${pct(S.params.minEdge, 1)} EV, ${Math.round(S.params.kelly * 100)}% Kelly capped at ${pct(S.params.kellyCap, 1)}. Bankroll ${money(S.ledger.bankroll || 0)}, unit ${money(S.ledger.unit || 0)}.`,
    `Their bets: ${settled.filter(x => x.st === 'won').length}-${settled.filter(x => x.st === 'lost').length} settled, P/L ${sMoney(pnl)}. Open: ${open || 'none'}.`,
    `Power ratings (% vs average): top ${pw.slice(0, 5).map(t => t + ' ' + D.rtNow.R[t].power).join(', ')}; bottom ${pw.slice(-5).map(t => t + ' ' + D.rtNow.R[t].power).join(', ')}.`,
    `Recent finals: ${last}.`,
    S.feed.brief && S.feed.brief.summary && dates.includes(S.feed.brief.date) ? `Brief for ${fmtDay(S.feed.brief.date, true)}: ${S.feed.brief.headline}. ${S.feed.brief.summary}` : '',
    'SLATE (game ids in brackets):\n' + (slate || 'No upcoming games loaded.'),
    chatProps(dates[0])
  ].filter(Boolean).join('\n');
}

function chatProps(date) {
  if (!date || !PP()) return '';
  const games = D.gamesArr.filter(g => g.date === date && !g.final);
  const rows = games.flatMap(g => gameProps(g) || []);
  const sk = rows.filter(r => !r.goalie), gk = rows.filter(r => r.goalie);
  const fmt = r => `${playerInfo(r.pid).n} (${r.team} vs ${r.opp}, id ${r.pid})`;
  const withLines = rows.flatMap(r => Object.entries(r.mk).filter(([, e]) => e.book).map(([m, e]) => ({ r, m, e, best: bestEdge(r, m) }))).filter(x => x.best).sort((a, b) => b.best.ev - a.best.ev).slice(0, 8);
  return 'PROPS for ' + fmtDay(date, true) + ':\n' +
    '- Most shots: ' + sk.slice().sort((a, b) => b.mean.SOG - a.mean.SOG).slice(0, 8).map(r => `${fmt(r)} ${r.mean.SOG.toFixed(2)} SOG, o${r.mk.SOG.line} ${pct(r.mk.SOG.pO, 0)} fair ${BL.fmtAm(r.mk.SOG.fairO)}`).join('; ') + '\n' +
    '- Likeliest point: ' + sk.slice().sort((a, b) => b.mk.PTS.pO - a.mk.PTS.pO).slice(0, 8).map(r => `${fmt(r)} ${pct(r.mk.PTS.pO, 0)} fair ${BL.fmtAm(r.mk.PTS.fairO)}`).join('; ') + '\n' +
    '- Likeliest goal: ' + sk.slice().sort((a, b) => b.mk.G.pO - a.mk.G.pO).slice(0, 8).map(r => `${fmt(r)} ${pct(r.mk.G.pO, 0)} fair ${BL.fmtAm(r.mk.G.fairO)}`).join('; ') + '\n' +
    '- Goalies: ' + gk.map(r => `${fmt(r)} ${r.status} ${r.mean.SV.toFixed(1)} saves, o${r.mk.SV.line} ${pct(r.mk.SV.pO, 0)}`).join('; ') + '\n' +
    '- Book prop lines with the best EV: ' + (withLines.length ? withLines.map(x => `${propLabel(x.r.pid, x.m, x.best.side, x.e.line)} at ${BL.fmtAm(x.best.side === 'under' ? x.e.book.under : x.e.book.over)} (${x.e.book.book}) EV ${sgnPct(x.best.ev)}`).join('; ') : 'none loaded yet');
}
function findPlayer(q) { // name, last name or id among players in upcoming games
  if (!PP()) return null; const games = D.gamesArr.filter(g => !g.final).slice(0, 40);
  const cands = []; for (const g of games) for (const r of gameProps(g) || []) cands.push(r);
  const qs = norm(q), id = String(q).replace(/\D/g, '');
  return cands.find(r => r.pid === id) || cands.find(r => norm(playerInfo(r.pid).n) === qs) || cands.find(r => norm(playerInfo(r.pid).n).split(' ').pop() === qs.split(' ').pop() && (qs.split(' ').length < 2 || norm(playerInfo(r.pid).n)[0] === qs[0])) || cands.find(r => norm(playerInfo(r.pid).n).includes(qs)) || null;
}
const MKT_ALIAS = { sog: 'SOG', shots: 'SOG', 'shots on goal': 'SOG', points: 'PTS', pts: 'PTS', point: 'PTS', goal: 'G', goals: 'G', 'anytime goal': 'G', anytime: 'G', assists: 'A', assist: 'A', ast: 'A', saves: 'SV', sv: 'SV' };
function findGame(id) { id = String(id).replace(/\D/g, ''); return D.allGames[id] || null; }
function chatToolDefs() {
  return [
    { name: 'game_detail', description: 'Full breakdown of one game: team stats, splits, head to head, goalie notes, every market with model/market/EV, and prices at every book. Use before recommending a specific game.',
      inputSchema: { type: 'object', properties: { gameId: { type: 'string', description: 'Game id from the slate, e.g. 2026020119' } }, required: ['gameId'] },
      execute: ({ gameId }) => { const g = findGame(gameId); if (!g) throw new Error('No game with id ' + gameId);
        chatNote('Looked at ' + g.away + ' @ ' + g.home);
        const books = Object.entries(booksFor(g)).filter(([k]) => k !== 'Opener').map(([k, x]) => `${k}: ${x.ml ? 'ML ' + BL.fmtAm(x.ml[0]) + '/' + BL.fmtAm(x.ml[1]) : ''}${x.pl ? ' PL ' + g.away + (x.pl[0] > 0 ? '+' : '') + x.pl[0] + ' ' + BL.fmtAm(x.pl[1]) + '/' + BL.fmtAm(x.pl[3]) : ''}${x.tot ? ' O/U ' + x.tot[0] + ' ' + BL.fmtAm(x.tot[1]) + '/' + BL.fmtAm(x.tot[2]) : ''}`).join('\n');
        return gameContext(g) + '\nBooks:\n' + (books || 'none'); } },
    { name: 'team_report', description: 'One team\'s season: record, scoring, splits, last 10 results, betting trends and upcoming games with model odds.',
      inputSchema: { type: 'object', properties: { team: { type: 'string', description: 'Three-letter code, e.g. COL' } }, required: ['team'] },
      execute: ({ team }) => { const t = String(team).toUpperCase().trim(); const x = D.stats[t]; if (!x) throw new Error('Unknown team ' + team); const r = D.rtNow.R[t];
        chatNote('Pulled the ' + teamName(t) + ' report');
        const per = k => x.gp ? (x[k] / x.gp) : 0;
        const up = D.gamesArr.filter(g => !g.final && (g.away === t || g.home === t)).slice(0, 5).map(g => { const { pred } = predFor(g); const hm = g.home === t; return `${g.date} ${hm ? 'vs' : '@'} ${hm ? g.away : g.home} [${g.id}] model ${pct(hm ? pred.pHome : pred.pAway, 0)}`; }).join('; ');
        return `${teamName(t)}: ${x.w}-${x.l}-${x.otl}, ${x.pts} pts, GF/G ${per('gf').toFixed(2)}, GA/G ${per('ga').toFixed(2)}, home ${x.hw}-${x.hl}-${x.hot}, road ${x.rw}-${x.rl}-${x.rot}, L10 ${x.l10.join('-')}, streak ${x.streak}. Power ${r.power}% (att ${r.att.toFixed(2)}, def ${r.def.toFixed(2)}). Luck ${sgnPct(x.luck, 0)}. Over 6.5 in ${pct(per('o65'), 0)}, +1.5 covered ${pct(per('p15'), 0)}, won by 2+ ${pct(per('m15'), 0)}, OT ${pct(per('otg'), 0)}. Last 10: ${x.log.slice(-10).map(g => (g.home ? 'vs ' : '@ ') + g.opp + ' ' + g.res + ' ' + g.gf + '-' + g.ga).join(', ')}. Last season ${x.last ? x.last.w + '-' + x.last.l + '-' + x.last.otl : 'n/a'}. Upcoming: ${up || 'none loaded'}.`; } },
    { name: 'propose_bet', description: 'Show the person a bet slip they can confirm to record in My Bets. Does not place anything at a sportsbook. Price defaults to the best available; stake defaults to the Kelly stake (or one unit).',
      inputSchema: { type: 'object', properties: {
        gameId: { type: 'string' }, market: { type: 'string', enum: ['ML', 'PL', 'TOT'] }, side: { type: 'string', enum: ['away', 'home', 'over', 'under'] },
        stake: { type: 'number', description: 'Dollars. Optional.' }, price: { type: 'number', description: 'American odds if the person named a specific price. Optional.' }, why: { type: 'string', description: 'One short sentence shown on the slip.' } }, required: ['gameId', 'market', 'side'] },
      execute: (inp) => { const g = findGame(inp.gameId); if (!g) throw new Error('No game with id ' + inp.gameId); if (g.final) throw new Error('That game is already final.');
        const m = marketsFor(g).find(x => x.market === inp.market && x.side === inp.side);
        if (!m) throw new Error('No ' + inp.market + ' ' + inp.side + ' line is posted for that game.');
        const price = inp.price && Math.abs(inp.price) >= 100 ? Math.round(inp.price) : m.best.price;
        const bank = S.ledger.bankroll || 0, cap = bank * S.params.kellyCap;
        let stake = inp.stake > 0 ? inp.stake : Math.round(m.kelly * bank) || S.ledger.unit || 10;
        const capped = cap > 0 && stake > cap; if (capped) stake = Math.floor(cap);
        const ev = BL.ev(m.p, price);
        pushUi({ kind: 'slip', id: 's' + Date.now().toString(36), status: 'pending', gameId: g.id, market: m.market, side: m.side, line: m.line, label: m.label, matchup: g.away + ' @ ' + g.home, date: g.date, price, book: price === m.best.price ? m.best.book : '', stake, p: m.p, ev, why: inp.why || '' });
        chatSave(); renderChatLog();
        return { shown: true, label: m.label, price: BL.fmtAm(price), stake: money(stake), ev: sgnPct(ev), stakeCappedToMax: capped, note: 'The person must tap Save on the slip to record it.' }; } },
    { name: 'player_report', description: 'One player in an upcoming game: projection (ice time, shots, goals, assists or goalie saves), model probability and fair price for every common prop line, any book line with EV, and his last 10 games.',
      inputSchema: { type: 'object', properties: { player: { type: 'string', description: 'Player name, e.g. "Auston Matthews", or his id' } }, required: ['player'] },
      execute: ({ player }) => { const r = findPlayer(player); if (!r) throw new Error('No player named ' + player + ' in an upcoming game. Check the spelling, or he may be out of the lineup.');
        chatNote('Pulled ' + playerInfo(r.pid).n + '\'s props');
        const lines = Object.entries(r.pmf).map(([m, pmf]) => { const ls = m === 'SV' ? [r.mk.SV.line - 1, r.mk.SV.line, r.mk.SV.line + 1] : m === 'SOG' ? [1.5, 2.5, 3.5, 4.5] : m === 'PTS' ? [0.5, 1.5] : m === 'A' ? [0.5, 1.5] : [0.5];
          return PM[m].name + ': ' + ls.map(L => { const e = propEval(pmf, L, null); return (m === 'G' ? 'anytime' : 'o' + L) + ' ' + pct(e.pO, 0) + ' (fair ' + BL.fmtAm(e.fairO) + ')'; }).join(', ') + (r.mk[m].book ? ` | ${r.mk[m].book.book} o${r.mk[m].book.line} ${BL.fmtAm(r.mk[m].book.over)} / u ${BL.fmtAm(r.mk[m].book.under)}, EV over ${sgnPct(r.mk[m].evO)} under ${sgnPct(r.mk[m].evU)}` : ''); }).join('\n');
        const log = last10(r.pid, r.goalie ? 'SV' : 'SOG', r.goalie).map(x => x.d.slice(5) + ' ' + (x.h ? 'vs ' : '@ ') + x.o + ' ' + x.v).join(', ');
        return `${playerInfo(r.pid).n}, ${r.team} vs ${r.opp} [game ${r.g.id}] ${fmtDay(r.g.date)}. ` + (r.goalie ? `${r.status} starter. Expected ${r.pr.sa.toFixed(1)} shots against, save rate ${r.pr.sv.toFixed(3)}, ${r.mean.SV.toFixed(1)} saves.` : `Projected ${r.pr.toi.toFixed(1)} min, ${r.mean.SOG.toFixed(2)} shots, ${r.mean.G.toFixed(2)} goals, ${r.mean.A.toFixed(2)} assists. Opponent shot factor ${r.pr.oppDef.toFixed(2)}, team scoring factor ${r.pr.env.toFixed(2)}.`) + '\n' + lines + '\nLast 10 (' + (r.goalie ? 'saves' : 'shots') + '): ' + log; } },
    { name: 'price_prop', description: 'Price a specific player prop at a specific line and American price: model probability, the blended probability and EV.',
      inputSchema: { type: 'object', properties: { player: { type: 'string' }, market: { type: 'string', description: 'shots, points, goal, assists or saves' }, line: { type: 'number', description: 'e.g. 2.5 (use 0.5 for anytime goal)' }, side: { type: 'string', enum: ['over', 'under'] }, price: { type: 'number', description: 'American odds, e.g. -130' }, otherPrice: { type: 'number', description: 'Price on the other side if known, to remove the book margin' } }, required: ['player', 'market', 'line', 'side', 'price'] },
      execute: (inp) => { const r = findPlayer(inp.player); if (!r) throw new Error('No player named ' + inp.player + ' in an upcoming game.');
        const m = MKT_ALIAS[norm(inp.market)] || String(inp.market).toUpperCase(); if (!r.pmf[m]) throw new Error('No ' + inp.market + ' projection for ' + playerInfo(r.pid).n + '.');
        if (!(Math.abs(inp.price) >= 100)) throw new Error('Price must be American odds like -130 or +115.');
        const bk = inp.side === 'over' ? { line: inp.line, over: inp.price, under: inp.otherPrice || null, book: 'Quoted' } : { line: inp.line, over: inp.otherPrice || null, under: inp.price, book: 'Quoted' };
        const e = propEval(r.pmf[m], inp.line, bk), ev = inp.side === 'over' ? e.evO : e.evU, p = inp.side === 'over' ? e.bO : e.bU, k = inp.side === 'over' ? e.kO : e.kU;
        chatNote('Priced ' + propLabel(r.pid, m, inp.side, inp.line) + ' at ' + BL.fmtAm(inp.price));
        return { player: playerInfo(r.pid).n, gameId: r.g.id, pid: r.pid, market: m, line: inp.line, side: inp.side, price: BL.fmtAm(inp.price), modelProbability: pct(inp.side === 'over' ? e.pO : e.pU, 1), blendedProbability: pct(p, 1), fairPrice: BL.fmtAm(inp.side === 'over' ? e.fairO : e.fairU), ev: sgnPct(ev), kellyStake: money((k || 0) * (S.ledger.bankroll || 0)), clearsValueBar: ev >= S.params.minEdge }; } },
    { name: 'propose_prop', description: 'Show the person a player-prop bet slip they can confirm to record in My Bets. Does not place anything at a sportsbook.',
      inputSchema: { type: 'object', properties: { player: { type: 'string' }, market: { type: 'string', description: 'shots, points, goal, assists or saves' }, line: { type: 'number' }, side: { type: 'string', enum: ['over', 'under'] }, price: { type: 'number', description: 'American odds the person can get' }, stake: { type: 'number' }, why: { type: 'string' } }, required: ['player', 'market', 'line', 'side', 'price'] },
      execute: (inp) => { const r = findPlayer(inp.player); if (!r) throw new Error('No player named ' + inp.player + ' in an upcoming game.');
        const m = MKT_ALIAS[norm(inp.market)] || String(inp.market).toUpperCase(); if (!r.pmf[m]) throw new Error('No ' + inp.market + ' market for that player.');
        if (!(Math.abs(inp.price) >= 100)) throw new Error('Price must be American odds.');
        const bk = inp.side === 'over' ? { line: inp.line, over: inp.price, under: null, book: '' } : { line: inp.line, over: null, under: inp.price, book: '' };
        const e = propEval(r.pmf[m], inp.line, bk), ev = inp.side === 'over' ? e.evO : e.evU, p = inp.side === 'over' ? e.bO : e.bU, k = inp.side === 'over' ? e.kO : e.kU;
        const bank = S.ledger.bankroll || 0, cap = bank * S.params.kellyCap; let stake = inp.stake > 0 ? inp.stake : Math.round((k || 0) * bank) || S.ledger.unit || 10; const capped = cap > 0 && stake > cap; if (capped) stake = Math.floor(cap);
        pushUi({ kind: 'slip', id: 's' + Date.now().toString(36), status: 'pending', gameId: r.g.id, market: 'PROP', stat: m, pid: r.pid, side: m === 'G' ? 'over' : inp.side, line: inp.line, label: propLabel(r.pid, m, inp.side, inp.line), matchup: r.g.away + ' @ ' + r.g.home, date: r.g.date, price: Math.round(inp.price), book: '', stake, p, ev, why: inp.why || '' });
        chatSave(); renderChatLog();
        return { shown: true, ev: sgnPct(ev), stake: money(stake), stakeCappedToMax: capped, note: 'The person must tap Save on the slip to record it.' }; } }
  ];
}
function pushUi(item) { // keep the streaming answer below tool notes and slips
  const cur = C.cur && C.ui.indexOf(C.cur); if (cur != null && cur >= 0) { C.ui.splice(cur, 1); C.ui.push(item, C.cur); } else C.ui.push(item);
}
function chatNote(text) { pushUi({ kind: 'tool', text }); renderChatLog(); }

async function sendChat(text) {
  text = (text || '').trim(); if (!text || C.busy || !D) return;
  const sample = await getSample();
  C.ui.push({ kind: 'user', text });
  if (!sample) { C.ui.push({ kind: 'error', text: SITE ? 'The chat isn\'t switched on for this site yet. The owner can turn it on in the project settings.' : 'Chat runs on your Claude account. Sign in to Claude and open this page from your link to use it.' }); renderChatLog(); return; }
  if (chatTools === null) { try { const lim = await sample.limits(); chatTools = !!(lim && lim.tools); } catch (e) { chatTools = false; } }
  C.turns.push({ role: 'user', content: text });
  const hist = C.turns.slice(-10); while (hist.length && hist[0].role !== 'user') hist.shift();
  const msgs = hist.map((t, i) => ({ role: t.role, content: t.content }));
  msgs[msgs.length - 1] = { role: 'user', content: 'LIVE DATA\n' + chatData() + '\n\nMESSAGE\n' + text };
  msgs[0] = { role: 'user', content: CHAT_RULES + '\n\n' + msgs[0].content };
  const bubble = { kind: 'assistant', text: '' }; C.ui.push(bubble); C.cur = bubble;
  C.busy = true; C.ctl = new AbortController(); renderChatLog();
  try {
    const opts = { modelTier: 'default', cache: false, signal: C.ctl.signal, onText: ({ text: t }) => { bubble.text = t; updateLastBubble(); } };
    if (chatTools) opts.tools = chatToolDefs();
    const res = await sample(msgs, opts);
    bubble.text = res.text; C.turns.push({ role: 'assistant', content: res.text || '(no answer)' });
  } catch (e) {
    if (e && e.text) bubble.text = e.text;
    if (!bubble.text) C.ui.splice(C.ui.indexOf(bubble), 1);
    C.turns.push({ role: 'assistant', content: bubble.text || '(no answer)' });
    if (!e || e.code !== 'cancelled') C.ui.push({ kind: 'error', text: e && e.code === 'not_granted' ? 'Claude access was declined for this page. Reload the page to be asked again.' : e && e.code === 'rate_limited' ? 'Too many messages at once. Give it a minute.' : 'Something went wrong: ' + (e && e.message || 'unknown error') });
  } finally { C.busy = false; C.ctl = null; C.cur = null; chatSave(); renderChatLog(); }
}

const SUGGEST = ['What\'s the best bet tonight?', 'Best shots-on-goal props tonight?', 'Build me a card for tonight with 3 units max', 'Is Matthews over 3.5 shots at -120 worth it?', 'How are my bets doing?'];
function chatSlipEl(it) {
  const done = it.status !== 'pending';
  const stakeIn = h('input', { id: 'cs-stake-' + it.id, inputmode: 'decimal', value: it.stake, disabled: done, 'aria-label': 'Stake in dollars' });
  const priceIn = h('input', { id: 'cs-price-' + it.id, inputmode: 'numeric', value: it.price, disabled: done, 'aria-label': 'Price in American odds' });
  const bookIn = h('input', { id: 'cs-book-' + it.id, value: it.book, placeholder: 'Book', disabled: done, 'aria-label': 'Sportsbook' });
  return h('div', { class: 'cslip' + (done ? ' done' : '') },
    h('div', { class: 'cslip-h' }, h('strong', null, it.label), h('span', { class: 'small muted' }, it.matchup + ' · ' + fmtDay(it.date))),
    it.why ? h('div', { class: 'small' }, it.why) : null,
    h('div', { class: 'cslip-f' },
      h('label', null, h('span', null, 'Price'), priceIn), h('label', null, h('span', null, 'Stake $'), stakeIn), h('label', null, h('span', null, 'Book'), bookIn)),
    h('div', { class: 'cslip-a' },
      h('span', { class: 'small muted' }, 'EV ' + sgnPct(it.ev) + ' at ' + BL.fmtAm(it.price)),
      done ? h('span', { class: 'pill ' + (it.status === 'saved' ? 'good' : 'neutral') }, it.status === 'saved' ? 'Saved to My Bets' : 'Dismissed') : [
        h('button', { class: 'btn sm ghost', onclick: () => { it.status = 'dismissed'; chatSave(); renderChatLog(); } }, 'Dismiss'),
        h('button', { class: 'btn sm primary', onclick: () => {
          const price = +priceIn.value, stake = +stakeIn.value;
          if (!(Math.abs(price) >= 100)) { toast('Enter American odds like -110 or +145'); return; }
          if (!(stake > 0)) { toast('Enter a stake above $0'); return; }
          const g = D.allGames[it.gameId]; if (!g) { toast('That game is no longer on the board'); return; }
          S.ledger.bets.push(Object.assign({ id: 'b' + Date.now().toString(36), gameId: g.id, date: g.date, away: g.away, home: g.home, market: it.market, side: it.side, line: it.line, price, stake, book: bookIn.value, label: it.label, pAtBet: it.p, placedAt: new Date().toISOString(), status: 'open', via: 'chat' }, it.market === 'PROP' ? { pid: it.pid, stat: it.stat } : {}));
          it.status = 'saved'; it.price = price; it.stake = stake; it.book = bookIn.value; saveLedger(); chatSave(); toast('Saved to My Bets. Place it with your book.'); render(); renderChatLog(); } }, 'Save bet')]));
}
function bubbleEl(it) {
  if (it.kind === 'user') return h('div', { class: 'msg user' }, it.text);
  if (it.kind === 'tool') return h('div', { class: 'msg tool' }, it.text);
  if (it.kind === 'error') return h('div', { class: 'msg err' }, it.text);
  if (it.kind === 'slip') return chatSlipEl(it);
  return h('div', { class: 'msg bot' }, ...(it.text ? renderMd(it.text) : [h('p', { class: 'thinking' }, 'Thinking…')]));
}
function updateLastBubble() {
  const log = $('#chat-log'); if (!log) return; const it = C.ui[C.ui.length - 1]; if (!it || it.kind !== 'assistant') return renderChatLog();
  const last = log.lastElementChild; const el = bubbleEl(it); if (last && last.classList.contains('bot')) last.replaceWith(el); else log.append(el);
  log.scrollTop = log.scrollHeight;
}
function renderChatLog() {
  const log = $('#chat-log'); if (!log) return;
  const kids = C.ui.map(bubbleEl);
  if (!C.ui.length) kids.push(h('div', { class: 'chat-empty' },
    h('div', { class: 'h-display', style: { fontSize: '24px' } }, 'Ask the desk'),
    h('p', { class: 'small muted' }, 'It sees tonight\'s lines, player props, the model, your bankroll and your open bets. Ask for a pick, a card, or why a line looks off. Bets it suggests show up as slips you confirm.'),
    h('div', { class: 'chips' }, SUGGEST.map(q => h('button', { class: 'chip', onclick: () => sendChat(q) }, q)))));
  log.replaceChildren(...kids); log.scrollTop = log.scrollHeight;
  const send = $('#chat-send'), stop = $('#chat-stop');
  if (send) send.hidden = C.busy; if (stop) stop.hidden = !C.busy;
}
function renderChatShell() {
  const host = $('#chat-host');
  const fab = h('button', { class: 'chat-fab', id: 'chat-fab', 'aria-label': 'Open chat', hidden: C.open, onclick: () => { C.open = true; renderChatShell(); setTimeout(() => { const i = $('#chat-in'); if (i) i.focus(); }, 30); } },
    h('span', { class: 'chat-fab-ico', 'aria-hidden': 'true' }), 'Ask the desk');
  if (!C.open) { host.replaceChildren(fab); return; }
  const input = h('textarea', { id: 'chat-in', rows: 1, placeholder: 'Ask about tonight\'s games or your bets…', 'aria-label': 'Message',
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = input.value; input.value = ''; sendChat(v); } },
    oninput: () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; } });
  const panel = h('aside', { class: 'chat', role: 'dialog', 'aria-label': 'Chat with the desk' },
    h('div', { class: 'chat-h' }, h('div', null, h('strong', null, 'Ask the desk'), h('div', { class: 'small muted' }, SITE ? 'Powered by Claude' : 'Uses your Claude account')),
      h('div', { style: { display: 'flex', gap: '6px' } },
        h('button', { class: 'btn sm ghost', onclick: () => { if (C.busy) return; C.turns = []; C.ui = []; chatSave(); renderChatLog(); } }, 'New chat'),
        h('button', { class: 'btn sm', onclick: () => { C.open = false; renderChatShell(); }, 'aria-label': 'Close chat' }, 'Close'))),
    h('div', { class: 'chat-log', id: 'chat-log', 'aria-live': 'polite' }),
    h('form', { class: 'chat-in', onsubmit: e => { e.preventDefault(); const v = input.value; input.value = ''; sendChat(v); } },
      input,
      h('button', { class: 'btn primary', id: 'chat-send', type: 'submit' }, 'Send'),
      h('button', { class: 'btn', id: 'chat-stop', type: 'button', hidden: true, onclick: () => C.ctl && C.ctl.abort() }, 'Stop')),
    h('div', { class: 'chat-foot small muted' }, 'Suggestions, not guarantees. Record bets here, place them with your book. 21+.'));
  host.replaceChildren(panel);
  renderChatLog();
}
