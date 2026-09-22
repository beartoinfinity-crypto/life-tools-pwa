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
  var preloadPlayer = null;   // hidden YT.Player pre-buffering the next song
  var preloadVideoId = null;  // videoId currently preloaded
  var preloadIdx = -1;        // playlist index currently preloaded (-1 = none)
  var preloadShuffle = false; // shuffle mode captured when preload was scheduled
  var preloadReady = false;   // true when preloadPlayer has finished cueing
  var preloadDiv = null;      // container for the preload iframe (sibling of #ytFrame)
  var bufferSkipTimer = null; // auto-skip if BUFFERING persists >15s
  var MY_KEY = 'music-my-list';
  var pTimeEl = document.getElementById('pTime');
  var myTools = document.getElementById('myTools');
  var myPicker = document.getElementById('myPicker');
  var myUploadBtn = document.getElementById('myUploadBtn');
  var myPickerBtn = document.getElementById('myPickerBtn');
  var myImportBtn = document.getElementById('myImportBtn');
  var myImport = document.getElementById('myImport');

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
        onStateChange: handleMainStateChange,
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

  /* Shared onStateChange for whichever player is currently main. Bound in the
   * constructor and re-bound after a preload-slot promotion so ENDED never
   * loses its advance path (that was how shuffle playback stopped). */
  function handleMainStateChange(e) {
    if (e.data === YT.PlayerState.ENDED) {
      if (!advanceFromPreload()) nextSong(true);
    } else if (e.data === YT.PlayerState.PLAYING) {
      forceLowQuality();
      clearStallWatch();
      clearBufferSkip();
      wantPlaying = true;
      playPauseBtn.textContent = '❚❚';
      // Warm the next track (shuffle-aware). After a preload promotion this
      // uses the updated currentSong so we do not re-cue the song on air.
      var entry = findList(current);
      var list = playable(entry);
      if (list.length) schedulePreload(list, currentSong);
    } else if (e.data === YT.PlayerState.PAUSED) {
      // A drop also surfaces here: the IFrame API pauses mid-song when signal
      // dies. If we're offline, or a stall watchdog / resume is already
      // pending, DON'T flip wantPlaying to false — that would orphan our
      // resume intent and the reconnect handler would come back quietly.
      var dropPaused = !navigator.onLine || stallTimer || resumeInfo;
      if (!dropPaused) {
        wantPlaying = false;
        playPauseBtn.textContent = '▶';
      }
    } else if (e.data === YT.PlayerState.BUFFERING) {
      armStallWatch();
      armBufferSkip();
    }
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

    // Pre-buffer the next song so switching is instant
    schedulePreload(list, idx);
  }

  /* Pick the track that should play after `idx` under the current mode. */
  function nextIndexFor(list, idx) {
    if (!list.length) return -1;
    if (list.length < 2) return idx;
    if (shuffle) {
      var i;
      do { i = Math.floor(Math.random() * list.length); } while (i === idx);
      return i;
    }
    return (((idx + 1) % list.length) + list.length) % list.length;
  }

  /* ---- pre-buffer next song in a second slot (no iframe reparent) ----
   * The preload lives as a sibling of #ytFrame inside #playerMount. Promotion
   * only toggles CSS visibility — moving a YT iframe in the DOM kills the
   * player, which is why transitions used to freeze (especially under shuffle,
   * where the pre-cued id was always sequential and never matched nextSong). */
  function schedulePreload(list, idx) {
    clearBufferSkip();
    if (!list || !list.length) return;

    // Keep a still-valid warmer. Under shuffle the next index is arbitrary, so
    // re-rolling on every PLAYING would destroy the buffer we just built.
    if (preloadReady && preloadPlayer && preloadShuffle === shuffle &&
        preloadIdx >= 0 && preloadIdx < list.length && preloadIdx !== idx &&
        list[preloadIdx].youtubeId === preloadVideoId) {
      return;
    }

    var nextIdx = nextIndexFor(list, idx);
    if (nextIdx < 0) return;
    var next = list[nextIdx];
    if (!next || !next.youtubeId) return;
    if (preloadReady && preloadVideoId === next.youtubeId && preloadIdx === nextIdx && preloadShuffle === shuffle) return;
    preloadVideoId = next.youtubeId;
    preloadIdx = nextIdx;
    preloadShuffle = shuffle;
    preloadReady = false;

    if (!preloadDiv) {
      preloadDiv = document.createElement('div');
      preloadDiv.id = 'ytPreloadMount';
      preloadDiv.style.cssText = 'position:absolute;inset:0;display:none;pointer-events:none;';
      playerMount.appendChild(preloadDiv);
    }

    if (preloadPlayer) {
      try { preloadPlayer.destroy(); } catch (e) {}
      preloadPlayer = null;
    }
    preloadDiv.innerHTML = '';
    var frameId = 'ytPreload_' + Date.now();
    var frameDiv = document.createElement('div');
    frameDiv.id = frameId;
    frameDiv.style.cssText = 'width:100%;height:100%;';
    preloadDiv.appendChild(frameDiv);
    var wantId = preloadVideoId;
    preloadPlayer = new YT.Player(frameId, {
      height: '100%', width: '100%', videoId: '',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 0 },
      events: {
        onReady: function () {
          if (preloadPlayer && preloadVideoId === wantId) {
            preloadPlayer.cueVideoById(wantId);
          }
        },
        onStateChange: function (e) {
          if (preloadVideoId === wantId &&
              (e.data === YT.PlayerState.CUED || e.data === YT.PlayerState.PLAYING)) {
            preloadReady = true;
          }
        }
      }
    });
  }

  function clearBufferSkip() {
    if (bufferSkipTimer) { clearTimeout(bufferSkipTimer); bufferSkipTimer = null; }
  }

  function armBufferSkip() {
    clearBufferSkip();
    bufferSkipTimer = setTimeout(function () {
      bufferSkipTimer = null;
      // Stuck buffering too long — skip to next
      nextSong(true);
    }, 15000);
  }

  /* When current song ends, promote the preloaded slot if it matches the
   * real next track (same index AND shuffle mode). Never reparent iframes. */
  function advanceFromPreload() {
    if (!preloadPlayer || !preloadReady || !preloadVideoId || preloadIdx < 0) return false;
    // Mode changed after we cued — the cued id is not the next track.
    if (preloadShuffle !== shuffle) return false;
    var entry = findList(current);
    var list = playable(entry);
    if (preloadIdx >= list.length || list[preloadIdx].youtubeId !== preloadVideoId) return false;
    if (!preloadDiv || !preloadDiv.parentNode || !playerMount) return false;

    var oldFrame = document.getElementById('ytFrame');
    if (!oldFrame) return false;

    // Swap slots in place: show preload, hide old. No DOM reparent of iframes.
    try { ytPlayer.destroy(); } catch (e) {}
    if (oldFrame.parentNode) oldFrame.parentNode.removeChild(oldFrame);

    // Main player now lives in the preload slot.
    preloadDiv.id = 'ytFrame';
    preloadDiv.style.cssText = 'position:absolute;inset:0;';
    var promoted = preloadPlayer;
    var promotedIdx = preloadIdx;

    // Detach preload bookkeeping before rebinding so a PLAYING from the
    // promoted player does not treat itself as the next-track warmer.
    preloadPlayer = null;
    preloadReady = false;
    preloadVideoId = null;
    preloadIdx = -1;
    preloadDiv = null;

    ytPlayer = promoted;
    if (typeof ytPlayer.addEventListener === 'function') {
      ytPlayer.addEventListener('onStateChange', handleMainStateChange);
    }

    // Sync app state to the track we actually promoted (shuffle-safe).
    currentSong = promotedIdx;
    var s = list[promotedIdx];
    nowName.textContent = s.name;
    nowArtist.textContent = s.artist;
    if (pTimeEl) pTimeEl.textContent = '0:00 / ' + (s.durationMs ? fmtTime(s.durationMs / 1000) : '--:--');
    wantPlaying = true;
    highlightRow(s);
    document.dispatchEvent(new CustomEvent('songchange', { detail: s }));

    ytPlayer.playVideo();
    forceLowQuality();
    return true;
  }

  function randomOtherIdx(list) {
    return nextIndexFor(list, currentSong);
  }

  function nextSong(auto) {
    var entry = findList(current);
    var list = playable(entry);
    if (!list.length) return;
    playSong(entry, nextIndexFor(list, currentSong), true);
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
    // Data-savings badge: roughly how many MB this track would have burned if we
    // hadn't pinned it to the lowest quality. Comparison is vs. the 720p that
    // YouTube picks by default. ~1.1 Mbps saved ≈ 0.14 MB/s (720p≈1.5Mbps vs
    // pinned 144p≈0.35Mbps), scaled by the track's real duration. Only shown for
    // rows that actually stream (playableRow), and omitted when we can't know the
    // length — no fake numbers.
    var saveBadge = '';
    if (playableRow && s.durationMs) {
      var mb = Math.round((s.durationMs / 1000) * 0.14);
      if (mb > 0) saveBadge = '<div class="s-save" title="省下約 ' + mb + ' MB 流量（對比 720p 預設畫質）">省 ' + mb + ' MB</div>';
    }
    var art = s.artwork
      ? '<img class="s-art" src="' + esc(s.artwork) + '" alt="" loading="lazy" />'
      : '<div class="s-art s-art-none"></div>';
    var artist = s.artistUrl
      ? '<a class="s-artist" href="' + esc(s.artistUrl) + '" target="_blank" rel="noopener">' + esc(s.artist) + '</a>'
      : '<span class="s-artist">' + esc(s.artist) + '</span>';
    var playBadge = playableRow ? '<div class="s-play">▶</div>' : '';
    saveBadge = saveBadge || '';
    var addBtn = opts.showAdd
      ? '<button class="s-add' + (inMyList(s.id) ? ' on' : '') + '" data-addid="' + esc(s.id) + '" title="My playlist">' +
          (opts.removeMode ? '✕' : inMyList(s.id) ? '✓' : '＋') + '</button>'
      : '';
    var ytEditBtn = '<button class="s-yt-edit" data-songid="' + esc(s.id) + '" title="Replace YouTube video">&#9998;</button>';
    return '<div class="song-row' + (playableRow ? ' tappable' : '') + '"' +
        (playableRow ? ' data-videoid="' + esc(s.youtubeId) + '"' : '') + ' data-songid="' + esc(s.id) + '">' +
        '<div class="s-rank">' + (i + 1) + '</div>' +
        art +
        '<div class="s-main">' +
          '<div class="s-name">' + esc(s.name) + '</div>' +
          artist +
        '</div>' +
        '<div class="s-genre">' + esc(s.genre) + '</div>' +
        playBadge +
        saveBadge +
        ytEditBtn +
        addBtn +
      '</div>';
  }

  function render() {
    var entry = findList(current);
    renderCountries();
    myTools.classList.toggle('hidden', current !== 'my');
    if (current !== 'my') myPicker.classList.add('hidden');
    if (current !== 'my') myImport.classList.add('hidden');
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

  /* ---- YouTube ID replacement ---- */
  function extractYtId(input) {
    var s = String(input || '').trim();
    // Already a bare video ID
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    // Try URL parsing
    try {
      var u = new URL(s);
      // youtu.be/VIDEO_ID
      if (u.hostname === 'youtu.be' && u.pathname.length > 1) return u.pathname.slice(1).split('/')[0].split('?')[0];
      // youtube.com/watch?v=VIDEO_ID
      if (u.searchParams.has('v')) return u.searchParams.get('v');
      // youtube.com/embed/VIDEO_ID or /v/VIDEO_ID
      var m = u.pathname.match(/\/(embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[2];
    } catch {}
    return null;
  }

  function replaceYtId(songId, newId) {
    var entry = findList(current);
    if (!entry) return;
    // Update the song object in memory
    var songs = entry.songs || [];
    for (var i = 0; i < songs.length; i++) {
      if (String(songs[i].id) === String(songId)) {
        songs[i].youtubeId = newId;
        songs[i].youtubeTitle = songs[i].youtubeTitle || '';
        break;
      }
    }
    // Persist to backend or localStorage
    if (current === 'my') {
      saveMySongs(songs);
      render();
      return;
    }
    // Chart playlist: PATCH the server
    var listKey = country + ':' + current;
    fetch(API_BASE + '/playlists/' + encodeURIComponent(listKey) + '/songs/' + encodeURIComponent(songId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtubeId: newId }),
      cache: 'no-store'
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (payload && payload.error) throw new Error(payload.error);
        // Update device cache too
        saveDev(country, current, cache);
        render();
        statusFlash('YouTube video replaced');
      })
      .catch(function (e) { statusFlash('Replace failed: ' + e.message); });
  }

  listEl.addEventListener('click', function (e) {
    var ytBtn = e.target.closest ? e.target.closest('.s-yt-edit') : null;
    if (ytBtn) {
      var songId = ytBtn.dataset.songid;
      var entry = findList(current);
      var song = null;
      var songs = (entry && entry.songs) || [];
      for (var j = 0; j < songs.length; j++) {
        if (String(songs[j].id) === String(songId)) { song = songs[j]; break; }
      }
      if (!song) return;
      var currentId = song.youtubeId || '';
      var input = window.prompt('Enter YouTube URL or video ID:', currentId);
      if (input === null) return; // cancelled
      var newId = extractYtId(input);
      if (!newId) { statusFlash('Invalid YouTube URL or video ID'); return; }
      replaceYtId(songId, newId);
      return;
    }
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
    // Check if a playlist with this name already exists
    fetch(API_BASE + '/myplaylists/' + encodeURIComponent(name), { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) return null;
        return r.json();
      })
      .then(function (existing) {
        if (existing && existing.name) {
          if (!window.confirm('Overwrite existing playlist「' + name + '」(' + existing.songs.length + ' songs)?')) return null;
        }
        return fetch(API_BASE + '/myplaylists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, songs: songs }),
          cache: 'no-store'
        });
      })
      .then(function (r) {
        if (!r) return;
        return r.json();
      })
      .then(function (payload) {
        if (!payload) return;
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
          html += '<div class="my-pick-row">' +
            '<button class="my-pick" data-name="' + esc(p.name) + '">' + esc(p.name) +
            ' · ' + p.count + ' 首 · ' + fmtAgo(p.updated_at) + '</button>' +
            '<button class="my-pick-edit" data-name="' + esc(p.name) + '" title="Rename">&#9998;</button>' +
            '<button class="my-pick-ytr" data-name="' + esc(p.name) + '" title="Resolve YouTube (Shift+click = force re-resolve)">&#9654;</button>' +
            '<button class="my-pick-del" data-name="' + esc(p.name) + '" title="Delete">&#128465;</button>' +
            '</div>';
        });
        myPicker.innerHTML = html;
      })
      .catch(function (e) { myPicker.innerHTML = '<div class="my-picker-title">載入失敗: ' + esc(e.message) + '</div>'; });
  });

  myPicker.addEventListener('click', function (e) {
    var renameBtn = e.target.closest ? e.target.closest('.my-pick-edit') : null;
    if (renameBtn) {
      var oldName = renameBtn.dataset.name;
      var newName = window.prompt('Rename playlist', oldName);
      if (!newName || newName.trim() === oldName) return;
      fetch(API_BASE + '/myplaylists/' + encodeURIComponent(oldName), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: newName.trim() }),
        cache: 'no-store'
      })
        .then(function (r) { return r.json(); })
        .then(function (payload) {
          if (payload && payload.error) throw new Error(payload.error);
          statusFlash('已改名為「' + payload.name + '」');
          myPickerBtn.click();
          myPickerBtn.click();
        })
        .catch(function (e) { statusFlash('改名失敗: ' + e.message); });
      return;
    }
    var delBtn = e.target.closest ? e.target.closest('.my-pick-del') : null;
    if (delBtn) {
      var delName = delBtn.dataset.name;
      if (!window.confirm('Delete playlist「' + delName + '」?')) return;
      fetch(API_BASE + '/myplaylists/' + encodeURIComponent(delName), {
        method: 'DELETE',
        cache: 'no-store'
      })
        .then(function (r) { return r.json(); })
        .then(function (payload) {
          if (payload && payload.error) throw new Error(payload.error);
          statusFlash('已刪除歌單「' + delName + '」');
          myPickerBtn.click();
          myPickerBtn.click();
        })
        .catch(function (e) { statusFlash('刪除失敗: ' + e.message); });
      return;
    }
    var ytrBtn = e.target.closest ? e.target.closest('.my-pick-ytr') : null;
    if (ytrBtn) {
      resolveYouTubeForPlaylist(ytrBtn.dataset.name, e.shiftKey);
      return;
    }
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

  /* ---- import from Apple Music URL ---- */
  myImportBtn.addEventListener('click', function () {
    if (!myImport.classList.contains('hidden')) { myImport.classList.add('hidden'); return; }
    myImport.classList.remove('hidden');
    myPicker.classList.add('hidden');
    myImport.innerHTML =
      '<div class="my-picker-title">貼上 Apple Music 連結</div>' +
      '<div class="import-row">' +
        '<input id="importUrl" type="url" placeholder="playlist / room / album / artist URL" class="import-input" />' +
        '<button id="importFetchBtn" class="my-tool-btn">匯入</button>' +
      '</div>';
    document.getElementById('importFetchBtn').addEventListener('click', doImport);
    document.getElementById('importUrl').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doImport();
    });
  });

  function doImport() {
    var urlInput = document.getElementById('importUrl');
    var url = urlInput ? urlInput.value.trim() : '';
    if (!url) { statusFlash('請貼上歌單連結'); return; }
    if (!url.includes('music.apple.com') || (!url.includes('pl.') && !url.includes('/room/') && !url.includes('/album/') && !url.includes('/artist/'))) {
      statusFlash('請輸入有效的 Apple Music 連結 (歌單 / 房間 / 專輯 / 藝人)');
      return;
    }
    var fetchBtn = document.getElementById('importFetchBtn');
    if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = '解析中…'; }
    myImport.innerHTML += '<div class="loading-note" id="importStatus">正在解析歌單…</div>';

    fetch(API_BASE + '/playlist/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url }),
      cache: 'no-store'
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        var st = document.getElementById('importStatus');
        if (st) st.remove();
        var html = '<div class="my-picker-title">' + esc(data.title) + '（' + data.songs.length + ' 首）</div>' +
          '<div class="import-row">' +
            '<input id="importName" type="text" placeholder="歌單名稱" class="import-input" value="' + esc(data.title) + '" />' +
            '<button id="importSaveBtn" class="my-tool-btn">儲存</button>' +
            '<button id="importCancelBtn" class="my-tool-btn">取消</button>' +
          '</div>' +
          '<div class="import-preview">';
        data.songs.forEach(function (s, i) {
          html += '<div class="import-song">' +
            '<span class="import-rank">#' + (i + 1) + '</span>' +
            '<span class="import-sname">' + esc(s.name) + '</span>' +
            '<span class="import-artist">' + esc(s.artist) + '</span>' +
          '</div>';
        });
        html += '</div>';
        myImport.innerHTML = html;

        document.getElementById('importSaveBtn').addEventListener('click', function () {
          var nameInput = document.getElementById('importName');
          var name = nameInput ? nameInput.value.trim() : '';
          if (!name) { statusFlash('請輸入歌單名稱'); return; }
          saveImportedPlaylist(name, data.songs);
        });
        document.getElementById('importCancelBtn').addEventListener('click', function () {
          myImport.classList.add('hidden');
        });
      })
      .catch(function (e) {
        var st = document.getElementById('importStatus');
        if (st) st.remove();
        statusFlash('解析失敗: ' + e.message);
        if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = '匯入'; }
      });
  }

  function saveImportedPlaylist(name, songs) {
    // Check if exists
    fetch(API_BASE + '/myplaylists/' + encodeURIComponent(name), { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) return null;
        return r.json();
      })
      .then(function (existing) {
        if (existing && existing.name) {
          if (!window.confirm('已存在歌單「' + name + '」(' + existing.songs.length + ' 首)，是否覆蓋？')) return null;
        }
        return fetch(API_BASE + '/myplaylists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, songs: songs }),
          cache: 'no-store'
        });
      })
      .then(function (r) {
        if (!r) return;
        return r.json();
      })
      .then(function (payload) {
        if (!payload) return;
        if (payload && payload.error) throw new Error(payload.error);
        // Also load into local state
        saveMySongs(songs);
        currentSong = -1;
        render();
        statusFlash('已匯入歌單「' + name + '」(' + songs.length + ' 首)');
        myImport.classList.add('hidden');
        // Ask user if they want to resolve YouTube IDs
        if (window.confirm('歌單已儲存。是否搜尋 YouTube 影片以便播放？')) {
          resolveYouTubeForPlaylist(name);
        }
      })
      .catch(function (e) { statusFlash('儲存失敗: ' + e.message); });
  }

  function resolveYouTubeForPlaylist(name, force) {
    statusFlash(force ? '重新搜尋 YouTube 影片… 0/0' : '正在搜尋 YouTube 影片… 0/0');
    var retries = 0;
    function doBatch() {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 15000);
      fetch(API_BASE + '/myplaylists/' + encodeURIComponent(name) + '/resolve-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: force ? JSON.stringify({ force: true }) : '{}',
        cache: 'no-store',
        signal: controller.signal
      })
        .then(function (r) { clearTimeout(timer); return r.json(); })
        .then(function (payload) {
          if (payload && payload.error) throw new Error(payload.error);
          retries = 0;
          statusFlash('正在搜尋 YouTube 影片… ' + payload.resolved + '/' + payload.total);
          if (payload.remaining > 0) {
            setTimeout(doBatch, 300);
          } else {
            // All resolved — remove songs without YouTube ID
            statusFlash('正在清理無法播放的歌曲…');
            fetch(API_BASE + '/myplaylists/' + encodeURIComponent(name) + '/cleanup', {
              method: 'POST', cache: 'no-store'
            })
              .then(function (r) { return r.json(); })
              .then(function (c) {
                if (c && c.error) throw new Error(c.error);
                statusFlash('已找到 ' + payload.resolved + ' 首，移除 ' + c.removed + ' 首無法播放的歌曲，保留 ' + c.remaining + ' 首');
                return fetch(API_BASE + '/myplaylists/' + encodeURIComponent(name), { cache: 'no-store' });
              })
              .then(function (r) { return r ? r.json() : null; })
              .then(function (data) {
                if (data && data.songs) { saveMySongs(data.songs); currentSong = -1; render(); }
              });
          }
        })
        .catch(function (e) {
          clearTimeout(timer);
          retries++;
          if (retries < 3) {
            statusFlash('搜尋超時，重試中… (' + retries + '/3)');
            setTimeout(doBatch, 1000);
          } else {
            statusFlash('YouTube 搜尋失敗: ' + e.message);
          }
        });
    }
    force = false; // only force on first batch
    doBatch();
  }
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
    clearBufferSkip();
    // Clean up preload player + slot
    if (preloadPlayer) { try { preloadPlayer.destroy(); } catch (e) {} preloadPlayer = null; }
    if (preloadDiv && preloadDiv.parentNode) preloadDiv.parentNode.removeChild(preloadDiv);
    preloadDiv = null;
    preloadReady = false; preloadVideoId = null; preloadIdx = -1; preloadShuffle = false;
    var rows = listEl.querySelectorAll('.song-row');
    Array.prototype.forEach.call(rows, function (r) { r.classList.remove('playing'); });
  });

  refreshBtn.addEventListener('click', function (e) {
    // Shift+click: force re-resolve all YouTube IDs (clears cache)
    var clearCache = !!(e && e.shiftKey);
    load(true, clearCache);
  });

  function load(refresh, clearCache) {
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
    var body = { country: country, list: wantList };
    if (clearCache) body.clearCache = true;
    fetch(refresh ? API_BASE + '/playlists/refresh' : API_BASE + '/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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