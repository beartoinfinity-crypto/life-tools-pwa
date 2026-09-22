import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const PLAYLIST_PAYLOAD = {
  data: [
    {
      list: 'hk:trending',
      chartTitle: 'Trending',
      songs: [
        { id: 's1', name: 'Song One', artist: 'A', genre: 'canto', youtubeId: 'vid00000001', durationMs: 180000 },
        { id: 's2', name: 'Song Two', artist: 'B', genre: 'canto', youtubeId: 'vid00000002', durationMs: 180000 },
        { id: 's3', name: 'Song Three', artist: 'C', genre: 'canto', youtubeId: 'vid00000003', durationMs: 180000 },
        { id: 's4', name: 'Song Four', artist: 'D', genre: 'canto', youtubeId: 'vid00000004', durationMs: 180000 },
      ],
    },
  ],
  lastRefresh: new Date().toISOString(),
  countries: { hk: 'HK' },
};

function installMockYT(dom) {
  const { window } = dom;
  const players = [];

  class MockPlayer {
    constructor(target, config) {
      this.config = config;
      this.videoId = config.videoId || '';
      this.state = -1;
      this.destroyed = false;
      this.listeners = { onStateChange: [], onReady: [], onError: [] };
      if (config.events) {
        if (config.events.onStateChange) this.listeners.onStateChange.push(config.events.onStateChange);
        if (config.events.onReady) this.listeners.onReady.push(config.events.onReady);
        if (config.events.onError) this.listeners.onError.push(config.events.onError);
      }
      const el = typeof target === 'string' ? window.document.getElementById(target) : target;
      if (el && el.parentNode) {
        const iframe = window.document.createElement('iframe');
        iframe.id = el.id || '';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        el.parentNode.replaceChild(iframe, el);
        this.iframe = iframe;
      } else {
        this.iframe = null;
      }
      players.push(this);
      queueMicrotask(() => {
        if (!this.destroyed) this.emitReady();
      });
    }

    emitReady() {
      this.listeners.onReady.forEach((fn) => fn({ target: this }));
    }

    setState(state) {
      if (this.destroyed) return;
      this.state = state;
      this.listeners.onStateChange.slice().forEach((fn) => fn({ data: state, target: this }));
    }

    addEventListener(name, fn) {
      if (this.listeners[name]) this.listeners[name].push(fn);
    }

    removeEventListener(name, fn) {
      if (this.listeners[name]) {
        this.listeners[name] = this.listeners[name].filter((f) => f !== fn);
      }
    }

    cueVideoById(id) {
      this.videoId = id;
      this.cuedOnly = true;
      this.setState(5); // CUED
    }

    loadVideoById(id) {
      this.videoId = id;
      this.cuedOnly = false;
      this.loaded = true;
      this.setState(3); // BUFFERING
      queueMicrotask(() => {
        if (!this.destroyed && this.videoId === id) this.setState(1); // PLAYING
      });
    }

    playVideo() {
      if (this.destroyed) return;
      this.playCalls = (this.playCalls || 0) + 1;
      this.setState(1);
    }

    pauseVideo() {
      this.pauseCalls = (this.pauseCalls || 0) + 1;
      this.setState(2);
    }

    getPlayerState() {
      return this.destroyed ? -1 : this.state;
    }

    stopVideo() {
      this.setState(-1);
    }

    destroy() {
      this.destroyed = true;
      if (this.iframe && this.iframe.parentNode) this.iframe.parentNode.removeChild(this.iframe);
    }

    getAvailableQualityLevels() { return ['hd720', 'small']; }
    setPlaybackQuality() {}
    getCurrentTime() {
      if (typeof this._currentTime === 'number') return this._currentTime;
      return 10;
    }
    getDuration() {
      if (typeof this._duration === 'number') return this._duration;
      return 180;
    }
  }

  window.YT = {
    Player: MockPlayer,
    PlayerState: {
      UNSTARTED: -1,
      ENDED: 0,
      PLAYING: 1,
      PAUSED: 2,
      BUFFERING: 3,
      CUED: 5,
    },
  };

  return { players, YT: window.YT };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function createHarness({ shuffle = false, hidden = false } = {}) {
  const dom = new JSDOM(indexHtml, {
    url: 'https://example.test/music-trend/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.localStorage.setItem('music-country', 'hk');
  if (shuffle) window.localStorage.setItem('music-shuffle', '1');
  else window.localStorage.removeItem('music-shuffle');

  window.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/music-trend/api/playlists')) {
      return {
        ok: true,
        status: 200,
        json: async () => PLAYLIST_PAYLOAD,
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  });

  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: { register: () => Promise.resolve({}) },
    configurable: true,
  });
  // Screen Wake Lock (optional in real browsers)
  const wakeLock = {
    released: false,
    release: vi.fn(() => {
      wakeLock.released = true;
      return Promise.resolve();
    }),
    addEventListener: vi.fn(),
  };
  Object.defineProperty(window.navigator, 'wakeLock', {
    value: { request: vi.fn(() => Promise.resolve(wakeLock)) },
    configurable: true,
  });

  // Media Session (lock-screen / Bluetooth bar)
  const mediaSession = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: vi.fn(),
    setPositionState: vi.fn(),
  };
  Object.defineProperty(window.navigator, 'mediaSession', {
    value: mediaSession,
    configurable: true,
  });
  window.MediaMetadata = class MediaMetadata {
    constructor(init) {
      this.title = (init && init.title) || '';
      this.artist = (init && init.artist) || '';
      this.album = (init && init.album) || '';
      this.artwork = (init && init.artwork) || [];
    }
  };

  let visibilityState = hidden ? 'hidden' : 'visible';
  Object.defineProperty(window.document, 'visibilityState', {
    get: () => visibilityState,
    configurable: true,
  });
  Object.defineProperty(window.document, 'hidden', {
    get: () => visibilityState === 'hidden',
    configurable: true,
  });

  const { players, YT } = installMockYT(dom);

  // app.js is an IIFE that talks to globals on window
  window.eval(appJs);

  return {
    dom,
    window,
    players,
    YT,
    wakeLock,
    mediaSession,
    setHidden(next) {
      visibilityState = next ? 'hidden' : 'visible';
      window.document.dispatchEvent(new window.Event('visibilitychange'));
    },
  };
}

function livePlayers(players) {
  return players.filter((p) => !p.destroyed);
}

function playingVideoIds(players) {
  return livePlayers(players)
    .filter((p) => p.state === 1)
    .map((p) => p.videoId);
}

describe('music-trend playback transitions', () => {
  let harness;

  afterEach(() => {
    if (harness) {
      try { harness.dom.window.close(); } catch { /* ignore */ }
      harness = null;
    }
  });

  async function startAndSettle({ shuffle, hidden } = {}) {
    harness = createHarness({ shuffle, hidden });
    const { window, players } = harness;

    window.onYouTubeIframeAPIReady();
    await flush();
    await flush();

    // load() is kicked off by app.js; wait for render
    await flush();
    await flush();
    await flush();

    const rows = window.document.querySelectorAll('.song-row.tappable');
    expect(rows.length).toBeGreaterThan(0);

    // Click first playable row
    rows[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    await flush();

    const main = players.find((p) => !p.destroyed && p.videoId);
    expect(main).toBeTruthy();
    expect(main.videoId).toBe('vid00000001');
    main.setState(1); // PLAYING
    await flush();

    return { window, players, main };
  }

  it('advances to the next song when ENDED fires (sequential)', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });

    // Let preload cue the next sequential video
    await flush();
    await flush();

    main.setState(0); // ENDED
    await flush();
    await flush();

    const playing = playingVideoIds(players);
    expect(playing).toContain('vid00000002');
  });

  it('advances to a different song when ENDED fires (shuffle)', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: true });

    await flush();
    await flush();

    main.setState(0); // ENDED
    await flush();
    await flush();

    const playing = playingVideoIds(players);
    // Must have advanced: some live player is playing a non-first song
    // (or at least something is playing — not a dead stop on song 1)
    expect(playing.length).toBeGreaterThan(0);
    expect(playing).not.toEqual(['vid00000001']);
    // Under shuffle with 4 songs, next should not necessarily be vid2,
    // but must be one of the playlist ids and currently playing
    expect(playing.every((id) => id.startsWith('vid0000000'))).toBe(true);
  });

  it('keeps advancing across a second ENDED after a preload swap (sequential)', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });

    await flush();
    await flush();

    // First transition (likely advanceFromPreload)
    main.setState(0);
    await flush();
    await flush();

    const afterFirst = livePlayers(players).filter((p) => p.state === 1);
    expect(afterFirst.length).toBeGreaterThan(0);
    const second = afterFirst[0];
    expect(second.videoId).toBe('vid00000002');

    // Second transition must also advance — this is where a broken rebind stops
    second.setState(0); // ENDED on the swapped/preloaded player
    await flush();
    await flush();

    const playing = playingVideoIds(players);
    expect(playing).toContain('vid00000003');
  });

  it('keeps advancing across a second ENDED after a preload swap (shuffle)', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: true });

    await flush();
    await flush();

    main.setState(0);
    await flush();
    await flush();

    const afterFirst = livePlayers(players).filter((p) => p.state === 1);
    expect(afterFirst.length).toBeGreaterThan(0);
    const second = afterFirst[0];
    const firstNext = second.videoId;
    expect(firstNext).not.toBe('vid00000001');

    second.setState(0);
    await flush();
    await flush();

    const playing = playingVideoIds(players);
    expect(playing.length).toBeGreaterThan(0);
    // Must not be stuck: either still playing firstNext (bad if ENDED ignored)
    // — we assert we MOVED on to some other song than the one that just ended.
    const advanced = playing.filter((id) => id !== firstNext);
    expect(advanced.length).toBeGreaterThan(0);
  });

  it('does not stop when ENDED fires while a preload player exists (shuffle)', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: true });

    await flush();
    await flush();

    // Multiple transitions in a row — stress the swap/rebind path
    let ended = main;
    for (let i = 0; i < 3; i++) {
      const playingNow = livePlayers(players).filter((p) => p.state === 1);
      if (!playingNow.length) break;
      ended = playingNow[0];
      ended.setState(0);
      await flush();
      await flush();
    }

    const playing = playingVideoIds(players);
    expect(playing.length).toBeGreaterThan(0);
  });

  it('prebuffers the next track with loadVideoById (not cue-only)', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });
    await flush();
    await flush();

    const preload = players.find((p) => p !== main && !p.destroyed && p.videoId === 'vid00000002');
    expect(preload).toBeTruthy();
    expect(preload.loaded).toBe(true);
    expect(preload.cuedOnly).not.toBe(true);
  });

  it('keeps wantPlaying when the player pauses while the display is hidden', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });
    harness.setHidden(true);
    await flush();

    main.setState(2); // PAUSED while monitor off (YouTube does this)
    await flush();

    // User still wants audio — button must stay in "playing" state
    const btn = window.document.getElementById('playPauseBtn');
    expect(btn.textContent).toBe('❚❚');
  });

  it('advances past ENDED while hidden so the next track is loaded', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });
    await flush();
    await flush();
    harness.setHidden(true);
    await flush();

    main.setState(0); // ENDED while monitor off
    await flush();
    await flush();

    const live = livePlayers(players);
    const nextLoaded = live.some((p) => p.videoId === 'vid00000002' && p.loaded !== false && p.videoId);
    expect(nextLoaded).toBe(true);
    // Some live player must be on song 2 (promoted or main load)
    expect(live.some((p) => p.videoId === 'vid00000002')).toBe(true);
  });

  it('resumes playback when the display becomes visible again', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });
    await flush();
    await flush();

    harness.setHidden(true);
    await flush();

    // While hidden: song ends, next is loaded but not actually playing
    main.setState(0);
    await flush();
    await flush();
    // Simulate browser freezing playback while display is off
    livePlayers(players).forEach((p) => {
      if (p.videoId === 'vid00000002') p.setState(3); // BUFFERING / stuck
    });
    await flush();

    harness.setHidden(false); // monitor on
    await flush();
    await flush();

    const playing = playingVideoIds(players);
    expect(playing).toContain('vid00000002');
    const next = livePlayers(players).find((p) => p.videoId === 'vid00000002');
    expect(next.playCalls || 0).toBeGreaterThan(0);
  });

  it('requests a screen wake lock while playing', async () => {
    const { window } = await startAndSettle({ shuffle: false });
    await flush();
    expect(harness.window.navigator.wakeLock.request).toHaveBeenCalledWith('screen');
    expect(harness.wakeLock.released).toBe(false);
  });

  it('publishes Media Session metadata for the current track', async () => {
    const { window } = await startAndSettle({ shuffle: false });
    await flush();
    expect(harness.mediaSession.metadata).toBeTruthy();
    expect(harness.mediaSession.metadata.title).toBe('Song One');
    expect(harness.mediaSession.metadata.artist).toBe('A');
    expect(harness.mediaSession.playbackState).toBe('playing');
  });

  it('keeps the lock-screen bar alive across ENDED by advancing Media Session while hidden', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });
    await flush();
    await flush();

    harness.setHidden(true); // phone locked
    await flush();

    main.setState(0); // ENDED on lock screen
    await flush();
    await flush();

    // YouTube clears its session on ENDED — we must own the next track's bar
    expect(harness.mediaSession.metadata).toBeTruthy();
    expect(harness.mediaSession.metadata.title).toBe('Song Two');
    expect(harness.mediaSession.playbackState).toBe('playing');
    // Next track must already be loading (not waiting for unlock)
    expect(livePlayers(players).some((p) => p.videoId === 'vid00000002')).toBe(true);

    // Unlock: bar still present with next track, playback can resume
    harness.setHidden(false);
    await flush();
    await flush();
    expect(harness.mediaSession.metadata.title).toBe('Song Two');
    expect(harness.mediaSession.playbackState).toBe('playing');
  });

  it('registers lock-screen transport controls', async () => {
    await startAndSettle({ shuffle: false });
    await flush();
    const actions = harness.mediaSession.setActionHandler.mock.calls.map((c) => c[0]);
    expect(actions).toContain('play');
    expect(actions).toContain('pause');
    expect(actions).toContain('nexttrack');
    expect(actions).toContain('previoustrack');
  });

  it('advances from the end watchdog while still hidden (no ENDED from YouTube)', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });
    await flush();
    await flush();

    // Pretend the track is about to finish; visibilitychange re-arms the watch.
    main._duration = 0.05;
    main._currentTime = 0;
    harness.setHidden(true);
    await flush();

    // Wait past remain(50ms)+grace(400ms) — ENDED never fires.
    await new Promise((r) => setTimeout(r, 600));
    await flush();
    await flush();

    expect(livePlayers(players).some((p) => p.videoId === 'vid00000002')).toBe(true);
    expect(window.document.hidden).toBe(true);
  });

  it('advances on unlock when wall-clock end already passed (ENDED was held back)', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });
    await flush();
    await flush();

    harness.setHidden(true);
    await flush();

    // Jump past trackEndAt while locked; unlock must advance, not resume song 1.
    // app.js runs inside jsdom, so patch that realm's Date — not Node's.
    const winDate = window.Date;
    const realNow = winDate.now.bind(winDate);
    const t0 = realNow();
    try {
      winDate.now = () => t0 + 10 * 60 * 1000;
      harness.setHidden(false);
      await flush();
      await flush();
    } finally {
      winDate.now = realNow;
    }

    expect(livePlayers(players).some((p) => p.videoId === 'vid00000002')).toBe(true);
    // Must not have just resumed song 1
    const playing = playingVideoIds(players);
    expect(playing).not.toContain('vid00000001');
  });

  it('does not advance on unlock when the track is still mid-play', async () => {
    const { window, players, main } = await startAndSettle({ shuffle: false });
    await flush();
    await flush();

    main._duration = 180;
    main._currentTime = 10;
    main.setState(1); // re-arm end watch with ~170s remaining
    await flush();

    harness.setHidden(true);
    await flush();
    harness.setHidden(false);
    await flush();
    await flush();

    expect(main.videoId).toBe('vid00000001');
    expect(livePlayers(players).some((p) => p.videoId === 'vid00000002' && p.state === 1)).not.toBe(true);
  });
});
