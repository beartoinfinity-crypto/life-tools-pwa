(function () {
  'use strict';

  var API_BASE = '/youtube-mp3/api';
  var MUSIC_API = '/music-trend/api';

  var urlInput = document.getElementById('urlInput');
  var convertBtn = document.getElementById('convertBtn');
  var resultList = document.getElementById('resultList');
  var lastUpdate = document.getElementById('lastUpdate');
  var sourceTabs = document.getElementById('sourceTabs');
  var musicPanel = document.getElementById('musicPanel');
  var musicList = document.getElementById('musicList');
  var countryTabs = document.getElementById('countryTabs');
  var listTabs = document.getElementById('listTabs');

  var currentTab = 'url';
  var currentCountry = 'hk';
  var currentList = 'trending';
  var musicData = null;
  var myPlaylists = [];
  var ytdlpReady = null; // null = unknown, true/false after check

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function status(msg) {
    lastUpdate.textContent = msg;
  }

  // Check if the server can convert to real MP3 (needs yt-dlp + ffmpeg)
  function checkYtdlp() {
    if (ytdlpReady !== null) return Promise.resolve(ytdlpReady);
    return fetch(API_BASE + '/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) { ytdlpReady = !!(s.ytdlp && s.ffmpeg); return ytdlpReady; })
      .catch(function () { ytdlpReady = false; return false; });
  }

  /* --- resolve URL --- */
  function resolve() {
    var url = (urlInput.value || '').trim();
    if (!url) { status('Please paste a YouTube URL first'); return; }
    convertBtn.disabled = true;
    convertBtn.textContent = 'Resolving...';
    resultList.innerHTML = '<div class="loading-note">Resolving videos...</div>';

    fetch(API_BASE + '/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url }),
      cache: 'no-store'
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (payload.error) throw new Error(payload.error);
        renderResults(payload.data || []);
        status(payload.data.length + ' video(s) found');
      })
      .catch(function (e) {
        resultList.innerHTML = '<div class="loading-note">Failed: ' + esc(e.message) + '</div>';
        status('Resolve failed');
      })
      .finally(function () {
        convertBtn.disabled = false;
        convertBtn.textContent = 'Convert';
      });
  }

  convertBtn.addEventListener('click', resolve);
  urlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') resolve();
  });

  /* --- render results --- */
  function renderResults(videos) {
    if (!videos.length) {
      resultList.innerHTML = '<div class="loading-note">No videos found.</div>';
      return;
    }
    checkYtdlp().then(function (ok) {
      resultList.innerHTML = videos.map(function (v) {
        var dl = ok
          ? '<a class="dl-btn" href="' + API_BASE + '/download?id=' + encodeURIComponent(v.id) + '&title=' + encodeURIComponent(v.title) + '" target="_blank" rel="noopener">' +
              '<span class="dl-label">MP3</span></a>'
          : '<span class="dl-btn err" title="Server has no yt-dlp/ffmpeg — MP3 conversion unavailable">N/A</span>';
        return '<div class="result-item" data-id="' + esc(v.id) + '">' +
          '<img class="thumb" src="' + esc(v.thumbnail) + '" alt="" onerror="this.style.visibility=\'hidden\'" />' +
          '<div class="ri-info">' +
            '<div class="ri-title">' + esc(v.title) + '</div>' +
            '<div class="ri-meta">' + esc(v.duration || '') + (v.channel ? ' &middot; ' + esc(v.channel) : '') + '</div>' +
          '</div>' +
          dl +
        '</div>';
      }).join('');
      if (!ok) {
        status('MP3 conversion unavailable — server needs yt-dlp + ffmpeg');
      }
    });
  }

  function safeFilename(title) {
    return String(title || 'audio').replace(/[^\w\u4e00-\u9fff\u3040-\u30ff()-]+/g, '_').slice(0, 80);
  }

  /* --- tabs --- */
  sourceTabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn) return;
    currentTab = btn.dataset.tab;
    Array.prototype.forEach.call(sourceTabs.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('active', t === btn);
    });
    musicPanel.classList.toggle('hidden', currentTab !== 'music');
    if (currentTab === 'music' && !musicData) loadMusic();
  });

  /* --- music trend playlists --- */
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store'
    }).then(function (r) { return r.json(); });
  }

  function loadMusic() {
    musicList.innerHTML = '<div class="loading-note">Loading playlists...</div>';
    post(MUSIC_API + '/playlists', { country: currentCountry })
      .then(function (payload) {
        if (payload.error) throw new Error(payload.error);
        musicData = payload;
        renderCountryTabs(payload.countries || {});
        renderMusicList();
      })
      .catch(function (e) {
        musicList.innerHTML = '<div class="loading-note">Failed: ' + esc(e.message) + '</div>';
      });
  }

  function renderCountryTabs(countries) {
    var keys = Object.keys(countries);
    countryTabs.innerHTML = keys.map(function (cc) {
      return '<button class="ctab' + (cc === currentCountry ? ' active' : '') + '" data-cc="' + esc(cc) + '">' + esc(countries[cc]) + '</button>';
    }).join('');
  }

  countryTabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.ctab');
    if (!btn) return;
    currentCountry = btn.dataset.cc;
    currentList = 'trending';
    Array.prototype.forEach.call(listTabs.querySelectorAll('.ltab'), function (t) {
      t.classList.toggle('active', t.dataset.list === 'trending');
    });
    loadMusic();
  });

  listTabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.ltab');
    if (!btn) return;
    currentList = btn.dataset.list;
    Array.prototype.forEach.call(listTabs.querySelectorAll('.ltab'), function (t) {
      t.classList.toggle('active', t === btn);
    });
    if (currentList === 'my') loadMyPlaylists();
    else renderMusicList();
  });

  function renderMusicList() {
    if (!musicData || !musicData.data) {
      musicList.innerHTML = '<div class="loading-note">No playlists.</div>';
      return;
    }
    var items = [];
    if (currentList === 'my') return; // handled by loadMyPlaylists
    var row = musicData.data.find(function (r) { return r.list === currentCountry + ':' + currentList; });
    if (!row || !row.songs) {
      musicList.innerHTML = '<div class="loading-note">No songs in this list.</div>';
      return;
    }
    items = row.songs.filter(function (s) { return s.youtubeId; });
    if (!items.length) {
      musicList.innerHTML = '<div class="loading-note">No YouTube links resolved yet. Try again later.</div>';
      return;
    }
    musicList.innerHTML = items.map(function (s) {
      return '<div class="music-item" data-ytid="' + esc(s.youtubeId) + '" data-title="' + esc(s.name + ' - ' + s.artist) + '">' +
        '<div class="mi-name">' + esc(s.name) + '</div>' +
        '<div class="mi-count">' + esc(s.artist || '') + '</div>' +
      '</div>';
    }).join('');
  }

  function loadMyPlaylists() {
    musicList.innerHTML = '<div class="loading-note">Loading my playlists...</div>';
    fetch(MUSIC_API + '/myplaylists', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (payload.error) throw new Error(payload.error);
        myPlaylists = payload.data || [];
        if (!myPlaylists.length) {
          musicList.innerHTML = '<div class="loading-note">No saved playlists. Create one in Music Trend first.</div>';
          return;
        }
        musicList.innerHTML = myPlaylists.map(function (p, i) {
          return '<div class="music-item" data-idx="' + i + '">' +
            '<div class="mi-name">' + esc(p.name) + '</div>' +
            '<div class="mi-count">' + p.count + ' songs</div>' +
          '</div>';
        }).join('');
      })
      .catch(function (e) {
        musicList.innerHTML = '<div class="loading-note">Failed: ' + esc(e.message) + '</div>';
      });
  }

  musicList.addEventListener('click', function (e) {
    var item = e.target.closest('.music-item');
    if (!item) return;

    if (currentList === 'my') {
      var idx = Number(item.dataset.idx);
      var pl = myPlaylists[idx];
      if (!pl) return;
      fetch(MUSIC_API + '/myplaylists/' + encodeURIComponent(pl.name), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (payload) {
          if (payload.error) throw new Error(payload.error);
          var videos = (payload.songs || []).filter(function (s) { return s.youtubeId; }).map(function (s) {
            return {
              id: s.youtubeId,
              title: s.name + ' - ' + s.artist,
              thumbnail: 'https://i.ytimg.com/vi/' + s.youtubeId + '/default.jpg',
              duration: ''
            };
          });
          renderResults(videos);
          status(videos.length + ' songs from "' + pl.name + '"');
        })
        .catch(function (e) { status('Failed: ' + e.message); });
    } else {
      var ytid = item.dataset.ytid;
      var title = item.dataset.title;
      if (!ytid) return;
      renderResults([{
        id: ytid,
        title: title,
        thumbnail: 'https://i.ytimg.com/vi/' + ytid + '/default.jpg',
        duration: ''
      }]);
      status('Ready to download');
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
})();
