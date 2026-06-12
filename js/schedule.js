;(window.Views = window.Views || {}).home = async function () {
  const { formatIST, escapeHtml, debounce, $, $$ } = Utils;

  await Data.load({ squads: true });

  // 'all' = whole schedule; otherwise a YYYY-MM-DD IST day key.
  const state = { search: '', dayKey: 'all', stage: 'all' };

  const sortedMatches = () => Data.getMatches().slice().sort(
    (a, b) => new Date(a.date_utc) - new Date(b.date_utc)
  );

  // ---- date helpers (IST day keys) ----
  const todayKey = formatIST(new Date().toISOString()).dayKey;
  function addDaysKey(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${mm}-${dd}`;
  }
  const keyLabel = key => formatIST(key + 'T06:00:00Z'); // -> {date,...} in IST

  const MIN_KEY = '2026-06-11', MAX_KEY = '2026-07-19'; // tournament range
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Days (IST) that have at least one fixture — used to dot the calendar.
  function matchDayKeys() {
    const s = new Set();
    Data.getMatches().forEach(m => s.add(formatIST(m.date_utc).dayKey));
    return s;
  }

  // Single place that changes the active day; keeps pills, calendar + list in sync.
  function setDay(key) {
    state.dayKey = key;
    syncPillActive();
    updatePickLabel();
    if (calView && !$('#datePopover').hidden) renderCalendar();
    render();
  }

  function updatePickLabel() {
    const el = $('#datePickLabel');
    const btn = $('#datePickBtn');
    if (!el) return;
    if (state.dayKey === 'all') {
      el.textContent = 'Pick date';
      btn.classList.remove('has-date');
    } else {
      el.textContent = keyLabel(state.dayKey).date.replace(/^\w+,\s*/, ''); // "14 Jun"
      btn.classList.add('has-date');
    }
  }

  // Which days actually have live matches (for a subtle pill highlight).
  function liveDayKeys() {
    const s = new Set();
    Data.getMatches().forEach(m => {
      if (m.status === 'live') s.add(formatIST(m.date_utc).dayKey);
    });
    return s;
  }

  renderHero();
  renderDatePills();
  renderStageFilter();
  bindControls();
  updatePickLabel();
  render();

  Data.onRefresh(() => { renderHero(); renderDatePills(); render(); });

  // ---- controls ----
  function bindControls() {
    bindSearch();
    bindCalendar();
    bindPredModal();
    $('#clearDate').addEventListener('click', () => setDay('all'));
  }

  // ---- prediction explainer modal ----
  function bindPredModal() {
    const modal = $('#predModal');
    $('#matchList').addEventListener('click', e => {
      const btn = e.target.closest('.prediction[data-pred]');
      if (btn) openPredModal(btn.dataset.pred);
    });
    modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) modal.hidden = true; });
    if (window.__predEscCleanup) window.__predEscCleanup();
    const onEsc = e => { if (e.key === 'Escape') modal.hidden = true; };
    document.addEventListener('keydown', onEsc);
    window.__predEscCleanup = () => document.removeEventListener('keydown', onEsc);
  }

  function openPredModal(matchId) {
    const m = Data.getMatches().find(x => x.id === matchId);
    if (!m) return;
    const home = Data.getTeam(m.home), away = Data.getTeam(m.away);
    if (!home || !away || typeof Predict === 'undefined' || !Predict.predictMatch) return;
    const p = Predict.predictMatch(home, away);
    if (!p) return;

    const hWin = Math.round(p.pA * 100), aWin = Math.round(p.pB * 100);
    const baseH = Predict.baseStrength(home), baseA = Predict.baseStrength(away);
    const bdH = Ratings.getBreakdown ? Ratings.getBreakdown(home.code) : { total: 0 };
    const bdA = Ratings.getBreakdown ? Ratings.getBreakdown(away.code) : { total: 0 };
    const mom = v => (v > 0 ? '+' : '') + v.toFixed(1);

    $('#predModalBody').innerHTML = `
      <div class="pm">
        <h3 class="pm-title">Why this pick?</h3>
        <div class="pm-match">
          <span>${home.flag} ${escapeHtml(home.name)}</span>
          <span class="pm-vs">vs</span>
          <span>${escapeHtml(away.name)} ${away.flag}</span>
        </div>

        <div class="pm-pick">Model pick: <b>${p.winner.flag} ${escapeHtml(p.winner.name)}</b>
          <span class="pm-conf">${p.confidence}% confidence</span></div>

        <div class="pm-prob-bar">
          <span class="pm-prob-h" style="width:${hWin}%">${hWin}%</span>
          <span class="pm-prob-a" style="width:${aWin}%">${aWin}%</span>
        </div>
        <div class="pm-prob-lbls"><span>${home.flag} ${escapeHtml(home.code)}</span><span>${escapeHtml(away.code)} ${away.flag}</span></div>

        <p class="pm-note"><b>What the % means.</b> The number on the card is the model's
          <b>confidence</b> — how decisively it favours the pick (0% = a coin-flip, 100% = near-certain).
          It's the gap between the teams' projected strengths run through a logistic curve, which gives the
          win split above.</p>

        <div class="pm-strength">
          <div class="pm-srow pm-shead"><span>Team</span><span>Squad</span><span>Momentum</span><span>Projected</span></div>
          <div class="pm-srow"><span>${home.flag} ${escapeHtml(home.code)}</span><span>${baseH.toFixed(1)}</span><span class="${bdH.total >= 0 ? 'up' : 'down'}">${mom(bdH.total)}</span><span><b>${p.strengthA.toFixed(1)}</b></span></div>
          <div class="pm-srow"><span>${away.flag} ${escapeHtml(away.code)}</span><span>${baseA.toFixed(1)}</span><span class="${bdA.total >= 0 ? 'up' : 'down'}">${mom(bdA.total)}</span><span><b>${p.strengthB.toFixed(1)}</b></span></div>
        </div>

        <p class="pm-foot"><b>Squad</b> = player ratings + FIFA rank. <b>Momentum</b> shifts it live from
          tournament results and player match-ratings — so this pick sharpens as the World Cup unfolds.</p>
      </div>`;
    $('#predModal').hidden = false;
  }

  // ---- custom, themed calendar popover ----
  let calView = null; // { y, m } month on screen (m 0-based)

  function bindCalendar() {
    const btn = $('#datePickBtn');
    const pop = $('#datePopover');

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (pop.hidden) {
        const base = state.dayKey !== 'all' ? state.dayKey
          : (todayKey >= MIN_KEY && todayKey <= MAX_KEY ? todayKey : MIN_KEY);
        const [y, m] = base.split('-').map(Number);
        calView = { y, m: m - 1 };
        renderCalendar();
        pop.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      } else {
        closeCal();
      }
    });

    // Outside-click / Escape to close. Dedupe across view re-inits.
    if (window.__calCleanup) window.__calCleanup();
    const onDoc = e => { if (!pop.hidden && !e.target.closest('.date-pick')) closeCal(); };
    const onKey = e => { if (e.key === 'Escape') closeCal(); };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    window.__calCleanup = () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }

  function closeCal() {
    const pop = $('#datePopover'), btn = $('#datePickBtn');
    if (pop) pop.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function renderCalendar() {
    const pop = $('#datePopover');
    const { y, m } = calView;
    const startDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const matchDays = matchDayKeys();
    const canPrev = !(y === 2026 && m <= 5);
    const canNext = !(y === 2026 && m >= 6);

    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<span class="cal-cell empty"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const disabled = key < MIN_KEY || key > MAX_KEY;
      const cls = ['cal-cell'];
      if (disabled) cls.push('disabled');
      if (key === state.dayKey) cls.push('selected');
      if (key === todayKey) cls.push('today');
      const dot = (!disabled && matchDays.has(key)) ? '<span class="cal-dot"></span>' : '';
      cells += `<button class="${cls.join(' ')}" data-key="${key}"${disabled ? ' disabled' : ''}>${d}${dot}</button>`;
    }

    pop.innerHTML = `
      <div class="cal-head">
        <button class="cal-nav" data-nav="-1"${canPrev ? '' : ' disabled'} aria-label="Previous month">‹</button>
        <span class="cal-title">${MONTHS[m]} ${y}</span>
        <button class="cal-nav" data-nav="1"${canNext ? '' : ' disabled'} aria-label="Next month">›</button>
      </div>
      <div class="cal-dow">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cal-days">${cells}</div>`;

    pop.querySelectorAll('.cal-nav').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      if (b.disabled) return;
      calView.m += Number(b.dataset.nav);
      if (calView.m < 0) { calView.m = 11; calView.y--; }
      else if (calView.m > 11) { calView.m = 0; calView.y++; }
      renderCalendar();
    }));
    pop.querySelectorAll('.cal-cell[data-key]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!b.disabled) { setDay(b.dataset.key); closeCal(); }
    }));
  }

  // Autocomplete: suggest teams + groups while typing; picking one filters the
  // schedule (and the list also filters live as you type).
  function bindSearch() {
    const input = $('#search');
    const list = $('#searchResults');
    const teams = Data.getTeams();
    const groups = [...new Set(teams.map(t => t.group))].sort();
    let items = [];
    let hi = -1;

    function suggest(q) {
      q = q.toLowerCase().trim();
      if (!q) return [];
      const teamHits = teams
        .filter(t => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))
        .slice(0, 6)
        .map(t => ({ q: t.name.toLowerCase(), flag: t.flag, label: t.name, sub: 'Group ' + t.group }));
      const groupHits = groups
        .filter(g => ('group ' + g).toLowerCase().includes(q))
        .slice(0, 2)
        .map(g => ({ q: 'group ' + g.toLowerCase(), flag: '🏆', label: 'Group ' + g, sub: 'Group stage' }));
      return [...teamHits, ...groupHits];
    }

    function paint() {
      if (!items.length) { list.hidden = true; return; }
      list.innerHTML = items.map((it, i) => `
        <li class="search-result ${i === hi ? 'highlighted' : ''}" data-i="${i}">
          <span class="result-flag">${it.flag}</span>
          <span class="result-name">${escapeHtml(it.label)}</span>
          <span class="result-group">${escapeHtml(it.sub)}</span>
        </li>`).join('');
      list.hidden = false;
    }

    function refresh() {
      state.search = input.value.trim().toLowerCase();
      items = suggest(input.value);
      hi = -1;
      paint();
      render();
    }

    function choose(it) {
      input.value = it.label;
      state.search = it.q;
      list.hidden = true;
      render();
    }

    input.addEventListener('input', refresh);
    input.addEventListener('focus', () => { items = suggest(input.value); paint(); });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
    input.addEventListener('keydown', e => {
      if (!items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = (hi + 1) % items.length; paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hi = (hi - 1 + items.length) % items.length; paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(items[hi >= 0 ? hi : 0]); }
      else if (e.key === 'Escape') { list.hidden = true; }
    });
    list.addEventListener('mousedown', e => {
      const li = e.target.closest('.search-result');
      if (li) choose(items[+li.dataset.i]);
    });
  }

  function renderDatePills() {
    const live = liveDayKeys();
    const pills = [{ key: 'all', main: 'All', sub: 'Full schedule' }];
    for (let i = 0; i < 4; i++) {
      const key = addDaysKey(todayKey, i);
      const l = keyLabel(key);
      const main = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : l.date.split(',')[0];
      const sub = `${key.split('-')[2]} ${l.date.split(' ')[2]}`;
      pills.push({ key, main, sub, live: live.has(key) });
    }

    $('#datePills').innerHTML = pills.map(p => `
      <button class="date-pill ${state.dayKey === p.key ? 'active' : ''} ${p.live ? 'has-live' : ''}" data-day="${p.key}">
        <span>${escapeHtml(p.main)}</span>
        <span class="pill-sub">${escapeHtml(p.sub)}</span>
      </button>`).join('');

    $$('#datePills .date-pill').forEach(btn => {
      btn.addEventListener('click', () => setDay(btn.dataset.day));
    });
  }

  function syncPillActive() {
    $$('#datePills .date-pill').forEach(b =>
      b.classList.toggle('active', b.dataset.day === state.dayKey));
  }

  function renderStageFilter() {
    const stages = [
      ['all', 'All stages'], ['group', 'Group'], ['r32', 'Round of 32'],
      ['r16', 'Round of 16'], ['qf', 'Quarter-final'], ['sf', 'Semi-final'],
      ['3rd', '3rd place'], ['final', 'Final']
    ];
    const c = $('#stageFilter');
    c.innerHTML = stages.map(([k, l]) =>
      `<button class="stage-pill ${state.stage === k ? 'active' : ''}" data-stage="${k}">${escapeHtml(l)}</button>`
    ).join('');
    c.addEventListener('click', e => {
      const btn = e.target.closest('.stage-pill');
      if (!btn) return;
      state.stage = btn.dataset.stage;
      $$('.stage-pill', c).forEach(b => b.classList.toggle('active', b.dataset.stage === state.stage));
      render();
    });
  }

  // ---- hero ----
  function renderHero() {
    const ms = Data.getMatches();
    const liveMatches = ms.filter(m => m.status === 'live');
    const played = ms.filter(m => m.status === 'played').length;
    const upcoming = ms.filter(m => m.status !== 'played' && m.status !== 'live').length;

    // Live scoreline chip(s) where the live indicator sits — tap to jump to it.
    const liveChips = liveMatches.map(m => {
      const h = Data.getTeam(m.home), a = Data.getTeam(m.away);
      const hs = Number.isFinite(m.home_score) ? m.home_score : 0;
      const as = Number.isFinite(m.away_score) ? m.away_score : 0;
      const hl = h ? `${h.flag} ${escapeHtml(h.code)}` : escapeHtml(m.home_label || '');
      const al = a ? `${escapeHtml(a.code)} ${a.flag}` : escapeHtml(m.away_label || '');
      return `<a class="hero-live-chip" href="#liveSection">
        <span class="hlc-badge">● LIVE</span>
        <span class="hlc-score">${hl} <b>${hs}–${as}</b> ${al}</span>
      </a>`;
    }).join('');

    const stats = `
      <div class="hero-stat"><div class="n">${played}</div><div class="l">Played</div></div>
      <div class="hero-stat"><div class="n">${upcoming}</div><div class="l">Upcoming</div></div>`;

    $('#heroStats').innerHTML =
      (liveChips ? `<div class="hero-live">${liveChips}</div>` : '') +
      `<div class="hero-stat-row">${stats}</div>`;
  }

  // ---- filtering ----
  function matchMatchesFilters(m) {
    if (state.stage !== 'all' && m.stage !== state.stage) return false;
    if (state.dayKey !== 'all' && formatIST(m.date_utc).dayKey !== state.dayKey) return false;
    if (state.search) {
      const q = state.search;
      const home = Data.getTeam(m.home), away = Data.getTeam(m.away);
      const hits = [
        home && home.name.toLowerCase(), home && home.code.toLowerCase(),
        away && away.name.toLowerCase(), away && away.code.toLowerCase(),
        m.home_label && m.home_label.toLowerCase(), m.away_label && m.away_label.toLowerCase(),
        m.group && ('group ' + m.group.toLowerCase())
      ].filter(Boolean);
      if (!hits.some(h => h.includes(q))) return false;
    }
    return true;
  }

  function dataStatusBanner() {
    const updated = Data.getLastUpdated();
    if (!updated) return '';
    let ago = '';
    try { ago = new Date(updated).toLocaleTimeString(); } catch (e) {}
    return `<div class="data-status">⚡ Live data · updated ${escapeHtml(ago)}</div>`;
  }

  // ---- render ----
  function render() {
    const list = $('#matchList');
    const filtered = sortedMatches().filter(matchMatchesFilters);

    if (filtered.length === 0) {
      list.innerHTML = dataStatusBanner() +
        `<div class="empty-state"><span class="es-emoji">📅</span>No matches for this filter.<br>Tap <strong>All</strong> to see the full schedule.</div>`;
      return;
    }

    let html = dataStatusBanner();

    // Surface live matches in their own spotlight section.
    const live = filtered.filter(m => m.status === 'live');
    const rest = filtered.filter(m => m.status !== 'live');

    if (live.length) {
      html += `<div class="section-title live" id="liveSection">● Live now</div>`;
      html += live.map(m => renderCard(m, formatIST(m.date_utc))).join('');
    }

    let lastDay = null;
    rest.forEach(m => {
      const f = formatIST(m.date_utc);
      if (f.dayKey !== lastDay) {
        html += `<div class="day-header">${escapeHtml(f.date)}</div>`;
        lastDay = f.dayKey;
      }
      html += renderCard(m, f);
    });

    list.innerHTML = html;
  }

  function renderCard(m, f) {
    const home = m.home ? Data.getTeam(m.home) : null;
    const away = m.away ? Data.getTeam(m.away) : null;
    const venue = Data.getVenue(m.venue_id);

    const stageLabel = ({
      group: m.group ? `Group ${m.group} · MD${m.matchday}` : 'Group',
      r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-final',
      sf: 'Semi-final', '3rd': '3rd place', final: 'Final'
    })[m.stage];
    const stageClass = m.stage === 'group' ? '' : 'knockout';

    const homeBlock = home
      ? `<a class="team-link" href="#/teams/${home.code}"><span class="flag">${home.flag}</span><span class="name">${escapeHtml(home.name)}</span></a>`
      : `<span class="flag">·</span><span class="name tbd">${escapeHtml(m.home_label || 'TBD')}</span>`;
    const awayBlock = away
      ? `<a class="team-link" href="#/teams/${away.code}"><span class="flag">${away.flag}</span><span class="name">${escapeHtml(away.name)}</span></a>`
      : `<span class="flag">·</span><span class="name tbd">${escapeHtml(m.away_label || 'TBD')}</span>`;

    const isLive = m.status === 'live';
    const isPlayed = m.status === 'played';
    const hasScore = Number.isFinite(m.home_score) && Number.isFinite(m.away_score);

    const centerBlock = hasScore
      ? `<span class="score ${isLive ? 'live' : ''}">${m.home_score}<span class="score-sep">–</span>${m.away_score}</span>`
      : `<span class="vs">VS</span>`;
    const statusBadge = isLive ? `<span class="live-badge">● LIVE</span>`
      : isPlayed ? `<span class="ft-badge">FT</span>` : '';

    const pred = isPlayed ? null : Data.predict(m);
    const predBlock = pred
      ? `<button type="button" class="prediction" data-pred="${escapeHtml(m.id)}" title="Why this pick?">
           <span class="label">Pick</span>
           <span class="winner">${pred.winner.flag} ${escapeHtml(pred.winner.code)}</span>
           <span class="confidence-bar"><span class="confidence-fill" style="width:${pred.confidence}%"></span></span>
           <span class="pct">${pred.confidence}%<span class="pct-lbl">confidence</span></span>
           <span class="pred-info" aria-hidden="true">ⓘ</span>
         </button>`
      : '';

    const venueText = m.venue_name
      ? `${escapeHtml(m.venue_name)}${m.venue_city ? ' · ' + escapeHtml(m.venue_city) : ''}`
      : venue ? `${escapeHtml(venue.name)} · ${escapeHtml(venue.city)}` : 'Venue TBD';

    return `
      <article class="match-card ${isLive ? 'is-live' : ''}">
        <div class="match-meta">
          <span class="stage-badge ${stageClass}">${escapeHtml(stageLabel)}</span>
          ${statusBadge}
          <span>${escapeHtml(m.id)}</span>
        </div>
        <div class="match-teams">
          <div class="team home">${homeBlock}</div>
          ${centerBlock}
          <div class="team away">${awayBlock}</div>
        </div>
        ${predBlock}
        <div class="match-info">
          <span class="venue">📍 ${venueText}</span>
          <span class="kickoff">${escapeHtml(f.time)}</span>
        </div>
      </article>`;
  }
};
