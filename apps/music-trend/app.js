(function () {
  'use strict';

  var API_BASE = '/music-trend/api';

  var tabsEl = document.getElementById('listTabs');
  var listEl = document.getElementById('playList');
  var lastUpdate = document.getElementById('lastUpdate');
  var refreshBtn = document.getElementById('refreshBtn');

  var current = 'trending';
  var cache = null; // { data: [{list, chartTitle, updatedAtSrc, songs}], lastRefresh }

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

  function artworkBigger(url) {
    return String(url || '').replace('100x100bb', '300x300bb');
  }

  function findList(name) {
    if (!cache) return null;
    for (var i = 0; i < cache.data.length; i++) {
      if (cache.data[i].list === name) return cache.data[i];
    }
    return null;
  }

  function songRow(s, i) {
    var art = s.artwork
      ? '<img class="s-art" src="' + esc(artworkBigger(s.artwork)) + '" alt="" loading="lazy" />'
      : '<div class="s-art s-art-none"></div>';
    var artist = s.artistUrl
      ? '<a class="s-artist" href="' + esc(s.artistUrl) + '" target="_blank" rel="noopener">' + esc(s.artist) + '</a>'
      : '<span class="s-artist">' + esc(s.artist) + '</span>';
    return '<div class="song-row">' +
        '<div class="s-rank">' + (i + 1) + '</div>' +
        art +
        '<div class="s-main">' +
          '<div class="s-name">' + esc(s.name) + '</div>' +
          artist +
        '</div>' +
        '<div class="s-genre">' + esc(s.genre) + '</div>' +
      '</div>';
  }

  function render() {
    var entry = findList(current);
    var tabs = tabsEl.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (t) {
      t.classList.toggle('active', t.dataset.list === current);
    });

    if (cache && cache.lastRefresh) {
      lastUpdate.textContent = 'chart: ' + fmtAgo(cache.lastRefresh) + (entry ? ' · ' + entry.songs.length + ' songs' : '');
    }

    if (!entry || !entry.songs.length) {
      listEl.innerHTML = '<div class="loading-note">No songs in this playlist.</div>';
      return;
    }

    var html = '';
    entry.songs.forEach(function (s, i) { html += songRow(s, i); });
    listEl.innerHTML = html;
  }

  function load(refresh) {
    refreshBtn.classList.add('spinning');
    fetch(refresh ? API_BASE + '/playlists/refresh' : API_BASE + '/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      cache: 'no-store'
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (payload && payload.data) { cache = payload; }
        render();
      })
      .catch(function () {
        listEl.innerHTML = '<div class="loading-note">Failed to load playlists.</div>';
      })
      .finally(function () { refreshBtn.classList.remove('spinning'); });
  }

  tabsEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.tab') : null;
    if (!btn) return;
    current = btn.dataset.list;
    render();
  });
  refreshBtn.addEventListener('click', function () { load(true); });

  load(false);
  setInterval(function () { load(false); }, 10 * 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
})();