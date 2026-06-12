// Diagnostic: confirms your API-Football key works and tells us the exact
// league id + season to use for the World Cup (these are NOT guaranteed to be
// league=1 / season=2026 on every plan). Run this first.
//
//   node scripts/check_api.js

const api = require('./lib/apifootball');

async function main() {
  // 1) Plan + request limits.
  const status = await api.get('/status');
  const s = status.response || {};
  console.log('=== Account ===');
  console.log(`  plan:      ${s.subscription && s.subscription.plan}`);
  console.log(`  active:    ${s.subscription && s.subscription.active}`);
  console.log(`  requests:  ${s.requests && s.requests.current}/${s.requests && s.requests.limit_day} today`);

  // 2) Which "World Cup" leagues exist and what seasons they cover.
  console.log('\n=== Leagues matching "world cup" ===');
  const leagues = await api.get('/leagues', { search: 'world cup' });
  for (const L of (leagues.response || [])) {
    const seasons = (L.seasons || []).map(x => x.year).join(', ');
    console.log(`  id=${L.league.id}  ${L.league.name} (${L.country && L.country.name})`);
    console.log(`     seasons: ${seasons || '—'}`);
  }

  // 3) Does our configured LEAGUE_ID / SEASON actually return fixtures?
  console.log(`\n=== Fixtures for configured league=${api.LEAGUE_ID} season=${api.SEASON} ===`);
  const fx = await api.get('/fixtures', { league: api.LEAGUE_ID, season: api.SEASON });
  console.log(`  ${fx.results || 0} fixtures returned`);
  if (fx.response && fx.response[0]) {
    const f = fx.response[0];
    console.log(`  sample: ${f.teams.home.name} vs ${f.teams.away.name} — ${f.fixture.date}`);
  } else {
    console.log('  ⚠ No fixtures. Pick the right id/season from the league list above');
    console.log('    and set them in scripts/.env (WC_SEASON) / lib/apifootball.js (LEAGUE_ID).');
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
