// Vercel serverless function: returns the schedule with live/final scores,
// real kickoff dates and venues merged in from API-Football.
//
// The key lives in the API_FOOTBALL_KEY *environment variable* (set it in the
// Vercel dashboard) — it is never shipped to the browser. If no key is set,
// the function responds 204 so the frontend transparently falls back to the
// committed static data/schedule.json.
//
// Edge-cached via Cache-Control so bursts of visitors don't exhaust the API
// quota: one upstream fetch every ~2 minutes regardless of traffic.

const api = require('../scripts/lib/apifootball');
const { buildIdMap } = require('../scripts/lib/teamMap');
const { mergeResults } = require('../scripts/fetch_results');
const schedule = require('../data/schedule.json');

module.exports = async (req, res) => {
  if (!process.env.API_FOOTBALL_KEY) {
    // No key configured -> let the client use the static file.
    res.status(204).end();
    return;
  }

  try {
    const fixtures = await api.getAll('/fixtures', {
      league: api.LEAGUE_ID, season: api.SEASON
    });

    const apiTeams = [];
    for (const fx of fixtures) apiTeams.push(fx.teams.home, fx.teams.away);
    const { map } = buildIdMap(apiTeams);
    const idToCode = Object.fromEntries(
      Object.entries(map).map(([code, id]) => [id, code])
    );

    // Deep-clone so we never mutate the require()-cached module object across
    // warm invocations.
    const matches = JSON.parse(JSON.stringify(schedule.matches));
    mergeResults(matches, fixtures, idToCode);

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json({ matches, lastUpdated: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
