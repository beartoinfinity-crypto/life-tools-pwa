(function () {
  'use strict';

  var APPS = [
    {
      id: 'traffic-news',
      title: '交通消息',
      keywords: 'traffic news incident road jam routejam',
      category: 'transport',
      badge: 'Live',
      emoji: '🚦',
      desc: 'Real-time Hong Kong traffic incidents, road closures & public transport alerts - refreshed every minute.',
      href: '/traffic-news/'
    },
    {
      id: 'mark-six',
      title: 'Mark Six 六合彩',
      keywords: 'mark six lottery draw results special number ticket checker',
      category: 'lottery',
      emoji: '🎱',
      desc: 'Latest draw results, history, ball colour stats, hot/cold numbers & ticket checker.',
      href: '/mark-six/'
    },
    {
      id: 'bus-eta',
      title: 'HK Bus ETA',
      keywords: 'bus eta departure original full-featured maps stops',
      category: 'transport',
      emoji: '🚌',
      desc: 'Full-featured upstream PWA - route & stop ETA, maps, saved stops, filters.',
      href: '/bus-eta/'
    },
    {
      id: 'bus-eta-lite',
      title: 'Bus ETA (lite)',
      keywords: 'bus eta lite simple route stop search live arrivals',
      category: 'transport',
      emoji: '🚏',
      desc: 'Simple ETA UI - search a route or stop, live arrival chips, bookmarks, day/night.',
      href: '/bus-eta-lite/'
    },
    {
      id: 'music-trend',
      title: 'Music Trend',
      keywords: 'music trend charts cantonese mandarin apple playlist top 100',
      category: 'utility',
      emoji: '🎵',
      desc: 'Apple Music top-100 charts - trending, Cantonese and Mandarin playlists.',
      href: '/music-trend/'
    }
  ];

  var CATEGORY_LABELS = {
    transport: 'transport buses mtr',
    lottery: 'lottery lucky draw',
    utility: 'utility tools utilities'
  };

  var ORDER_KEY = 'life-tool-apps';
  var THEME_KEY = 'life-tool-theme';
  var INSTALL_DISMISS_KEY = 'life-tool-install-dismissed';

  var grid = document.getElementById('appGrid');
  var themeBtn = document.getElementById('themeBtn');
  var sortBtn = document.getElementById('sortBtn');
  var simBtn = document.getElementById('simBtn');
  var searchInput = document.getElementById('appSearchInput');
  var filterRow = document.querySelector('.filter-row');
  var noResults = document.getElementById('noResults');
  var installBanner = document.getElementById('installBanner');
  var bannerInstall = document.getElementById('bannerInstall');
  var bannerDismiss = document.getElementById('bannerDismiss');
  var sortMode = false;
  var activeCategory = 'all';
  var deferredPrompt = null;

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function appById(id) {
    for (var i = 0; i < APPS.length; i++) if (APPS[i].id === id) return APPS[i];
    return null;
  }

  /* --- ordering (persisted) --- */
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

  /* --- search + category filter --- */
  function searchBlob(a) {
    return (a.title + ' ' + a.keywords + ' ' + a.desc + ' ' + a.category + ' ' +
      (CATEGORY_LABELS[a.category] || '')).toLowerCase();
  }

  function matches(a, q, cat) {
    if (!a) return false;
    if (cat !== 'all' && a.category !== cat) return false;
    if (!q) return true;
    return searchBlob(a).indexOf(q) !== -1;
  }

  function applyFilter() {
    var q = (searchInput.value || '').trim().toLowerCase();
    var cards = grid.querySelectorAll('.app-card');
    var visible = 0;
    for (var i = 0; i < cards.length; i++) {
      var app = appById(cards[i].getAttribute('data-id'));
      var show = matches(app, q, activeCategory);
      cards[i].hidden = !show;
      if (show) visible++;
    }
    if (noResults) noResults.hidden = visible > 0;
  }

  function setCategory(cat) {
    activeCategory = cat;
    var btns = document.querySelectorAll('.filter-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-category') === cat;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    applyFilter();
  }

  if (filterRow) {
    filterRow.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.filter-btn') : null;
      if (!btn) return;
      setCategory(btn.getAttribute('data-category'));
    });
  }

  if (searchInput) searchInput.addEventListener('input', applyFilter);

  /* --- render --- */
  function render() {
    var list = orderedApps();
    var html = list.map(function (a, i) {
      var sortBtns = sortMode
        ? '<div class="sort-btns">' +
            (i > 0 ? '<button type="button" class="sort-up" data-id="' + a.id + '" title="Move up">&#9650;</button>' : '') +
            (i < list.length - 1 ? '<button type="button" class="sort-down" data-id="' + a.id + '" title="Move down">&#9660;</button>' : '') +
          '</div>'
        : '';
      var badge = a.badge ? '<span class="badge">' + esc(a.badge) + '</span>' : '';
      return '<a class="app-card' + (sortMode ? ' sort-active' : '') + '"' +
          ' data-id="' + esc(a.id) + '"' +
          ' data-category="' + esc(a.category) + '"' +
          ' data-title="' + esc(a.title + ' ' + a.keywords) + '"' +
          ' href="' + (sortMode ? '#' : a.href) + '">' +
          '<div class="app-icon ' + esc(a.id) + '" aria-hidden="true">' + a.emoji + '</div>' +
          '<div class="app-info">' +
            '<div class="app-head">' +
              '<h2 class="app-title">' + esc(a.title) + '</h2>' + badge +
            '</div>' +
            '<p class="app-desc">' + esc(a.desc) + '</p>' +
            sortBtns +
          '</div>' +
        '</a>';
    }).join('');
    grid.innerHTML = html;
    applyFilter();
  }

  grid.addEventListener('click', function (e) {
    if (!sortMode) return;
    var up = e.target.closest ? e.target.closest('.sort-up') : null;
    if (up) { e.preventDefault(); moveCard(up.getAttribute('data-id'), -1); return; }
    var down = e.target.closest ? e.target.closest('.sort-down') : null;
    if (down) { e.preventDefault(); moveCard(down.getAttribute('data-id'), 1); return; }
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

  /* --- PWA install prompt banner --- */
  function bannerDismissed() {
    try { return sessionStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch (e) { return false; }
  }
  function markBannerDismissed() {
    try { sessionStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (e) {}
  }

  function openBanner() {
    installBanner.classList.remove('banner-exit');
    installBanner.classList.add('banner-enter');
    installBanner.hidden = false;
    void installBanner.offsetHeight;
    installBanner.classList.remove('banner-enter');
    installBanner.classList.add('banner-enter-active');
  }

  function closeBanner() {
    installBanner.classList.remove('banner-enter', 'banner-enter-active');
    installBanner.classList.add('banner-exit');
    window.setTimeout(function () {
      installBanner.hidden = true;
      installBanner.classList.remove('banner-exit');
      installBanner.classList.add('banner-enter');
    }, 260);
  }

  function onBeforeInstallPrompt(e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!bannerDismissed()) openBanner();
  }
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    installBanner.hidden = true;
  });

  if (bannerInstall) {
    bannerInstall.addEventListener('click', function () {
      var promptEvent = deferredPrompt;
      deferredPrompt = null;
      if (promptEvent && typeof promptEvent.prompt === 'function') {
        try { promptEvent.prompt(); } catch (e) {}
        if (promptEvent.userChoice && typeof promptEvent.userChoice.then === 'function') {
          promptEvent.userChoice.then(function () {
            markBannerDismissed();
            closeBanner();
          }).catch(function () { closeBanner(); });
        } else {
          closeBanner();
        }
      } else {
        closeBanner();
      }
    });
  }

  if (bannerDismiss) {
    bannerDismiss.addEventListener('click', function () {
      markBannerDismissed();
      closeBanner();
    });
  }

  if (simBtn) {
    simBtn.addEventListener('click', function () {
      if (installBanner.hidden) openBanner();
      else closeBanner();
    });
  }

  /* --- service worker (offline shell) --- */
  if ('serviceWorker' in navigator && navigator.serviceWorker.register) {
    try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) {}
  }

  render();

  // Pure-logic test hooks (also used by the simulate/dismiss flows above).
  window.HubCore = {
    apps: APPS,
    matches: matches,
    setSearch: function (q) { searchInput.value = q; applyFilter(); },
    selectCategory: function (cat) { setCategory(cat); },
    visibleIds: function () {
      var out = [];
      var cards = grid.querySelectorAll('.app-card');
      for (var i = 0; i < cards.length; i++) {
        if (!cards[i].hidden) out.push(cards[i].getAttribute('data-id'));
      }
      return out;
    },
    openBanner: openBanner,
    closeBanner: closeBanner,
    handleBeforeInstallPrompt: onBeforeInstallPrompt,
    setDeferredPrompt: function (p) { deferredPrompt = p; },
    bannerVisible: function () { return !installBanner.hidden; },
    bannerDismissed: bannerDismissed
  };
})();
