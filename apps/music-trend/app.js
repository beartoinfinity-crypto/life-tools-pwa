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
  var shuffleBtn = document.getElementById('shuffleBtn');

  var current = 'trending';
  var country = 'hk';
  try { var savedCc = localStorage.getItem('music-country'); if (savedCc) country = savedCc; } catch (e) {}
  var cache = null; // { data: [<loaded list row>], lastRefresh, countries }
  var loadedKey = ''; // "<cc>:<list>" currently fetched (data-saving: fetch only the chosen list)
  var currentSong = -1;      // index into the active playlist
  var ytPlayer = null;
  var ytReady = false;
  var pendingPlay = null;    // videoId queued while the API loads
  var wantPlaying = false;
  var shuffle = false;
  var resumeInfo = null;     // { list, country, idx, at, ytId, wantPlaying } -> set when a
                             // signal drop stalls the current song; consumed by 'online'
                             // to resume the SAME song/position instead of skipping.
  var stallTimer = null;     // BUFFERING watchdog: fires if we sit stalled ~10s on a drop
  var resumeRetryTimer = null;   // second-opinion loop: if the browser never fires
                                 // 'online' on a weak signal, poll a resume try every
                                 // ~15s for up to ~2 min, then go quiet.
  var MY_KEY = 'music-my-list';
  var pTimeEl = document.getElementById('pTime');
  var myTools = document.getElementById('myTools');
  var myPicker = document.getElementById('myPicker');
  var myUploadBtn = document.getElementById('myUploadBtn');
  var myPickerBtn = document.getElementById('myPickerBtn');

  /* ---- my playlist (localStorage, per device) ---- */
  function mySongs() {
    try { return JSON.parse(localStorage.getItem(MY_KEY) || '[]'); } catch (e) { return []; }
  }

  /* Device playlist cache: the last successful payload per country+list, kept in
   * localStorage so a reopen paints the chart the moment app.js runs — no cell
   * round-trip in the critical path. The server read still refreshes it silently
   * in the background (see load()), and a country switch always refetches. */
  function devKey(cc, list) { return 'music-dev:' + cc + ':' + list; }
  function readDev(cc, list) {
    try { return JSON.parse(localStorage.getItem(devKey(cc, list)) || 'null'); } catch (e) { return null; }
  }
  function saveDev(cc, list, payload) {
    try { localStorage.setItem(devKey(cc, list), JSON.stringify(payload)); } catch (e) {}
  }
  function saveMySongs(a) {
    try { localStorage.setItem(MY_KEY, JSON.stringify(a)); } catch (e) {}
  }
  function inMyList(id) {
    return mySongs().some(function (s) { return String(s.id) === String(id); });
  }
  function toggleMyList(s) {
    var a = mySongs();
    var i = a.findIndex(function (x) { return String(x.id) === String(s.id); });
    if (i >= 0) a.splice(i, 1);
    else a.push(s);
    saveMySongs(a);
    return i < 0;
  }

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

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--';
    sec = Math.floor(sec);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setTimeDisplay() {
    if (!pTimeEl || !ytPlayer || !ytReady) return;
    if (playerBar.classList.contains('hidden')) return;
    var cur = -1;
    var dur = -1;
    try { if (ytPlayer.getCurrentTime) cur = ytPlayer.getCurrentTime(); } catch (e) {}
    try { if (ytPlayer.getDuration) dur = ytPlayer.getDuration(); } catch (e) {}
    if (cur < 0) return;
    pTimeEl.textContent = fmtTime(cur) + ' / ' + (dur > 0 ? fmtTime(dur) : '--:--');
  }
  setInterval(setTimeDisplay, 500);

  function artworkBigger(url) {
    return url; // data-saving: keep the feed's small 100x100 artwork
  }

  function findList(name) {
    if (name === 'my') return { list: 'my', chartTitle: '我的歌單', songs: mySongs() };
    if (!cache) return null;
    var key = country + ':' + name;
    for (var i = 0; i < cache.data.length; i++) {
      if (cache.data[i].list === key) return cache.data[i];
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
            forceLowQuality();
            if (wantPlaying) ytPlayer.playVideo();
            pendingPlay = null;
          }
        },
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.ENDED) {
            nextSong(true);
          } else if (e.data === YT.PlayerState.PLAYING) {
            forceLowQuality();
            clearStallWatch();
            wantPlaying = true;
            playPauseBtn.textContent = '❚❚';
          } else if (e.data === YT.PlayerState.PAUSED) {
            // A drop also surfaces here: the IFrame API pauses mid-song when signal
            // dies. If we're offline, or a stall watchdog / resume is already
            // pending, DON'T flip wantPlaying to false — that would orphan our
            // resume intent and the reconnect handler would come back quietly.
            // The player may stay paused for 1-2 min (or longer) until the
            // connection returns; only a real user pause — online and with nothing
            // pending — is authoritative.
            var dropPaused = !navigator.onLine || stallTimer || resumeInfo;
            if (!dropPaused) {
              wantPlaying = false;
              playPauseBtn.textContent = '▶';
            }
          } else if (e.data === YT.PlayerState.BUFFERING) {
            // Stalled mid-song. Most car drops show up here (BUFFERING that never
            // resolves). Arm a watchdog instead of waiting forever: if we sit
            // stalled ~10s, treat it as a signal drop and remember the position so
            // the 'online' handler can resume this exact song where it stalled.
            armStallWatch();
          }
        },
        onError: function () {
          // Distinguish a genuine signal drop from an unplayable video, so a blip
          // in the car does NOT skip tracks. When we're offline (or looks like a
          // dead-link stall), remember the song and wait to resume it on reconnect.
          if (!wantPlaying && !navigator.onLine) {
            // Wanted quiet anyway; stay paused, nothing to resume.
            return;
          }
          if (ytPlayer && ytPlayer.getCurrentTime &&
              ytPlayer.getDuration && ytPlayer.getCurrentTime() > 0 &&
              ytPlayer.getCurrentTime() < (ytPlayer.getDuration() - 2)) {
            // We have real progress past the start: likely a transient blip, not a
            // dead video. Remember the spot and resume it when signal returns.
            resumeFromSpot();
            return;
          }
          // Genuinely unplayable video at load: skip forward
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

  /* ---- car-signal resume: watchdog + reconnect hook ---- *
   * Belt and suspenders. The BUFFERING branch in onStateChange arms a watchdog
   * (10s of no progress = treat as a drop); the offline event captures the spot
   * immediately; and the online event does the actual resume — same song, same
   * position, zero taps. onError only skips when the video is genuinely dead. */

  function armStallWatch() {
    if (stallTimer) return;                       // already armed by a prior BUFFERING
    stallTimer = setTimeout(function () {
      stallTimer = null;
      // ~10s of stalling = a real signal drop (not a normal short buffer).
      if (wantPlaying) resumeFromSpot();
    }, 10000);
  }

  function clearStallWatch() {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  }
  // ----- third trick: pin the LOWEST quality to save mobile data (README: ~144p) --
  // YouTube defaults to Auto (usually 720p+), which burns a phone data plan.
  // getAvailableQualityLevels() returns the levels valid right now; we pick the
  // absolute lowest (tiny/small/medium ~= 144/240/360p) and setPlaybackQuality()
  // it on every new load AND on PLAYING, because the IFrame API can bump the
  // bitrate back up on its own once playback starts.
  function forceLowQuality() {
    if (!ytPlayer || !ytPlayer.getAvailableQualityLevels) return;
    var lv, i, r, best = null, bRank = 99;
    var rank = { tiny: 0, small: 1, medium: 2, large: 3, hd720: 4, hd1080: 5, highres: 6 };
    try { lv = ytPlayer.getAvailableQualityLevels(); } catch (e) { return; }
    if (!lv || !lv.length) return;
    for (i = 0; i < lv.length; i++) {
      r = rank[lv[i]];
      if (r !== undefined && r < bRank) { bRank = r; best = lv[i]; }
    }
    if (best) try { ytPlayer.setPlaybackQuality(best); } catch (e) {}
  }

  // ----- second opinion: reconnect retry loop ---------------------------------
  // The browser fires 'online' when it sees the signal come back, but on a weak
  // or flaky signal it sometimes DOESN'T fire the event even though the network
  // is usable again. So we keep a tamer "second opinion": every ~15s for up to
  // ~2 min (only while we actually want audio and have a spot captured) we try
  // finishResume() as a nudge. If the radio quietly comes back, the resume then
  // just works without any taps. After ~2 min we go quiet so WhatsApp only gets
  // the taps when there's a real signal, not a dead net we keep poking.

  var resumeRetryTimer = null;     // setInterval handle for the reconnect loop
  var resumeRetryStart = 0;        // when we started poking, so we can go quiet

  function armResumeRetry() {
    if (resumeRetryTimer) return;                // already poking
    resumeRetryStart = Date.now();
    resumeRetryTimer = setInterval(function () {
      if (!resumeInfo || !wantPlaying) { clearResumeRetry(); return; }  // nothing to resume
      if (Date.now() - resumeRetryStart > 120000) { clearResumeRetry(); return; }  // gone quiet
      finishResume();                            // nudge: exact song/position, no taps
    }, 15000);
  }

  function clearResumeRetry() {
    if (resumeRetryTimer) { clearInterval(resumeRetryTimer); resumeRetryTimer = null; }
  }

  function armResumeRetryIfNeeded() {
    // Only poke while there's a captured spot AND the user still wants audio.
    if (resumeInfo && wantPlaying) armResumeRetry();
  }

  function resumeFromSpot() {
    if (resumeInfo) return;                       // already captured; don't overwrite
    var entry = findList(current);
    var list = playable(entry);
    if (!list.length || currentSong < 0 || currentSong >= list.length) return;
    var s = list[currentSong];
    var at = 0;
    try { if (ytPlayer && ytPlayer.getCurrentTime) at = ytPlayer.getCurrentTime() || 0; } catch (e) {}
    resumeInfo = {
      list: current,
      country: country,
      idx: currentSong,
      at: at,
      ytId: s.youtubeId,
      wantPlaying: wantPlaying
    };
    if (playPauseBtn) playPauseBtn.textContent = '⏳';   // "waiting for signal"
    if (nowName) nowName.textContent = (nowName.textContent || '');   // keep label
    armResumeRetry();   // second opinion: keep nudging in case 'online' never fires
  }

  function finishResume() {
    if (!resumeInfo) return;
    var r = resumeInfo;
    resumeInfo = null;

    // Only resume if we're still on the same list + country and the song still
    // exists there. If the user navigated away meanwhile, just let it be.
    if (r.list !== current || r.country !== country) return;
    var entry = findList(current);
    var list = playable(entry);
    if (!list.length || r.idx < 0 || r.idx >= list.length) return;   // spot no longer valid

    var s = list[r.idx];
    if (!s || s.youtubeId !== r.ytId) { nextSong(true); return; }   // list changed
    if (playPauseBtn) playPauseBtn.textContent = '❚❚';

    if (!ytReady || !ytPlayer) {
      // Player got killed by the drop; queue the same song and restart the API.
      pendingPlay = r.ytId;
      wantPlaying = r.wantPlaying;
      loadYTApi();
      return;
    }
    
    ytPlayer.loadVideoById(s.youtubeId);
    forceLowQuality();
    try { if (r.at > 1 && ytPlayer.seekTo) ytPlayer.seekTo(r.at, true); } catch (e) {}
    if (r.wantPlaying) ytPlayer.playVideo();
    else ytPlayer.pauseVideo();
    wantPlaying = r.wantPlaying;
    clearResumeRetry();   // the resume actually happened; stop the nudge loop
    returnSongUI(r.idx);
  }

  function returnSongUI(idx) {
    current = resumeLastList();
    currentSong = idx;
    var entry = findList(current);
    var list = playable(entry);
    if (list[idx]) highlightRow(list[idx]);
  }

  // Live intent of the "current list" for UI restore after a resume
  function resumeLastList() { return current; }

  window.addEventListener('offline', function () {
    // Signal dropped while we wanted audio: capture the spot right away so we
    // don't wait the full 10s watchdog for a hard drop. Nothing if we were quiet.
    if (wantPlaying) resumeFromSpot();
  });

  window.addEventListener('online', function () {
    // Back on signal: resume the exact song where it stalled. Also clear any
    // pending stall watchdog so it can't double-fire on the newly resumed audio.
    clearStallWatch();
    finishResume();
  });

  function playSong(entry, idx, autoplay) {
    var list = playable(entry);
    if (!list.length) return;
    idx = ((idx % list.length) + list.length) % list.length;
    currentSong = idx;
    var s = list[idx];

    playerBar.classList.remove('hidden');
    nowName.textContent = s.name;
    nowArtist.textContent = s.artist;
    if (pTimeEl) pTimeEl.textContent = '0:00 / ' + (s.durationMs ? fmtTime(s.durationMs / 1000) : '--:--');
    wantPlaying = !!autoplay;

    highlightRow(s);
    document.dispatchEvent(new CustomEvent('songchange', { detail: s }));

    if (!ytReady) {
      pendingPlay = s.youtubeId;
      loadYTApi();
      return;
    }
    
    ytPlayer.loadVideoById(s.youtubeId);
    forceLowQuality();
    if (autoplay) ytPlayer.playVideo();
    else ytPlayer.pauseVideo();
  }

  function randomOtherIdx(list) {
    if (list.length < 2) return currentSong;
    var i;
    do { i = Math.floor(Math.random() * list.length); } while (i === currentSong);
    return i;
  }

  function nextSong(auto) {
    var entry = findList(current);
    var list = playable(entry);
    if (!list.length) return;
    if (shuffle) playSong(entry, randomOtherIdx(list), true);
    else playSong(entry, currentSong + 1, true);
  }

  function prevSong() {
    var entry = findList(current);
    if (shuffle) { playSong(entry, randomOtherIdx(playable(entry)), wantPlaying); return; }
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

  function songRow(s, i, playableRow, opts) {
    opts = opts || {};
    var art = s.artwork
      ? '<img class="s-art" src="' + esc(s.artwork) + '" alt="" loading="lazy" />'
      : '<div class="s-art s-art-none"></div>';
    var artist = s.artistUrl
      ? '<a class="s-artist" href="' + esc(s.artistUrl) + '" target="_blank" rel="noopener">' + esc(s.artist) + '</a>'
      : '<span class="s-artist">' + esc(s.artist) + '</span>';
    var playBadge = playableRow ? '<div class="s-play">▶</div>' : '';
    var addBtn = opts.showAdd
      ? '<button class="s-add' + (inMyList(s.id) ? ' on' : '') + '" data-addid="' + esc(s.id) + '" title="My playlist">' +
          (opts.removeMode ? '✕' : inMyList(s.id) ? '✓' : '＋') + '</button>'
      : '';
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
        addBtn +
      '</div>';
  }

  function render() {
    var entry = findList(current);
    renderCountries();
    myTools.classList.toggle('hidden', current !== 'my');
    if (current !== 'my') myPicker.classList.add('hidden');
    // Mirror the server's CANTO_COUNTRIES / MANDO_COUNTRIES (parser.js): 廣東歌
    // only exists in 香港, 國語歌 only in 香港/台灣/中國/新加坡. Hide the tab
    // everywhere the server returns [] for that country so we never show an
    // empty list for a scene the country doesn't have.
    var cantoOn = country === 'hk';
    var mandoOn = country === 'hk' || country === 'tw' || country === 'cn' || country === 'sg';
    var tabs = tabsEl.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (t) {
      var sceneOn =
        !(t.dataset.list === 'cantonese' && !cantoOn) &&
        !(t.dataset.list === 'chinese' && !mandoOn);
      // Data check on top of the country gate: a genre tab with zero songs or
      // zero playable (YouTube-resolved) songs is useless — hide it exactly
      // like the country-gated scenes. Gated on `cache` so a first load or
      // country switch (cache === null) never flashes all tabs away, and never
      // applied to `trending`/`my` so the default tab and the user's list can't
      // disappear from the tab bar.
      if (sceneOn && cache && t.dataset.list !== 'trending' && t.dataset.list !== 'my') {
        var e = findList(t.dataset.list);
        sceneOn = !!(e && e.songs && e.songs.length && playable(e).length);
      }
      t.classList.toggle('hidden', !sceneOn);
      t.classList.toggle('active', sceneOn && t.dataset.list === current);
    });

    if (current === 'my') {
      lastUpdate.textContent = 'my playlist · ' + mySongs().length + ' songs';
    } else if (cache && cache.lastRefresh) {
      var extra = entry ? ' · ' + entry.songs.length + ' songs · ' + playable(entry).length + ' playable' : '';
      lastUpdate.textContent = (CC_LABEL[country] || country) + ' chart: ' + fmtAgo(cache.lastRefresh) + extra;
    }

    if (!entry || !entry.songs.length) {
      listEl.innerHTML = '<div class="loading-note">' +
        (current === 'my' ? '你的歌單是空的 — 在其他歌單按 ＋ 加入歌曲。' : 'No songs in this playlist.') +
        '</div>';
      return;
    }

    var html = '';
    entry.songs.forEach(function (s, i) {
      html += songRow(s, i, !!s.youtubeId, { showAdd: true, removeMode: current === 'my' });
    });
    listEl.innerHTML = html;
  }

  /* ---------------- events ---------------- */

  listEl.addEventListener('click', function (e) {
    var add = e.target.closest ? e.target.closest('.s-add') : null;
    if (add) {
      var entry = findList(current);
      var all = (entry && entry.songs) || [];
      var song = null;
      for (var j = 0; j < all.length; j++) {
        if (String(all[j].id) === String(add.dataset.addid)) { song = all[j]; break; }
      }
      if (song) {
        var added = toggleMyList(song);
        statusFlash(added ? '已加入我的歌單' : '已從我的歌單移除');
        if (current === 'my') { currentSong = -1; }
        render();
      }
      return;
    }
    var row = e.target.closest ? e.target.closest('.song-row.tappable') : null;
    if (!row) return;
    var entry2 = findList(current);
    var list = playable(entry2);
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].youtubeId === row.dataset.videoid) { idx = i; break; }
    }
    if (idx >= 0) playSong(entry2, idx, true);
  });

  var CC_LABEL = { hk: '香港', tw: '台灣', cn: '中國', jp: '日本', kr: '韓國', us: '美國', sg: '新加坡', my: '馬來西亞', au: '澳洲', gb: '英國' };

  function renderCountries() {
    var box = document.getElementById('countryTabs');
    if (!box) return;
    var ccs = (cache && cache.countries) ? Object.keys(cache.countries) : ['hk'];
    var html = '';
    ccs.forEach(function (cc) {
      html += '<button class="ctab' + (cc === country ? ' active' : '') + '" data-cc="' + cc + '">' +
        esc((cache && cache.countries && cache.countries[cc]) || CC_LABEL[cc] || cc.toUpperCase()) + '</button>';
    });
    box.innerHTML = html;
  }

  document.getElementById('countryTabs').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.ctab') : null;
    if (!btn) return;
    country = btn.dataset.cc;
    try { localStorage.setItem('music-country', country); } catch (e2) {}
    cache = null;
    current = 'trending';
    currentSong = -1;
    render();
    load(false);
  });

  var flashTimer = null;
  function statusFlash(msg) {
    var el = document.getElementById('statusBar');
    el.textContent = msg;
    el.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('flash'); renderStatus(); }, 1600);
  }
  function renderStatus() {
    if (current === 'my') {
      lastUpdate.textContent = 'my playlist · ' + mySongs().length + ' songs';
    } else if (cache && cache.lastRefresh) {
      var entry = findList(current);
      var extra = entry ? ' · ' + entry.songs.length + ' songs · ' + playable(entry).length + ' playable' : '';
      lastUpdate.textContent = 'chart: ' + fmtAgo(cache.lastRefresh) + extra;
    }
  }

  tabsEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.tab') : null;
    if (!btn) return;
    current = btn.dataset.list;
    currentSong = -1;
    var key = country + ':' + current;
    if (current !== 'my' && key !== loadedKey) load(false);
    else render();
  });

  function setShuffle(on, persist) {
    shuffle = !!on;
    shuffleBtn.classList.toggle('on', shuffle);
    shuffleBtn.title = shuffle ? 'Random: on' : 'Random: off';
    if (persist) { try { localStorage.setItem('music-shuffle', shuffle ? '1' : '0'); } catch (e) {} }
  }
  shuffleBtn.addEventListener('click', function () { setShuffle(!shuffle, true); });
  try { setShuffle(localStorage.getItem('music-shuffle') === '1', false); } catch (e) { setShuffle(false, false); }

  prevBtn.addEventListener('click', prevSong);
  nextBtn.addEventListener('click', function () { nextSong(false); });

  /* ---- my playlist sync (Supabase, cross-device) ---- */
  myUploadBtn.addEventListener('click', function () {
    var songs = mySongs();
    if (!songs.length) { statusFlash('歌單是空的 — 先在其他歌單按 ＋ 加入歌曲'); return; }
    var name = window.prompt('歌單名稱（在不同裝置輸入相同名稱即可取用）', '');
    if (!name) return;
    name = name.trim().slice(0, 100);
    if (!name) { statusFlash('名稱不能是空的'); return; }
    fetch(API_BASE + '/myplaylists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, songs: songs }),
      cache: 'no-store'
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (payload && payload.error) throw new Error(payload.error);
        statusFlash('已上傳歌單「' + name + '」(' + songs.length + ' 首)');
      })
      .catch(function (e) { statusFlash('上傳失敗: ' + e.message); });
  });

  myPickerBtn.addEventListener('click', function () {
    if (!myPicker.classList.contains('hidden')) { myPicker.classList.add('hidden'); return; }
    myPicker.classList.remove('hidden');
    myPicker.innerHTML = '<div class="loading-note">Loading…</div>';
    fetch(API_BASE + '/myplaylists', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.error) throw new Error((payload && payload.error) || 'bad response');
        if (!payload.data || !payload.data.length) {
          myPicker.innerHTML = '<div class="my-picker-title">沒有已上傳的歌單</div>';
          return;
        }
        var html = '<div class="my-picker-title">已上傳歌單（點擊載入）</div>';
        payload.data.forEach(function (p) {
          html += '<button class="my-pick" data-name="' + esc(p.name) + '">' + esc(p.name) +
            ' · ' + p.count + ' 首 · ' + fmtAgo(p.updated_at) + '</button>';
        });
        myPicker.innerHTML = html;
      })
      .catch(function (e) { myPicker.innerHTML = '<div class="my-picker-title">載入失敗: ' + esc(e.message) + '</div>'; });
  });

  myPicker.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.my-pick') : null;
    if (!btn) return;
    var name = btn.dataset.name;
    fetch(API_BASE + '/myplaylists/' + encodeURIComponent(name), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.error) throw new Error((payload && payload.error) || 'not found');
        saveMySongs(payload.songs || []);
        currentSong = -1;
        render();
        statusFlash('已載入歌單「' + name + '」(' + payload.songs.length + ' 首)');
      })
      .catch(function (e) { statusFlash('載入失敗: ' + e.message); });
  });
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
    var wantList = (current === 'my') ? 'trending' : current;
    refreshBtn.classList.add('spinning');
    // Device cache: when we already fetched this exact country+list before, paint
    // it NOW from localStorage so the chart appears instantly on cellular — the
    // server read below refreshes it silently in the background and saves the
    // newer copy. Guarded by country+list so switching countries never recycles
    // yesterday's chart, and skipped on forced refresh.
    var dev = readDev(country, wantList);
    if (!refresh && country + ':' + wantList !== loadedKey && dev) {
      cache = dev;
      loadedKey = country + ':' + wantList;
      render();
    }
    if (refresh || country + ':' + wantList !== loadedKey) {
      listEl.innerHTML = '<div class="loading-note">Loading…</div>';
    }
    fetch(refresh ? API_BASE + '/playlists/refresh' : API_BASE + '/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: country, list: wantList }),
      cache: 'no-store'
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (payload && payload.data) {
          cache = payload;
          loadedKey = country + ':' + wantList;
          saveDev(country, wantList, payload);
        }
        render();
      })
      .catch(function () {
        listEl.innerHTML = '<div class="loading-note">Failed to load playlists.</div>';
      })
      .finally(function () { refreshBtn.classList.remove('spinning'); });
  }

  load(false);
  setInterval(function () { if (current !== 'my') load(false); }, 10 * 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
})();