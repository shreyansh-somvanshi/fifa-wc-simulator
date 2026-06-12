// Client-side hash router. One persistent shell (header + nav); each view's
// markup lives in a <template> and its logic in window.Views[key]. Navigation
// swaps #view inside a View Transition (smooth cross-fade where supported) and
// slides the active-tab indicator — continuous motion, fully static-hostable
// on Vercel (hash routes need no server rewrites).

const App = (() => {
  const ROUTES = {
    home:      'tpl-home',
    standings: 'tpl-standings',
    teams:     'tpl-teams',
    simulator: 'tpl-simulator'
  };

  let current = null;

  // "#/teams/ARG" -> { key:'teams', params:{ code:'ARG' } }
  function parseHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const [seg, sub] = raw.split('/');
    const key = ROUTES[seg] ? seg : 'home';
    return { key, params: { code: sub ? decodeURIComponent(sub).toUpperCase() : null } };
  }

  function setActiveTab(key) {
    document.querySelectorAll('#navTabs a[data-route]').forEach(a =>
      a.classList.toggle('active', a.dataset.route === key));
    moveIndicator();
  }

  // Slide the gradient pill under the active tab.
  function moveIndicator() {
    const nav = document.getElementById('navTabs');
    const ind = nav && nav.querySelector('.nav-indicator');
    const active = nav && nav.querySelector('a.active');
    if (!ind || !active) return;
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
    ind.style.opacity = '1';
  }

  function renderView(key, params) {
    const view = document.getElementById('view');
    const tpl = document.getElementById(ROUTES[key]);
    // Tear down the previous view's live-refresh hooks before swapping.
    Data.clearRefreshListeners();
    view.innerHTML = '';
    view.appendChild(tpl.content.cloneNode(true));
    window.scrollTo(0, 0);
    // Re-trigger the enter animation (fade + rise) on the new content.
    view.classList.remove('view-enter');
    void view.offsetWidth;            // force reflow so the animation restarts
    view.classList.add('view-enter');
    const fn = window.Views && window.Views[key];
    if (fn) Promise.resolve(fn(params)).catch(console.error);
  }

  function navigate() {
    const { key, params } = parseHash();
    // Slide the active-tab indicator first (its own CSS transition), so the
    // nav motion runs live alongside the content's enter animation.
    setActiveTab(key);
    renderView(key, params);
    current = key;
  }

  async function boot() {
    try { await Data.load({ squads: true }); }
    catch (e) { console.error('initial data load failed', e); }
    Data.startPolling(60000);
    window.addEventListener('hashchange', navigate);
    window.addEventListener('resize', moveIndicator);
    navigate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { navigate };
})();
