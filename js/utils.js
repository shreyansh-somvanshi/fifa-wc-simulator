const Utils = (() => {
  const IST_OFFSET_MIN = 5 * 60 + 30;

  // Format a UTC ISO timestamp as IST.
  // Returns { date: "Thu, 11 Jun", time: "11:30 PM IST", dayKey: "2026-06-12" }
  // dayKey is the IST calendar day (used for grouping).
  function formatIST(isoUTC) {
    const utc = new Date(isoUTC);
    const ist = new Date(utc.getTime() + IST_OFFSET_MIN * 60000);

    const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][ist.getUTCDay()];
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][ist.getUTCMonth()];
    const dd = ist.getUTCDate();
    let h = ist.getUTCHours();
    const m = String(ist.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;

    const y = ist.getUTCFullYear();
    const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const dayKey = `${y}-${mm}-${String(ist.getUTCDate()).padStart(2,'0')}`;

    return {
      date: `${wd}, ${dd} ${mo}`,
      time: `${h}:${m} ${ampm} IST`,
      dayKey
    };
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

  return { formatIST, escapeHtml, debounce, $, $$ };
})();
