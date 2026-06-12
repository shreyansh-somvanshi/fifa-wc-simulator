// Live ratings layer: turns real played results into (a) actual group standings
// and (b) an Elo-style adjustment that nudges each team's strength up or down
// based on how they've actually performed vs expectation.
//
// Depends on Data (matches/teams) and Predict.baseStrength (the squad-derived,
// results-agnostic strength). Predict.teamStrength then adds getAdjustment(code)
// so simulations and predictions reflect the latest scores on the fly.
//
// Recompute is cheap; call it whenever data is (re)loaded.

const Ratings = (() => {
  let adjustments = {};        // code -> total strength delta (can be +/-)
  let breakdown = {};          // code -> { elo, form, total, avgForm }
  let standings = {};          // group letter -> sorted standings rows
  let playedByPair = new Map(); // "AAA|BBB" -> { home, away, hg, ag }

  const ELO_SCALE = 10;  // strengths sit ~50-90, so 10 gives sane expecteds
  const ELO_K = 6;       // max strength points moved by a single result
  const FORM_BASE = 6.7; // an "average" player match rating
  const FORM_K = 3.0;    // strength points per rating point above/below base
  const FORM_CAP = 6;    // clamp the form swing

  const pairKey = (a, b) => [a, b].sort().join('|');
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function blankRow(team) {
    return { team, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
  }

  // A played group match with both scores present.
  function isScored(m) {
    return m.stage === 'group' && m.status === 'played' &&
      m.home && m.away &&
      Number.isFinite(m.home_score) && Number.isFinite(m.away_score);
  }

  function recompute() {
    adjustments = {};
    breakdown = {};
    standings = {};
    playedByPair = new Map();

    const teams = Data.getTeams();
    if (!teams || !teams.length) return;

    // Elo ratings seeded from squad-derived base strength.
    const elo = {};
    teams.forEach(t => { elo[t.code] = Predict.baseStrength(t); });

    // Group standings scaffold.
    const rows = {};
    teams.forEach(t => {
      (standings[t.group] = standings[t.group] || []);
      rows[t.code] = blankRow(t);
      standings[t.group].push(rows[t.code]);
    });

    // Walk played matches in kickoff order so Elo updates chronologically.
    const played = Data.getMatches()
      .filter(isScored)
      .sort((a, b) => (a.date_utc || '').localeCompare(b.date_utc || ''));

    for (const m of played) {
      const hg = m.home_score, ag = m.away_score;
      playedByPair.set(pairKey(m.home, m.away), { home: m.home, away: m.away, hg, ag });

      // --- standings ---
      const H = rows[m.home], A = rows[m.away];
      if (H && A) {
        H.played++; A.played++;
        H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg;
        if (hg > ag) { H.w++; A.l++; H.pts += 3; }
        else if (hg < ag) { A.w++; H.l++; A.pts += 3; }
        else { H.d++; A.d++; H.pts++; A.pts++; }
      }

      // --- Elo update on strength ---
      const Ra = elo[m.home], Rb = elo[m.away];
      if (Ra == null || Rb == null) continue;
      const expA = 1 / (1 + Math.pow(10, (Rb - Ra) / ELO_SCALE));
      const scoreA = hg > ag ? 1 : hg < ag ? 0 : 0.5;
      // Margin-of-victory multiplier (capped), à la World Football Elo.
      const mov = Math.log(Math.abs(hg - ag) + 1) + 1;
      const change = ELO_K * mov * (scoreA - expA);
      elo[m.home] = Ra + change;
      elo[m.away] = Rb - change;
    }

    // Per-team tournament form from player match-ratings (all WC matches with
    // a recorded rating, played or live).
    const formRatings = {};
    Data.getMatches().forEach(m => {
      if (Number.isFinite(m.home_form)) (formRatings[m.home] = formRatings[m.home] || []).push(m.home_form);
      if (Number.isFinite(m.away_form)) (formRatings[m.away] = formRatings[m.away] || []).push(m.away_form);
    });

    // Total live adjustment = results (Elo, which also drives the standings)
    // + player-rating form. Both shift the strength used by predictions/sim.
    teams.forEach(t => {
      const eloDelta = elo[t.code] - Predict.baseStrength(t);
      const fr = formRatings[t.code] || [];
      const avgForm = fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : null;
      const formDelta = avgForm != null ? clamp((avgForm - FORM_BASE) * FORM_K, -FORM_CAP, FORM_CAP) : 0;
      adjustments[t.code] = eloDelta + formDelta;
      breakdown[t.code] = {
        elo: eloDelta, form: formDelta,
        total: eloDelta + formDelta, avgForm
      };
    });

    // Sort each group by the same tiebreakers the simulator uses.
    Object.values(standings).forEach(group => {
      group.forEach(r => { r.gd = r.gf - r.ga; });
      group.sort((a, b) =>
        b.pts - a.pts || b.gd - a.gd || b.gf - a.gf ||
        a.team.fifa_rank - b.team.fifa_rank
      );
    });
  }

  const getAdjustment = code => adjustments[code] || 0;
  const getBreakdown = code => breakdown[code] || { elo: 0, form: 0, total: 0, avgForm: null };
  const getStandings = letter => letter ? (standings[letter] || []) : standings;
  // Real result for a pair, oriented to the requested home/away, or null.
  function getPlayedResult(homeCode, awayCode) {
    const r = playedByPair.get(pairKey(homeCode, awayCode));
    if (!r) return null;
    return r.home === homeCode
      ? { goalsA: r.hg, goalsB: r.ag }
      : { goalsA: r.ag, goalsB: r.hg };
  }

  return { recompute, getAdjustment, getBreakdown, getStandings, getPlayedResult };
})();
