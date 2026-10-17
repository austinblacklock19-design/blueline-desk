# Blueline Desk

An NHL betting desk: a team model and a player-props model priced against live sportsbook lines, team and
player trends with headshots, a bet tracker that grades itself, and an AI analyst you can chat with.

It runs as a free static website. A scheduled GitHub Action pulls fresh data from the NHL's stats feed and
The Odds API a few times a day, runs the tests, and redeploys the site. Nothing needs a server unless you
want the chat (see "Turn on the chat").

```
NHL stats API ─┐                                   ┌─> data/*.json (committed history)
               ├─> pipeline/refresh.js ── tests ───┤
The Odds API ──┘        (GitHub Action)            └─> site/ ──> GitHub Pages ──> you and your friends
                                                                  │
                                         chat ──> worker/ (your Claude API key) ──> Claude
```

## Quick start (about 15 minutes)

1. **Create the repository.** On GitHub, make a new repository (for example `blueline-desk`) and upload this
   folder, or from this folder run:
   ```
   git remote add origin https://github.com/<you>/blueline-desk.git
   git push -u origin main
   ```
   GitHub Pages on a free account needs a **public** repository. For a private one, see "Hosting elsewhere".
2. **Turn on Pages.** Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Add your odds key (optional but needed for lines and props).** Sign up at the-odds-api.com, then
   **Settings → Secrets and variables → Actions → New repository secret**, name `ODDS_API_KEY`.
   Put the key only in that secret box, never in a file: the repository is public.
   Without a key the site still updates results, box scores, rosters, schedules and every model projection;
   it just shows no sportsbook lines.
4. **Run it once.** **Actions → Refresh data and deploy → Run workflow.** It takes a few minutes. When it
   finishes, the run's summary links to your site (`https://<you>.github.io/blueline-desk/`). After that it
   runs on its own. If Pages isn't on yet, the run still saves the data and its summary says what to switch on.

Share that link with friends. Each person's bets save in their own browser (My Bets has Export and Import
to move them between devices).

## What updates when

| Time (Central) | What runs |
| --- | --- |
| ~8:10 AM | Last night's results and box scores, standings check, rosters, schedule, game lines |
| ~3:40 PM | Game lines and player props for tonight |
| ~6:20 PM | Late line moves and props before the later games |

GitHub runs schedules in UTC and can start them a few minutes late. Edit the times in
`.github/workflows/refresh.yml`. In November, when Central time falls back an hour, each run lands an hour
earlier unless you shift the times.

## Costs

- **GitHub Actions and Pages:** free for public repositories.
- **The Odds API:** game lines cost 3 credits per run, about 9 a day, which fits the free plan (500 credits
  a month). Player props cost up to 5 credits per game per run, and with two prop runs a night that's
  roughly 2,000 credits a month, so props need a paid plan (in October 2026, 20,000 credits for $30 a month).
  The job only pulls props while at least 280 credits stay in reserve for game lines (`oddsReserveCredits`
  in `pipeline/config.json`), so on the free plan props stop for the rest of the month, never game lines.
  If the key is wrong or credits run out, the run keeps the last lines, still saves the NHL data, and says
  so in its summary. Each run's summary shows the credits left.
- **Chat (optional):** billed to your Claude API key per message. The worker can cap requests per visitor.

## Turn on the chat

The chat and the "Analyze" buttons call Claude through a tiny proxy so your API key stays private.
Follow `worker/README.md` (Cloudflare Workers, free tier), then put the worker's URL in `web/config.js`
as `chatEndpoint` and push. The chat can see tonight's lines, props, the model and the visitor's own
bets, and it can put a bet slip in front of them, which they confirm to record. It never places bets.

## Run it on your computer

Needs Node.js 22 or newer.

```
npm run refresh        # pull fresh data into data/ (add ODDS_API_KEY=... in front for lines)
npm run refresh:props  # the same, plus player prop lines
npm run dev            # build the site and serve it at http://localhost:8080
npm test               # model checks and an offline end-to-end run of the pipeline
```

To rebuild every team's headshot sheet: `pip install pillow` then `python3 pipeline/headshots.py --all`.

## How the numbers are made

**Team model** (`model/team.js`). Each team gets an attack and a defense rating from goals for and against,
adjusted for opponents and venue, with recent games weighted more. Last season, pulled toward average,
is the starting point. Expected goals for both teams go into a Poisson score grid with extra weight on
regulation ties and empty-net goals; ties go to overtime and the shootout. The grid prices the moneyline,
puck line and total. The sportsbooks' price, with the margin removed, is blended in (50/50 by default),
and expected value uses the best price across books. Stakes are fractional Kelly with a cap.

**Props model** (`model/props.js`). Each skater gets projected ice time and per-60 rates for shots and
assists, blended from this season (recent games weighted more), last season and his position's average.
Shooting percentage is pulled hard toward average. The opponent's shots allowed scale his shots; the team
model's expected goals scale his goals and assists. Shots and points use negative binomial distributions.
Goalies get expected shots against from both teams' shot rates, a save rate pulled toward league average,
and a small chance of being pulled.

**How good is it?** On the first 120 games of this season (through October 16), predicting each game only
from earlier games:
- The team model picked 59.2% of winners. Home teams won 55.0% of those games, and the model's log loss
  (0.659) beat a flat "the home team wins 53.5%" (0.689).
- Across 3,744 player-games, the props model had 18% lower log loss than each player's season-to-date
  average on 3+ shots on goal and 24% lower on 1+ point. Its probabilities matched how often things
  happened: players it gave a 20–40% chance of 3+ shots averaged a 28.8% forecast and hit 28.0% of the time.
  It ran a little low on the likeliest outcomes.

A season-to-date average is an easy baseline to beat this early, and 120 games is a small sample. The Model
tab keeps these numbers current and lets you change every assumption. Judge it over hundreds of bets on
closing line value, not a week of results.

## Project layout

```
pipeline/refresh.js     the data job: NHL results, box scores, rosters, schedule; odds and props
pipeline/lib/nhl.js     NHL stats API parsing and checks (box score totals, standings match)
pipeline/lib/odds.js    The Odds API parsing: game lines, props, team and player name matching
pipeline/headshots.py   rebuilds the headshot sprite sheets in web/p/
model/team.js           team model (shared by the site and the tests)
model/props.js          player-props model
web/                    the app: app.js, props-ui.js, chat.js, style.css, index.html, config.js
worker/                 optional chat proxy (Cloudflare Worker)
data/                   the season so far; the Action commits updates here
tests/                  model checks and a full offline replay of the pipeline on real data
scripts/                build-site.js (site/), build-artifact.js (single-file Claude artifact), serve.js
```

## Hosting elsewhere

`npm run build` writes a plain static site to `site/`. Cloudflare Pages, Netlify and Vercel all host it
from a private repository on their free plans: set the build command to
`node pipeline/refresh.js && node scripts/build-site.js` and the output folder to `site`, or keep the GitHub
Action for data and point the host at the repository.

## The Claude version

The same app also runs as a Claude artifact (`npm run build:artifact` writes `dist/blueline.html`), where
the chat runs on each viewer's own Claude account and bets save to their Claude account.

## Notes

- For adults of legal betting age. The model's numbers are estimates, not guarantees.
  Problem gambling help: 1-800-GAMBLER.
- Data comes from the NHL's public stats feed and The Odds API. Player headshots are the NHL's.
  Check each provider's terms before using this commercially.
