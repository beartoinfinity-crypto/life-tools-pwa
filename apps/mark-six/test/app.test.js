import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
const engineJs = readFileSync(join(__dirname, '..', 'prediction-engine.js'), 'utf8');
const indexHtml = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const TICKETS_KEY = 'saved_tickets';
const HISTORY_KEY = 'm6_history';

function draw(id, numbers, special, date) {
  return { id, drawDate: date, drawResult: { drawnNo: numbers, xDrawnNo: special } };
}

function defaultDraws() {
  return [
    draw('26/100', [1, 3, 11, 15, 33, 46], 19, '2026-09-26+08:00'),
    draw('26/099', [2, 3, 7, 20, 25, 40], 5, '2026-09-24+08:00'),
  ];
}

/** n deterministic draws with strictly descending dates (newest first). */
function makeDraws(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const nums = new Set();
    let x = (i * 2654435761 + 12345) >>> 0;
    while (nums.size < 6) {
      x = (x * 1664525 + 1013904223) >>> 0;
      nums.add((x % 49) + 1);
    }
    const iso = new Date(Date.UTC(2026, 8, 26) - i * 86400000).toISOString().slice(0, 10);
    out.push(draw(`26/${100 - i}`, [...nums].sort((a, b) => a - b), ((i * 7) % 49) + 1, iso + '+08:00'));
  }
  return out;
}

function createHarness({
  draws = defaultDraws(),
  fail = false,
  seedTickets = null,
  userAgent = null,
  standalone = null,
  autoDismissMs = null,
  drawSchedule = [],
  seedHistory = null,
} = {}) {
  const dom = new JSDOM(indexHtml, {
    url: 'https://example.test/mark-six/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const state = { fail, draws, drawSchedule };

  if (seedTickets) window.localStorage.setItem(TICKETS_KEY, JSON.stringify(seedTickets));
  if (seedHistory) window.localStorage.setItem(HISTORY_KEY, JSON.stringify(seedHistory));
  if (userAgent) {
    Object.defineProperty(window.navigator, 'userAgent', { get: () => userAgent, configurable: true });
  }
  if (standalone !== null) {
    Object.defineProperty(window.navigator, 'standalone', { get: () => standalone, configurable: true });
  }
  if (autoDismissMs != null) window.__BANNER_AUTO_DISMISS_MS = autoDismissMs;

  window.fetch = vi.fn(async () => {
    if (state.fail) throw new TypeError('Network down');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { lotteryDraws: state.draws.map((d) => JSON.parse(JSON.stringify(d))) },
        source: 'database',
        totalCached: state.draws.length,
        returned: state.draws.length,
        lastRefresh: new Date().toISOString(),
        drawSchedule: state.drawSchedule.slice(),
      }),
    };
  });

  window.eval(engineJs);
  window.eval(appJs);
  return { dom, window, state };
}

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function click(window, el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('mark-six app (v1.1)', () => {
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

  // ---- Feature 1: official ball colours + rendering ----

  it('renders official ball colours (32 is blue) with aria labels', async () => {
    const { window } = await boot({
      draws: [draw('26/100', [1, 3, 32, 15, 33, 46], 19, '2026-09-26+08:00')],
    });
    const group = window.document.querySelector('.winning-numbers');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Winning numbers');

    const labels = {};
    [...group.querySelectorAll('.ball')].forEach((b) => {
      labels[b.textContent] = b.className;
    });
    expect(labels['32']).toContain('ball-blue');
    expect(labels['1']).toContain('ball-red');
    expect(labels['3']).toContain('ball-blue');
    expect(labels['33']).toContain('ball-green');
    expect(labels['15']).toContain('ball-blue');
    expect(labels['46']).toContain('ball-red');

    const byLabel = [...group.querySelectorAll('.ball')].map((b) => b.getAttribute('aria-label'));
    expect(byLabel).toContain('32 Blue');
    expect(byLabel).toContain('1 Red');
    expect(byLabel).toContain('33 Green');
    expect(byLabel).toContain('Special number 19 Red');
    const special = [...group.querySelectorAll('.ball')].pop();
    expect(special.classList.contains('special')).toBe(true);
    expect(group.querySelector('.divider').getAttribute('aria-hidden')).toBe('true');
  });

  // ---- Feature 5: accessible draw-card markup ----

  it('renders accessible draw-card markup (section/h2/time)', async () => {
    const { window } = await boot();
    const card = window.document.querySelector('.draw-card');
    expect(card.tagName).toBe('SECTION');
    const headingId = card.getAttribute('aria-labelledby');
    const h2 = card.querySelector('h2');
    expect(h2.getAttribute('id')).toBe(headingId);
    expect(h2.textContent).toBe('Draw Results - 26/100');
    const time = card.querySelector('time');
    expect(time.getAttribute('datetime')).toBe('2026-09-26');
    expect(time.textContent).toBe('26 Sept 2026');
  });

  it('formats draw dates via MarksixCore.fmtDrawDate', async () => {
    const { window } = await boot();
    expect(window.MarksixCore.fmtDrawDate('2026-01-05+08:00')).toEqual({ iso: '2026-01-05', text: '5 Jan 2026' });
    expect(window.MarksixCore.fmtDrawDate('')).toEqual({ iso: '', text: '' });
  });

  // ---- Feature 3: next draw countdown ----

  it('computes the next cutoff: same day before 21:15 HKT', async () => {
    const { window } = await boot();
    // Tue 2026-09-29 12:00 UTC == 20:00 HKT, before the 21:15 cutoff
    const next = window.MarksixCore.nextDrawCutoff(Date.parse('2026-09-29T12:00:00Z'));
    expect(next.dateIso).toBe('2026-09-29');
    expect(next.dayName).toBe('Tue');
    expect(new Date(next.cutoffMs).toISOString()).toBe('2026-09-29T13:15:00.000Z');
  });

  it('skips to the next draw day after cutoff / on off days', async () => {
    const { window } = await boot();
    // Tue 22:00 HKT (past cutoff) -> Thursday
    let next = window.MarksixCore.nextDrawCutoff(Date.parse('2026-09-29T14:00:00Z'));
    expect(next.dateIso).toBe('2026-10-01');
    expect(next.dayName).toBe('Thu');
    // Sunday -> Tuesday
    next = window.MarksixCore.nextDrawCutoff(Date.parse('2026-09-27T02:00:00Z'));
    expect(next.dateIso).toBe('2026-09-29');
    expect(next.dayName).toBe('Tue');
    // Monday -> Tuesday
    next = window.MarksixCore.nextDrawCutoff(Date.parse('2026-09-28T02:00:00Z'));
    expect(next.dateIso).toBe('2026-09-29');
  });

  it('ticks the countdown widget with a deterministic time', async () => {
    const { window } = await boot();
    window.MarksixCore.tickCountdown(Date.parse('2026-09-29T12:00:00Z'));
    expect(window.document.getElementById('ndDate').textContent).toBe('2026-09-29 (Tue)');
    const cutoff = window.document.getElementById('ndCutoff');
    expect(cutoff.textContent).toBe('01 hrs : 15 mins : 00 secs');
    expect(cutoff.getAttribute('datetime')).toBe('2026-09-29T13:15:00.000Z');
    // default boot also populated a live value
    expect(cutoff.textContent).toMatch(/^\d{2} hrs : \d{2} mins : \d{2} secs$/);
  });

  it('anchors the next draw to the newest real draw (a missed draw day is skipped)', async () => {
    const { window } = await boot();
    // newest real draw = Sat 2026-09-26; it is now Wed 30/09 20:00 HKT, so
    // Tue 29/09 came and went with no draw -> the next real draw is Thu 01/10
    const next = window.MarksixCore.nextDrawCutoff(Date.parse('2026-09-30T12:00:00Z'), null, '2026-09-26');
    expect(next.dateIso).toBe('2026-10-01');
    expect(next.dayName).toBe('Thu');
    expect(new Date(next.cutoffMs).toISOString()).toBe('2026-10-01T13:15:00.000Z');
  });

  it('never proposes a draw date at or before the anchor draw', async () => {
    const { window } = await boot();
    // anchor = Tue 2026-09-29 itself, same day before its cutoff: the next
    // draw is Thursday, not the anchor draw being counted past
    const next = window.MarksixCore.nextDrawCutoff(Date.parse('2026-09-29T12:00:00Z'), null, '2026-09-29');
    expect(next.dateIso).toBe('2026-10-01');
    expect(next.dayName).toBe('Thu');
  });

  it('shows an honest awaiting state when no draw day is in range', async () => {
    const { window } = await boot();
    // stale anchor (Sat 2026-09-26) two weeks on: every candidate has passed
    expect(window.MarksixCore.nextDrawCutoff(Date.parse('2026-10-10T12:00:00Z'), null, '2026-09-26')).toBe(null);
    window.MarksixCore.tickCountdown(Date.parse('2026-10-10T12:00:00Z'));
    expect(window.document.getElementById('ndDate').textContent).toBe('Awaiting next draw date');
    expect(window.document.getElementById('ndCutoff').textContent).toBe('--');
    expect(window.document.getElementById('ndCutoff').getAttribute('datetime')).toBeNull();
  });

  it('follows the server-published schedule over the weekday rule', async () => {
    const { window } = await boot();
    // HKJC skipped Tue 29/09 and Thu 01/10: the calendar says the next draw
    // after Sat 26/09 is Sat 03/10, even though it is not "the next Thu"
    const next = window.MarksixCore.nextDrawCutoff(
      Date.parse('2026-09-30T12:00:00Z'),
      ['2026-10-03', '2026-10-06', '2026-10-08'],
      '2026-09-26'
    );
    expect(next.dateIso).toBe('2026-10-03');
    expect(next.dayName).toBe('Sat');
    expect(new Date(next.cutoffMs).toISOString()).toBe('2026-10-03T13:15:00.000Z');
  });

  it('counts to today\'s scheduled draw while sales are still open', async () => {
    const { window } = await boot();
    // 20:00 HKT on a scheduled draw day: still counting to tonight, not tomorrow
    const next = window.MarksixCore.nextDrawCutoff(
      Date.parse('2026-10-03T12:00:00Z'),
      ['2026-10-03', '2026-10-06'],
      null
    );
    expect(next.dateIso).toBe('2026-10-03');
  });

  it('renders the published schedule in the countdown widget', async () => {
    const { window } = await boot({ drawSchedule: ['2026-10-03', '2026-10-06'] });
    window.MarksixCore.tickCountdown(Date.parse('2026-09-30T12:00:00Z'));
    expect(window.document.getElementById('ndDate').textContent).toBe('2026-10-03 (Sat)');
    const cutoff = window.document.getElementById('ndCutoff');
    expect(cutoff.textContent).toBe('73 hrs : 15 mins : 00 secs');
  });

  it('falls back to the weekday rule when the server sends no schedule', async () => {
    const { window } = await boot({ drawSchedule: [] });
    window.MarksixCore.tickCountdown(Date.parse('2026-09-30T12:00:00Z'));
    // no published dates: anchored rule guesses Thu 01/10 from draw 26/09
    expect(window.document.getElementById('ndDate').textContent).toBe('2026-10-01 (Thu)');
  });

  it('knows the draw days for the midnight auto-refresh (official schedule)', async () => {
    const { window } = await boot({ drawSchedule: ['2099-01-05', '2099-01-07'] });
    const core = window.MarksixCore;
    // instants compared on their HKT calendar date
    expect(core.isScheduledDrawDay(new Date('2099-01-04T16:00:00Z'))).toBe(true);  // HKT 05 Jan
    expect(core.isScheduledDrawDay(new Date('2099-01-06T16:00:00Z'))).toBe(true);  // HKT 07 Jan
    expect(core.isScheduledDrawDay(new Date('2099-01-05T16:00:00Z'))).toBe(false); // HKT 06 Jan, not scheduled
  });

  it('falls back to Tue/Thu/Sat for the midnight refresh when no schedule', async () => {
    const { window } = await boot({ drawSchedule: [] });
    const core = window.MarksixCore;
    expect(core.isScheduledDrawDay(new Date('2026-10-02T16:00:00Z'))).toBe(true);  // HKT Sat 03 Oct
    expect(core.isScheduledDrawDay(new Date('2026-10-04T16:00:00Z'))).toBe(false); // HKT Mon 05 Oct
  });

  it('refreshes once when the countdown target expires, then re-anchors', async () => {
    const { window } = await boot();
    // newest fixture draw is Sat 2026-09-26 -> lock onto Tue 29/09 21:15 HKT
    window.MarksixCore.tickCountdown(Date.parse('2026-09-29T12:00:00Z'));
    // the cutoff passes -> the app pulls the fresh draw
    window.MarksixCore.tickCountdown(Date.parse('2026-09-29T14:00:00Z'));
    const refreshes = () => window.fetch.mock.calls.filter((c) => String(c[0]).includes('/refresh')).length;
    expect(refreshes()).toBe(1);
    // it does not refire while counting to the new target
    window.MarksixCore.tickCountdown(Date.parse('2026-09-29T15:00:00Z'));
    expect(refreshes()).toBe(1);
    // and the widget now counts to Thursday
    expect(window.document.getElementById('ndDate').textContent).toBe('2026-10-01 (Thu)');
  });

  it('boots from the cached read (no forced scrape) and fetches stats history', async () => {
    const { window } = await boot();
    const urls = window.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe('/mark-six/api/marksix');
    expect(urls[0]).not.toContain('refresh');
    const historyCall = window.fetch.mock.calls.find((c) => String(c[0]).includes('/history'));
    expect(historyCall).toBeTruthy();
    expect(JSON.parse(historyCall[1].body).limit).toBe(100);
  });

  // ---- Feature 4: frequency & hot/cold analytics ----

  it('computes hot, cold and odd/even stats over the window', async () => {
    const { window } = await boot();
    const draws = [
      draw('a', [1, 2, 3, 4, 5, 6], 7, '2026-09-26+08:00'),
      draw('b', [1, 2, 3, 4, 5, 8], 7, '2026-09-24+08:00'),
      draw('c', [1, 2, 3, 4, 5, 9], 7, '2026-09-22+08:00'),
    ];
    const s = window.MarksixCore.computeStats(draws, 2);
    // hot: 1-5 appear twice, then lowest number first
    expect(s.hot.slice(0, 5).map((h) => h.n)).toEqual([1, 2, 3, 4, 5]);
    expect(s.hot[0].count).toBe(2);
    expect(s.hot.find((h) => h.n === 6).count).toBe(1);
    // cold: absent from the window, capped at 6, never-seen ranks coldest (asc by n)
    expect(s.cold.length).toBe(6);
    expect(s.cold.map((c) => c.n).slice(0, 3)).toEqual([7, 10, 11]);
    expect(s.cold[0].since).toBe(Infinity);
    expect(s.odd).toBe(6);
    expect(s.even).toBe(6);
  });

  it('renders the stats panel with hot balls, window chips and odd/even bar', async () => {
    const { window } = await boot();
    const panel = window.document.getElementById('statsPanel');
    expect(panel.style.display).toBe('block');

    const hot = [...window.document.querySelectorAll('#hotNums .stat-entry')];
    expect(hot.length).toBe(6);
    expect(hot[0].querySelector('.ball').textContent).toBe('3'); // only number drawn twice
    expect(hot[0].querySelector('.stat-count').textContent).toBe('2\u00d7');

    expect(window.document.getElementById('oeLegend').textContent).toBe('8 Odd (67%) / 4 Even (33%)');
    expect(window.document.getElementById('oeBar').getAttribute('aria-label')).toContain('8 odd, 4 even');

    const chip20 = window.document.querySelector('.stats-chip[data-w="20"]');
    const chip50 = window.document.querySelector('.stats-chip[data-w="50"]');
    expect(chip50.getAttribute('aria-pressed')).toBe('true');
    click(window, chip20);
    expect(chip20.getAttribute('aria-pressed')).toBe('true');
    expect(chip50.getAttribute('aria-pressed')).toBe('false');
    expect(chip20.classList.contains('active')).toBe(true);
  });

  it('keeps the stats panel hidden when history is unavailable', async () => {
    const { window } = await boot({ fail: true });
    await flush();
    expect(window.document.getElementById('statsPanel').style.display).toBe('none');
  });

  // ---- Feature 2: ticket checker ----

  it('validates ticket input (6 unique numbers 1-49)', async () => {
    const { window } = await boot();
    const core = window.MarksixCore;
    expect(core.parseTicketNumbers('3 7 11 15 33 46')).toEqual({ ok: true, numbers: [3, 7, 11, 15, 33, 46] });
    expect(core.parseTicketNumbers('46,33,15,11,7,3').numbers).toEqual([3, 7, 11, 15, 33, 46]);
    expect(core.parseTicketNumbers('1 2 3 4 5').ok).toBe(false);
    expect(core.parseTicketNumbers('1 2 3 4 5 6 7').ok).toBe(false);
    expect(core.parseTicketNumbers('1 2 3 4 5 5').error).toContain('Duplicate');
    expect(core.parseTicketNumbers('1 2 3 4 5 50').error).toContain('1 to 49');
    expect(core.parseTicketNumbers('1 2 3 4 5 x').ok).toBe(false);
  });

  it('maps matches to the 7 prize divisions', async () => {
    const { window } = await boot();
    const check = window.MarksixCore.checkTicket;
    const drawn = [1, 2, 3, 4, 5, 6];
    const special = 7;
    expect(check([1, 2, 3, 4, 5, 6], drawn, special)).toBe(1); // 6 main
    expect(check([1, 2, 3, 4, 5, 7], drawn, special)).toBe(2); // 5 + special
    expect(check([1, 2, 3, 4, 5, 8], drawn, special)).toBe(3); // 5
    expect(check([1, 2, 3, 4, 7, 8], drawn, special)).toBe(4); // 4 + special
    expect(check([1, 2, 3, 4, 8, 9], drawn, special)).toBe(5); // 4
    expect(check([1, 2, 3, 7, 8, 9], drawn, special)).toBe(6); // 3 + special
    expect(check([1, 2, 3, 8, 9, 10], drawn, special)).toBe(7); // 3
    expect(check([1, 2, 8, 9, 10, 11], drawn, special)).toBe(0);
    expect(check([7, 8, 9, 10, 11, 12], drawn, special)).toBe(0); // special alone
    expect(window.MarksixCore.divisionLabel(3)).toBe('3rd Division');
    expect(window.MarksixCore.divisionLabel(0)).toBe('No prize');
  });

  it('saves a ticket, evaluates it against the latest draw, persists to localStorage', async () => {
    const { window } = await boot();
    const input = window.document.getElementById('ticketInput');
    input.value = '1 3 11 15 33 46'; // exact winning numbers of the latest draw
    click(window, window.document.getElementById('saveTicketBtn'));

    const saved = JSON.parse(window.localStorage.getItem(TICKETS_KEY));
    expect(saved.length).toBe(1);
    expect(saved[0].id).toMatch(/^t_\d{8}_\d{2}$/);
    expect(saved[0].type).toBe('single');
    expect(saved[0].numbers).toEqual([1, 3, 11, 15, 33, 46]);
    expect(typeof saved[0].created_at).toBe('string');

    const row = window.document.querySelector('.ticket-row');
    expect(row.querySelector('.ticket-badge').textContent).toBe('1st Division');
    expect(input.value).toBe('');
  });

  it('renders seeded tickets with the right division (5 + special = 2nd)', async () => {
    const { window } = await boot({
      seedTickets: [{ id: 't_20260928_01', numbers: [1, 3, 11, 15, 33, 19], type: 'single', created_at: '2026-09-28T14:15:00Z' }],
    });
    const row = window.document.querySelector('.ticket-row');
    expect(row.getAttribute('data-id')).toBe('t_20260928_01');
    expect(row.querySelector('.ticket-badge').textContent).toBe('2nd Division');
    expect(row.querySelectorAll('.ball').length).toBe(6);
  });

  it('rejects invalid input with a visible error and deletes tickets', async () => {
    const { window } = await boot({
      seedTickets: [{ id: 't_20260928_01', numbers: [1, 3, 11, 15, 33, 46], type: 'single', created_at: '2026-09-28T14:15:00Z' }],
    });
    const input = window.document.getElementById('ticketInput');
    const err = window.document.getElementById('ticketError');

    input.value = '1 2 3';
    click(window, window.document.getElementById('saveTicketBtn'));
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('exactly 6');
    expect(JSON.parse(window.localStorage.getItem(TICKETS_KEY)).length).toBe(1);

    click(window, window.document.querySelector('.ticket-del'));
    expect(window.document.querySelector('.ticket-row')).toBeNull();
    expect(window.document.querySelector('.ticket-empty')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(TICKETS_KEY)).length).toBe(0);
  });

  // ---- PWA install banner ----

  function fireInstall(window, prompt = vi.fn()) {
    const evt = new window.Event('beforeinstallprompt', { cancelable: true });
    evt.prompt = prompt;
    evt.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(evt);
    return evt;
  }

  it('shows the install banner until dismissed, and remembers the dismissal', async () => {
    const { window } = await boot();
    const banner = window.document.querySelector('.install-banner');
    expect(banner).toBeTruthy();
    expect(banner.style.display).toBe('none');

    fireInstall(window);
    expect(banner.style.display).toBe('flex');

    click(window, banner.querySelector('.dismiss-btn'));
    expect(banner.style.display).toBe('none');
    expect(window.sessionStorage.getItem('life-tool-install-dismissed')).toBe('1');

    // dismissed for the rest of the session (shared key with the hub)
    fireInstall(window);
    expect(banner.style.display).toBe('none');
  });

  it('calls the deferred prompt and hides the banner once a choice lands', async () => {
    const { window } = await boot();
    const banner = window.document.querySelector('.install-banner');
    const prompt = vi.fn();
    fireInstall(window, prompt);
    expect(banner.style.display).toBe('flex');

    click(window, banner.querySelector('.install-btn'));
    expect(prompt).toHaveBeenCalledTimes(1);
    await flush();
    expect(banner.style.display).toBe('none');
    expect(window.sessionStorage.getItem('life-tool-install-dismissed')).toBe('1');
  });

  it('shows manual instructions when Install is clicked with no deferred prompt', async () => {
    const { window } = await boot();
    const banner = window.document.querySelector('.install-banner');
    click(window, banner.querySelector('.install-btn'));
    expect(banner.style.display).toBe('flex');
    expect(banner.querySelector('p').textContent).toContain('browser menu');
    expect(banner.querySelector('.install-btn').style.display).toBe('none');
    expect(window.sessionStorage.getItem('life-tool-install-dismissed')).toBeNull();
  });

  it('auto-shows iOS instructions on iPhone Safari (no beforeinstallprompt there)', async () => {
    const { window } = await boot({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const banner = window.document.querySelector('.install-banner');
    expect(banner.style.display).toBe('flex');
    expect(banner.querySelector('p').textContent).toContain('Add to Home Screen');
    expect(banner.querySelector('.install-btn').style.display).toBe('none');
    expect(window.sessionStorage.getItem('life-tool-install-dismissed')).toBeNull();
  });

  it('stays hidden when launched from the installed home-screen app', async () => {
    const { window } = await boot({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      standalone: true,
    });
    const banner = window.document.querySelector('.install-banner');
    expect(banner.style.display).toBe('none');
    expect(window.sessionStorage.getItem('life-tool-install-dismissed')).toBeNull();
  });

  it('auto-hides the banner after the timeout and remembers the dismissal', async () => {
    const { window } = await boot({ autoDismissMs: 25 });
    const banner = window.document.querySelector('.install-banner');
    fireInstall(window);
    expect(banner.style.display).toBe('flex');
    await new Promise((r) => setTimeout(r, 150));
    expect(banner.style.display).toBe('none');
    expect(window.sessionStorage.getItem('life-tool-install-dismissed')).toBe('1');
  });

  it('returns to the install mode when a real prompt later arrives', async () => {
    const { window } = await boot();
    const banner = window.document.querySelector('.install-banner');
    click(window, banner.querySelector('.install-btn'));
    expect(banner.querySelector('p').textContent).toContain('browser menu');

    fireInstall(window);
    expect(banner.querySelector('p').textContent).toBe('Add Mark Six to your home screen?');
    expect(banner.querySelector('.install-btn').style.display).toBe('');
    expect(banner.style.display).toBe('flex');
  });
});

// ---- Feature: Smart Pick generator (prediction engine over stored history) ----

describe('mark-six Smart Pick generator', () => {
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

  it('sits directly below the Number frequency panel with the five strategies', async () => {
    const { window } = await boot();
    const stats = window.document.getElementById('statsPanel');
    const smart = window.document.getElementById('smartPickPanel');
    expect(stats.compareDocumentPosition(smart) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(window.document.getElementById('smartPickHeading').textContent).toBe('Smart Pick Generator');
    const strategies = [...window.document.querySelectorAll('#strategySelect option')].map((o) => o.value);
    expect(strategies).toEqual(['balanced', 'hot_streak', 'cold_recovery', 'markov_chain', 'monte_carlo']);
    expect(window.document.getElementById('generateBtn').textContent).toBe('Generate Ticket');
    expect(window.document.getElementById('generate5Btn').textContent).toBe('Generate 5 Lines');
  });

  it('generates a ticket with balls, score and breakdown', async () => {
    const { window } = await boot();
    await window.MarksixCore.generateSmartLines(1);
    await flush();
    const line = window.document.querySelector('.smart-line');
    expect(line).toBeTruthy();
    expect(line.querySelectorAll('.ball')).toHaveLength(6);
    expect(line.querySelector('.smart-line-label').textContent).toBe('Generated Line 1');
    expect(line.querySelector('.smart-score').textContent).toMatch(/^Score: \d+%$/);
    expect(line.querySelector('.smart-breakdown').textContent)
      .toMatch(/Breakdown: Sum \d+ \| \d+ Odd \d+ Even \| \d+ Hot \/ \d+ Cold/);
  });

  it('generates five lines on one click', async () => {
    const { window } = await boot();
    await window.MarksixCore.generateSmartLines(5);
    await flush();
    const lines = window.document.querySelectorAll('.smart-line');
    expect(lines).toHaveLength(5);
    lines.forEach((line) => {
      expect(line.querySelectorAll('.ball')).toHaveLength(6);
      expect(line.querySelector('.smart-line-label').textContent).toMatch(/^Generated Line \d+$/);
    });
  });

  it('shows a backtest badge for the selected strategy over the last 20 draws', async () => {
    const { window } = await boot({ draws: makeDraws(30) });
    await window.MarksixCore.runBacktest();
    const badge = window.document.getElementById('backtestBadge');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toMatch(/^Strategy hit rate \(3\+ numbers\): \d+% in last 20 draws\.$/);
  });

  it('says when there is not enough history for a backtest', async () => {
    const { window } = await boot(); // only the 2 fixture draws
    await window.MarksixCore.runBacktest();
    expect(window.document.getElementById('backtestBadge').textContent)
      .toBe('Backtest needs 11+ draws of history.');
  });

  it('recomputes the backtest when the strategy changes', async () => {
    const { window } = await boot({ draws: makeDraws(30) });
    const sel = window.document.getElementById('strategySelect');
    sel.value = 'cold_recovery';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 320)); // 250 ms debounce
    await flush();
    expect(window.document.getElementById('backtestBadge').textContent)
      .toMatch(/^Strategy hit rate \(3\+ numbers\): \d+%/);
  });

  it('works fully offline from locally stored history', async () => {
    const { window } = await boot({ fail: true, seedHistory: makeDraws(30) });
    expect(window.MarksixCore.historyCount()).toBe(30);
    // stats panel still renders from the cache
    expect(window.document.getElementById('statsPanel').style.display).toBe('block');

    await window.MarksixCore.runBacktest();
    expect(window.document.getElementById('backtestBadge').textContent)
      .toMatch(/in last 20 draws\.$/);

    await window.MarksixCore.generateSmartLines(1);
    await flush();
    expect(window.document.querySelector('.smart-line')).toBeTruthy();
  });

  it('notes that numbers are random when there is no history at all', async () => {
    const { window } = await boot({ fail: true });
    expect(window.MarksixCore.historyCount()).toBe(0);
    await window.MarksixCore.generateSmartLines(1);
    await flush();
    const line = window.document.querySelector('.smart-line');
    expect(line).toBeTruthy();
    expect(window.document.getElementById('smartStatus').textContent)
      .toContain('No stored history yet');
  });

  it('honours the filter switches when generating', async () => {
    const { window } = await boot();
    window.document.getElementById('consecutiveChk').checked = true;
    window.document.getElementById('sumRangeChk').checked = false;
    await window.MarksixCore.generateSmartLines(1);
    await flush();
    const nums = [...window.document.querySelectorAll('.smart-line .ball')].map((b) => parseInt(b.textContent, 10));
    expect(nums).toHaveLength(6);
    const consecutive = nums.some((n, i) => i > 0 && n === nums[i - 1] + 1);
    expect(consecutive).toBe(true);
  });

  it('fetches a deeper history when the window widens (500, then all)', async () => {
    const { window } = await boot();
    const sel = window.document.getElementById('historySelect');
    const historyLimits = () => window.fetch.mock.calls
      .filter((c) => String(c[0]).includes('/history'))
      .map((c) => JSON.parse(c[1].body).limit);
    expect(historyLimits()).toContain(100); // the boot stats fetch

    sel.value = '500';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flush();
    expect(historyLimits()).toContain(500);

    sel.value = 'all';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flush();
    expect(historyLimits()).toContain(1000); // "all" is capped at MAX_STORED_DRAWS
  });

  it('exposes all four odd/even modes as radios', async () => {
    const { window } = await boot();
    const values = [...window.document.querySelectorAll('input[name="oeRatio"]')].map((r) => r.value);
    expect(values).toEqual(['balanced', 'any', 'odd_heavy', 'even_heavy']);
  });
});
