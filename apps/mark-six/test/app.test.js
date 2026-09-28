import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const TICKETS_KEY = 'saved_tickets';

function draw(id, numbers, special, date) {
  return { id, drawDate: date, drawResult: { drawnNo: numbers, xDrawnNo: special } };
}

function defaultDraws() {
  return [
    draw('26/100', [1, 3, 11, 15, 33, 46], 19, '2026-09-26+08:00'),
    draw('26/099', [2, 3, 7, 20, 25, 40], 5, '2026-09-24+08:00'),
  ];
}

function createHarness({ draws = defaultDraws(), fail = false, seedTickets = null } = {}) {
  const dom = new JSDOM(indexHtml, {
    url: 'https://example.test/mark-six/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const state = { fail, draws };

  if (seedTickets) window.localStorage.setItem(TICKETS_KEY, JSON.stringify(seedTickets));

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
      }),
    };
  });

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
});
