// Thin API-Football (api-sports.io) client used by the fetch_* scripts.
// Key is read from the environment so it never lands in committed files
// or in the browser-served js/ — path A keeps the site static.
//
//   export API_FOOTBALL_KEY=xxxx   (or put it in scripts/.env)
//
// Docs: https://www.api-football.com/documentation-v3

const fs = require('fs');
const path = require('path');

const BASE = 'https://v3.football.api-sports.io';

// World Cup league id in API-Football is 1. Season is the tournament year.
const LEAGUE_ID = 1;
const SEASON = Number(process.env.WC_SEASON || 2026);

// Minimal .env loader so `node scripts/fetch_*.js` works without extra deps.
(function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

function apiKey() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    throw new Error(
      'API_FOOTBALL_KEY is not set. Add it to scripts/.env or export it:\n' +
      '  export API_FOOTBALL_KEY=your_key_here'
    );
  }
  return key;
}

// GET with retry/backoff. Returns the `response` array from the API envelope.
async function get(endpoint, params = {}) {
  const url = new URL(BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { 'x-apisports-key': apiKey() } });

    if (res.status === 429) {
      // Rate limited — exponential backoff.
      const wait = 1000 * 2 ** attempt;
      console.warn(`  429 rate limited, waiting ${wait}ms (attempt ${attempt})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${endpoint} -> HTTP ${res.status}`);

    const body = await res.json();
    if (body.errors && Object.keys(body.errors).length) {
      throw new Error(`${endpoint} -> API error: ${JSON.stringify(body.errors)}`);
    }
    return body;
  }
  throw new Error(`${endpoint} -> gave up after retries`);
}

// Some endpoints (e.g. /players) paginate. Walk all pages. The first call omits
// `page` entirely — some endpoints (e.g. /fixtures) reject the param outright.
async function getAll(endpoint, params = {}) {
  const first = await get(endpoint, params);
  let out = first.response || [];
  const total = first.paging ? first.paging.total : 1;
  for (let page = 2; page <= total; page++) {
    const next = await get(endpoint, { ...params, page });
    out = out.concat(next.response || []);
    // Be gentle between pages.
    await new Promise(r => setTimeout(r, 350));
  }
  return out;
}

module.exports = { get, getAll, BASE, LEAGUE_ID, SEASON, apiKey };
