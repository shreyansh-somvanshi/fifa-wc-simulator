// Pulls each qualified nation's player pool from API-Football, derives a
// 0-100 rating per player (see lib/deriveRating.js), and writes data/squads.json
// in the app's existing { CODE: [{name, pos, rating, club}] } shape.
//
//   node scripts/fetch_squads.js
//
// Notes / honest limitations:
//   * API-Football's free tier exposes broad positions only (GK/DEF/MID/ATT),
//     so detailed slots (LB vs CB, LW vs ST) are approximated. The Best XI
//     picker in team.js fills the gaps via its positional fallback.
//   * Ratings are derived from season form + output + minutes, regressed toward
//     a FIFA-rank baseline for thin samples. They are a heuristic, not EA ratings.

const fs = require('fs');
const path = require('path');
const api = require('./lib/apifootball');
const teamMap = require('./lib/teamMap');
const { deriveRating, BROAD_TO_POS } = require('./lib/deriveRating');

const DATA = path.join(__dirname, '..', 'data');
const SQUADS = path.join(DATA, 'squads.json');
const teams = JSON.parse(fs.readFileSync(path.join(DATA, 'teams.json'), 'utf8')).teams;
const rankByCode = Object.fromEntries(teams.map(t => [t.code, t.fifa_rank]));

// During the tournament the WC season has almost no minutes, so ratings come
// from each player's CLUB season instead (2025 = the 2025-26 club season).
const CLUB_SEASON = Number(process.env.WC_CLUB_SEASON || 2025);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ensure we have team-id mappings. If the cache is empty, populate it from the
// tournament fixtures (which carry every team's {id, name}).
async function ensureTeamIds() {
  let map = teamMap.loadCache();
  if (Object.keys(map).length >= teams.length) return map;

  console.log('Resolving team ids from fixtures…');
  const fixtures = await api.getAll('/fixtures', {
    league: api.LEAGUE_ID, season: api.SEASON
  });
  const apiTeams = [];
  for (const fx of fixtures) apiTeams.push(fx.teams.home, fx.teams.away);
  map = teamMap.resolveFromApiTeams(apiTeams);
  return map;
}

// Pick the club a player featured for most (by minutes) as their displayed club.
function primaryClub(stats) {
  let best = null, bestMin = -1;
  for (const s of (stats || [])) {
    const min = (s.games && s.games.minutes) || 0;
    const name = s.team && s.team.name;
    if (name && min > bestMin) { bestMin = min; best = name; }
  }
  return best || '';
}

// Build one player record from their called-up roster entry + club-season stats.
function buildPlayer(rosterPlayer, stats, fifaRank) {
  const broad = rosterPlayer.position || 'Midfielder';
  return {
    name: rosterPlayer.name,
    pos: BROAD_TO_POS[broad] || 'CM',
    rating: deriveRating({ age: rosterPlayer.age, stats, broadPos: broad, fifaRank }),
    club: primaryClub(stats)
  };
}

async function main() {
  const codeToId = await ensureTeamIds();
  const out = {};
  let totalPlayers = 0, missing = [];

  for (const t of teams) {
    const id = codeToId[t.code];
    if (!id) { missing.push(t.code); continue; }

    process.stdout.write(`  ${t.code} (${t.name})… `);

    // Current called-up 26 (or so) from the squads endpoint.
    const sq = await api.get('/players/squads', { team: id });
    const roster = (sq.response && sq.response[0] && sq.response[0].players) || [];

    // Rate each player from their club season (the WC season has ~no minutes yet).
    const squad = [];
    for (const rp of roster) {
      let stats = [];
      try {
        const pr = await api.get('/players', { id: rp.id, season: CLUB_SEASON });
        stats = (pr.response && pr.response[0] && pr.response[0].statistics) || [];
      } catch (e) { /* no club data -> rating falls back to baseline */ }
      squad.push(buildPlayer(rp, stats, rankByCode[t.code]));
      await sleep(150);  // ~400/min, under the Pro 450/min ceiling
    }

    squad.sort((a, b) => b.rating - a.rating);  // highest-rated first
    out[t.code] = squad;
    totalPlayers += squad.length;
    console.log(`${squad.length} players`);
  }

  out._lastUpdated = new Date().toISOString();
  fs.writeFileSync(SQUADS, JSON.stringify(out, null, 2) + '\n');

  console.log(`\nWrote ${totalPlayers} players across ${Object.keys(out).length - 1} teams -> data/squads.json`);
  if (missing.length) {
    console.warn(`No team id for: ${missing.join(', ')} (extend ALIASES in teamMap.js)`);
  }
}

if (require.main === module) {
  main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
}

module.exports = { buildPlayer, primaryClub };
