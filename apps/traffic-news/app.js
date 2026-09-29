(function () {
  'use strict';

  var API_BASE = '/traffic-news/api';
  var FAVS_KEY = 'traffic-news:favs';
  var SNAP_KEY = 'traffic-news:snapshot';
  var FAV_CAT = 'fav';

  var newsList = document.getElementById('newsList');
  var lastUpdate = document.getElementById('lastUpdate');
  var refreshBtn = document.getElementById('refreshBtn');
  var searchInput = document.getElementById('searchInput');
  var chipRow = document.getElementById('chipRow');
  var regionRow = document.getElementById('regionRow');
  var banner = document.getElementById('offlineBanner');

  var renderedOnce = false;
  var liveAttached = false;
  var lastItems = [];
  var lastSig = null;
  var chipSig = null;
  var regionSig = null;
  var openIds = {};
  var favs = loadFavs();
  var filterState = { cat: '', q: '', r: '' };

  // ---- severity classification (L3 urgent > L2 warning > L1 info) ----
  var SEV_L3 = ['暫停服務', '停止服務', '服務中斷', '停駛', '全線封閉', '全面封閉', '全部封閉',
    '八號風球', '九號風球', '十號風球', '黑色暴雨', '紅色暴雨'];
  var SEV_L2 = ['嚴重擠塞', '擠塞', '班次調整', '班次延誤', '服務延誤', '延誤', '單線雙程',
    '部分封閉', '快線封閉', '中線封閉', '封閉', '交通意外', '道路事故', '意外', '火警', '故障'];
  var SEV_L1 = ['改道', '繞道', '臨時', '交通管制', '道路工程', '工程', '路線改動'];
  var SEV_LABEL = { l3: '緊急', l2: '警告', l1: '提示' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var hk = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
    if (isNaN(hk)) return d.toISOString().slice(0, 16).replace('T', ' ');
    var h = hk.getHours(), min = ('0' + hk.getMinutes()).slice(-2);
    var ampm = h < 12 ? '上午' : '下午';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var m = hk.getMonth() + 1, day = hk.getDate();
    return (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day) + ' ' + ampm + ' ' + ('0' + h12).slice(-2) + ':' + min;
  }

  function fmtAgo(iso) {
    if (!iso) return '';
    var s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  /** Severity from text, only for active (最新情況) items. */
  function classify(n) {
    if (n.status !== '最新情況') return null;
    var hay = ((n.category || '') + ' ' + (n.location || '') + ' ' + (n.detail || '')).toLowerCase();
    if (SEV_L3.some(function (k) { return hay.indexOf(k) !== -1; })) return 'l3';
    if (SEV_L2.some(function (k) { return hay.indexOf(k) !== -1; })) return 'l2';
    if (SEV_L1.some(function (k) { return hay.indexOf(k) !== -1; })) return 'l1';
    return null;
  }

  /** "道路事故-交通意外" -> "道路事故" (chip group key). */
  function chipPrefix(n) {
    var cat = (n.category || '').trim();
    if (!cat) return '其他';
    var i = cat.indexOf('-');
    return i > 0 ? cat.slice(0, i).trim() : cat;
  }

  // ---- broad region inference (district chips) ----
  // `location` is free text (road/MTR-stop names), so the region is inferred
  // by keyword match against location first, then detail/category; unmatched
  // items land under 'other'.
  var REGION_DEFS = [
    { key: 'hk-island', label: '香港島', keys: ['港島', '香港島', '中西區', '灣仔', '東區', '南區',
      '上環', '中環', '金鐘', '銅鑼灣', '北角', '西灣河', '柴灣', '筲箕灣', '香港仔', '薄扶林',
      '赤柱', '堅尼地城', '西環', '干諾道', '告士打道', '菲林明道', '英皇道', '太古城', '跑馬地', '大坑'] },
    { key: 'kowloon', label: '九龍', keys: ['九龍', '油尖旺', '油麻地', '旺角', '太子', '深水埗',
      '長沙灣', '荔枝角', '紅磡', '土瓜灣', '馬頭圍', '九龍城', '何文田', '黃大仙', '樂富', '彩虹',
      '牛頭角', '九龍灣', '觀塘', '藍田', '油塘', '西九龍', '亞皆老街', '彌敦道', '加士居道',
      '柯士甸', '渡船街', '公主道', '界限街', '京士柏', '觀塘道', '清水灣道'] },
    { key: 'new-terr', label: '新界', keys: ['新界', '屯門', '元朗', '天水圍', '上水', '粉嶺',
      '沙田', '大圍', '馬鞍山', '西貢', '將軍澳', '調景嶺', '荃灣', '葵涌', '青衣', '大埔',
      '太和', '烏溪沙', '石門', '第一城', '恆安', '洪水橋', '屯門公路', '元朗公路', '青朗公路',
      '大老山', '城門隧道'] },
    { key: 'lantau', label: '大嶼山', keys: ['大嶼山', '東涌', '迪士尼', '機場', '青嶼', '汲水門',
      '馬灣', '梅窩', '昂坪', '北大嶼山', '欣澳'] }
  ];

  function matchRegion(text) {
    var hay = String(text || '').toLowerCase();
    if (!hay) return null;
    for (var i = 0; i < REGION_DEFS.length; i++) {
      var keys = REGION_DEFS[i].keys;
      for (var j = 0; j < keys.length; j++) {
        if (hay.indexOf(keys[j]) !== -1) return REGION_DEFS[i].key;
      }
    }
    return null;
  }

  /** Broad region for an item: location first, then detail/category. */
  function regionOf(n) {
    return matchRegion(n.location) || matchRegion((n.detail || '') + ' ' + (n.category || '')) || 'other';
  }

  function matches(n) {
    var cat = filterState.cat;
    if (cat === FAV_CAT) {
      if (!favs[n.id]) return false;
    } else if (cat && chipPrefix(n) !== cat) {
      return false;
    }
    if (filterState.r && regionOf(n) !== filterState.r) return false;
    var q = filterState.q.trim().toLowerCase();
    if (q) {
      var hay = ((n.category || '') + ' ' + (n.location || '') + ' ' + (n.detail || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function favCount() {
    var c = 0;
    for (var k in favs) if (favs[k]) c++;
    return c;
  }

  function loadFavs() {
    try {
      var a = JSON.parse(localStorage.getItem(FAVS_KEY) || '[]');
      var o = {};
      if (Array.isArray(a)) a.forEach(function (id) { o[id] = true; });
      return o;
    } catch (e) { return {}; }
  }

  function saveFavs() {
    try { localStorage.setItem(FAVS_KEY, JSON.stringify(Object.keys(favs))); } catch (e) {}
  }

  function toggleFav(id) {
    if (favs[id]) delete favs[id];
    else favs[id] = true;
    saveFavs();
    chipSig = null;
    renderChips();
    renderList();
  }

  // ---- URL params (?q=...&cat=...) for deep-linking ----
  function readUrl() {
    var p = new URLSearchParams(location.search);
    filterState.q = p.get('q') || '';
    filterState.cat = p.get('cat') || '';
    filterState.r = p.get('r') || '';
  }

  function writeUrl() {
    var p = new URLSearchParams(location.search);
    if (filterState.q) p.set('q', filterState.q); else p.delete('q');
    if (filterState.cat) p.set('cat', filterState.cat); else p.delete('cat');
    if (filterState.r) p.set('r', filterState.r); else p.delete('r');
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  // ---- chips (data-driven category prefixes + All + Favourites) ----
  function renderChips() {
    var prefixes = [], seen = {};
    lastItems.forEach(function (n) {
      var p = chipPrefix(n);
      if (!seen[p]) { seen[p] = 1; prefixes.push(p); }
    });
    var sig = prefixes.join(',') + '|' + filterState.cat + '|' + favCount();
    if (sig === chipSig) return;
    chipSig = sig;

    var html = chip('', '全部', filterState.cat === '');
    prefixes.forEach(function (p) {
      html += chip(p, p, filterState.cat === p);
    });
    var fc = favCount();
    html += chip(FAV_CAT, '收藏' + (fc ? ' ' + fc : ''), filterState.cat === FAV_CAT);
    chipRow.innerHTML = html;

    function chip(value, label, active) {
      return '<button type="button" class="chip' + (active ? ' active' : '') +
        '" data-cat="' + esc(value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
        esc(label) + '</button>';
    }
  }

  // ---- region chips (broad areas inferred from location text) ----
  function renderRegions() {
    var present = {}, order = [];
    lastItems.forEach(function (n) {
      var k = regionOf(n);
      if (!present[k]) { present[k] = 1; }
    });
    // stable order: REGION_DEFS order, with 'other' last
    REGION_DEFS.forEach(function (d) { if (present[d.key]) order.push(d.key); });
    if (present.other) order.push('other');

    var sig = order.join(',') + '|' + filterState.r;
    if (sig === regionSig) return;
    regionSig = sig;

    var html = rChip('', '全部地區', filterState.r === '');
    order.forEach(function (k) {
      html += rChip(k, k === 'other' ? '其他' : labelFor(k), filterState.r === k);
    });
    regionRow.innerHTML = html;

    function rChip(value, label, active) {
      return '<button type="button" class="chip' + (active ? ' active' : '') +
        '" data-r="' + esc(value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
        esc(label) + '</button>';
    }
    function labelFor(key) {
      for (var i = 0; i < REGION_DEFS.length; i++) if (REGION_DEFS[i].key === key) return REGION_DEFS[i].label;
      return key;
    }
  }

  function srcBadge(n) {
    var s = n.source;
    if (!s) return '';
    var label, cls;
    if (s === '881903') { label = '881903'; cls = 'src-881903'; }
    else if (s === 'routejam' || s === 'Routejam') { label = 'Routejam'; cls = 'src-routejam'; }
    else {
      // attribution captured from the 資料來源 line (香港電台, data.gov.hk, ...)
      label = s.replace(/^https?:\/\//, '').replace(/\/$/, '');
      cls = 'src-other';
    }
    return '<span class="ni-src ' + cls + '">' + esc(label) + '</span>';
  }

  function cardHtml(r) {
    var n = r.n;
    var latest = n.status === '最新情況';
    var statusLabel = latest ? '最新' : (n.status || '完結');
    var cong = /擠塞信號/.test(n.category) ? '<span class="ni-cong">擠塞</span>' : '';
    var sev = r.sev ? '<span class="ni-sev sev-' + r.sev + '">' + SEV_LABEL[r.sev] + '</span>' : '';
    var fav = r.fav;
    var timeHtml = n.posted_at
      ? '<time datetime="' + esc(n.posted_at) + '">' + esc(fmtTime(n.posted_at)) + '</time>'
      : esc(fmtTime(n.posted_at));
    return '<article class="news-item' + (latest ? '' : ' closed-item') + (r.sev ? ' sev-' + r.sev : '') +
        '" data-id="' + esc(n.id) + '" data-region="' + esc(r.region || '') + '">' +
        '<button type="button" class="ni-fav' + (fav ? ' on' : '') + '" aria-pressed="' + (fav ? 'true' : 'false') +
          '" aria-label="' + (fav ? '取消收藏' : '加入收藏') + '" title="' + (fav ? '取消收藏' : '加入收藏') + '">' +
          (fav ? '&#9733;' : '&#9734;') + '</button>' +
        '<div class="news-head" role="button" tabindex="0" aria-expanded="' + (openIds[n.id] ? 'true' : 'false') +
          '" aria-controls="d-' + esc(n.id) + '">' +
          '<div class="ni-meta">' +
            '<span class="ni-status ' + (latest ? 'latest' : 'closed') + '">' + esc(statusLabel) + '</span>' +
            sev +
            cong +
            srcBadge(n) +
            '<span class="ni-right">' + timeHtml + '<span class="ni-rel">' + esc(fmtAgo(n.posted_at)) + '</span></span>' +
          '</div>' +
          '<div class="ni-loc">' + esc(n.location || n.category || '') + '</div>' +
          '<div class="ni-cat">' + esc(n.category) + '</div>' +
        '</div>' +
        '<div class="ni-detail" id="d-' + esc(n.id) + '">' + esc(n.detail) + '</div>' +
      '</article>';
  }

  function renderList() {
    var rows = [];
    lastItems.forEach(function (n) {
        if (matches(n)) rows.push({ n: n, sev: classify(n), fav: !!favs[n.id], region: regionOf(n) });
    });
    // favourites pin to top (stable within each group)
    rows.sort(function (a, b) { return (b.fav ? 1 : 0) - (a.fav ? 1 : 0); });

    var sig = rows.map(function (r) {
      return r.n.id + '|' + r.n.status + '|' + r.sev + '|' + r.fav + '|' + r.n.source + '|' + r.n.posted_at;
    }).join(';');
    if (sig === lastSig) return;
    lastSig = sig;

    if (!rows.length) {
      newsList.innerHTML = lastItems.length
        ? '<div class="news-empty">No matches.</div>'
        : '<div class="news-empty">No traffic news in the last 12 hours.</div>';
      return;
    }

    newsList.innerHTML = rows.map(cardHtml).join('');

    // re-apply expansion state lost to the rebuild
    Array.prototype.forEach.call(newsList.querySelectorAll('.news-item'), function (el) {
      var id = el.getAttribute('data-id');
      if (openIds[id]) {
        el.classList.add('open');
        var head = el.querySelector('.news-head');
        if (head) head.setAttribute('aria-expanded', 'true');
      }
    });
  }

  function render(payload) {
    var items = (payload && payload.data) || [];
    if (payload && payload.lastRefresh) {
      lastUpdate.textContent = 'updated ' + fmtAgo(payload.lastRefresh) + ' (' + items.length + ' items)';
    }
    if (items.length) {
      lastItems = items;
    } else if (!renderedOnce) {
      lastItems = [];
    }
    // else: keep showing what we have (never blank on a scrape hiccup)
    renderedOnce = true;
    renderChips();
    renderRegions();
    renderList();
    // attach the live region only after the first paint so the initial
    // list is not announced wholesale to screen readers
    if (!liveAttached) {
      newsList.setAttribute('aria-live', 'polite');
      newsList.setAttribute('aria-atomic', 'false');
      liveAttached = true;
    }
  }

  // ---- offline / cached snapshot ----
  function saveSnapshot(payload) {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify({ t: Date.now(), payload: payload })); } catch (e) {}
  }

  function loadSnapshot() {
    try { return JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch (e) { return null; }
  }

  function showBanner(kind, ts) {
    var age = ts ? fmtAgo(ts) : '';
    if (kind === 'offline') {
      banner.textContent = '⚡ Offline — showing cached traffic news' + (age ? ' from ' + age + ' ago' : '');
    } else {
      banner.textContent = '⚠ Refresh failed — showing news' + (age ? ' from ' + age + ' ago' : '');
    }
    banner.hidden = false;
  }

  function hideBanner() { banner.hidden = true; }

  /** Serve the last good payload (or keep the DOM) when the fetch fails. */
  function serveFallback(reason) {
    var snap = loadSnapshot();
    if (snap && snap.payload && snap.payload.data && snap.payload.data.length) {
      render(snap.payload);
      showBanner(reason, snap.payload.lastRefresh || (snap.t ? new Date(snap.t).toISOString() : ''));
    } else if (!renderedOnce) {
      newsList.innerHTML = '<div class="news-empty">Failed to load traffic news.</div>';
      renderedOnce = true;
      showBanner(reason, '');
    } else {
      showBanner(reason, '');
    }
  }

  function post(url) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 50 }),
      cache: 'no-store'
    }).then(function (r) { return r.json(); });
  }

  function load(refresh) {
    if (!navigator.onLine) { serveFallback('offline'); return; }
    refreshBtn.classList.add('spinning');
    // Fast first paint: boot and the auto-poll read the cached snapshot (POST
    // /news) which the server keeps <=60 s fresh (Render interval / Vercel SWR
    // background scrape), so the page renders in ~100 ms instead of waiting on
    // a live scrape of routejam + 881903. The refresh button still pays for
    // the blocking /news/refresh scrape -- and a plain read only falls through
    // to it when the cache is cold (no items yet, e.g. first deploy).
    var p = refresh
      ? post(API_BASE + '/news/refresh').then(function (payload) {
          if (payload && payload.data && payload.data.length) return payload;
          return post(API_BASE + '/news');
        })
      : post(API_BASE + '/news').then(function (payload) {
          if (payload && payload.data && payload.data.length) return payload;
          return post(API_BASE + '/news/refresh');
        });

    p.then(function (payload) {
        // only overwrite the snapshot with real data (never with a hiccup)
        if (payload && payload.data && payload.data.length) saveSnapshot(payload);
        hideBanner();
        render(payload);
      })
      .catch(function () {
        serveFallback(navigator.onLine ? 'error' : 'offline');
      })
      .finally(function () { refreshBtn.classList.remove('spinning'); });
  }

  // ---- events ----
  refreshBtn.addEventListener('click', function () { load(true); });

  searchInput.addEventListener('input', function () {
    filterState.q = searchInput.value;
    writeUrl();
    renderList();
  });

  chipRow.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.chip') : null;
    if (!b) return;
    filterState.cat = b.getAttribute('data-cat') || '';
    writeUrl();
    chipSig = null;
    renderChips();
    renderList();
  });

  regionRow.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.chip') : null;
    if (!b) return;
    filterState.r = b.getAttribute('data-r') || '';
    writeUrl();
    regionSig = null;
    renderRegions();
    renderList();
  });

  newsList.addEventListener('click', function (e) {
    var t = e.target;
    var item = t.closest ? t.closest('.news-item') : null;
    if (!item) return;
    if (t.closest('.ni-fav')) {
      toggleFav(item.getAttribute('data-id'));
      return;
    }
    var head = item.querySelector('.news-head');
    if (head) toggleOpen(head);
  });

  newsList.addEventListener('keydown', function (e) {
    var head = e.target.closest ? e.target.closest('.news-head') : null;
    if (!head) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      toggleOpen(head);
    }
  });

  function toggleOpen(head) {
    var item = head.closest('.news-item');
    if (!item) return;
    var id = item.getAttribute('data-id');
    var open = !item.classList.contains('open');
    item.classList.toggle('open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) openIds[id] = true;
    else delete openIds[id];
  }

  window.addEventListener('offline', function () {
    showBanner('offline', '');
    if (!renderedOnce) serveFallback('offline');
  });
  window.addEventListener('online', function () { hideBanner(); load(false); });

  // ---- boot ----
  readUrl();
  searchInput.value = filterState.q;
  load(false);
  setInterval(function () { if (navigator.onLine) load(false); }, 60 * 1000);

  /* ---- PWA install banner (shares the hub's dismiss key) ---- */
  var INSTALL_DISMISS_KEY = 'life-tool-install-dismissed';
  var deferredPrompt = null;
  var installBanner = document.createElement('div');
  installBanner.className = 'install-banner';
  installBanner.style.display = 'none';
  installBanner.setAttribute('role', 'region');
  installBanner.setAttribute('aria-label', 'Install app');
  installBanner.innerHTML =
    '<p>Add Traffic News to your home screen?</p>' +
    '<button class="install-btn" type="button">Install</button>' +
    '<button class="dismiss-btn" type="button" aria-label="Dismiss">&times;</button>';
  document.body.insertBefore(installBanner, document.body.firstChild);

  function bannerDismissed() { try { return sessionStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch (e) { return false; } }
  function markBannerDismissed() { try { sessionStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (e) {} }

  function isInstalledMode() {
    if (navigator.standalone === true) return true; // iOS Safari, launched from the home screen
    var dm = window.matchMedia && window.matchMedia('(display-mode: standalone)');
    return !!(dm && dm.matches);
  }

  var BANNER_AUTO_DISMISS_MS = (function () {
    var v = Number(window.__BANNER_AUTO_DISMISS_MS);
    return isFinite(v) && v > 0 ? v : 10000;
  })();
  var bannerAutoDismissTimer = null;

  function armBannerAutoDismiss() {
    if (bannerAutoDismissTimer) window.clearTimeout(bannerAutoDismissTimer);
    bannerAutoDismissTimer = window.setTimeout(function () {
      bannerAutoDismissTimer = null;
      markBannerDismissed();
      closeInstallBanner();
    }, BANNER_AUTO_DISMISS_MS);
  }

  function cancelBannerAutoDismiss() {
    if (bannerAutoDismissTimer) {
      window.clearTimeout(bannerAutoDismissTimer);
      bannerAutoDismissTimer = null;
    }
  }

  function openInstallBanner() {
    installBanner.style.display = 'flex';
    armBannerAutoDismiss();
  }
  function closeInstallBanner() {
    cancelBannerAutoDismiss();
    installBanner.style.display = 'none';
  }

  var bannerP = installBanner.querySelector('p');
  var bannerBtn = installBanner.querySelector('.install-btn');
  var currentBannerMode = 'install';
  var BANNER_TEXTS = {
    install: { text: 'Add Traffic News to your home screen?', btn: 'Install' },
    ios: { text: 'Tap the Share button, then choose "Add to Home Screen".', btn: '' },
    manual: { text: 'Open your browser menu and choose "Install app" or "Add to Home Screen".', btn: '' }
  };

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iP(hone|ad|od)\b/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  }

  function setBannerMode(mode) {
    var t = BANNER_TEXTS[mode];
    if (!t) return;
    currentBannerMode = mode;
    bannerP.textContent = t.text;
    bannerBtn.textContent = t.btn;
    bannerBtn.style.display = t.btn ? '' : 'none';
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    if (isInstalledMode()) return;
    deferredPrompt = e;
    setBannerMode('install');
    if (!bannerDismissed()) openInstallBanner();
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    closeInstallBanner();
  });

  if (isIOS() && !isInstalledMode() && !bannerDismissed()) {
    setBannerMode('ios');
    openInstallBanner();
  }

  installBanner.querySelector('.install-btn').addEventListener('click', function () {
    var pe = deferredPrompt;
    deferredPrompt = null;
    if (pe && typeof pe.prompt === 'function') {
      try { pe.prompt(); } catch (e) {}
      if (pe.userChoice && typeof pe.userChoice.then === 'function') {
        pe.userChoice.then(function () { markBannerDismissed(); closeInstallBanner(); },
                           function () { closeInstallBanner(); });
      } else { closeInstallBanner(); }
    } else {
      setBannerMode('manual');
      openInstallBanner();
    }
  });
  installBanner.querySelector('.dismiss-btn').addEventListener('click', function () {
    markBannerDismissed();
    closeInstallBanner();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
})();
