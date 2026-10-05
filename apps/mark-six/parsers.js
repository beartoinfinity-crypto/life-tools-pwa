function parseLotteryExtreme(html) {
  const draws = [];
  const rowRegex = /<tr class='cy'><td class='cx'>(\d{2}\/\d{2}\/\d{4})\s+\w+\s+\((\d{2}\/\d{3})\)[\s\S]*?<\/tr>\s*<TR><TD class='c1'><ul class='displayball'[^>]*>([\s\S]*?)<\/ul>/gi;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const date = match[1];
    const draw = match[2];
    const ballsHtml = match[3];

    const parts = ballsHtml.split(/<li class=["']dbx["']>/);
    if (parts.length === 2) {
      const mainNos = [];
      const mainRegex = /<li>(\d{1,2})/g;
      let m;
      while ((m = mainRegex.exec(parts[0])) !== null) {
        mainNos.push(Number(m[1]));
      }

      let special = null;
      const specMatch = parts[1].match(/(\d{1,2})/);
      if (specMatch) special = Number(specMatch[1]);

      if (mainNos.length === 6) {
        draws.push({ draw, date, numbers: mainNos, special, source: 'lotteryextreme' });
      }
    }
  }
  return draws;
}

function parseLotteryHk(html) {
  const draws = [];
  const rowRegex = /<tr>\s*<td>(\d{2}\/\d{3})<\/td>\s*<td><span class="date">(\d{2}\/\d{2}\/\d{4})<\/span><\/td>\s*<td>\s*<ul class="balls">([\s\S]*?)<\/ul>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const draw = match[1];
    const date = match[2];
    const ballsHtml = match[3];
    const ballRegex = /<li class="([^"]*)">(\d{1,2})<\/li>/g;
    const numbers = [];
    let special = null;
    let ballMatch;
    while ((ballMatch = ballRegex.exec(ballsHtml)) !== null) {
      if (ballMatch[1].includes('-plus')) {
        special = Number(ballMatch[2]);
      } else {
        numbers.push(Number(ballMatch[2]));
      }
    }
    if (numbers.length >= 6) {
      draws.push({ draw, date, numbers: numbers.slice(0, 6), special, source: 'lottery.hk' });
    }
  }
  return draws;
}

function parseGitHubData(data) {
  return data.map(d => ({
    draw: d.id,
    date: d.date ? d.date.split('-').reverse().join('/') : '',
    numbers: (d.no || []).map(Number),
    special: d.sno ? parseInt(d.sno) : null,
    source: 'github',
  }));
}

function toISODate(ddmmyyyy) {
  if (!ddmmyyyy) return '';
  const parts = ddmmyyyy.split('/');
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function toResponseDate(iso) {
  if (!iso) return '';
  return iso + '+08:00';
}

/**
 * HKJC's own published draw schedule (their Sitecore "MarksixFixtures"
 * GraphQL response). Returns every normal draw date as a sorted
 * 'YYYY-MM-DD' list. Snowball draws are a subset of these dates, so the
 * countdown does not need them separately.
 */
function parseHKJCFixtures(json) {
  const out = [];
  const years = json && json.data && json.data.item && json.data.item.years;
  if (!Array.isArray(years)) return out;
  for (const y of years) {
    const year = y.year;
    if (!year) continue;
    for (const mo of y.months || []) {
      const mm = mo.month && mo.month.value;
      const dates = mo.dates && mo.dates.date;
      if (!mm || !Array.isArray(dates)) continue;
      for (const d of dates) {
        if (!d || !d.value) continue;
        const iso = `${year}-${String(mm).padStart(2, '0')}-${String(d.value).padStart(2, '0')}`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) out.push(iso);
      }
    }
  }
  return out.sort();
}

/**
 * The schedule dates HKJC has published from today (HKT) onward, capped so the
 * API payload stays small. Callers still apply the 21:15 HKT cutoff client-side.
 */
function upcomingDrawDates(dates, nowMs, limit) {
  const todayIso = new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
  return (dates || []).filter((d) => d >= todayIso).slice(0, limit || 8);
}

module.exports = {
  parseLotteryExtreme,
  parseLotteryHk,
  parseGitHubData,
  toISODate,
  toResponseDate,
  parseHKJCFixtures,
  upcomingDrawDates,
};
