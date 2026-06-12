// Derives a 0-100 player rating from API-Football season statistics.
// No public API exposes EA FC-style ratings, so we build our own from the
// signals that ARE available: average match form-rating (the strongest skill
// proxy), attacking output per 90, minutes (sample confidence), and age.
//
// Thin samples regress toward a position baseline that is itself nudged by the
// national team's FIFA rank, so a Brazil squad player and a Haiti squad player
// with no usable stats don't collapse to the same number.
//
// All functions are pure -> unit-testable without the network.

// Broad API position -> our detailed position code (best effort; the API does
// not expose CB-vs-LB granularity on the free tier).
const BROAD_TO_POS = {
  Goalkeeper: 'GK',
  Defender: 'CB',
  Midfielder: 'CM',
  Attacker: 'ST'
};

const POS_GROUP = { GK: 'GK', CB: 'DEF', CM: 'MID', ST: 'ATT' };

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// Team-rank baseline: better-ranked nations get a higher floor. rank 1 -> ~78,
// rank 50 -> ~66, rank 100+ -> ~58. Position-tweaked slightly.
function baselineFor(broadPos, fifaRank) {
  const r = fifaRank || 80;
  const base = clamp(80 - Math.log2(r) * 3.0, 56, 80);
  const posAdj = { GK: -1, Defender: 0, Midfielder: 0.5, Attacker: 1 }[broadPos] || 0;
  return base + posAdj;
}

// Aggregate the statistics[] array into per-player totals, minutes-weighting the
// form rating. Returns null fields when no usable data is present.
function aggregate(stats) {
  let minutes = 0, apps = 0, goals = 0, assists = 0;
  let ratingSum = 0, ratingWeight = 0;

  for (const s of (stats || [])) {
    const g = s.games || {};
    const min = g.minutes || 0;
    minutes += min;
    apps += g.appearences || 0;
    goals += (s.goals && s.goals.total) || 0;
    assists += (s.goals && s.goals.assists) || 0;
    const r = g.rating != null ? parseFloat(g.rating) : NaN;
    if (!Number.isNaN(r) && min > 0) { ratingSum += r * min; ratingWeight += min; }
  }

  return {
    minutes, apps, goals, assists,
    avgRating: ratingWeight > 0 ? ratingSum / ratingWeight : null
  };
}

// Map a 0-10 form rating to a 0-100 skill base. 6.0->62, 7.0->76, 8.0->90.
function formToBase(avgRating) {
  return clamp(62 + (avgRating - 6.0) * 14, 50, 94);
}

// Main entry. player: { age }, stats: statistics[], broadPos, fifaRank.
function deriveRating({ age, stats, broadPos, fifaRank }) {
  const agg = aggregate(stats);
  const baseline = baselineFor(broadPos, fifaRank);

  // Skill base from form rating, else fall back to the baseline.
  const skill = agg.avgRating != null ? formToBase(agg.avgRating) : baseline;

  // Confidence: how much we trust the player's own stats vs the baseline.
  // Full trust at ~900 minutes (≈10 full matches), none at 0.
  const confidence = clamp(agg.minutes / 900, 0, 1);
  let rating = confidence * skill + (1 - confidence) * baseline;

  // Attacking output per 90, weighted by position group.
  if (agg.minutes >= 270) {
    const per90 = (agg.goals + agg.assists) / (agg.minutes / 90);
    const w = { ATT: 6, MID: 4, DEF: 2, GK: 0 }[POS_GROUP[BROAD_TO_POS[broadPos] || 'CM']] || 3;
    rating += clamp(per90 * w, 0, 8);
  }

  // Mild age curve: peak 24-30, gentle decline after 32, penalty under 20.
  if (age) {
    if (age > 32) rating -= (age - 32) * 0.6;
    else if (age < 20) rating -= (20 - age) * 0.5;
  }

  return Math.round(clamp(rating, 45, 95));
}

module.exports = { deriveRating, aggregate, baselineFor, formToBase, BROAD_TO_POS };
