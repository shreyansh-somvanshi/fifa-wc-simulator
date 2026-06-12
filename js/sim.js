const Sim = (() => {
  // Mulberry32 — seeded PRNG so simulations are reproducible from a seed.
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function poisson(lambda, rng) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L && k < 12);
    return k - 1;
  }

  function simMatch(teamA, teamB, rng, allowDraw = true) {
    if (!teamA || !teamB) return null;
    const sA = Predict.teamStrength(teamA);
    const sB = Predict.teamStrength(teamB);
    const delta = (sA - sB) / 10;
    const base = 1.35;
    const lambdaA = Math.max(0.25, Math.min(4.5, base * (1 + delta * 0.55)));
    const lambdaB = Math.max(0.25, Math.min(4.5, base * (1 - delta * 0.55)));

    let goalsA = poisson(lambdaA, rng);
    let goalsB = poisson(lambdaB, rng);

    let pen = null;
    if (!allowDraw && goalsA === goalsB) {
      const pA = 1 / (1 + Math.exp(-(sA - sB) / 12));
      if (rng() < pA) pen = 'A'; else pen = 'B';
    }

    const winner =
      goalsA > goalsB ? teamA.code :
      goalsA < goalsB ? teamB.code :
      pen === 'A' ? teamA.code :
      pen === 'B' ? teamB.code : null;

    return { home: teamA.code, away: teamB.code, goalsA, goalsB, pen, winner };
  }

  function simGroupStage(rng) {
    const groups = {};
    'ABCDEFGHIJKL'.split('').forEach(letter => {
      const teams = Data.getTeams().filter(t => t.group === letter);
      const standings = teams.map(t => ({
        team: t, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0
      }));
      const stMap = Object.fromEntries(standings.map(s => [s.team.code, s]));

      const matches = [];
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          // Lock in real results that have already been played; only simulate
          // fixtures that haven't happened yet.
          const real = (typeof Ratings !== 'undefined')
            ? Ratings.getPlayedResult(teams[i].code, teams[j].code) : null;
          let m;
          if (real) {
            const winner =
              real.goalsA > real.goalsB ? teams[i].code :
              real.goalsA < real.goalsB ? teams[j].code : null;
            m = { home: teams[i].code, away: teams[j].code,
                  goalsA: real.goalsA, goalsB: real.goalsB, pen: null, winner, played: true };
          } else {
            m = simMatch(teams[i], teams[j], rng, true);
          }
          matches.push(m);
          const A = stMap[teams[i].code], B = stMap[teams[j].code];
          A.played++; B.played++;
          A.gf += m.goalsA; A.ga += m.goalsB;
          B.gf += m.goalsB; B.ga += m.goalsA;
          if (m.goalsA > m.goalsB) { A.w++; B.l++; A.pts += 3; }
          else if (m.goalsA < m.goalsB) { B.w++; A.l++; B.pts += 3; }
          else { A.d++; B.d++; A.pts++; B.pts++; }
        }
      }

      standings.forEach(s => s.gd = s.gf - s.ga);
      standings.sort((a, b) =>
        b.pts - a.pts ||
        b.gd - a.gd ||
        b.gf - a.gf ||
        a.team.fifa_rank - b.team.fifa_rank
      );

      groups[letter] = { letter, standings, matches };
    });
    return groups;
  }

  function seedTeams(groups) {
    const tiebreak = (a, b) =>
      b.pts - a.pts ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      a.team.fifa_rank - b.team.fifa_rank;

    const winners = Object.values(groups).map(g => g.standings[0]).sort(tiebreak);
    const runners = Object.values(groups).map(g => g.standings[1]).sort(tiebreak);
    const thirds  = Object.values(groups).map(g => g.standings[2]).sort(tiebreak);

    const advancingThirds = thirds.slice(0, 8);
    const eliminatedThirds = thirds.slice(8);

    return {
      winners, runners, thirds,
      advancingThirds, eliminatedThirds,
      seeds: [...winners, ...runners, ...advancingThirds]
    };
  }

  // Standard 32-team single-elimination bracket positions (1-indexed seeds).
  // Order is the R32 match order; pairs of adjacent R32 winners meet in R16,
  // so seeds 1 and 2 only meet in the final.
  function r32Positions() {
    return [
      [1, 32], [16, 17], [8, 25], [9, 24], [4, 29], [13, 20], [5, 28], [12, 21],
      [2, 31], [15, 18], [7, 26], [10, 23], [3, 30], [14, 19], [6, 27], [11, 22]
    ];
  }

  function simKnockouts(seeds, rng) {
    const positions = r32Positions();
    const r32 = positions.map(([a, b]) => {
      const tA = seeds[a - 1].team;
      const tB = seeds[b - 1].team;
      const m = simMatch(tA, tB, rng, false);
      m.seedA = a; m.seedB = b;
      return m;
    });

    const advance = (matches) => {
      const out = [];
      for (let i = 0; i < matches.length; i += 2) {
        const tA = Data.getTeam(matches[i].winner);
        const tB = Data.getTeam(matches[i + 1].winner);
        out.push(simMatch(tA, tB, rng, false));
      }
      return out;
    };

    const r16 = advance(r32);
    const qf  = advance(r16);
    const sf  = advance(qf);

    const loserOf = m => m.winner === m.home ? m.away : m.home;
    const thirdPlace = simMatch(Data.getTeam(loserOf(sf[0])), Data.getTeam(loserOf(sf[1])), rng, false);
    const final = simMatch(Data.getTeam(sf[0].winner), Data.getTeam(sf[1].winner), rng, false);

    return { r32, r16, qf, sf, thirdPlace, final };
  }

  function simAll(seed) {
    const rng = makeRng(seed);
    const groups = simGroupStage(rng);
    const seedInfo = seedTeams(groups);
    const knockouts = simKnockouts(seedInfo.seeds, rng);
    return {
      seed,
      groups,
      ...seedInfo,
      ...knockouts,
      champion: knockouts.final.winner
    };
  }

  // Run n independent simulations with deterministic seeds and tally per-team
  // tournament outcomes. Yields to the event loop every batch so the UI stays
  // responsive.
  function simManyAggregate(n, onProgress, onDone) {
    const tally = {
      n,
      champion: {},
      final: {},
      semi: {},
      quarter: {},
      r16: {},
      r32: {},
      groupWinner: {}
    };
    const inc = (bucket, code) => { tally[bucket][code] = (tally[bucket][code] || 0) + 1; };

    let i = 0;
    const batchSize = 40;

    function runBatch() {
      const end = Math.min(i + batchSize, n);
      for (; i < end; i++) {
        const seed = ((i + 1) * 2654435761) >>> 0;
        const r = simAll(seed);

        inc('champion', r.champion);
        r.sf.forEach(m => inc('final', m.winner));
        r.qf.forEach(m => inc('semi', m.winner));
        r.r16.forEach(m => inc('quarter', m.winner));
        r.r32.forEach(m => inc('r16', m.winner));
        r.seeds.forEach(s => inc('r32', s.team.code));
        Object.values(r.groups).forEach(g => inc('groupWinner', g.standings[0].team.code));
      }

      if (onProgress) onProgress(i / n);

      if (i < n) {
        setTimeout(runBatch, 0);
      } else {
        onDone(tally);
      }
    }

    runBatch();
  }

  return { makeRng, simMatch, simAll, simManyAggregate, r32Positions };
})();
