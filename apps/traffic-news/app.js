(function () {
  'use strict';

  var API_BASE = '/traffic-news/api';

  var newsList = document.getElementById('newsList');
  var lastUpdate = document.getElementById('lastUpdate');
  var refreshBtn = document.getElementById('refreshBtn');

  var renderedOnce = false;

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

  function render(payload) {
    var items = (payload && payload.data) || [];
    if (payload && payload.lastRefresh) {
      lastUpdate.textContent = 'updated ' + fmtAgo(payload.lastRefresh) + ' (' + items.length + ' items)';
    }

    // NEVER BLANK: if the last known render already has news but this fetch
    // returned nothing (live scrape hiccup / empty window), keep showing what
    // we have instead of wiping the page with "No traffic news".
    if (!items.length && renderedOnce) {
      return;
    }

    renderedOnce = true;
    if (!items.length) {
      newsList.innerHTML = '<div class="news-empty">No traffic news in the last 12 hours.</div>';
      return;
    }

    newsList.innerHTML = items.map(function (n) {
      var latest = n.status === '最新情況';
      var srcLabel = n.source === '881903' ? '881903' : n.source === 'routejam' ? 'Routejam' : '';
      var src = srcLabel ? '<span class="ni-src src-' + esc(n.source) + '">' + esc(srcLabel) + '</span>' : '';
      var cong = /擠塞信號/.test(n.category) ? '<span class="ni-cong">擠塞</span>' : '';
      return '<div class="news-item' + (latest ? '' : ' closed-item') + '" role="button" tabindex="0">' +
          '<div class="ni-meta">' +
            '<span class="ni-status ' + (latest ? 'latest' : 'closed') + '">' + (latest ? '最新' : '完結') + '</span>' +
            cong +
            src +
            '<span>' + esc(fmtTime(n.posted_at)) + '</span>' +
            '<span class="ni-rel">' + esc(fmtAgo(n.posted_at)) + '</span>' +
          '</div>' +
          '<div class="ni-loc">' + esc(n.location || n.category || '') + '</div>' +
          '<div class="ni-cat">' + esc(n.category) + '</div>' +
          '<div class="ni-detail">' + esc(n.detail) + '</div>' +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(newsList.querySelectorAll('.news-item'), function (el) {
      el.addEventListener('click', function () { el.classList.toggle('open'); });
    });
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
    refreshBtn.classList.add('spinning');
    // Live-first: opening/clicking the page triggers a real scrape so the latest
    // news shows immediately without a manual refresh. If the live scrape yields
    // nothing, fall back to the stored snapshot so the page is never blank/stale.
    var p = refresh
      ? post(API_BASE + '/news/refresh').then(function (payload) {
          if (payload && payload.data && payload.data.length) return payload;
          return post(API_BASE + '/news');
        })
      : post(API_BASE + '/news');

    p.then(render)
      .catch(function () {
        newsList.innerHTML = '<div class="news-empty">Failed to load traffic news.</div>';
        renderedOnce = true;
      })
      .finally(function () { refreshBtn.classList.remove('spinning'); });
  }

  refreshBtn.addEventListener('click', function () { load(true); });

  load(true);
  setInterval(function () { load(false); }, 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
})();
