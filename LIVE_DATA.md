# Live data pipeline

The app stays **fully static** (path A): a couple of Node scripts pull from
API-Football and rewrite `data/*.json`. The browser keeps fetching local JSON —
it's just fresher. A cron runs the scripts on an interval.

## One-time setup

1. Get an API key at <https://www.api-football.com/>.
2. `cp scripts/.env.example scripts/.env` and paste your key into it.
   (`scripts/.env` is git-ignored — the key never reaches the browser or a commit.)

## Refresh scripts

```bash
node scripts/fetch_results.js   # scores + status -> data/schedule.json
node scripts/fetch_squads.js    # rosters + derived ratings -> data/squads.json
```

- `fetch_results.js` is light (one paginated call) — safe to run every ~10–15 min.
- `fetch_squads.js` is heavier (one paginated call per nation) — run it once a day.

Both resolve API-Football team ids from the tournament fixtures and cache them in
`data/.team_ids.json`. If a nation can't be matched, the script logs the API's
name so you can add it to `ALIASES` in `scripts/lib/teamMap.js`.

## How it flows into the app

- `data.js` cache-busts its fetches and **polls every 60s**, so an open tab picks
  up regenerated files. On each load it clears `Predict`'s cache and calls
  `Ratings.recompute()`.
- `ratings.js` turns played scores into (a) live group standings and (b) an
  Elo-style **adjustment** to each team's strength.
- `predict.js` `teamStrength = baseStrength (squad-derived, cached) + Elo adjustment`,
  so predictions and the simulator reflect the latest results on the fly.
- `sim.js` **locks in** real played group results and only simulates the rest.
- The schedule shows scores + LIVE/FT badges; the simulator shows a "data as of"
  stamp and re-runs when new data arrives.

## Scheduling (cron example)

```cron
*/15 * * * *  cd /path/to/fifa-wc-simulator && /usr/local/bin/node scripts/fetch_results.js >> /tmp/wc_results.log 2>&1
0    6 * * *  cd /path/to/fifa-wc-simulator && /usr/local/bin/node scripts/fetch_squads.js  >> /tmp/wc_squads.log  2>&1
```

For a deployed static host, run the same two commands in a GitHub Action on a
schedule and commit/deploy the regenerated `data/*.json`.

## Rating derivation — honest limitations

- No public API exposes EA FC-style ratings. `lib/deriveRating.js` builds a 0–100
  from season **form rating + output per 90 + minutes**, regressed toward a
  FIFA-rank baseline for thin samples. It's a heuristic — tune the constants there.
- API-Football's free tier exposes **broad positions** (GK/DEF/MID/ATT) only, so
  detailed slots (LB vs CB, LW vs ST) are approximated; the Best XI picker fills
  the gaps. The Elo responsiveness is tunable via `ELO_K` in `js/ratings.js`.
