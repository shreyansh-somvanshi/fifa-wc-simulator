;(window.Views = window.Views || {}).teams = async function (params) {
  const { escapeHtml, formatIST, $, $$ } = Utils;
  await Data.load({ squads: true });

  const code = ((params && params.code) || 'BRA').toUpperCase();
  const team = Data.getTeam(code);

  if (!team) {
    $('#teamRoot').innerHTML = `<div class="empty-state">Unknown team code: ${escapeHtml(code)}.</div>`;
    return;
  }

  const squad = Data.getSquad(code);
  const xi = bestXI(squad);
  const overall = xi.starters.length
    ? Math.round(xi.starters.reduce((s, p) => s + p.rating, 0) / xi.starters.length)
    : null;

  renderTeamPicker();
  renderHeader();
  renderTabs();
  bindTabs();

  // ---- Typable team search combobox ----
  function renderTeamPicker() {
    const input = $('#teamSearchInput');
    const list = $('#teamSearchResults');
    const allTeams = Data.getTeams().slice().sort((a, b) => a.name.localeCompare(b.name));
    let highlightIdx = -1;

    input.placeholder = `Search a team… (current: ${team.name})`;

    function render(matches) {
      if (!matches.length) {
        list.innerHTML = `<li class="no-results">No team matches</li>`;
      } else {
        list.innerHTML = matches.map((t, i) => `
          <li class="search-result ${t.code === code ? 'is-current' : ''}" data-code="${t.code}" data-idx="${i}">
            <span class="result-flag">${t.flag}</span>
            <span class="result-name">${escapeHtml(t.name)}</span>
            <span class="result-group">Group ${t.group}</span>
          </li>
        `).join('');
      }
      list.hidden = false;
      highlightIdx = -1;
    }

    function filter(q) {
      const query = q.toLowerCase().trim();
      if (!query) return allTeams;
      return allTeams.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.code.toLowerCase().includes(query) ||
        ('group ' + t.group.toLowerCase()).includes(query)
      );
    }

    function setHighlight(idx) {
      const items = $$('.search-result', list);
      if (!items.length) return;
      highlightIdx = (idx + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
      items[highlightIdx].scrollIntoView({ block: 'nearest' });
    }

    function go(targetCode) {
      if (targetCode && targetCode !== code) {
        location.hash = `#/teams/${targetCode}`;
      } else {
        list.hidden = true;
      }
    }

    input.addEventListener('focus', () => { input.select(); render(filter(input.value)); });
    input.addEventListener('input', () => render(filter(input.value)));
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
    input.addEventListener('keydown', e => {
      const items = $$('.search-result', list);
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(highlightIdx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(highlightIdx - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = items[highlightIdx >= 0 ? highlightIdx : 0];
        if (pick) go(pick.dataset.code);
      } else if (e.key === 'Escape') {
        input.blur();
      }
    });
    list.addEventListener('mousedown', e => {
      const item = e.target.closest('.search-result');
      if (item) go(item.dataset.code);
    });
  }

  function renderHeader() {
    const h = $('#teamHeader');
    h.innerHTML = `
      <div class="team-hero">
        <div class="hero-flag">${team.flag}</div>
        <div class="hero-meta">
          <div class="hero-name">${escapeHtml(team.name)}</div>
          <div class="hero-sub">Group ${team.group} · FIFA Rank ${team.fifa_rank}</div>
        </div>
        <div class="hero-rating">
          <div class="rating-num">${overall ?? '—'}</div>
          <div class="rating-lbl">Overall</div>
        </div>
      </div>
    `;
  }

  function renderTabs() {
    $('#tabBestXI').innerHTML = renderBestXIView(xi);
    $('#tabSquad').innerHTML = renderSquadView(squad);
    $('#tabFixtures').innerHTML = renderFixturesView(code);
  }

  function bindTabs() {
    const tabs = $$('.team-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab' + target));
      });
    });
  }

  // ---- Best XI algorithm: 4-3-3 with positional fallback ----
  function bestXI(players) {
    if (players.length < 11) return { starters: [], slots: [] };

    const taken = new Set();
    const pick = (positions, slotName, role) => {
      for (const pos of positions) {
        const cand = players
          .filter(p => !taken.has(p) && p.pos === pos)
          .sort((a, b) => b.rating - a.rating);
        if (cand.length) {
          taken.add(cand[0]);
          return { slot: slotName, role, player: cand[0] };
        }
      }
      return { slot: slotName, role, player: null };
    };

    const slots = [
      pick(['GK'],                    'GK',  'GK'),
      pick(['LB','LWB','CB'],         'LB',  'DEF'),
      pick(['CB'],                    'CB1', 'DEF'),
      pick(['CB','CDM'],              'CB2', 'DEF'),
      pick(['RB','RWB','CB'],         'RB',  'DEF'),
      pick(['CDM','CM'],              'CDM', 'MID'),
      pick(['CM','CAM','CDM'],        'CM1', 'MID'),
      pick(['CM','CAM','CDM'],        'CM2', 'MID'),
      pick(['LW','CAM','ST'],         'LW',  'FWD'),
      pick(['ST','CAM'],              'ST',  'FWD'),
      pick(['RW','CAM','ST'],         'RW',  'FWD'),
    ];

    // Last-resort fill: when a position is too thin to fill exactly, take the
    // highest-rated remaining outfielder so every slot has a player.
    slots.forEach(s => {
      if (!s.player) {
        const remaining = players
          .filter(p => !taken.has(p) && p.pos !== 'GK')
          .sort((a, b) => b.rating - a.rating);
        if (remaining.length) {
          taken.add(remaining[0]);
          s.player = remaining[0];
        }
      }
    });

    return { starters: slots.filter(s => s.player).map(s => s.player), slots };
  }

  // ---- Best XI view: formation pitch SVG + starting eleven list ----
  function renderBestXIView(xi) {
    if (!xi.slots.length) {
      return `<div class="empty-state">Squad too small to compute a starting XI.</div>`;
    }

    // Pitch layout coords (% of pitch box). y grows downward.
    const coords = {
      GK:  { x: 50, y: 88 },
      LB:  { x: 12, y: 70 }, CB1: { x: 36, y: 72 }, CB2: { x: 64, y: 72 }, RB: { x: 88, y: 70 },
      CDM: { x: 50, y: 55 }, CM1: { x: 25, y: 45 }, CM2: { x: 75, y: 45 },
      LW:  { x: 18, y: 22 }, ST:  { x: 50, y: 15 }, RW: { x: 82, y: 22 }
    };

    const chips = xi.slots.map((s, i) => {
      const c = coords[s.slot];
      const posLabel = s.slot.replace(/[12]$/, '');
      if (!s.player) {
        return `<div class="player-chip empty" style="left:${c.x}%;top:${c.y}%;--i:${i}"><span class="chip-pos">${posLabel}</span></div>`;
      }
      const lastName = s.player.name.split(' ').slice(-1)[0];
      return `
        <div class="player-chip" style="left:${c.x}%;top:${c.y}%;--i:${i}" data-role="${s.role}" title="${escapeHtml(s.player.name)} · ${escapeHtml(s.player.club || '')}">
          <div class="chip-card">
            <div class="chip-top">
              <span class="chip-rating">${s.player.rating}</span>
              <span class="chip-pos">${posLabel}</span>
            </div>
            <span class="chip-name">${escapeHtml(lastName.toUpperCase())}</span>
          </div>
        </div>
      `;
    }).join('');

    const list = xi.slots.map(s => s.player ? `
      <li class="xi-row">
        <span class="xi-slot">${s.slot}</span>
        <span class="xi-name">${escapeHtml(s.player.name)}</span>
        <span class="xi-club">${escapeHtml(s.player.club || '')}</span>
        <span class="xi-rating">${s.player.rating}</span>
      </li>` : '').join('');

    return `
      <div class="formation-header">
        <span class="formation-name">Formation · 4-3-3</span>
        <span class="formation-overall">Avg ${overall}</span>
      </div>
      <div class="pitch">
        <svg class="pitch-markings" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true">
          <rect x="3" y="3" width="94" height="144" rx="0.8" />
          <line x1="3" y1="75" x2="97" y2="75" />
          <circle cx="50" cy="75" r="11" />
          <circle cx="50" cy="75" r="0.9" class="spot" />
          <rect x="22" y="3" width="56" height="18" />
          <rect x="22" y="129" width="56" height="18" />
          <rect x="36" y="3" width="28" height="7" />
          <rect x="36" y="140" width="28" height="7" />
          <circle cx="50" cy="15" r="0.9" class="spot" />
          <circle cx="50" cy="135" r="0.9" class="spot" />
          <path d="M 41 21 A 9 9 0 0 0 59 21" />
          <path d="M 41 129 A 9 9 0 0 1 59 129" />
          <path d="M 3 5 A 2 2 0 0 1 5 3" />
          <path d="M 95 3 A 2 2 0 0 1 97 5" />
          <path d="M 3 145 A 2 2 0 0 0 5 147" />
          <path d="M 95 147 A 2 2 0 0 0 97 145" />
        </svg>
        ${chips}
      </div>
      <ul class="xi-list">${list}</ul>
    `;
  }

  // ---- Full squad grouped by position ----
  function renderSquadView(players) {
    if (!players.length) return `<div class="empty-state">No squad data.</div>`;

    const positionOrder = ['GK','CB','LB','RB','LWB','RWB','CDM','CM','CAM','LW','RW','ST'];
    const groups = {};
    players.forEach(p => (groups[p.pos] = groups[p.pos] || []).push(p));

    const sections = positionOrder
      .filter(pos => groups[pos])
      .map(pos => {
        const rows = groups[pos]
          .slice()
          .sort((a, b) => b.rating - a.rating)
          .map(p => `
            <li class="squad-row">
              <span class="sq-rating">${p.rating}</span>
              <span class="sq-name">${escapeHtml(p.name)}</span>
              <span class="sq-club">${escapeHtml(p.club || '')}</span>
            </li>
          `).join('');
        return `
          <section class="squad-group">
            <h3 class="squad-group-title">${positionLabel(pos)} <small>${groups[pos].length}</small></h3>
            <ul class="squad-list">${rows}</ul>
          </section>
        `;
      }).join('');

    return sections;
  }

  function positionLabel(pos) {
    return ({
      GK: 'Goalkeepers',
      CB: 'Centre-backs', LB: 'Left-backs', RB: 'Right-backs', LWB: 'Left wing-backs', RWB: 'Right wing-backs',
      CDM: 'Defensive midfielders', CM: 'Central midfielders', CAM: 'Attacking midfielders',
      LW: 'Left wingers', RW: 'Right wingers', ST: 'Strikers'
    })[pos] || pos;
  }

  // ---- Team's fixtures ----
  function renderFixturesView(code) {
    const matches = Data.getMatches()
      .filter(m => m.home === code || m.away === code)
      .sort((a, b) => new Date(a.date_utc) - new Date(b.date_utc));

    if (!matches.length) return `<div class="empty-state">No fixtures.</div>`;

    return matches.map(m => {
      const opp = m.home === code ? Data.getTeam(m.away) : Data.getTeam(m.home);
      const f = formatIST(m.date_utc);
      const v = Data.getVenue(m.venue_id);
      const stageLbl = m.stage === 'group' ? `Group ${m.group} · MD${m.matchday}` : m.stage.toUpperCase();
      return `
        <a class="fixture-row" href="#/">
          <span class="fix-date">${escapeHtml(f.date)} · ${escapeHtml(f.time)}</span>
          <span class="fix-vs"><span class="fix-flag">${opp.flag}</span> vs ${escapeHtml(opp.name)}</span>
          <span class="fix-meta">${escapeHtml(stageLbl)} · ${escapeHtml(v ? v.city : 'TBD')}</span>
        </a>
      `;
    }).join('');
  }
};
