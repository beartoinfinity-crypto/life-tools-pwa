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
    }
  ];

  var ORDER_KEY = 'life-tool-apps';
  var THEME_KEY = 'life-tool-theme';

  var grid = document.getElementById('appGrid');
  var themeBtn = document.getElementById('themeBtn');

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

  function render() {
    var list = orderedApps();
    var html = list.map(function (a) {
      return '<a class="app-card" data-id="' + a.id + '" href="' + a.href + '">' +
          '<div class="app-icon ' + a.id + '" aria-hidden="true">' + a.icon + '</div>' +
          '<div class="app-title">' + a.title + '</div>' +
          '<div class="app-desc">' + a.desc + '</div>' +
          '<div class="app-link">Open &rarr;</div>' +
        '</a>';
    }).join('');
    grid.innerHTML = html;
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) wireDnD();
  }

  /* --- drag to reorder (desktop / fine pointers only) --- */
  var draggedId = null;
  function wireDnD() {
    grid.classList.add('draggable');
    grid.addEventListener('dragover', function (e) { e.preventDefault(); });
    grid.addEventListener('drop', function (e) { e.preventDefault(); });
    var cards = grid.querySelectorAll('.app-card');
    cards.forEach(function (card) {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', function (e) {
        draggedId = card.dataset.id;
        card.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.dataset.id); } catch (err) {}
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('dragging');
        draggedId = null;
      });
      card.addEventListener('dragover', function (e) {
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
      });
      card.addEventListener('drop', function (e) {
        e.preventDefault();
        var toId = card.dataset.id;
        if (draggedId && toId && draggedId !== toId) reorder(draggedId, toId);
        draggedId = null;
      });
    });
  }
  function reorder(fromId, toId) {
    var list = orderedApps();
    var src;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === fromId) { src = list.splice(i, 1)[0]; break; }
    }
    if (!src) return;
    var to = 0;
    for (var j = 0; j < list.length; j++) {
      if (list[j].id === toId) { to = j; break; }
    }
    list.splice(to, 0, src);
    saveOrder(list);
    render();
  }

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