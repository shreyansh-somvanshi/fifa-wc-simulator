// Standings tab: live group tables built from real played results, plus a
// knockout bracket map that resolves Winner/Runner-up slots as each group is
// mathematically decided (all its matches played). Updates on poll/refresh.

;(window.Views = window.Views || {}).standings = async function () {
  const { escapeHtml, $ } = Utils;

  await Data.load({ squads: true });

  const GROUP_LETTERS = 'ABCDEFGHIJKL'.split('');

  render();
  Data.onRefresh(render);

  // --- helpers ----------------------------------------------------------

  // Group is "decided" once all its group-stage matches have been played.
  function groupProgress(letter) {
    const ms = Data.getMatches().filter(m => m.stage === 'group' && m.group === letter);
    const played = ms.filter(m => m.status === 'played').length;
    return { played, total: ms.length, complete: ms.length > 0 && played === ms.length };
  }

  function statusLine() {
    const updated = Data.getLastUpdated();
    const live = Data.getMatches().filter(m => m.status === 'live').length;
    const decided = GROUP_LETTERS.filter(l => groupProgress(l).complete).length;
    const bits = [];
    if (live) bits.push(`<span class="live-badge">● ${live} LIVE</span>`);
    bits.push(`${decided}/12 groups decided`);
    if (updated) { try { bits.push(`as of ${escapeHtml(new Date(updated).toLocaleTimeString())}`); } catch (e) {} }
    else bits.push('no results loaded yet');
    return '· ' + bits.join(' · ');
  }

  // Live momentum chip: how far results + player form have moved a team's
  // strength from its squad baseline (drives the simulator's win probabilities).
  function momChip(code) {
    const b = Ratings.getBreakdown(code);
    const v = Math.round(b.total);
    if (!v) return '';
    const dir = v > 0 ? 'up' : 'down';
    const tip = `Form-adjusted strength ${v > 0 ? '+' : ''}${v}` +
      ` (results ${b.elo >= 0 ? '+' : ''}${b.elo.toFixed(1)}, form ${b.form >= 0 ? '+' : ''}${b.form.toFixed(1)})`;
    return `<span class="mom ${dir}" title="${tip}">${v > 0 ? '▲' : '▼'}${Math.abs(v)}</span>`;
  }

  // --- group standings --------------------------------------------------

  function render() {
    renderGroups();
    renderBracket();
    const s = $('#standingsStatus');
    if (s) s.innerHTML = statusLine();
  }

  function renderGroups() {
    const html = GROUP_LETTERS.map(letter => {
      const rows = Ratings.getStandings(letter);
      const prog = groupProgress(letter);
      const tag = prog.complete
        ? '<span class="ft-badge">decided</span>'
        : `<span class="grp-prog">${prog.played}/${prog.total}</span>`;

      return `
        <section class="group-table">
          <h3 class="group-title">Group ${letter} ${tag}</h3>
          <table>
            <thead>
              <tr><th class="t-team">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr>
            </thead>
            <tbody>
              ${rows.map((s, i) => `
                <tr class="row-${i < 2 ? 'win' : i === 2 ? 'maybe' : 'out'}">
                  <td class="t-team"><span class="t-flag">${s.team.flag}</span><span class="t-name">${escapeHtml(s.team.name)}</span>${momChip(s.team.code)}</td>
                  <td>${s.played}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td>
                  <td>${s.gf}</td><td>${s.ga}</td>
                  <td>${s.gd > 0 ? '+' : ''}${s.gd}</td>
                  <td class="t-pts">${s.pts}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </section>`;
    }).join('');
    $('#groups').innerHTML = html;
  }

  // --- knockout bracket map --------------------------------------------

  // Resolve a placeholder label ("Winner A" / "Runner-up B") to a real team
  // once that group is decided. Returns a team object or null (keep the label).
  function resolveLabel(label) {
    if (!label) return null;
    let m = label.match(/^Winner ([A-L])$/);
    if (m && groupProgress(m[1]).complete) return Ratings.getStandings(m[1])[0].team;
    m = label.match(/^Runner-up ([A-L])$/);
    if (m && groupProgress(m[1]).complete) return Ratings.getStandings(m[1])[1].team;
    return null;
  }

  // One side of a bracket match: real KO result team > resolved group slot > label.
  function sideHtml(code, label) {
    const team = code ? Data.getTeam(code) : resolveLabel(label);
    if (team) {
      return `<span class="bm-side resolved"><span class="t-flag">${team.flag}</span><span class="bm-code">${escapeHtml(team.code)}</span></span>`;
    }
    return `<span class="bm-side tbd">${escapeHtml(label || 'TBD')}</span>`;
  }

  function bracketMatchHtml(m) {
    const hs = Number.isFinite(m.home_score) ? m.home_score : null;
    const as = Number.isFinite(m.away_score) ? m.away_score : null;
    const score = (hs != null && as != null) ? `<span class="bm-score">${hs}–${as}</span>` : '';
    return `
      <div class="bracket-match">
        ${sideHtml(m.home, m.home_label)}
        ${score || '<span class="bm-vs">v</span>'}
        ${sideHtml(m.away, m.away_label)}
      </div>`;
  }

  function renderBracket() {
    const matches = Data.getMatches();
    const stages = [
      { key: 'r32',   label: 'Round of 32' },
      { key: 'r16',   label: 'Round of 16' },
      { key: 'qf',    label: 'Quarter-finals' },
      { key: 'sf',    label: 'Semi-finals' },
      { key: '3rd',   label: '3rd place' },
      { key: 'final', label: 'Final' }
    ];

    const html = stages.map(stage => {
      const ms = matches.filter(m => m.stage === stage.key);
      if (!ms.length) return '';
      return `
        <div class="bracket-col" data-stage="${stage.key}">
          <h4 class="bracket-stage">${stage.label}</h4>
          <div class="bracket-col-matches">
            ${ms.map(bracketMatchHtml).join('')}
          </div>
        </div>`;
    }).join('');

    $('#bracket').innerHTML = html;
  }
};
