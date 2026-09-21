(function () {
  'use strict';

  var APPS = [
    {
      id: 'mark-six',
      title: 'Mark Six',
      desc: 'Hong Kong Mark Six lottery results with special numbers, history and daily auto-refresh.',
      href: '/mark-six/',
      icon: '6'
    },
    {
      id: 'bus-eta',
      title: 'HK Bus ETA (original)',
      desc: 'Upstream PWA (hkbus/hk-independent-bus-eta) — full-featured route/stop ETA, maps, saved stops.',
      href: '/bus-eta/',
      icon: '巴'
    },
    {
      id: 'bus-eta-lite',
      title: 'Bus ETA (lite)',
      desc: 'Edited simple UI — search by route number or bus stop (all buses via), auto-refresh 30s.',
      href: '/bus-eta-lite/',
      icon: '汽'
    },
    {
      id: 'traffic-news',
      title: 'Traffic News',
      desc: 'Latest HK traffic incidents from Routejam — updated every minute.',
      href: '/traffic-news/',
      icon: '交'
    },
    {
      id: 'music-trend',
      title: 'Music Trend',
      desc: 'HK top 100 Apple Music charts — trending, Cantonese and Mandarin playlists.',
      href: '/music-trend/',
      icon: '樂'
    }
  ];

  var ORDER_KEY = 'life-tool-apps';
  var THEME_KEY = 'life-tool-theme';

  var grid = document.getElementById('appGrid');
  var themeBtn = document.getElementById('themeBtn');
  var sortBtn = document.getElementById('sortBtn');
  var sortMode = false;

  function orderedApps() {
    var custom;
    try { custom = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null'); } catch (e) { custom = null; }
    if (!Array.isArray(custom) || !custom.length) return APPS.slice();
    var map = {};
    APPS.forEach(function (a) { map[a.id] = a; });
    var out = [], added = {};
    custom.forEach(function (id) { if (map[id] && !added[id]) { out.push(map[id]); added[id] = 1; } });
    APPS.forEach(function (a) { if (!added[a.id]) { out.push(a); added[a.id] = 1; } });
    return out;
  }

  function saveOrder(list) {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(list.map(function (a) { return a.id; }))); } catch (e) {}
  }

  function moveCard(id, dir) {
    var list = orderedApps();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    var swap = idx + dir;
    if (swap < 0 || swap >= list.length) return;
    var tmp = list[idx];
    list[idx] = list[swap];
    list[swap] = tmp;
    saveOrder(list);
    render();
  }

  function render() {
    var list = orderedApps();
    var html = list.map(function (a, i) {
      var sortBtns = sortMode
        ? '<div class="sort-btns">' +
            (i > 0 ? '<button class="sort-up" data-id="' + a.id + '" title="Move up">&#9650;</button>' : '') +
            (i < list.length - 1 ? '<button class="sort-down" data-id="' + a.id + '" title="Move down">&#9660;</button>' : '') +
          '</div>'
        : '';
      return '<a class="app-card' + (sortMode ? ' sort-active' : '') + '" data-id="' + a.id + '" href="' + (sortMode ? '#' : a.href) + '">' +
          '<div class="app-icon ' + a.id + '" aria-hidden="true">' + a.icon + '</div>' +
          '<div class="app-title">' + a.title + '</div>' +
          '<div class="app-desc">' + a.desc + '</div>' +
          (sortMode ? '' : '<div class="app-link">Open &rarr;</div>') +
          sortBtns +
        '</a>';
    }).join('');
    grid.innerHTML = html;
  }

  grid.addEventListener('click', function (e) {
    if (!sortMode) return;
    var up = e.target.closest ? e.target.closest('.sort-up') : null;
    if (up) { e.preventDefault(); moveCard(up.dataset.id, -1); return; }
    var down = e.target.closest ? e.target.closest('.sort-down') : null;
    if (down) { e.preventDefault(); moveCard(down.dataset.id, 1); return; }
    // Block navigation in sort mode
    var card = e.target.closest ? e.target.closest('.app-card') : null;
    if (card) e.preventDefault();
  });

  sortBtn.addEventListener('click', function () {
    sortMode = !sortMode;
    sortBtn.textContent = sortMode ? 'Done' : 'Sort';
    sortBtn.title = sortMode ? 'Finish reordering' : 'Reorder apps';
    render();
  });

  /* --- day / night theme --- */
  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function theme() {
    var saved = localStorage.getItem(THEME_KEY);
    return saved === 'dark' || saved === 'light' ? saved : systemTheme();
  }
  function updateThemeButton() {
    var dark = theme() === 'dark';
    themeBtn.textContent = dark ? 'Light' : 'Dark';
    themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }
  function applyTheme(t, persist) {
    if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch (e) {} }
    document.documentElement.dataset.theme = t;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = t === 'dark' ? '#12161a' : '#f5f5f5';
    updateThemeButton();
    updateIcon();
  }
  themeBtn.addEventListener('click', function () {
    applyTheme(theme() === 'dark' ? 'light' : 'dark', true);
  });
  /* --- theme-aware favicon (light / dark) --- */
  var iconLink = document.createElement('link');
  iconLink.rel = 'icon';
  iconLink.type = 'image/svg+xml';
  document.head.appendChild(iconLink);
  document.querySelectorAll('link[rel="icon"][media]').forEach(function (l) { l.remove(); });
  function updateIcon() {
    iconLink.href = theme() === 'dark' ? 'icon-dark.svg' : 'icon-light.svg';
  }

  var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (mq && mq.addEventListener && !localStorage.getItem(THEME_KEY)) {
    mq.addEventListener('change', function () { applyTheme(systemTheme(), false); });
  }
  applyTheme(theme(), false);

  render();
})();
