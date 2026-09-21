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
      desc: 'Latest HK traffic incidents from Routejam (路暢) — updated every minute.',
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
    wireDnD();
  }

  /* --- drag to reorder (desktop drag API + mobile touch) --- */
  var draggedId = null;
  var touchDragEl = null;   // floating clone during mobile drag
  var touchOrigin = null;   // { x, y, card, id, timer }
  var LONG_PRESS_MS = 400;

  function wireDnD() {
    grid.classList.add('draggable');
    var cards = grid.querySelectorAll('.app-card');

    /* --- desktop: HTML5 drag API --- */
    grid.addEventListener('dragover', function (e) { e.preventDefault(); });
    grid.addEventListener('drop', function (e) { e.preventDefault(); });
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

    /* --- mobile: touch long-press + drag --- */
    grid.addEventListener('touchstart', onTouchStart, { passive: true });
    grid.addEventListener('touchmove', onTouchMove, { passive: false });
    grid.addEventListener('touchend', onTouchEnd);
    grid.addEventListener('touchcancel', onTouchEnd);
    // Suppress context menu only when a drag is active
    grid.addEventListener('contextmenu', function (e) {
      if (touchDragEl) e.preventDefault();
    });
  }

  function onTouchStart(e) {
    var card = e.target.closest ? e.target.closest('.app-card') : null;
    if (!card) return;
    // Don't prevent default here — allow normal scrolling
    var touch = e.touches[0];
    touchOrigin = {
      x: touch.clientX,
      y: touch.clientY,
      card: card,
      id: card.dataset.id,
      timer: setTimeout(function () {
        // Long-press confirmed: start drag — NOW block scrolling
        draggedId = card.dataset.id;
        card.classList.add('dragging');
        // Create floating clone
        var rect = card.getBoundingClientRect();
        touchDragEl = card.cloneNode(true);
        touchDragEl.classList.add('touch-drag-clone');
        touchDragEl.style.width = rect.width + 'px';
        touchDragEl.style.position = 'fixed';
        touchDragEl.style.left = rect.left + 'px';
        touchDragEl.style.top = rect.top + 'px';
        touchDragEl.style.zIndex = '9999';
        touchDragEl.style.pointerEvents = 'none';
        touchDragEl.style.opacity = '0.9';
        touchDragEl.style.transform = 'scale(1.05)';
        touchDragEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)';
        document.body.appendChild(touchDragEl);
        if (navigator.vibrate) navigator.vibrate(30);
      }, LONG_PRESS_MS)
    };
  }

  function onTouchMove(e) {
    if (!touchOrigin) return;
    var touch = e.touches[0];
    var dx = touch.clientX - touchOrigin.x;
    var dy = touch.clientY - touchOrigin.y;

    // If not dragging yet, check if moved too far (cancel long-press)
    if (!touchDragEl) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(touchOrigin.timer);
        touchOrigin = null;
      }
      return;
    }

    e.preventDefault();
    // Move the clone
    var rect = touchOrigin.card.getBoundingClientRect();
    touchDragEl.style.left = (rect.left + dx) + 'px';
    touchDragEl.style.top = (rect.top + dy) + 'px';

    // Highlight the card we're hovering over
    var hoverCard = document.elementFromPoint(touch.clientX, touch.clientY);
    if (hoverCard) {
      var target = hoverCard.closest ? hoverCard.closest('.app-card') : null;
      var cards = grid.querySelectorAll('.app-card');
      Array.prototype.forEach.call(cards, function (c) { c.classList.remove('drag-over'); });
      if (target && target !== touchOrigin.card) target.classList.add('drag-over');
    }
  }

  function onTouchEnd(e) {
    if (!touchOrigin) return;
    clearTimeout(touchOrigin.timer);

    if (touchDragEl) {
      // Find the drop target
      var touch = e.changedTouches[0];
      var hoverCard = document.elementFromPoint(touch.clientX, touch.clientY);
      var target = hoverCard ? (hoverCard.closest ? hoverCard.closest('.app-card') : null) : null;
      if (target && target !== touchOrigin.card) {
        reorder(touchOrigin.id, target.dataset.id);
      }
      // Clean up
      touchDragEl.remove();
      touchDragEl = null;
    }

    touchOrigin.card.classList.remove('dragging');
    var cards = grid.querySelectorAll('.app-card');
    Array.prototype.forEach.call(cards, function (c) { c.classList.remove('drag-over'); });
    draggedId = null;
    touchOrigin = null;
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