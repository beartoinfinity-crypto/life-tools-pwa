(function () {
  'use strict';

  var API_BASE = '/music-trend/api';

  var tabsEl = document.getElementById('listTabs');
  var listEl = document.getElementById('playList');
  var lastUpdate = document.getElementById('lastUpdate');
  var refreshBtn = document.getElementById('refreshBtn');
  var playerBar = document.getElementById('playerBar');
  var playerMount = document.getElementById('playerMount');
  var nowName = document.getElementById('nowName');
  var nowArtist = document.getElementById('nowArtist');
  var prevBtn = document.getElementById('prevBtn');
  var playPauseBtn = document.getElementById('playPauseBtn');
  var nextBtn = document.getElementById('nextBtn');
  var closeBtn = document.getElementById('closeBtn');
  var videoBtn = document.getElementById('videoBtn');

  var current = 'trending';
  var cache = null;
  var currentSong = -1;      // index into the active playlist
  var ytPlayer = null;
  var ytReady = false;
  var pendingPlay = null;    // videoId queued while the API loads
  var wantPlaying = false;

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
    return url; // data-saving: keep the feed's small 100x100 artwork
  }

  function findList(name) {
    if (!cache) return null;
    for (var i = 0; i < cache.data.length; i++) {
      if (cache.data[i].list === name) return cache.data[i];
    }
    return null;
  }

  function playable(entry) {
    return (entry && entry.songs || []).filter(function (s) { return s.youtubeId; });
  }

  /* ---------------- YouTube IFrame API player ---------------- */

  window.onYouTubeIframeAPIReady = function () {
    ytPlayer = new YT.Player('ytFrame', {
      height: '100%',
      width: '100%',
      videoId: '',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: function () {
          ytReady = true;
          if (pendingPlay) {
            ytPlayer.loadVideoById(pendingPlay);
            if (wantPlaying) ytPlayer.playVideo();
            pendingPlay = null;
          }
        },
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.ENDED) {
            nextSong(true);
          } else if (e.data === YT.PlayerState.PLAYING) {
            wantPlaying = true;
            playPauseBtn.textContent = '❚❚';
          } else if (e.data === YT.PlayerState.PAUSED) {
            wantPlaying = false;
            playPauseBtn.textContent = '▶';
          }
        },
        onError: function () {
          // Unplayable video: skip forward
          nextSong(true);
        }
      }
    });
  };

  function loadYTApi() {
    if (document.getElementById('yt-api-script')) return;
    var s = document.createElement('script');
    s.id = 'yt-api-script';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  function playSong(entry, idx, autoplay) {
    var list = playable(entry);
    if (!list.length) return;
    idx = ((idx % list.length) + list.length) % list.length;
    currentSong = idx;
    var s = list[idx];

    playerBar.classList.remove('hidden');
    nowName.textContent = s.name;
    nowArtist.textContent = s.artist;
    wantPlaying = !!autoplay;

    highlightRow(s);
    document.dispatchEvent(new CustomEvent('songchange', { detail: s }));

    if (!ytReady) {
      pendingPlay = s.youtubeId;
      loadYTApi();
      return;
    }
    ytPlayer.loadVideoById(s.youtubeId);
    if (autoplay) ytPlayer.playVideo();
    else ytPlayer.pauseVideo();
  }

  function nextSong(auto) {
    var entry = findList(current);
    var list = playable(entry);
    if (!list.length) return;
    playSong(entry, currentSong + 1, true);
  }

  function prevSong() {
    var entry = findList(current);
    playSong(entry, currentSong - 1, wantPlaying);
  }

  function highlightRow(s) {
    var rows = listEl.querySelectorAll('.song-row');
    Array.prototype.forEach.call(rows, function (r) { r.classList.remove('playing'); });
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].dataset.videoid === s.youtubeId) {
        rows[i].classList.add('playing');
        if (rows[i].scrollIntoView) rows[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
    }
  }

  /* ---------------- list rendering ---------------- */

  function songRow(s, i, playableRow) {
    var art = s.artwork
      ? '<img class="s-art" src="' + esc(artworkBigger(s.artwork)) + '" alt="" loading="lazy" />'
      : '<div class="s-art s-art-none"></div>';
    var artist = s.artistUrl
      ? '<a class="s-artist" href="' + esc(s.artistUrl) + '" target="_blank" rel="noopener">' + esc(s.artist) + '</a>'
      : '<span class="s-artist">' + esc(s.artist) + '</span>';
    var playBadge = playableRow ? '<div class="s-play">▶</div>' : '';
    return '<div class="song-row' + (playableRow ? ' tappable' : '') + '"' +
        (playableRow ? ' data-videoid="' + esc(s.youtubeId) + '"' : '') + '>' +
        '<div class="s-rank">' + (i + 1) + '</div>' +
        art +
        '<div class="s-main">' +
          '<div class="s-name">' + esc(s.name) + '</div>' +
          artist +
        '</div>' +
        '<div class="s-genre">' + esc(s.genre) + '</div>' +
        playBadge +
      '</div>';
  }

  function render() {
    var entry = findList(current);
    var tabs = tabsEl.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (t) {
      t.classList.toggle('active', t.dataset.list === current);
    });

    if (cache && cache.lastRefresh) {
      var extra = entry ? ' · ' + entry.songs.length + ' songs · ' + playable(entry).length + ' playable' : '';
      lastUpdate.textContent = 'chart: ' + fmtAgo(cache.lastRefresh) + extra;
    }

    if (!entry || !entry.songs.length) {
      listEl.innerHTML = '<div class="loading-note">No songs in this playlist.</div>';
      return;
    }

    var html = '';
    entry.songs.forEach(function (s, i) {
      html += songRow(s, i, !!s.youtubeId);
    });
    listEl.innerHTML = html;
  }

  /* ---------------- events ---------------- */

  listEl.addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('.song-row.tappable') : null;
    if (!row) return;
    var entry = findList(current);
    var list = playable(entry);
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].youtubeId === row.dataset.videoid) { idx = i; break; }
    }
    if (idx >= 0) playSong(entry, idx, true);
  });

  tabsEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.tab') : null;
    if (!btn) return;
    current = btn.dataset.list;
    currentSong = -1;
    render();
  });

  prevBtn.addEventListener('click', prevSong);
  nextBtn.addEventListener('click', function () { nextSong(false); });
  videoBtn.addEventListener('click', function () {
    var bar = document.getElementById('playerBar');
    var on = bar.classList.toggle('video-mode');
    videoBtn.title = on ? 'Hide video' : 'Show video';
  });
  playPauseBtn.addEventListener('click', function () {
    if (!ytReady || !ytPlayer) return;
    if (wantPlaying) { ytPlayer.pauseVideo(); }
    else { ytPlayer.playVideo(); }
  });
  closeBtn.addEventListener('click', function () {
    if (ytReady && ytPlayer.stopVideo) ytPlayer.stopVideo();
    playerBar.classList.add('hidden');
    currentSong = -1;
    var rows = listEl.querySelectorAll('.song-row');
    Array.prototype.forEach.call(rows, function (r) { r.classList.remove('playing'); });
  });

  refreshBtn.addEventListener('click', function () { load(true); });

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

  load(false);
  setInterval(function () { load(false); }, 10 * 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
})();