(function () {
  'use strict';

  var API_BASE = '/traffic-news/api';

  var newsList = document.getElementById('newsList');
  var lastUpdate = document.getElementById('lastUpdate');
  var refreshBtn = document.getElementById('refreshBtn');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtAgo(iso) {
    if (!iso) return '';
    var s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    // Show in HK local time regardless of device locale
    var hk = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
    if (isNaN(hk)) return d.toISOString().slice(0, 16).replace('T', ' ');
    var h = hk.getHours(), min = ('0' + hk.getMinutes()).slice(-2);
    var ampm = h < 12 ? '上午' : '下午';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var m = hk.getMonth() + 1, day = hk.getDate();
    return (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day) + ' ' + ampm + ' ' + ('0' + h12).slice(-2) + ':' + min;
  }

  function fmtAgoZH(iso) {
    if (!iso) return '';
    var mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return mins + '分鐘前';
    var h = Math.floor(mins / 60);
    if (h < 24) return h + '小時前';
    return Math.floor(h / 24) + '天前';
  }

  function render(payload) {
    var items = (payload && payload.data) || [];
    if (payload && payload.lastRefresh) {
      lastUpdate.textContent = 'updated ' + fmtAgo(payload.lastRefresh) + ' (' + items.length + ' items)';
    }

    if (!items.length) {
      newsList.innerHTML = '<div class="news-empty">No traffic news in the last 12 hours.</div>';
      return;
    }

    newsList.innerHTML = items.map(function (n) {
      var latest = n.status === '最新情況';
      return '<div class="news-item' + (latest ? '' : ' closed-item') + '" role="button" tabindex="0">' +
          '<div class="ni-meta">' +
            '<span class="ni-status ' + (latest ? 'latest' : 'closed') + '">' + (latest ? '最新' : '完結') + '</span>' +
            '<span>' + esc(fmtTime(n.posted_at)) + '</span>' +
            '<span class="ni-rel">' + esc(fmtAgoZH(n.posted_at)) + '</span>' +
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

  function load(refresh) {
    refreshBtn.classList.add('spinning');
    fetch(refresh ? API_BASE + '/news/refresh' : API_BASE + '/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 50 }),
      cache: 'no-store'
    })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        newsList.innerHTML = '<div class="news-empty">Failed to load traffic news.</div>';
      })
      .finally(function () { refreshBtn.classList.remove('spinning'); });
  }

  refreshBtn.addEventListener('click', function () { load(true); });

  load(false);
  setInterval(function () { load(false); }, 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
})();