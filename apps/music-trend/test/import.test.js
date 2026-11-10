import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const PARSED = {
  title: 'My YT Mix',
  songs: [
    { rank: 1, id: 'vidAAAAAAAA1', name: 'Song One - Artist A', artist: '', artistUrl: '', artwork: '', releaseDate: '', genre: 'YouTube', youtubeId: 'vidAAAAAAAA1' },
    { rank: 2, id: 'vidBBBBBBBB2', name: 'Song Two', artist: '', artistUrl: '', artwork: '', releaseDate: '', genre: 'YouTube', youtubeId: 'vidBBBBBBBB2' },
  ],
};

let savedPlaylists = [];

function createHarness({ parseError = false } = {}) {
  const dom = new JSDOM(indexHtml, {
    url: 'https://example.test/music-trend/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('music-country', 'hk');

  window.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.includes('/music-trend/api/playlists') && !u.includes('myplaylists')) {
      return { ok: true, status: 200, json: async () => ({ data: [], lastRefresh: new Date().toISOString() }) };
    }
    if (u.includes('/playlist/parse')) {
      if (parseError) return { ok: false, status: 502, json: async () => ({ error: 'Failed to fetch page' }) };
      return { ok: true, status: 200, json: async () => PARSED };
    }
    if (u.endsWith('/myplaylists') && (opts?.method || 'GET') === 'POST') {
      const body = JSON.parse(opts.body);
      savedPlaylists.push({ name: body.name, songs: body.songs });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (u.includes('/myplaylists/')) {
      const name = decodeURIComponent(u.split('/myplaylists/')[1]);
      const found = savedPlaylists.find((p) => p.name === name);
      if (!found) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
      return { ok: true, status: 200, json: async () => ({ name: found.name, songs: found.songs }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  });

  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: { register: () => Promise.resolve({}) },
    configurable: true,
  });
  window.MediaMetadata = class { constructor(i) { Object.assign(this, i); } };
  Object.defineProperty(window.navigator, 'mediaSession', {
    value: { metadata: null, playbackState: 'none', setActionHandler: vi.fn(), setPositionState: vi.fn() },
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'wakeLock', {
    value: { request: vi.fn(() => Promise.resolve({ released: false, release: vi.fn(), addEventListener: vi.fn() })) },
    configurable: true,
  });

  window.eval(appJs);
  return { dom, window };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('music-trend import flow', () => {
  let harness;
  beforeEach(() => { savedPlaylists = []; });
  afterEach(() => {
    if (harness) {
      try { harness.dom.window.close(); } catch { /* ignore */ }
      harness = null;
    }
  });

  async function openImportPanel(window) {
    window.document.getElementById('myTools').classList.remove('hidden');
    window.document.getElementById('myImportBtn').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    await flush();
    return window.document.getElementById('myImport');
  }

  it('parses a YouTube playlist URL via /playlist/parse and shows a preview', async () => {
    harness = createHarness();
    const { window } = harness;
    const panel = await openImportPanel(window);
    window.document.getElementById('importUrl').value = 'https://www.youtube.com/playlist?list=PL1234567890abcdefg';
    window.document.getElementById('importFetchBtn').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    await flush(); await flush();

    const calls = window.fetch.mock.calls.filter((c) => String(c[0]).includes('/playlist/parse'));
    expect(calls.length).toBe(1);
    expect(JSON.parse(calls[0][1].body).url).toBe('https://www.youtube.com/playlist?list=PL1234567890abcdefg');
    expect(panel.textContent).toContain('My YT Mix');
    expect(panel.querySelectorAll('.import-song').length).toBe(2);
  });

  it('saves the imported playlist with youtubeIds already present (no resolve needed)', async () => {
    harness = createHarness();
    const { window } = harness;
    const panel = await openImportPanel(window);
    window.document.getElementById('importUrl').value = 'https://music.youtube.com/playlist?list=RDabcdefghijk';
    window.document.getElementById('importFetchBtn').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    await flush(); await flush();

    window.document.getElementById('importName').value = 'My Mix';
    window.document.getElementById('importSaveBtn').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    await flush(); await flush();

    expect(savedPlaylists).toHaveLength(1);
    expect(savedPlaylists[0].name).toBe('My Mix');
    expect(savedPlaylists[0].songs).toHaveLength(2);
    expect(savedPlaylists[0].songs[0].youtubeId).toBe('vidAAAAAAAA1');

    // songs loaded into the "my" tab without extra resolve calls
    const resolveCalls = window.fetch.mock.calls.filter((c) => String(c[0]).includes('resolve-youtube'));
    expect(resolveCalls.length).toBe(0);
  });

  it('still parses Apple Music URLs (regression guard)', async () => {
    harness = createHarness();
    const { window } = harness;
    const panel = await openImportPanel(window);
    window.document.getElementById('importUrl').value = 'https://music.apple.com/hk/playlist/apple-music-%E7%86%B1%E9%96%80/pl.u-xyz123';
    window.document.getElementById('importFetchBtn').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    await flush(); await flush();
    expect(panel.querySelectorAll('.import-song').length).toBe(2);
  });

  it('shows the failure toast when the parse endpoint errors', async () => {
    harness = createHarness({ parseError: true });
    const { window } = harness;
    const panel = await openImportPanel(window);
    window.document.getElementById('importUrl').value = 'https://www.youtube.com/playlist?list=PLbroken00001';
    window.document.getElementById('importFetchBtn').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    await flush(); await flush();
    // panel still on the URL entry step, toast fired
    expect(window.document.getElementById('importFetchBtn')).toBeTruthy();
    expect(window.document.getElementById('statusBar').textContent).toContain('解析失敗');
  });
});
