import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const indexHtml = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8'));

const ORDER_KEY = 'life-tool-apps';
const THEME_KEY = 'life-tool-theme';
const DISMISS_KEY = 'life-tool-install-dismissed';

const ALL_IDS = ['traffic-news', 'mark-six', 'bus-eta', 'bus-eta-lite', 'music-trend'];

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function createHarness({
  order = null,
  theme = null,
  userAgent = null,
  dismissed = false,
  standalone = null,
  autoDismissMs = null,
} = {}) {
  const dom = new JSDOM(indexHtml, {
    url: 'https://example.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  if (order) window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  if (theme) window.localStorage.setItem(THEME_KEY, theme);
  if (userAgent) {
    Object.defineProperty(window.navigator, 'userAgent', { get: () => userAgent, configurable: true });
  }
  if (dismissed) window.sessionStorage.setItem(DISMISS_KEY, '1');
  if (standalone !== null) {
    Object.defineProperty(window.navigator, 'standalone', { get: () => standalone, configurable: true });
  }
  if (autoDismissMs != null) window.__BANNER_AUTO_DISMISS_MS = autoDismissMs;
  window.eval(appJs);
  return { dom, window };
}

function click(window, el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function flush(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('hub launcher (public/)', () => {
  let harness;

  afterEach(() => {
    if (harness) {
      try { harness.dom.window.close(); } catch { /* ignore */ }
      harness = null;
    }
    vi.restoreAllMocks();
  });

  function boot(opts = {}) {
    harness = createHarness(opts);
    return harness;
  }

  function cardIds(window) {
    return [...window.document.querySelectorAll('.app-card')].map((c) => c.getAttribute('data-id'));
  }

  // ---- Feature 1: app grid & card component ----

  it('renders one card per app with data-category, data-title and href', () => {
    const { window } = boot();
    expect(cardIds(window)).toEqual(ALL_IDS);
    const cards = [...window.document.querySelectorAll('.app-card')];
    const byId = Object.fromEntries(cards.map((c) => [c.getAttribute('data-id'), c]));
    expect(byId['traffic-news'].getAttribute('data-category')).toBe('transport');
    expect(byId['traffic-news'].getAttribute('href')).toBe('/traffic-news/');
    expect(byId['mark-six'].getAttribute('data-category')).toBe('lottery');
    expect(byId['mark-six'].getAttribute('data-title')).toContain('六合彩');
    expect(byId['music-trend'].getAttribute('data-category')).toBe('utility');
    expect(byId['bus-eta'].getAttribute('data-category')).toBe('transport');
    // emoji icon tiles
    expect(byId['traffic-news'].querySelector('.app-icon').textContent).toBe('🚦');
    expect(byId['mark-six'].querySelector('.app-icon').textContent).toBe('🎱');
  });

  it('shows a Live badge on traffic-news only', () => {
    const { window } = boot();
    const badge = window.document.querySelector('[data-id="traffic-news"] .badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('Live');
    expect(window.document.querySelector('[data-id="bus-eta"] .badge')).toBeNull();
    expect(window.document.querySelector('[data-id="mark-six"] .badge')).toBeNull();
  });

  it('filters by category pill with aria-pressed state', () => {
    const { window } = boot();
    const transportBtn = window.document.querySelector('.filter-btn[data-category="transport"]');
    click(window, transportBtn);
    expect(window.HubCore.visibleIds()).toEqual(['traffic-news', 'bus-eta', 'bus-eta-lite']);
    expect(transportBtn.getAttribute('aria-pressed')).toBe('true');
    const allBtn = window.document.querySelector('.filter-btn[data-category="all"]');
    expect(allBtn.getAttribute('aria-pressed')).toBe('false');
    expect(allBtn.classList.contains('active')).toBe(false);
    click(window, allBtn);
    expect(window.HubCore.visibleIds()).toEqual(ALL_IDS);
    expect(allBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('searches titles, keywords and descriptions (EN + CJK)', () => {
    const { window } = boot();
    window.HubCore.setSearch('mark six');
    expect(window.HubCore.visibleIds()).toEqual(['mark-six']);
    window.HubCore.setSearch('交通');
    expect(window.HubCore.visibleIds()).toEqual(['traffic-news']);
    window.HubCore.setSearch('charts');
    expect(window.HubCore.visibleIds()).toEqual(['music-trend']);
    window.HubCore.setSearch('');
    expect(window.HubCore.visibleIds()).toEqual(ALL_IDS);
  });

  it('combines the active category with the search query', () => {
    const { window } = boot();
    window.HubCore.selectCategory('transport');
    window.HubCore.setSearch('lite');
    expect(window.HubCore.visibleIds()).toEqual(['bus-eta-lite']);
    window.HubCore.setSearch('zzzz-no-match');
    expect(window.HubCore.visibleIds()).toEqual([]);
    expect(window.document.getElementById('noResults').hidden).toBe(false);
    window.HubCore.setSearch('');
    expect(window.document.getElementById('noResults').hidden).toBe(true);
  });

  it('keeps search + category across a sort-mode re-render', () => {
    const { window } = boot();
    window.HubCore.selectCategory('transport');
    window.HubCore.setSearch('eta');
    click(window, window.document.getElementById('sortBtn'));
    expect(window.HubCore.visibleIds()).toEqual(['bus-eta', 'bus-eta-lite']);
    click(window, window.document.getElementById('sortBtn'));
    expect(window.HubCore.visibleIds()).toEqual(['bus-eta', 'bus-eta-lite']);
  });

  // ---- Sort / reorder (existing behaviour kept) ----

  it('reorders cards in sort mode and persists the order', () => {
    const { window } = boot();
    const sortBtn = window.document.getElementById('sortBtn');
    click(window, sortBtn);
    expect(sortBtn.textContent).toBe('Done');
    const first = window.document.querySelector('.app-card');
    expect(first.getAttribute('data-id')).toBe('traffic-news');
    click(window, first.querySelector('.sort-down'));
    expect(cardIds(window)[0]).toBe('mark-six');
    expect(JSON.parse(window.localStorage.getItem(ORDER_KEY))).toEqual([
      'mark-six', 'traffic-news', 'bus-eta', 'bus-eta-lite', 'music-trend',
    ]);
    click(window, sortBtn);
    expect(sortBtn.textContent).toBe('Sort');
    expect(window.document.querySelector('.app-card').getAttribute('href')).toBe('/mark-six/');
    expect(window.document.querySelector('.sort-up')).toBeNull();
  });

  it('honours a persisted custom order on boot', () => {
    const { window } = boot({ order: ['music-trend', 'traffic-news'] });
    expect(cardIds(window)).toEqual(['music-trend', 'traffic-news', 'mark-six', 'bus-eta', 'bus-eta-lite']);
  });

  // ---- Theme (existing behaviour kept) ----

  it('toggles and persists the day/night theme', () => {
    const { window } = boot();
    const html = window.document.documentElement;
    const before = html.dataset.theme;
    click(window, window.document.getElementById('themeBtn'));
    expect(html.dataset.theme).not.toBe(before);
    expect(window.localStorage.getItem(THEME_KEY)).toBe(html.dataset.theme);
    const meta = window.document.querySelector('meta[name="theme-color"]');
    expect(meta.content).toBe(html.dataset.theme === 'dark' ? '#12161a' : '#f5f5f5');
  });

  // ---- Feature 3: PWA install prompt banner ----

  function fakePrompt() {
    return {
      prompted: false,
      preventDefaultCalled: false,
      prompt: vi.fn(function () { this.prompted = true; }),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
      preventDefault() { this.preventDefaultCalled = true; },
    };
  }

  it('shows the banner when beforeinstallprompt fires (and prevents the default)', () => {
    const { window } = boot();
    expect(window.HubCore.bannerVisible()).toBe(false);
    const evt = fakePrompt();
    window.HubCore.handleBeforeInstallPrompt(evt);
    expect(evt.preventDefaultCalled).toBe(true);
    expect(window.HubCore.bannerVisible()).toBe(true);
    expect(window.HubCore.bannerDismissed()).toBe(false);
  });

  it('dismisses for the session and ignores refires, but Simulate still previews', async () => {
    const { window } = boot({ theme: 'light' });
    window.HubCore.handleBeforeInstallPrompt(fakePrompt());
    click(window, window.document.getElementById('bannerDismiss'));
    expect(window.HubCore.bannerDismissed()).toBe(true);
    await flush(300);
    expect(window.HubCore.bannerVisible()).toBe(false);
    // refire within the same session stays hidden
    window.HubCore.handleBeforeInstallPrompt(fakePrompt());
    expect(window.HubCore.bannerVisible()).toBe(false);
    // explicit simulate button bypasses the dismissal flag
    click(window, window.document.getElementById('simBtn'));
    expect(window.HubCore.bannerVisible()).toBe(true);
  });

  it('runs the real install prompt from the banner and hides afterwards', async () => {
    const { window } = boot();
    const evt = fakePrompt();
    window.HubCore.handleBeforeInstallPrompt(evt);
    click(window, window.document.getElementById('bannerInstall'));
    expect(evt.prompt).toHaveBeenCalledTimes(1);
    await flush(300);
    expect(window.HubCore.bannerVisible()).toBe(false);
    expect(window.HubCore.bannerDismissed()).toBe(true);
  });

  it('falls back to on-page instructions when Install is clicked with no deferred prompt', () => {
    const { window } = boot();
    // beforeinstallprompt never fired (unsupported browser or preview mode) - the
    // click must do something useful instead of silently closing the banner.
    click(window, window.document.getElementById('bannerInstall'));
    expect(window.HubCore.bannerMode()).toBe('manual');
    expect(window.HubCore.bannerVisible()).toBe(true);
    expect(window.HubCore.bannerDismissed()).toBe(false);
    const btn = window.document.getElementById('bannerInstall');
    expect(btn.style.display).toBe('none');
    expect(window.document.querySelector('.banner-text p').textContent).toContain('browser menu');
  });

  it('auto-shows the iOS how-to banner once per session on iPhone Safari', () => {
    const { window } = boot({ userAgent: IPHONE_UA });
    expect(window.HubCore.bannerVisible()).toBe(true);
    expect(window.HubCore.bannerMode()).toBe('ios');
    const btn = window.document.getElementById('bannerInstall');
    expect(btn.style.display).toBe('none');
    expect(window.document.querySelector('.banner-text p').textContent).toContain('Add to Home Screen');
    expect(window.HubCore.bannerDismissed()).toBe(false);
  });

  it('stays hidden for the session when the banner was already dismissed', () => {
    const { window } = boot({ userAgent: IPHONE_UA, dismissed: true });
    expect(window.HubCore.bannerVisible()).toBe(false);
  });

  it('stays hidden when the app is already installed (iOS standalone)', () => {
    const { window } = boot({ userAgent: IPHONE_UA, standalone: true });
    expect(window.HubCore.isInstalledMode()).toBe(true);
    expect(window.HubCore.bannerVisible()).toBe(false);
  });

  it('ignores beforeinstallprompt while running as an installed app', () => {
    const { window } = boot({ standalone: true });
    const evt = fakePrompt();
    window.HubCore.handleBeforeInstallPrompt(evt);
    expect(evt.preventDefaultCalled).toBe(true);
    expect(window.HubCore.bannerVisible()).toBe(false);
  });

  it('auto-hides the banner after the timeout and remembers the dismissal', async () => {
    const { window } = boot({ autoDismissMs: 25 });
    window.HubCore.openBanner();
    expect(window.HubCore.bannerVisible()).toBe(true);
    await flush(350); // 25ms timeout + 260ms exit animation
    expect(window.HubCore.bannerVisible()).toBe(false);
    expect(window.HubCore.bannerDismissed()).toBe(true);
  });

  it('switches back to install mode when a real prompt later arrives', () => {
    const { window } = boot();
    click(window, window.document.getElementById('bannerInstall'));
    expect(window.HubCore.bannerMode()).toBe('manual');
    window.HubCore.handleBeforeInstallPrompt(fakePrompt());
    expect(window.HubCore.bannerMode()).toBe('install');
    const btn = window.document.getElementById('bannerInstall');
    expect(btn.style.display).toBe('');
    expect(btn.textContent).toBe('Install');
    expect(window.HubCore.bannerVisible()).toBe(true);
  });

  // ---- Feature 3: manifest integration ----

  it('links a valid manifest scoped to the hub root', () => {
    expect(indexHtml).toMatch(/<link rel="manifest" href="manifest\.json"/);
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
    // installability needs raster icons (192 + 512), not just SVG
    const pngs = manifest.icons.filter((i) => i.type === 'image/png');
    expect(pngs.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
    expect(indexHtml).toMatch(/<link rel="apple-touch-icon" href="icon-192\.png"/);
  });

  it('exposes a matches() helper for query/category logic', () => {
    const { window } = boot();
    const m = window.HubCore.matches;
    const markSix = window.HubCore.apps.find((a) => a.id === 'mark-six');
    expect(m(markSix, 'lottery', 'lottery')).toBe(true);
    expect(m(markSix, '', 'transport')).toBe(false);
    expect(m(markSix, '六', 'all')).toBe(true);
    expect(m(markSix, 'bus', 'all')).toBe(false);
    expect(m(null, '', 'all')).toBe(false);
  });
});
