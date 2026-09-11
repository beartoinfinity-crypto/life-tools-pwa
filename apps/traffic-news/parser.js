/**
 * Parser for https://news.routejam.com/ (Routejam 路暢 — HK traffic news).
 *
 * The page is server-rendered HTML: each news item is a Bootstrap accordion-item
 * whose header button contains a <tabke> (sic) element with exactly 4 rows:
 *   row 1: <b>2026年9月11日 下午02:58 (4分鐘前)</b>   (date/time + relative)
 *   row 2: <b>道路事故-交通意外 (最新情況)</b>          (category + status)
 *   row 3: <b>西九龍公路,奧運港鐵站 [往西隧]</b>        (location, may be empty)
 *   row 4: detail text ...<br />資料來源: 香港電台       (detail + source)
 * Item ids appear on the h2 header and can be plain md5, "RD#<md5>" or "IN-YY-NNNNN".
 * Coordinates live in the inline script as per-item blocks:
 *   $('#collapse<ID>').on('show.bs.collapse', ... new google.maps.LatLng(lat,lng) ...)
 * (the trailing bare marker block and initMap's default center must be ignored,
 *  and some items have no script block at all).
 */

const NEWS_URL = 'https://news.routejam.com/';

/** "2026年9月11日 下午02:58" -> "2026-09-11T14:58:00+08:00" (HK time, UTC+8) */
function toHKISO(raw) {
  const m = String(raw || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(上午|下午)\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[5], 10);
  if (m[4] === '下午' && h < 12) h += 12;
  if (m[4] === '上午' && h === 12) h = 0;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(h)}:${m[6]}:00+08:00`;
}

/** Map of item id -> { lat, lng } from the inline script's collapse handlers. */
function extractCoords(html) {
  const map = new Map();
  // Tempered dot: the lazy body must not cross into the next $('#collapse...' handler,
  // so a legacy handler with no LatLng (e.g. #collapseOne) can't steal the next item's coords.
  const re = /\$\('#collapse([^']+)'\)\.on\('show\.bs\.collapse'(?:(?!\$\('#collapse)[\s\S])*?new google\.maps\.LatLng\(([-\d.]+)\s*,\s*([-\d.]+)\)/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    if (!map.has(id)) map.set(id, { lat: parseFloat(m[2]), lng: parseFloat(m[3]) });
  }
  return map;
}

/** cell html -> plain text: <br> -> newline, tags stripped, per-line trimmed */
function cellText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parseRoutejamNews(html) {
  const coords = extractCoords(html);
  const items = [];
  const reItem = /<div class="accordion-item">([\s\S]*?)(?=<div class="accordion-item">|<\/div>\s*<\/div>\s*<\/body>|<\/body>)/g;
  let m;
  while ((m = reItem.exec(html))) {
    const chunk = m[1];
    const idMatch = chunk.match(/<h2 class="accordion-header" id="([^"]+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const tabke = chunk.match(/<tabke>([\s\S]*?)<\/tabke>/);
    if (!tabke) continue;
    const rows = [];
    const reRow = /<tr><td>([\s\S]*?)<\/td><\/tr>/g;
    let r;
    while ((r = reRow.exec(tabke[1]))) rows.push(cellText(r[1]));
    if (rows.length < 4) continue;

    // row 1: "2026年9月11日 下午02:58 (4分鐘前)"
    let postedRaw = rows[0], relative = '';
    const rm = rows[0].match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    if (rm) { postedRaw = rm[1].trim(); relative = rm[2].trim(); }

    // row 2: "道路事故-交通意外 (最新情況)"
    let category = rows[1], status = '';
    const cm = rows[1].match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    if (cm) { category = cm[1].trim(); status = cm[2].trim(); }

    // row 3: location (may be empty)
    const location = rows[2];

    // row 4: detail + "資料來源: X" (may be followed by a footnote line, e.g. DS- items)
    let detail = rows[3], source = '';
    const sm = rows[3].match(/資料來源:\s*([^\n]+)/);
    if (sm) {
      source = sm[1].trim();
      detail = rows[3].slice(0, sm.index).replace(/\n+$/, '').trim();
      const rest = rows[3].slice(sm.index + sm[0].length).trim();
      if (rest) detail += (detail ? '\n' : '') + rest;
    }

    const c = coords.get(id) || {};
    items.push({
      id,
      postedAt: toHKISO(postedRaw) || '',
      postedRaw,
      relative,
      category,
      status,
      location,
      detail,
      source,
      lat: c.lat != null ? c.lat : null,
      lng: c.lng != null ? c.lng : null
    });
  }
  return items;
}

module.exports = { parseRoutejamNews, toHKISO, extractCoords, NEWS_URL };