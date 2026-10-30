// Behaviour tests for the ETA read loop: refresh silence/concurrency batching and
// the next-arrival chip layout. Drives the real app (build/index.html + build/app.js)
// with the committed routeFareList fixture and a controllable fetchEtas mock.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const indexHtml = readFileSync(join(buildDir, 'index.html'), 'utf8');
const appJs = readFileSync(join(buildDir, 'app.js'), 'utf8').replace(
  /^import\s*\{[^}]*\}\s*from\s*"[^"]*";$/m,
  'const fetchEtaDb = () => fetch("https://data.hkbus.app/routeFareList.min.json").then((r) => r.json());\n' +
  'const fetchEtas = (args) => window.__etaImplFn ? window.__etaImplFn(args) : Promise.resolve([]);'
);
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'routeFareList.fixture.json'), 'utf8'));

afterEach(() => vi.useRealTimers());

function loadDb() {
  return JSON.parse(JSON.stringify(fixture));
}

async function createHarness(dbJson, { seedEtaFmt = null } = {}) {
  const dom = new JSDOM(indexHtml, {
    url: 'https://life-tools-pwa.vercel.app/bus-eta-lite/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  if (seedEtaFmt) window.localStorage.setItem('buseta-eta-fmt', seedEtaFmt);
  window.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('routeFareList.min.json')) {
      return { ok: true, status: 200, json: async () => dbJson };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  });
  window.eval(appJs);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  return dom;
}

async function settle(dom) {
  // flush microtasks + any pending timers (fake timers flush async via runAllTimersAsync)
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

// Type into the real route input (honours the app's 120ms debounce) and wait for the DB.
async function openRoute(dom, query) {
  const { window } = dom;
  const input = window.document.getElementById('routeInput');
  for (let i = 0; i < 20; i++) {
    input.value = query;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 160));
    if (window.document.getElementById('routeResults').innerHTML.includes('route-row')) break;
  }
}

function searchCards(dom, no) {
  return [...dom.window.document.querySelectorAll('#routeResults .route-row')]
    .filter((c) => c.querySelector('.route-no')?.textContent.trim() === no);
}

// fetchEtas that returns deterministic future ETAs and counts in-flight concurrency.
function etaImpl(now) {
  const stats = { active: 0, max: 0, calls: 0 };
  const fn = (args) => {
    stats.active += 1;
    if (stats.active > stats.max) stats.max = stats.active;
    stats.calls += 1;
    return new Promise((resolve) => {
      setTimeout(() => {
        stats.active -= 1;
        const mins = 2 + ((stats.calls - 1) % 3);
        resolve([
          { eta: new Date(now + mins * 60000).toISOString(), dest: { zh: '測試', en: 'Test' }, remark: null, co: 'kmb' },
          { eta: new Date(now + (mins + 7) * 60000).toISOString(), dest: { zh: '測試', en: 'Test' }, remark: null, co: 'kmb' },
        ]);
      }, 15);
    });
  };
  return { stats, fn };
}

describe('ETA read loop', () => {
  it('marks the next arrival chip as the dominant first chip (no clock sub-label)', async () => {
    const dom = await createHarness(loadDb());
    const { stats, fn } = etaImpl(Date.now());
    dom.window.__etaImplFn = fn;
    await openRoute(dom, '71A');
    const kmb = searchCards(dom, '71A').find((c) => /\bco-kmb\b/.test(c.querySelector('.route-no').className));
    expect(kmb).toBeTruthy();
    kmb.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 80));
    await settle(dom);
    const chips = dom.window.document.querySelector('.stop-card .eta-chips').innerHTML;
    expect(chips).toContain('eta-chip first');
    expect(chips).not.toMatch(/class="t"/);
    expect(stats.calls).toBeGreaterThan(0);
    dom.window.close();
  });

  it('caps concurrent ETA fetches while filling a long route', async () => {
    const dom = await createHarness(loadDb());
    const { stats, fn } = etaImpl(Date.now());
    dom.window.__etaImplFn = fn;
    await openRoute(dom, '2000X');
    const card = searchCards(dom, '2000X')[0];
    expect(card).toBeTruthy();
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 200));
    await settle(dom);
    setTimeout(() => {}, 60); // leave time for any late tasks to resolve
    await settle(dom);
    expect(stats.calls).toBeGreaterThan(6);
    expect(stats.max).toBeLessThanOrEqual(6);
    dom.window.close();
  });

  it('auto-refresh runs silently (no status toast every 30s)', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const dom = await createHarness(loadDb());
    const { stats, fn } = etaImpl(now);
    dom.window.__etaImplFn = fn;
    const { window } = dom;
    const input = window.document.getElementById('routeInput');
    input.value = '71A';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200); // debounce
    const kmb = searchCards(dom, '71A').find((c) => /\bco-kmb\b/.test(c.querySelector('.route-no').className));
    expect(kmb).toBeTruthy();
    kmb.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(200); // initial ETA fill (15ms tasks)
    const statusbar = window.document.getElementById('statusbar');
    statusbar.classList.remove('show');
    statusbar.textContent = '';
    const callsBefore = stats.calls;
    await vi.advanceTimersByTimeAsync(30000); // exactly one 30s auto-refresh cycle
    await vi.advanceTimersByTimeAsync(100); // settle the refresh's 15ms fetches
    expect(stats.calls).toBeGreaterThan(callsBefore);
    expect(statusbar.classList.contains('show')).toBe(false);
    expect(statusbar.textContent).toBe('');
    vi.useRealTimers();
    dom.window.close();
  });

  it('tightens auto-refresh to 10s while the next bus is close', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const dom = await createHarness(loadDb());
    const { stats, fn } = etaImpl(now); // etaImpl yields 2-4 min ETAs -> within 3 min
    dom.window.__etaImplFn = fn;
    const { window } = dom;
    const input = window.document.getElementById('routeInput');
    input.value = '71A';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200); // debounce
    const kmb = searchCards(dom, '71A').find((c) => /\bco-kmb\b/.test(c.querySelector('.route-no').className));
    expect(kmb).toBeTruthy();
    kmb.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(200); // initial ETA fill
    const callsBefore = stats.calls;
    // a 10s tick must fire (fixed 30s cadence would not)
    await vi.advanceTimersByTimeAsync(10000);
    expect(stats.calls).toBeGreaterThan(callsBefore);
    vi.useRealTimers();
    dom.window.close();
  });
});

describe('ETA display format toggle', () => {
  const now = () => Date.now();
  const FMT_KEY = 'buseta-eta-fmt';

  async function openKmbCard(db, fmt) {
    const dom = await createHarness(db, { seedEtaFmt: fmt });
    dom.window.__etaImplFn = etaImpl(now()).fn;
    await openRoute(dom, '71A');
    const kmb = searchCards(dom, '71A').find((c) => /\bco-kmb\b/.test(c.querySelector('.route-no').className));
    expect(kmb).toBeTruthy();
    kmb.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 80));
    await settle(dom);
    return dom;
  }

  function chipText(dom) {
    return dom.window.document.querySelector('.stop-card .eta-chips').textContent;
  }

  it('defaults to minutes-only chip text (no clock)', async () => {
    const dom = await openKmbCard(loadDb(), null);
    const txt = chipText(dom);
    expect(txt).toMatch(/分/); // "N 分"
    expect(txt).not.toMatch(/\d{1,2}:\d{2}/);
    dom.window.close();
  });

  it('shows text on the format button (label + title per mode)', async () => {
    const dom = await openKmbCard(loadDb(), null);
    const btn = dom.window.document.getElementById('etaFmtBtn');
    expect(btn.textContent).toMatch(/\S/);
    expect(btn.title).toMatch(/\S/);
    expect(btn.title).not.toBe('undefined');
    dom.window.close();
  });

  it('cycles the format button: time -> both -> minutes', async () => {
    const dom = await openKmbCard(loadDb(), null);
    const { window } = dom;
    const btn = window.document.getElementById('etaFmtBtn');
    expect(btn).toBeTruthy();

    // click once -> exact time
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(dom);
    let txt = chipText(dom);
    expect(txt).toMatch(/\d{2}:\d{2}/);
    expect(txt).not.toMatch(/分/);
    expect(window.localStorage.getItem(FMT_KEY)).toBe('time');

    // click again -> both (two-line chip: clock on top, minutes below)
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(dom);
    txt = chipText(dom);
    expect(txt).toMatch(/\d{2}:\d{2}/);
    expect(txt).toMatch(/分/);
    const chip = window.document.querySelector('.stop-card .eta-chips .eta-chip');
    expect(chip.querySelector('.t')).toBeTruthy(); // clock is its own sub-line
    expect(window.localStorage.getItem(FMT_KEY)).toBe('both');

    // click again -> minutes only
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(dom);
    txt = chipText(dom);
    expect(txt).toMatch(/分/);
    expect(txt).not.toMatch(/\d{1,2}:\d{2}/);
    expect(window.localStorage.getItem(FMT_KEY)).toBe('mins');
    dom.window.close();
  });

  it('restores a saved format on boot', async () => {
    const dom = await openKmbCard(loadDb(), 'time');
    const txt = chipText(dom);
    expect(txt).toMatch(/\d{2}:\d{2}/);
    expect(txt).not.toMatch(/分/);
    dom.window.close();
  });
});

describe('daily timetable', () => {
  async function openKmb71a() {
    const dom = await createHarness(loadDb());
    await openRoute(dom, '71A');
    const kmb = searchCards(dom, '71A').find((c) => /\bco-kmb\b/.test(c.querySelector('.route-no').className));
    expect(kmb).toBeTruthy();
    kmb.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 60));
    await settle(dom);
    return dom;
  }

  it('shows a collapsible per-day-type timetable for a route with freq', async () => {
    const dom = await openKmb71a();
    const { window } = dom;
    const toggle = window.document.querySelector('#ttToggle');
    expect(toggle).toBeTruthy();
    expect(toggle.textContent).toContain('班次表');
    const panel = window.document.querySelector('#ttPanel');
    expect(panel).toBeTruthy();
    // collapsed initially
    expect(panel.hidden).toBe(true);
    expect(maxExpandAria(window)).toBe(false);

    toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(panel.hidden).toBe(false);

    const rows = [...panel.querySelectorAll('.tt-row')];
    expect(rows.map((r) => r.querySelector('.tt-day').textContent)).toEqual(['平日', '星期六', '星期日及公眾假期']);

    // weekday (2001): 06:00-06:30 & 17:00-17:30 every 10 min
    const wd = rows[0];
    expect(wd.querySelector('.tt-range').textContent).toContain('06:00');
    expect(wd.querySelector('.tt-range').textContent).toContain('17:30');
    expect(wd.querySelector('.tt-hw').textContent).toContain('每 10 分鐘');

    // grind every departure out of the window
    const exp = wd.querySelector('.tt-expand');
    const times = wd.querySelector('.tt-times');
    expect(times.hidden).toBe(true);
    exp.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(times.hidden).toBe(false);
    const tts = [...times.querySelectorAll('.tt-t')].map((t) => t.textContent);
    expect(tts).toEqual(['06:00', '06:10', '06:20', '06:30', '17:00', '17:10', '17:20', '17:30']);

    // saturday (2002): 06:30-07:00 every 15 min
    expect(rows[1].querySelector('.tt-range').textContent).toContain('06:30');
    expect(rows[1].querySelector('.tt-range').textContent).toContain('07:00');
    expect(rows[1].querySelector('.tt-hw').textContent).toContain('每 15 分鐘');

    // sunday (2003): 08:00-08:30 every 15 min
    expect(rows[2].querySelector('.tt-range').textContent).toContain('08:00');
    expect(rows[2].querySelector('.tt-range').textContent).toContain('08:30');
    dom.window.close();
  });

  function maxExpandAria(window) {
    const btn = window.document.querySelector('#ttToggle');
    return btn && btn.getAttribute('aria-expanded') === 'true';
  }

  it('shows only the directions own day types after a pill switch (no Sun on reverse)', async () => {
    const dom = await openKmb71a();
    const { window } = dom;
    window.document.querySelector('#ttToggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    // switch to the reverse direction pill (大埔墟站→大埔(富亨))
    const pills = window.document.querySelectorAll('.pill');
    expect(pills.length).toBe(2);
    pills[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const panel = window.document.querySelector('#ttPanel');
    expect(panel).toBeTruthy();
    const rows = [...panel.querySelectorAll('.tt-row')];
    expect(rows.map((r) => r.querySelector('.tt-day').textContent)).toEqual(['平日', '星期六']);
    expect(rows[0].querySelector('.tt-range').textContent).toContain('06:10');
    dom.window.close();
  });

  it('renders no timetable for routes without freq data', async () => {
    const dom = await createHarness(loadDb());
    await openRoute(dom, '101');
    const card = searchCards(dom, '101')[0];
    expect(card).toBeTruthy();
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 60));
    await settle(dom);
    expect(dom.window.document.querySelector('.tt-wrap')).toBeNull();
    dom.window.close();
  });

  it('re-renders the timetable in English after the language toggle', async () => {
    const dom = await openKmb71a();
    const { window } = dom;
    window.document.getElementById('langBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(dom);
    const toggle = window.document.querySelector('#ttToggle');
    expect(toggle.textContent).toContain('Timetable');
    toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const rows = [...window.document.querySelectorAll('#ttPanel .tt-row')];
    expect(rows.map((r) => r.querySelector('.tt-day').textContent)).toEqual(['Weekday', 'Saturday', 'Sun & public holidays']);
    dom.window.close();
  });
});

describe('timetable service-variant merge (A47X-shaped)', () => {
  async function openA47x() {
    const dom = await createHarness(loadDb());
    await openRoute(dom, 'A47X');
    const card = searchCards(dom, 'A47X')[0];
    expect(card).toBeTruthy();
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 60));
    await settle(dom);
    return dom;
  }
  function showPanel(dom) {
    dom.window.document.querySelector('#ttToggle').dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  function dayRows(dom) {
    return [...dom.window.document.querySelectorAll('#ttPanel .tt-row')];
  }
  function expandTimes(dom, i) {
    const row = dayRows(dom)[i];
    row.querySelector('.tt-expand').dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    return [...row.querySelectorAll('.tt-t')].map((t) => t.textContent);
  }

  it('labels an all-week service as 每日 (not 星期日及公眾假期) and shows each direction range', async () => {
    const dom = await openA47x();
    const { window } = dom;
    showPanel(dom);
    // pill 0 = AIRPORT → TAI PO
    let rs = dayRows(dom);
    expect(rs.length).toBe(1);
    expect(rs[0].querySelector('.tt-day').textContent).toBe('每日');
    expect(rs[0].querySelector('.tt-range').textContent).toContain('10:05');
    expect(rs[0].querySelector('.tt-range').textContent).toContain('24:00');
    // pill 1 = TAI PO → AIRPORT (main + special service entries merged)
    window.document.querySelectorAll('.pill')[1].dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    rs = dayRows(dom);
    expect(rs.length).toBe(1);
    expect(rs[0].querySelector('.tt-day').textContent).toBe('每日');
    expect(rs[0].querySelector('.tt-range').textContent).toContain('05:00');
    expect(rs[0].querySelector('.tt-range').textContent).toContain('22:05');
    dom.window.close();
  });

  it('merges special-service departures and keeps fixed single trips on the reverse direction', async () => {
    const dom = await openA47x();
    const { window } = dom;
    showPanel(dom);
    window.document.querySelectorAll('.pill')[1].dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const times = expandTimes(dom, 0);
    // fixed single departures (0500 / 0530 / 0630) plus the serviceType 2 window (0730-1000)
    // plus the main service windows (1035-2205) => 32 unique HH:MM departures
    expect(times[0]).toBe('05:00');
    expect(times).toContain('05:30');
    expect(times).toContain('06:30');
    expect(times).toContain('07:30');
    expect(times).toContain('10:00');
    expect(times).toContain('22:05');
    expect(times).toHaveLength(32);
    dom.window.close();
  });
});