// Maps the app's 3-letter team codes to API-Football team IDs.
//
// API-Football names national teams differently than data/teams.json
// (e.g. "South Korea" -> "Korea Republic"). We resolve IDs once from the
// tournament fixtures (which carry {id, name} for every team) and cache
// them to data/.team_ids.json so later runs skip the lookup.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const CACHE = path.join(DATA, '.team_ids.json');
// require() (not fs) so the data is bundled when this runs inside a Vercel
// serverless function, whose filesystem is read-only and path-sensitive.
const teams = require('../../data/teams.json').teams;

// API-Football names that differ from ours. Keyed by our code; values are
// the alternative names the API may use (matched case-insensitively).
const ALIASES = {
  KOR: ['Korea Republic', 'South Korea'],
  USA: ['USA', 'United States'],
  CIV: ['Ivory Coast', "Cote d'Ivoire", "Côte d'Ivoire"],
  COD: ['Congo DR', 'DR Congo', 'Democratic Republic of Congo'],
  CZE: ['Czechia', 'Czech Republic'],
  CPV: ['Cape Verde Islands', 'Cape Verde'],
  BIH: ['Bosnia', 'Bosnia and Herzegovina', 'Bosnia & Herzegovina'],
  IRN: ['Iran', 'IR Iran'],
  RSA: ['South Africa'],
  KSA: ['Saudi Arabia'],
  TUR: ['Türkiye', 'Turkiye', 'Turkey']
};

const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z]/g, '');

// Build lookup: normalized API name -> our code.
function buildNameIndex() {
  const idx = new Map();
  for (const t of teams) {
    idx.set(norm(t.name), t.code);
    for (const alias of (ALIASES[t.code] || [])) idx.set(norm(alias), t.code);
  }
  return idx;
}

function loadCache() {
  if (!fs.existsSync(CACHE)) return {};
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; }
}

function saveCache(map) {
  // Read-only filesystems (e.g. Vercel functions) make this a no-op.
  try { fs.writeFileSync(CACHE, JSON.stringify(map, null, 2) + '\n'); } catch { /* ignore */ }
}

// Pure: resolve {code: id} purely from the API teams seen, no disk involved.
// Returns { map, unmatched } so callers can decide how to surface misses.
function buildIdMap(apiTeams) {
  const idx = buildNameIndex();
  const map = {};
  const unmatched = [];
  for (const { id, name } of apiTeams) {
    const code = idx.get(norm(name));
    if (code) map[code] = id;
    else unmatched.push(name);
  }
  return { map, unmatched: [...new Set(unmatched)] };
}

// CLI variant: merges into the on-disk cache and logs misses (used by scripts).
function resolveFromApiTeams(apiTeams) {
  const { map: fresh, unmatched } = buildIdMap(apiTeams);
  const map = Object.assign(loadCache(), fresh);

  if (unmatched.length) {
    console.warn('  Unmatched API team names (add to ALIASES in teamMap.js):');
    unmatched.forEach(n => console.warn(`    - ${n}`));
  }

  saveCache(map);
  return map;
}

const codes = () => teams.map(t => t.code);

module.exports = { buildIdMap, resolveFromApiTeams, loadCache, codes, CACHE };
