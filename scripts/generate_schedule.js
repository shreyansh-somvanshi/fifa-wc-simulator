const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const teams = JSON.parse(fs.readFileSync(path.join(DATA, 'teams.json'), 'utf8')).teams;
const venues = JSON.parse(fs.readFileSync(path.join(DATA, 'venues.json'), 'utf8')).venues;

const groups = {};
teams.forEach(t => {
  (groups[t.group] = groups[t.group] || []).push(t.code);
});

const groupLetters = Object.keys(groups).sort();
const venueIds = venues.map(v => v.id);
let venueCursor = 0;
const nextVenue = () => venueIds[(venueCursor++) % venueIds.length];

// Kickoff slots in UTC. Group stage: 4 windows spread across NA timezones.
// 16:00, 19:00, 22:00, 01:00+1 UTC ≈ noon ET / 3pm ET / 6pm ET / 9pm ET
const slotsUTC = ['16:00', '19:00', '22:00', '01:00'];
const isoUTC = (dateStr, slot) => {
  if (slot === '01:00') {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10) + 'T01:00:00Z';
  }
  return `${dateStr}T${slot}:00Z`;
};

const matches = [];
let matchId = 1;
const mid = () => 'M' + String(matchId++).padStart(3, '0');

// === GROUP STAGE: June 11 – June 27, 2026 ===
// Pattern per group of 4 (in pot order [P1,P2,P3,P4]):
//   MD1: P1 v P4, P2 v P3
//   MD2: P1 v P3, P4 v P2
//   MD3: P3 v P4, P1 v P2
// Each group plays 3 matchdays; matchdays staggered across 17 days.
const groupStageDates = [];
const start = new Date('2026-06-11T00:00:00Z');
for (let i = 0; i < 17; i++) {
  const d = new Date(start); d.setUTCDate(d.getUTCDate() + i);
  groupStageDates.push(d.toISOString().slice(0, 10));
}

const pairPattern = [
  [[0, 3], [1, 2]],
  [[0, 2], [3, 1]],
  [[2, 3], [0, 1]]
];

groupLetters.forEach((g, gi) => {
  const codes = groups[g];
  pairPattern.forEach((pairs, mdIdx) => {
    pairs.forEach(([hi, ai], pi) => {
      const dayIdx = (gi + mdIdx * 5 + pi) % groupStageDates.length;
      const date = groupStageDates[dayIdx];
      const slot = slotsUTC[(gi + pi + mdIdx) % slotsUTC.length];
      matches.push({
        id: mid(),
        stage: 'group',
        group: g,
        matchday: mdIdx + 1,
        date_utc: isoUTC(date, slot),
        venue_id: nextVenue(),
        home: codes[hi],
        away: codes[ai],
        home_label: null,
        away_label: null,
        status: 'scheduled'
      });
    });
  });
});

// === KNOCKOUTS: placeholders, teams resolved by simulator ===
// R32: 16 matches, June 28 – July 3
// R16: 8 matches, July 4 – July 7
// QF:  4 matches, July 9 – July 11
// SF:  2 matches, July 14 – July 15
// 3rd: 1 match,   July 18
// Final: July 19
const ko = (id, stage, dateStr, slot, home_label, away_label) => ({
  id,
  stage,
  group: null,
  matchday: null,
  date_utc: isoUTC(dateStr, slot),
  venue_id: nextVenue(),
  home: null,
  away: null,
  home_label,
  away_label,
  status: 'scheduled'
});

// R32 placeholder labels. Real bracket pairings get computed at sim time;
// here we just create 16 slots so the UI can render them.
const r32Pairs = [
  ['Winner A', 'Runner-up B'], ['Winner C', 'Runner-up D'],
  ['Winner E', 'Runner-up F'], ['Winner G', 'Runner-up H'],
  ['Winner I', 'Runner-up J'], ['Winner K', 'Runner-up L'],
  ['Runner-up A', 'Winner C'], ['Runner-up E', 'Winner G'],
  ['Runner-up I', 'Winner K'], ['Winner B', '3rd place A/D/E/F'],
  ['Winner D', '3rd place B/E/F/G'], ['Winner F', '3rd place A/B/C/D'],
  ['Winner H', '3rd place C/D/F/G'], ['Winner J', '3rd place B/E/H/L'],
  ['Winner L', '3rd place E/H/I/J'], ['Runner-up G', 'Runner-up L']
];
const r32Dates = ['2026-06-28','2026-06-29','2026-06-30','2026-07-01','2026-07-02','2026-07-03'];
r32Pairs.forEach((p, i) => {
  matches.push(ko(mid(), 'r32', r32Dates[i % r32Dates.length], slotsUTC[i % slotsUTC.length], p[0], p[1]));
});

// R16: pair winners of R32 sequentially
const r16Dates = ['2026-07-04','2026-07-05','2026-07-06','2026-07-07'];
for (let i = 0; i < 8; i++) {
  matches.push(ko(
    mid(), 'r16', r16Dates[i % r16Dates.length], slotsUTC[i % slotsUTC.length],
    `Winner R32-${i * 2 + 1}`, `Winner R32-${i * 2 + 2}`
  ));
}

// QF
const qfDates = ['2026-07-09','2026-07-10','2026-07-11','2026-07-11'];
for (let i = 0; i < 4; i++) {
  matches.push(ko(
    mid(), 'qf', qfDates[i], slotsUTC[(i + 2) % slotsUTC.length],
    `Winner R16-${i * 2 + 1}`, `Winner R16-${i * 2 + 2}`
  ));
}

// SF
matches.push(ko(mid(), 'sf', '2026-07-14', '22:00', 'Winner QF-1', 'Winner QF-2'));
matches.push(ko(mid(), 'sf', '2026-07-15', '22:00', 'Winner QF-3', 'Winner QF-4'));

// 3rd-place playoff
matches.push(ko(mid(), '3rd', '2026-07-18', '20:00', 'Loser SF-1', 'Loser SF-2'));

// Final — Estadio Azteca? No, MetLife is the actual 2026 final venue.
// Force venue for the final regardless of cursor.
const finalMatch = ko(mid(), 'final', '2026-07-19', '19:00', 'Winner SF-1', 'Winner SF-2');
finalMatch.venue_id = 'USA-NYC';
matches.push(finalMatch);

fs.writeFileSync(
  path.join(DATA, 'schedule.json'),
  JSON.stringify({ matches }, null, 2) + '\n'
);

console.log(`Wrote ${matches.length} matches to data/schedule.json`);
console.log(`  Group stage: ${matches.filter(m => m.stage === 'group').length}`);
console.log(`  R32: ${matches.filter(m => m.stage === 'r32').length}`);
console.log(`  R16: ${matches.filter(m => m.stage === 'r16').length}`);
console.log(`  QF:  ${matches.filter(m => m.stage === 'qf').length}`);
console.log(`  SF:  ${matches.filter(m => m.stage === 'sf').length}`);
console.log(`  3rd: ${matches.filter(m => m.stage === '3rd').length}`);
console.log(`  Final: ${matches.filter(m => m.stage === 'final').length}`);
