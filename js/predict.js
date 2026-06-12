const Predict = (() => {
  // Caches the squad-derived base strength only. This is stable for a given
  // data load; it is cleared by clearCache() whenever data is refreshed.
  // The live Elo adjustment is intentionally NOT cached here — it changes as
  // results come in, so teamStrength() always reads it fresh.
  const baseCache = new Map();

  function baseStrength(team) {
    if (!team) return 50;
    if (baseCache.has(team.code)) return baseCache.get(team.code);

    const squad = Data.getSquad(team.code) || [];
    let strength;

    if (squad.length >= 11) {
      const top11 = squad.map(p => p.rating).sort((a, b) => b - a).slice(0, 11);
      const xiAvg = top11.reduce((s, r) => s + r, 0) / 11;
      const squadAvg = squad.reduce((s, p) => s + p.rating, 0) / squad.length;
      const rankScore = Math.max(0, 100 - team.fifa_rank);
      strength = 0.60 * xiAvg + 0.30 * squadAvg + 0.10 * rankScore;
    } else {
      strength = Math.max(40, 95 - team.fifa_rank * 0.5);
    }

    baseCache.set(team.code, strength);
    return strength;
  }

  // Full-strength = squad baseline + live results adjustment (Elo). The
  // adjustment is 0 until matches are played, so this matches the old behaviour
  // before kickoff and drifts with real results afterward.
  function teamStrength(team) {
    if (!team) return 50;
    const adj = (typeof Ratings !== 'undefined') ? Ratings.getAdjustment(team.code) : 0;
    return baseStrength(team) + adj;
  }

  function predictMatch(teamA, teamB) {
    if (!teamA || !teamB) return null;
    const sA = teamStrength(teamA);
    const sB = teamStrength(teamB);
    const delta = sA - sB;
    const pA = 1 / (1 + Math.exp(-delta / 6));
    const winner = pA >= 0.5 ? teamA : teamB;
    const confidence = Math.round(Math.abs(pA - 0.5) * 200);
    return { winner, confidence, pA, pB: 1 - pA, strengthA: sA, strengthB: sB };
  }

  function clearCache() { baseCache.clear(); }

  return { baseStrength, teamStrength, predictMatch, clearCache };
})();
