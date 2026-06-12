;(window.Views = window.Views || {}).simulator = async function () {
  const { escapeHtml, $, $$ } = Utils;
  await Data.load({ squads: true });

  const STORAGE_KEY = 'wcsim_state_v1';
  const AGGR_KEY = 'wcsim_aggregate_v1';
  const AGGR_N = 1000;
  let state = loadState();

  if (!state) {
    state = { seed: newSeed() };
    state.result = Sim.simAll(state.seed);
    saveState();
  }

  // matchReg: id → { match, stage } so modal can look up the source match
  let matchReg = new Map();
  let matchIdCounter = 0;
  function regMatch(m, stage) {
    if (!m) return '';
    const id = `m${++matchIdCounter}`;
    matchReg.set(id, { match: m, stage });
    return id;
  }

  bindControls();
  bindMatchClicks();
  renderAll();
  updateDataBadge();

  // Aggregate odds: independent of the single-run view. Cached in localStorage
  // since 1000 sims is deterministic for fixed input data. Reset clears it.
  loadOrComputeAggregate().then(renderOdds);

  // When the refresh pipeline brings new scores/squads, re-run against the
  // latest data: the single run re-locks played results, and the odds recompute.
  Data.onRefresh(() => {
    state.result = Sim.simAll(state.seed);
    renderAll();
    updateDataBadge();
    loadOrComputeAggregate().then(renderOdds);
  });

  function updateDataBadge() {
    const el = document.getElementById('dataAsOf');
    if (!el) return;
    const updated = Data.getLastUpdated();
    if (!updated) { el.textContent = ''; return; }
    const live = Data.getMatches().filter(m => m.status === 'live').length;
    let t = '';
    try { t = new Date(updated).toLocaleTimeString(); } catch (e) {}
    el.innerHTML = (live ? `<span class="live-badge">● ${live} LIVE</span> · ` : '') +
      `data as of ${escapeHtml(t)}`;
  }

  function newSeed() {
    return ((Date.now() & 0xFFFFFFFF) ^ Math.floor(Math.random() * 1e9)) >>> 0;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Re-run simulation from the saved seed (state.result references stale
      // team objects after reload, so cleanest to recompute deterministically).
      parsed.result = Sim.simAll(parsed.seed);
      return parsed;
    } catch {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ seed: state.seed }));
    } catch {}
  }

  function reSimulate() {
    state.seed = newSeed();
    state.result = Sim.simAll(state.seed);
    saveState();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(AGGR_KEY);
    state.seed = newSeed();
    state.result = Sim.simAll(state.seed);
    saveState();
    renderAll();
    // Reset also recomputes the aggregate, in case data changed.
    $('#odds').innerHTML = `
      <div class="odds-loading">
        <div class="odds-progress"><div id="oddsProgressFill" class="odds-progress-fill"></div></div>
        <div id="oddsProgressText" class="odds-progress-text">0%</div>
      </div>`;
    $('#oddsCount').textContent = '· running 1,000 simulations…';
    loadOrComputeAggregate().then(renderOdds);
  }

  // =================== AGGREGATE ODDS ===================

  function loadOrComputeAggregate() {
    const dataVersion = Data.getLastUpdated() || 'static';
    try {
      const raw = localStorage.getItem(AGGR_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Reuse only if both the run count AND the underlying data are unchanged.
        if (parsed && parsed.n === AGGR_N && parsed.dataVersion === dataVersion) {
          return Promise.resolve(parsed);
        }
      }
    } catch {}

    return new Promise(resolve => {
      Sim.simManyAggregate(
        AGGR_N,
        (pct) => {
          const fill = document.getElementById('oddsProgressFill');
          const txt  = document.getElementById('oddsProgressText');
          if (fill) fill.style.width = (pct * 100).toFixed(0) + '%';
          if (txt)  txt.textContent = (pct * 100).toFixed(0) + '%';
        },
        (result) => {
          result.dataVersion = dataVersion;
          try { localStorage.setItem(AGGR_KEY, JSON.stringify(result)); } catch {}
          resolve(result);
        }
      );
    });
  }

  function renderOdds(agg) {
    $('#oddsCount').textContent = `· based on ${agg.n.toLocaleString()} simulations`;

    const rows = Data.getTeams().map(t => ({
      team: t,
      champion: (agg.champion[t.code] || 0) / agg.n,
      final:    (agg.final[t.code]    || 0) / agg.n,
      semi:     (agg.semi[t.code]     || 0) / agg.n,
      r32:      (agg.r32[t.code]      || 0) / agg.n
    }));
    rows.sort((a, b) => b.champion - a.champion || b.final - a.final);

    const topN = 8;
    const top = rows.slice(0, topN);
    const restWithChances = rows.slice(topN).filter(r => r.champion > 0);
    const maxBar = top[0]?.champion || 1;

    const cardHtml = top.map((r, i) => {
      const pct = (r.champion * 100).toFixed(1);
      const barW = ((r.champion / maxBar) * 100).toFixed(1);
      return `
        <div class="odds-row">
          <div class="o-head">
            <span class="o-rank">${i + 1}</span>
            <span class="o-flag">${r.team.flag}</span>
            <span class="o-name">${escapeHtml(r.team.name)}</span>
            <span class="o-pct">${pct}%</span>
          </div>
          <div class="o-bar"><div class="o-fill" style="width:${barW}%"></div></div>
          <div class="o-stages">
            <span>Final ${(r.final * 100).toFixed(0)}%</span>
            <span>Semi ${(r.semi * 100).toFixed(0)}%</span>
            <span>R32 ${(r.r32 * 100).toFixed(0)}%</span>
          </div>
        </div>
      `;
    }).join('');

    const restHtml = restWithChances.length
      ? `<details class="odds-rest">
           <summary>Show ${restWithChances.length} more teams with non-zero championship odds</summary>
           ${restWithChances.map(r => `
             <div class="odds-rest-row">
               <span class="o-flag">${r.team.flag}</span>
               <span class="o-name">${escapeHtml(r.team.name)}</span>
               <span class="o-pct-small">${(r.champion * 100).toFixed(1)}%</span>
             </div>
           `).join('')}
         </details>`
      : '';

    const neverChamp = Data.getTeams().length - rows.filter(r => r.champion > 0).length;
    const footerHtml = neverChamp > 0
      ? `<div class="odds-footer">${neverChamp} teams never won the tournament across these ${agg.n.toLocaleString()} simulations.</div>`
      : '';

    $('#odds').innerHTML = cardHtml + restHtml + footerHtml;
  }

  function bindControls() {
    $('#reSimBtn').addEventListener('click', reSimulate);
    $('#resetBtn').addEventListener('click', reset);
  }

  function renderAll() {
    matchReg = new Map();
    matchIdCounter = 0;
    renderChampion();
    renderGroups();
    renderThirds();
    renderBracket();
  }

  function renderChampion() {
    const r = state.result;
    const final = r.final;
    const champTeam = Data.getTeam(r.champion);
    const runnerCode = final.winner === final.home ? final.away : final.home;
    const runner = Data.getTeam(runnerCode);
    const third = Data.getTeam(r.thirdPlace.winner);
    const goldGoals  = final.winner === final.home ? final.goalsA : final.goalsB;
    const silverGoals = final.winner === final.home ? final.goalsB : final.goalsA;
    const penNote = final.pen ? ' (pens)' : '';

    $('#champion').innerHTML = `
      <div class="champion-card">
        <div class="trophy">🏆</div>
        <div class="champ-flag">${champTeam.flag}</div>
        <div class="champ-name">${escapeHtml(champTeam.name)}</div>
        <div class="champ-label">World Cup 2026 Champion</div>
        <div class="final-score">
          <span class="fs-team">${escapeHtml(champTeam.code)}</span>
          <span class="fs-goals">${goldGoals} – ${silverGoals}</span>
          <span class="fs-team">${escapeHtml(runner.code)}</span>
          <span class="fs-pen">${penNote}</span>
        </div>
        <div class="podium">
          <div class="podium-row silver"><span class="medal">🥈</span> ${runner.flag} ${escapeHtml(runner.name)}</div>
          <div class="podium-row bronze"><span class="medal">🥉</span> ${third.flag} ${escapeHtml(third.name)}</div>
        </div>
      </div>
    `;
  }

  function renderGroups() {
    const groups = state.result.groups;
    const html = Object.values(groups).map(g => `
      <section class="group-table">
        <h3 class="group-title">Group ${g.letter}</h3>
        <table>
          <thead>
            <tr><th class="t-team">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>
          </thead>
          <tbody>
            ${g.standings.map((s, i) => `
              <tr class="row-${i < 2 ? 'win' : i === 2 ? 'maybe' : 'out'}">
                <td class="t-team"><span class="t-flag">${s.team.flag}</span><span class="t-name">${escapeHtml(s.team.name)}</span></td>
                <td>${s.played}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td>
                <td>${s.gd > 0 ? '+' : ''}${s.gd}</td>
                <td class="t-pts">${s.pts}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <details class="group-matches">
          <summary>Match results</summary>
          ${g.matches.map(m => {
            const h = Data.getTeam(m.home), a = Data.getTeam(m.away);
            const id = regMatch(m, `Group ${g.letter}`);
            return `<div class="gm-row" data-match-id="${id}">
              <span class="gm-team">${h.flag} ${escapeHtml(h.code)}</span>
              <span class="gm-score">${m.goalsA} – ${m.goalsB}</span>
              <span class="gm-team away">${escapeHtml(a.code)} ${a.flag}</span>
            </div>`;
          }).join('')}
        </details>
      </section>
    `).join('');
    $('#groups').innerHTML = html;
  }

  function renderThirds() {
    const html = state.result.thirds.map((s, i) => `
      <tr class="${i < 8 ? 'row-win' : 'row-out'}">
        <td>${i + 1}</td>
        <td class="g">${s.team.group}</td>
        <td><span class="t-flag">${s.team.flag}</span><span class="t-name">${escapeHtml(s.team.name)}</span></td>
        <td>${s.pts}</td>
        <td>${s.gd > 0 ? '+' : ''}${s.gd}</td>
        <td>${s.gf}</td>
        <td class="status">${i < 8 ? '✓ R32' : '✗ Out'}</td>
      </tr>
    `).join('');
    $('#thirds').innerHTML = `
      <table class="thirds-table">
        <thead>
          <tr><th>#</th><th>Grp</th><th class="t-team">Team</th><th>Pts</th><th>GD</th><th>GF</th><th>Status</th></tr>
        </thead>
        <tbody>${html}</tbody>
      </table>
    `;
  }

  function renderBracket() {
    const r = state.result;
    const stages = [
      { key: 'r32',   label: 'Round of 32',     matches: r.r32 },
      { key: 'r16',   label: 'Round of 16',     matches: r.r16 },
      { key: 'qf',    label: 'Quarter-finals',  matches: r.qf },
      { key: 'sf',    label: 'Semi-finals',     matches: r.sf },
      { key: 'final', label: 'Final',           matches: [r.final] }
    ];

    const html = stages.map(stage => `
      <div class="bracket-col" data-stage="${stage.key}">
        <h4 class="bracket-stage">${stage.label}</h4>
        <div class="bracket-col-matches">
          ${stage.matches.map(m => renderBracketMatch(m, stage.label)).join('')}
        </div>
      </div>
    `).join('');

    $('#bracket').innerHTML = html;
  }

  function renderBracketMatch(m, stageLabel) {
    if (!m) return '';
    const home = Data.getTeam(m.home);
    const away = Data.getTeam(m.away);
    if (!home || !away) return '';

    const winHome = m.winner === home.code;
    const penA = m.pen === 'A' ? ' (p)' : '';
    const penB = m.pen === 'B' ? ' (p)' : '';
    const id = regMatch(m, stageLabel);

    return `
      <div class="bracket-match ${m.pen ? 'is-pens' : ''}" data-match-id="${id}">
        <div class="bm-team ${winHome ? 'win' : 'lose'}">
          <span class="bm-flag">${home.flag}</span>
          <span class="bm-code">${escapeHtml(home.code)}</span>
          <span class="bm-score">${m.goalsA}${penA}</span>
        </div>
        <div class="bm-team ${!winHome ? 'win' : 'lose'}">
          <span class="bm-flag">${away.flag}</span>
          <span class="bm-code">${escapeHtml(away.code)}</span>
          <span class="bm-score">${m.goalsB}${penB}</span>
        </div>
      </div>
    `;
  }

  // =================== MATCH EXPLAINER MODAL ===================

  function bindMatchClicks() {
    document.addEventListener('click', e => {
      const card = e.target.closest('[data-match-id]');
      if (card) {
        const entry = matchReg.get(card.dataset.matchId);
        if (entry) openModal(entry.match, entry.stage);
        return;
      }
      const closeTrigger = e.target.closest('[data-close]');
      if (closeTrigger && closeTrigger.closest('#matchModal')) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  }

  function openModal(m, stageLabel) {
    const teamA = Data.getTeam(m.home);
    const teamB = Data.getTeam(m.away);
    if (!teamA || !teamB) return;

    const winnerIsA = m.winner === teamA.code;
    const winner = winnerIsA ? teamA : teamB;
    const loser  = winnerIsA ? teamB : teamA;

    const sA = Predict.teamStrength(teamA);
    const sB = Predict.teamStrength(teamB);
    const xiA = avgBestXI(teamA);
    const xiB = avgBestXI(teamB);
    const pA = 1 / (1 + Math.exp(-(sA - sB) / 6));
    const pB = 1 - pA;

    const bullets = reasoningBullets(m, teamA, teamB, sA, sB, xiA, xiB);
    const penNote = m.pen ? `<div class="pen-banner">⚽ Decided on penalties</div>` : '';

    $('#modalBody').innerHTML = `
      <header class="modal-header">
        <div class="modal-stage">${escapeHtml(stageLabel)}</div>
        <div class="modal-final-score">
          <div class="mfs-team ${winnerIsA ? 'is-win' : ''}">
            <div class="mfs-flag">${teamA.flag}</div>
            <div class="mfs-name">${escapeHtml(teamA.name)}</div>
          </div>
          <div class="mfs-scores">
            <span class="${winnerIsA ? 'win' : ''}">${m.goalsA}</span>
            <span class="dash">–</span>
            <span class="${!winnerIsA ? 'win' : ''}">${m.goalsB}</span>
          </div>
          <div class="mfs-team ${!winnerIsA ? 'is-win' : ''}">
            <div class="mfs-flag">${teamB.flag}</div>
            <div class="mfs-name">${escapeHtml(teamB.name)}</div>
          </div>
        </div>
        ${penNote}
      </header>

      <section class="modal-reasoning">
        <h4 class="modal-h4">Why this result</h4>
        <ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
      </section>

      <section class="modal-numbers">
        <h4 class="modal-h4">By the numbers</h4>
        <div class="prob-bar">
          <div class="prob-fill prob-a" style="width:${(pA*100).toFixed(1)}%">${escapeHtml(teamA.code)} ${(pA*100).toFixed(0)}%</div>
          <div class="prob-fill prob-b" style="width:${(pB*100).toFixed(1)}%">${(pB*100).toFixed(0)}% ${escapeHtml(teamB.code)}</div>
        </div>
        <table class="stats-table">
          <thead>
            <tr><th></th><th>${teamA.flag} ${escapeHtml(teamA.code)}</th><th>${teamB.flag} ${escapeHtml(teamB.code)}</th></tr>
          </thead>
          <tbody>
            ${statRow('Overall strength', sA.toFixed(1), sB.toFixed(1), sA, sB)}
            ${statRow('Best XI avg', xiA.toFixed(1), xiB.toFixed(1), xiA, xiB)}
            ${statRow('FIFA rank', '#' + teamA.fifa_rank, '#' + teamB.fifa_rank, -teamA.fifa_rank, -teamB.fifa_rank)}
            ${statRow('Pre-match P(win)', (pA*100).toFixed(0) + '%', (pB*100).toFixed(0) + '%', pA, pB)}
          </tbody>
        </table>
      </section>
    `;

    $('#matchModal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function statRow(label, valA, valB, rawA, rawB) {
    const aLead = rawA > rawB, bLead = rawB > rawA;
    return `<tr>
      <td class="lbl">${escapeHtml(label)}</td>
      <td class="${aLead ? 'lead' : ''}">${escapeHtml(valA)}</td>
      <td class="${bLead ? 'lead' : ''}">${escapeHtml(valB)}</td>
    </tr>`;
  }

  function closeModal() {
    const modal = $('#matchModal');
    if (modal && !modal.hidden) {
      modal.hidden = true;
      document.body.style.overflow = '';
    }
  }

  function avgBestXI(team) {
    const sq = Data.getSquad(team.code) || [];
    if (sq.length < 11) return Math.max(60, 90 - team.fifa_rank * 0.4);
    return sq.map(p => p.rating).sort((a, b) => b - a).slice(0, 11)
      .reduce((s, r) => s + r, 0) / 11;
  }

  function reasoningBullets(m, teamA, teamB, sA, sB, xiA, xiB) {
    const winnerIsA = m.winner === teamA.code;
    const winner = winnerIsA ? teamA : teamB;
    const loser  = winnerIsA ? teamB : teamA;
    const sWin = winnerIsA ? sA : sB;
    const sLose = winnerIsA ? sB : sA;
    const xiWin = winnerIsA ? xiA : xiB;
    const xiLose = winnerIsA ? xiB : xiA;
    const delta = sWin - sLose;
    const gWin  = winnerIsA ? m.goalsA : m.goalsB;
    const gLose = winnerIsA ? m.goalsB : m.goalsA;
    const margin = gWin - gLose;

    const bullets = [];

    // Bullet 1 — strength comparison
    if (delta < -3) {
      bullets.push(`<b>Big upset.</b> ${winner.name} (${sWin.toFixed(1)}) entered well below ${loser.name} (${sLose.toFixed(1)}) — knockout football doesn't always honour the seedings.`);
    } else if (delta < -1) {
      bullets.push(`<b>Slight upset.</b> ${loser.name} (${sLose.toFixed(1)}) was the marginal favourite over ${winner.name} (${sWin.toFixed(1)}); the gap was too thin to be safe.`);
    } else if (delta < 1.5) {
      bullets.push(`<b>Essentially a coinflip.</b> Both sides within 1.5 strength points (${sWin.toFixed(1)} vs ${sLose.toFixed(1)}) — could have gone either way.`);
    } else if (delta < 5) {
      bullets.push(`${winner.name} held a meaningful strength edge (${sWin.toFixed(1)} vs ${sLose.toFixed(1)}) — favourites converted, as expected.`);
    } else {
      bullets.push(`${winner.name} were heavy favourites with a ${delta.toFixed(1)}-point gap (${sWin.toFixed(1)} vs ${sLose.toFixed(1)}).`);
    }

    // Bullet 2 — most-distinguishing input factor
    const rankGap = loser.fifa_rank - winner.fifa_rank;
    const xiGap = xiWin - xiLose;
    if (Math.abs(rankGap) > 25 && rankGap > 0) {
      bullets.push(`FIFA ranks back it up: #${winner.fifa_rank} ${winner.name} vs #${loser.fifa_rank} ${loser.name} — a chasm on paper.`);
    } else if (xiGap > 5) {
      bullets.push(`Starting-XI quality favours ${winner.name} (${xiWin.toFixed(1)} avg) over ${loser.name} (${xiLose.toFixed(1)}); class across the pitch.`);
    } else if (xiGap > 2) {
      bullets.push(`${winner.name}'s top XI averages ${xiWin.toFixed(1)} vs ${xiLose.toFixed(1)} — a small but real edge in talent.`);
    } else if (xiGap < -1.5) {
      bullets.push(`On paper, ${loser.name} had the stronger XI (${xiLose.toFixed(1)} vs ${xiWin.toFixed(1)}); ${winner.name} got the job done anyway.`);
    } else {
      bullets.push(`Talent was evenly split (XI avg ${xiWin.toFixed(1)} vs ${xiLose.toFixed(1)}); execution, not the team-sheet, decided this.`);
    }

    // Bullet 3 — scoreline narrative
    if (m.pen) {
      bullets.push(`Regulation finished ${gWin}-${gLose}. ${winner.name} won the shoot-out — at this stage, penalties are close to a coinflip with a slight edge to the stronger side.`);
    } else if (margin >= 4) {
      bullets.push(`A ${gWin}-${gLose} demolition; ${loser.name} never got into the match.`);
    } else if (margin === 3) {
      bullets.push(`A ${gWin}-${gLose} scoreline reflects ${winner.name} in control throughout.`);
    } else if (margin === 2) {
      bullets.push(`${winner.name} eased to a ${gWin}-${gLose} win — clear by the final whistle.`);
    } else if (gWin === 1 && gLose === 0) {
      bullets.push(`A 1-0 grind. One moment of quality from ${winner.name} was enough.`);
    } else if (margin === 1) {
      bullets.push(`A ${gWin}-${gLose} edge; ${loser.name} pushed but couldn't find the equaliser.`);
    } else {
      bullets.push(`A tight ${gWin}-${gLose} result — fine margins decided it.`);
    }

    return bullets;
  }
};
