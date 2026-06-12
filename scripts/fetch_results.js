// Pulls World Cup fixtures from API-Football and merges live/final scores
// into data/schedule.json. Group-stage matches are matched to our M0xx ids
// by the unordered pair of team codes (our home/away orientation is synthetic,
// so we re-orient scores to match it). Knockout slots stay placeholder-driven
// until the simulator resolves the bracket.
//
//   node scripts/fetch_results.js
//
// Part of the scheduled-refresh pipeline (path A) — safe to run on a cron.

const fs = require('fs');
const path = require('path');
const api = require('./lib/apifootball');
const teamMap = require('./lib/teamMap');

const DATA = path.join(__dirname, '..', 'data');
const SCHEDULE = path.join(DATA, 'schedule.json');

// API-Football fixture status.short -> our coarse status.
const STATUS = {
  TBD: 'scheduled', NS: 'scheduled',
  '1H': 'live', HT: 'live', '2H': 'live', ET: 'live', BT: 'live',
  P: 'live', LIVE: 'live', INT: 'live',
  FT: 'played', AET: 'played', PEN: 'played',
  PST: 'scheduled', CANC: 'scheduled', ABD: 'scheduled', SUSP: 'live'
};

// Pure merge: given our schedule + API fixtures + an id->code lookup, return
// an updated matches array. Exported so it can be tested without the network.
function mergeResults(matches, fixtures, idToCode) {
  // Index our group matches by unordered code pair "AAA|BBB" (sorted).
  const pairKey = (a, b) => [a, b].sort().join('|');
  const byPair = new Map();
  for (const m of matches) {
    if (m.stage === 'group' && m.home && m.away) {
      byPair.set(pairKey(m.home, m.away), m);
    }
  }

  let updated = 0;
  for (const fx of fixtures) {
    const homeCode = idToCode[fx.teams.home.id];
    const awayCode = idToCode[fx.teams.away.id];
    if (!homeCode || !awayCode) continue;

    const m = byPair.get(pairKey(homeCode, awayCode));
    if (!m) continue;

    const status = STATUS[fx.fixture.status.short] || 'scheduled';
    const hg = fx.goals.home;
    const ag = fx.goals.away;

    // Re-orient API goals to our schedule's home/away.
    if (m.home === homeCode) {
      m.home_score = hg; m.away_score = ag;
    } else {
      m.home_score = ag; m.away_score = hg;
    }
    m.status = status;
    m.fixture_id = fx.fixture.id;

    // Sync the real kickoff + venue so the synthetic schedule becomes accurate.
    if (fx.fixture.date) m.date_utc = new Date(fx.fixture.date).toISOString();
    const round = fx.league && fx.league.round;            // e.g. "Group Stage - 2"
    const md = round && round.match(/(\d+)\s*$/);
    if (md) m.matchday = Number(md[1]);
    if (fx.fixture.venue) {
      if (fx.fixture.venue.name) m.venue_name = fx.fixture.venue.name;
      if (fx.fixture.venue.city) m.venue_city = fx.fixture.venue.city;
    }
    updated++;
  }
  return { matches, updated };
}

// Minutes-weighted average player match-rating for one team in one fixture.
function teamMatchRating(players) {
  let sum = 0, w = 0;
  for (const p of (players || [])) {
    const g = p.statistics && p.statistics[0] && p.statistics[0].games;
    if (!g) continue;
    const r = g.rating != null ? parseFloat(g.rating) : NaN;
    const min = g.minutes || 0;
    if (!Number.isNaN(r) && min > 0) { sum += r * min; w += min; }
  }
  return w > 0 ? Math.round((sum / w) * 100) / 100 : null;
}

// Fetch per-match player ratings and store each side's team form (0-10).
// Finished matches are fetched once (ratings are final); live matches refresh.
async function fetchForm(matches, idToCode) {
  let n = 0;
  for (const m of matches) {
    if (!m.fixture_id) continue;
    const isPlayed = m.status === 'played', isLive = m.status === 'live';
    if (!isPlayed && !isLive) continue;
    if (isPlayed && Number.isFinite(m.home_form) && Number.isFinite(m.away_form)) continue;
    try {
      const pr = await api.get('/fixtures/players', { fixture: m.fixture_id });
      for (const entry of (pr.response || [])) {
        const code = idToCode[entry.team && entry.team.id];
        const rating = teamMatchRating(entry.players);
        if (!code || rating == null) continue;
        if (code === m.home) m.home_form = rating;
        else if (code === m.away) m.away_form = rating;
      }
      n++;
      await new Promise(r => setTimeout(r, 150));
    } catch (e) { /* leave form unset -> ratings fall back to results-only */ }
  }
  return n;
}

async function main() {
  console.log(`Fetching WC fixtures (league=${api.LEAGUE_ID}, season=${api.SEASON})…`);
  const fixtures = await api.getAll('/fixtures', {
    league: api.LEAGUE_ID,
    season: api.SEASON
  });
  console.log(`  ${fixtures.length} fixtures returned`);

  // Resolve/refresh team-id mapping from the fixtures themselves.
  const apiTeams = [];
  for (const fx of fixtures) {
    apiTeams.push(fx.teams.home, fx.teams.away);
  }
  const codeToId = teamMap.resolveFromApiTeams(apiTeams);
  const idToCode = Object.fromEntries(
    Object.entries(codeToId).map(([code, id]) => [id, code])
  );

  const schedule = JSON.parse(fs.readFileSync(SCHEDULE, 'utf8'));
  const { updated } = mergeResults(schedule.matches, fixtures, idToCode);

  // Per-match player-rating form (feeds the live ratings model).
  const formN = await fetchForm(schedule.matches, idToCode);

  schedule.lastUpdated = new Date().toISOString();
  fs.writeFileSync(SCHEDULE, JSON.stringify(schedule, null, 2) + '\n');

  const played = schedule.matches.filter(m => m.status === 'played').length;
  const live = schedule.matches.filter(m => m.status === 'live').length;
  console.log(`Updated ${updated} group matches -> data/schedule.json`);
  console.log(`  live: ${live}  played: ${played}  form fetched: ${formN}  as of ${schedule.lastUpdated}`);
}

if (require.main === module) {
  main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
}

module.exports = { mergeResults, STATUS };
