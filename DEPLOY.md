# Deploying to GitHub + Vercel

Static SPA + one serverless function + a scheduled data job. Same build runs
locally (static), on Vercel without a key (static fallback), and on Vercel with
a key (fully live).

## Production data stack

| Data | Source in production | Cadence |
|------|----------------------|---------|
| **Live scores / kickoff / venue** | `api/results.js` serverless fn (API-Football, server-side key) | on demand; edge-cached ~2 min; frontend polls 60s; Vercel Cron every 10 min |
| **Player form + standings momentum** | committed `data/schedule.json`, refreshed by GitHub Action | every 30 min (commits only on change) |
| **Squads + derived ratings** | committed `data/squads.json`, refreshed by GitHub Action | daily |
| **Live ratings / win odds** | computed in-browser (`ratings.js`) from the above | every refresh |

The API key never reaches the browser: it lives in a **Vercel env var** (for the
function) and a **GitHub secret** (for the Action). `scripts/.env` is git-ignored.

## 1. Push to GitHub

```bash
# (already a git repo with an initial commit)
gh auth login                       # or create a repo in the GitHub UI
gh repo create fifa-wc-simulator --public --source=. --remote=origin --push
# no gh? -> create the repo on github.com, then:
#   git remote add origin git@github.com:<you>/fifa-wc-simulator.git
#   git push -u origin main
```

Then add the key as a repo secret (for the data Action):
**GitHub → repo → Settings → Secrets and variables → Actions → New secret**
- `API_FOOTBALL_KEY` = your key

## 2. Deploy on Vercel

1. **vercel.com → Add New → Project → import the repo.** Zero-config (static +
   functions); `vercel.json` bundles `data/` + `scripts/` into the function and
   registers the cron.
2. **Settings → Environment Variables** (Production + Preview):
   - `API_FOOTBALL_KEY` = your key
   - `WC_SEASON` = `2026`
3. **Redeploy.** Visit `/` — live scores flow immediately.

> Vercel Cron at `*/10` needs a Pro plan; on Hobby it falls back to daily. Either
> way the 60s in-browser polling keeps live viewers current.

## 3. Verify

- `https://<app>.vercel.app/api/results` → JSON with `matches` + `lastUpdated`
  (200 with the key; **204** if the env var is missing → static fallback).
- Home shows live scores; Standings shows momentum chips; Simulator odds load.
- **Actions tab** → run **“Refresh World Cup data”** once manually to confirm the
  secret works and it can commit.

## Config knobs

- League id / season: `scripts/lib/apifootball.js` (`LEAGUE_ID`) + `WC_SEASON`.
  Run `node scripts/check_api.js` to confirm what your plan exposes.
- Rating model weights: `ELO_K`, `FORM_K`, `FORM_CAP` in `js/ratings.js`.
- 
