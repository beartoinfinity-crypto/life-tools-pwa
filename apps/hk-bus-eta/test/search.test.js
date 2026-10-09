// Repro/behaviour tests: drive the real lite app (build/index.html + build/app.js)
// with a frozen routeFareList fixture and assert route-search grouping rules:
// operator families get separate cards (九巴 vs 綠van) except 九巴/城巴 which stay merged.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const indexHtml = readFileSync(join(buildDir, 'index.html'), 'utf8');
const appJs = readFileSync(join(buildDir, 'app.js'), 'utf8').replace(
  /^import\s*\{[^}]*\}\s*from\s*"[^"]*";$/m,
  'const fetchEtaDb = () => fetch("https://data.hkbus.app/routeFareList.min.json").then((r) => r.json());\nconst fetchEtas = async () => [];'
);
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'routeFareList.fixture.json'), 'utf8'));

function loadDb() {
  return JSON.parse(JSON.stringify(fixture));
}

async function createHarness(dbJson) {
  const dom = new JSDOM(indexHtml, {
    url: 'https://life-tools-pwa.vercel.app/bus-eta-lite/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('routeFareList.min.json')) {
      return { ok: true, status: 200, json: async () => dbJson };
    }
    if (u.includes('routeFareList.md5')) {
      return { ok: true, status: 200, text: async () => '565448595689752eca7bb99884d7915e89b87a1b0', json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  });
  window.eval(appJs);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  return dom;
}

// Type into the real route input, honouring the app's 120ms debounce, retrying while
// the DB is still loading (skeleton rows are rendered by dbGuard).
async function searchRoute(dom, q, tries = 15) {
  const { window } = dom;
  const input = window.document.getElementById('routeInput');
  let html = '';
  for (let i = 0; i < tries; i++) {
    input.value = q;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 160));
    html = window.document.getElementById('routeResults').innerHTML;
    if (html.includes('route-row') || html.includes('msg')) break;
  }
  return html;
}

function routeCards(dom, no) {
  return [...dom.window.document.querySelectorAll('#routeResults .route-row')]
    .filter((c) => c.querySelector('.route-no')?.textContent.trim() === no);
}

describe('lite route search grouping', () => {
  it('renders 71A rows from the routeFareList fixture', async () => {
    const dom = await createHarness(loadDb());
    const html = await searchRoute(dom, '71A');
    const rows = [...html.matchAll(/route-no[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect({ rows, hasMsg: html.includes('msg') }).toEqual({ rows: expect.arrayContaining(['71A']), hasMsg: false });
    dom.window.close();
  });

  it('splits 71A into separate KMB and green-minibus cards', async () => {
    const dom = await createHarness(loadDb());
    await searchRoute(dom, '71A');
    const cards = routeCards(dom, '71A');
    expect(cards).toHaveLength(2);
    const badges = cards.map((c) => c.querySelector('.route-no').className);
    expect(badges.some((b) => /\bco-kmb\b/.test(b))).toBe(true);
    expect(badges.some((b) => /\bco-gmb\b/.test(b))).toBe(true);
    dom.window.close();
  });

  it('keeps the joint KMB/CTB route 101 in a single card', async () => {
    const dom = await createHarness(loadDb());
    await searchRoute(dom, '101');
    const cards = routeCards(dom, '101');
    expect(cards).toHaveLength(1);
    const tags = cards[0].querySelectorAll('.rmeta .tag');
    const classes = [...tags].map((t) => t.className);
    expect(classes.some((c) => /\bco-ctb\b/.test(c))).toBe(true);
    expect(classes.some((c) => /\bco-kmb\b/.test(c))).toBe(true);
    dom.window.close();
  });

  it('opens only the tapped operator card in route detail', async () => {
    const dom = await createHarness(loadDb());
    await searchRoute(dom, '71A');
    const kmbCard = routeCards(dom, '71A')
      .find((c) => /\bco-kmb\b/.test(c.querySelector('.route-no').className));
    expect(kmbCard).toBeTruthy();
    kmbCard.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
    const detail = dom.window.document.getElementById('detailTop').innerHTML;
    const pills = [...dom.window.document.querySelectorAll('#detailTop .pill')];
    expect(pills).toHaveLength(2);
    expect(detail).toContain('大埔');
    expect(detail).not.toContain('錦上路');
    expect(detail).not.toContain('寶達');
    dom.window.close();
  });

  it('shows no 71A card when the fixture lacks 71A (stale-db symptom)', async () => {
    const db = loadDb();
    for (const [k, v] of Object.entries(db.routeList)) {
      if (String(v.route).trim().toUpperCase() === '71A') delete db.routeList[k];
    }
    const dom = await createHarness(db);
    await searchRoute(dom, '71A');
    expect(routeCards(dom, '71A')).toHaveLength(0);
    dom.window.close();
  });

  it('opens the 71A route detail when its search row is tapped', async () => {
    const dom = await createHarness(loadDb());
    await searchRoute(dom, '71A');
    const row = routeCards(dom, '71A')[0];
    expect(row).toBeTruthy();
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
    const detail = dom.window.document.getElementById('detailTop')?.innerHTML || '';
    const viewDetailHidden = dom.window.document.getElementById('viewDetail')?.classList.contains('hidden');
    expect({ has71: detail.includes('71A'), viewDetailHidden }).toEqual({ has71: true, viewDetailHidden: false });
    dom.window.close();
  });
});
