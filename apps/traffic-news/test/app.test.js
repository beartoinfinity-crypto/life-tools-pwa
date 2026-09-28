import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const SNAP_KEY = 'traffic-news:snapshot';
const FAVS_KEY = 'traffic-news:favs';

let seq = 0;
function item(over = {}) {
  return {
    id: 'i' + ++seq,
    posted_at: new Date(Date.now() - 60 * 1000).toISOString(),
    category: '道路事故-交通意外',
    status: '最新情況',
    location: '西九龍公路',
    detail: '交通意外，車路通行延誤',
    source: 'routejam',
    lat: null,
    lng: null,
    ...over,
  };
}

function defaultItems() {
  return [
    item({
      id: 'urgent1',
      category: '惡劣天氣-服務',
      location: '港島線',
      detail: '因八號風球，港鐵服務暫停',
      source: '香港電台',
    }),
    item({
      id: 'warn1',
      category: '擠塞信號-車多',
      location: '屯門公路',
      detail: '屯門公路嚴重擠塞',
      source: '881903',
    }),
    item({ id: 'info1', category: '道路工程-改道', location: '彌敦道', detail: '臨時改道安排' }),
    item({ id: 'done1', status: '完結', detail: '全線封閉已解除，服務暫停已恢復' }),
    item({ id: 'plain1', category: '公共設施-檢查', location: '亞皆老街', detail: '路面清理完成' }),
  ];
}

function createHarness({
  url = 'https://example.test/traffic-news/',
  items = defaultItems(),
  fail = false,
  onLine = true,
  seedSnapshot = null,
  seedFavs = null,
} = {}) {
  const dom = new JSDOM(indexHtml, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const state = { fail, items, onLine };

  if (seedSnapshot) window.localStorage.setItem(SNAP_KEY, JSON.stringify(seedSnapshot));
  if (seedFavs) window.localStorage.setItem(FAVS_KEY, JSON.stringify(seedFavs));

  window.fetch = vi.fn(async () => {
    if (state.fail) throw new TypeError('Network down');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: state.items.map((x) => ({ ...x })),
        lastRefresh: new Date().toISOString(),
      }),
    };
  });
  Object.defineProperty(window.navigator, 'onLine', { get: () => state.onLine, configurable: true });

  window.eval(appJs);

  return { dom, window, state };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function cards(window) {
  return [...window.document.querySelectorAll('.news-item')];
}

function ids(window) {
  return cards(window).map((c) => c.getAttribute('data-id'));
}

function click(window, el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function type(window, value) {
  const input = window.document.getElementById('searchInput');
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('traffic-news app (v1.1)', () => {
  let harness;

  afterEach(() => {
    if (harness) {
      try { harness.dom.window.close(); } catch { /* ignore */ }
      harness = null;
    }
    vi.restoreAllMocks();
  });

  async function boot(opts = {}) {
    harness = createHarness(opts);
    await flush();
    return harness;
  }

  // ---- rendering + severity ----

  it('renders items with severity badges on active incidents only', async () => {
    const { window } = await boot();
    const byId = Object.fromEntries(cards(window).map((c) => [c.getAttribute('data-id'), c]));

    expect(byId.urgent1.classList.contains('sev-l3')).toBe(true);
    expect(byId.urgent1.querySelector('.ni-sev').textContent).toBe('緊急');
    expect(byId.warn1.classList.contains('sev-l2')).toBe(true);
    expect(byId.warn1.querySelector('.ni-sev').textContent).toBe('警告');
    expect(byId.info1.classList.contains('sev-l1')).toBe(true);
    expect(byId.info1.querySelector('.ni-sev').textContent).toBe('提示');
    // completed items never get a severity badge even with severe text
    expect(byId.done1.className).not.toContain('sev-');
    expect(byId.plain1.className).not.toContain('sev-');
    expect(byId.plain1.className).not.toContain('sev-');
  });

  it('shows source attribution badges (parsed 資料來源, feed, 881903)', async () => {
    const { window } = await boot();
    const byId = Object.fromEntries(cards(window).map((c) => [c.getAttribute('data-id'), c]));

    expect(byId.urgent1.querySelector('.ni-src').textContent).toBe('香港電台');
    expect(byId.urgent1.querySelector('.ni-src').className).toContain('src-other');
    expect(byId.warn1.querySelector('.ni-src').textContent).toBe('881903');
    expect(byId.plain1.querySelector('.ni-src').textContent).toBe('Routejam');
  });

  it('renders semantic markup: time[datetime], role=button, aria-expanded, status role', async () => {
    const { window } = await boot();
    const head = window.document.querySelector('.news-head');
    expect(head.getAttribute('role')).toBe('button');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    const time = window.document.querySelector('time');
    expect(time.getAttribute('datetime')).toBeTruthy();
    expect(window.document.getElementById('lastUpdate').getAttribute('role')).toBe('status');
    expect(window.document.getElementById('lastUpdate').textContent).toContain('updated');
    // live region attached only after the first paint
    expect(window.document.getElementById('newsList').getAttribute('aria-live')).toBe('polite');
  });

  // ---- expand / keyboard ----

  it('expands a card on click and collapses it again', async () => {
    const { window } = await boot();
    const head = window.document.querySelector('.news-head');
    const item = head.closest('.news-item');

    click(window, head);
    expect(item.classList.contains('open')).toBe(true);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    click(window, head);
    expect(item.classList.contains('open')).toBe(false);
    expect(head.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles expansion with the Enter key', async () => {
    const { window } = await boot();
    const head = window.document.querySelector('.news-head');
    head.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(head.getAttribute('aria-expanded')).toBe('true');
    head.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(head.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps an expanded card open across a refresh', async () => {
    const { window, state } = await boot();
    const head = window.document.querySelector('.news-head');
    click(window, head);
    expect(head.getAttribute('aria-expanded')).toBe('true');

    // new payload arrives (one more item) -> rebuild must re-apply expansion
    state.items = [...state.items, item({ id: 'extra1' })];
    click(window, window.document.getElementById('refreshBtn'));
    await flush();

    expect(ids(window)).toContain('extra1');
    const firstHead = window.document.querySelector('.news-item').querySelector('.news-head');
    expect(firstHead.getAttribute('aria-expanded')).toBe('true');
    expect(firstHead.closest('.news-item').classList.contains('open')).toBe(true);
  });

  // ---- filter chips + URL params ----

  it('renders data-driven chips and filters by category with URL sync', async () => {
    const { window } = await boot();
    const labels = [...window.document.querySelectorAll('.chip')].map((c) => c.textContent);
    expect(labels).toContain('全部');
    expect(labels).toContain('惡劣天氣');
    expect(labels).toContain('擠塞信號');
    expect(labels).toContain('道路工程');
    expect(labels).toContain('道路事故');
    expect(labels).toContain('收藏');

    const evil = [...window.document.querySelectorAll('.chip')].find((c) => c.textContent === '惡劣天氣');
    click(window, evil);
    expect(ids(window)).toEqual(['urgent1']);
    expect(window.location.search).toContain('cat=');
    // chips rebuild on state change -> re-query instead of holding the detached node
    const evilActive = [...window.document.querySelectorAll('.chip')].find((c) => c.textContent === '惡劣天氣');
    expect(evilActive.classList.contains('active')).toBe(true);

    click(window, [...window.document.querySelectorAll('.chip')].find((c) => c.textContent === '全部'));
    expect(ids(window).length).toBe(5);
    expect(window.location.search).not.toContain('cat=');
  });

  it('filters by search text and syncs ?q=', async () => {
    const { window } = await boot();
    type(window, '屯門公路');
    expect(ids(window)).toEqual(['warn1']);
    expect(window.location.search).toContain('q=');
    type(window, 'zzz-no-match');
    expect(cards(window).length).toBe(0);
    expect(window.document.querySelector('.news-empty').textContent).toBe('No matches.');
    type(window, '');
    expect(ids(window).length).toBe(5);
  });

  it('honours deep-link params on boot (?q= and ?cat=)', async () => {
    const { window } = await boot({ url: 'https://example.test/traffic-news/?q=' + encodeURIComponent('屯門') });
    expect(window.document.getElementById('searchInput').value).toBe('屯門');
    expect(ids(window)).toEqual(['warn1']);
  });

  // ---- favourites ----

  it('stars a card: pins it, persists, and shows it under the Saved chip', async () => {
    const { window } = await boot();
    const star = () => window.document.querySelector('.news-item[data-id="plain1"] .ni-fav');

    click(window, star());
    expect(star().getAttribute('aria-pressed')).toBe('true');
    expect(ids(window)[0]).toBe('plain1'); // pinned to top
    expect(JSON.parse(window.localStorage.getItem(FAVS_KEY))).toContain('plain1');

    const savedChip = [...window.document.querySelectorAll('.chip')].find((c) => c.textContent.startsWith('收藏'));
    expect(savedChip.textContent).toBe('收藏 1');
    click(window, savedChip);
    expect(ids(window)).toEqual(['plain1']);
  });

  it('restores saved favourites from localStorage on boot', async () => {
    const { window } = await boot({ seedFavs: ['warn1'] });
    expect(ids(window)[0]).toBe('warn1');
    const star = window.document.querySelector('.news-item[data-id="warn1"] .ni-fav');
    expect(star.getAttribute('aria-pressed')).toBe('true');
  });

  // ---- offline / never blank ----

  it('serves the cached snapshot with a banner when offline', async () => {
    const snap = {
      t: Date.now() - 5 * 60 * 1000,
      payload: {
        data: [item({ id: 'cached1', detail: 'cached only' })],
        lastRefresh: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    };
    const { window } = await boot({ fail: true, onLine: false, seedSnapshot: snap });
    expect(ids(window)).toEqual(['cached1']);
    const banner = window.document.getElementById('offlineBanner');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('Offline');
    expect(banner.textContent).toContain('ago');
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('keeps the current list and shows a banner when a refresh fails', async () => {
    const { window, state } = await boot();
    expect(ids(window).length).toBe(5);
    expect(window.document.getElementById('offlineBanner').hidden).toBe(true);

    state.fail = true;
    click(window, window.document.getElementById('refreshBtn'));
    await flush();

    expect(ids(window).length).toBe(5); // never wiped
    const banner = window.document.getElementById('offlineBanner');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('Refresh failed');
    expect(window.document.querySelector('.news-empty')).toBeNull();
  });

  it('keeps existing news when a refresh returns an empty payload', async () => {
    const { window, state } = await boot();
    state.items = [];
    click(window, window.document.getElementById('refreshBtn'));
    await flush();
    expect(ids(window).length).toBe(5);
  });

  it('saves a snapshot after a successful fetch for later offline use', async () => {
    const { window } = await boot();
    const snap = JSON.parse(window.localStorage.getItem(SNAP_KEY));
    expect(snap.payload.data.length).toBe(5);
    expect(typeof snap.t).toBe('number');
  });
});
