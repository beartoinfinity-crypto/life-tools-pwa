require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');

const { createDB } = require('./supabase-db');
const { parseLotteryExtreme, parseLotteryHk, parseGitHubData, toISODate } = require('./parsers');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

let db = createDB();

function fetchUrl(url, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...options.headers
      }
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && maxRedirects > 0) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url);
          redirectUrl = parsed.origin + redirectUrl;
        }
        res.resume();
        return fetchUrl(redirectUrl, options, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function scrapeLotteryExtreme() {
  try {
    const { status, data: html } = await fetchUrl('https://www.lotteryextreme.com/marksix/results');
    if (status === 200) {
      const draws = parseLotteryExtreme(html);
      if (draws.length > 0) return draws;
    }
  } catch (e) {
    console.log('lotteryextreme.com failed:', e.message);
  }
  return [];
}

async function scrapeLotteryHk(years) {
  const results = [];
  for (const year of years) {
    try {
      const { status, data: html } = await fetchUrl(`https://lottery.hk/en/mark-six/results/${year}`);
      if (status === 200) {
        const draws = parseLotteryHk(html);
        if (draws.length > 0) {
          results.push(...draws);
          console.log(`  lottery.hk/${year}: ${draws.length} draws`);
        }
      }
    } catch (e) {
      console.log(`  lottery.hk/${year} failed:`, e.message);
    }
  }
  return results;
}

async function fetchGitHubData() {
  try {
    const { status, data } = await fetchUrl(
      'https://raw.githubusercontent.com/icelam/mark-six-data-visualization/master/data/all.json'
    );
    if (status === 200) return parseGitHubData(JSON.parse(data));
  } catch (e) {
    console.log('GitHub failed:', e.message);
  }
  return [];
}

async function refreshData() {
  const before = await db.count();
  console.log(`Refresh start: ${before} draws in DB`);

  // 1. lotteryextreme.com: latest 20
  try {
    const latest = await scrapeLotteryExtreme();
    if (latest.length > 0) {
      await db.upsertBatch(latest.map(d => toISODraw(d)));
      console.log(`lotteryextreme.com: upserted ${latest.length} draws`);
    }
  } catch (e) {
    console.log('lotteryextreme.com failed:', e.message);
  }

  // 2. lottery.hk: fill missing years
  const currentYear = new Date().getFullYear();
  const existingYears = await db.getDraws(100000).then(draws =>
    [...new Set(draws.map(d => d.date.split('-')[0]))]
  );
  const missingYears = [];
  for (let y = 1993; y <= currentYear; y++) {
    if (!existingYears.includes(String(y))) missingYears.push(y);
  }

  if (missingYears.length > 0) {
    console.log(`Scraping lottery.hk for ${missingYears.length} missing years...`);
    const hkDraws = await scrapeLotteryHk(missingYears);
    if (hkDraws.length > 0) {
      await db.upsertBatch(hkDraws.map(d => toISODraw(d)));
    }
  } else {
    console.log('All years already in DB');
  }

  // 3. GitHub bulk if DB is small
  if (await db.count() < 100) {
    try {
      const ghDraws = await fetchGitHubData();
      if (ghDraws.length > 0) {
        const normalized = ghDraws.map(d => ({ ...d, date: toISODate(d.date) }));
        await db.upsertBatch(normalized);
        console.log(`GitHub: upserted ${ghDraws.length} draws`);
      }
    } catch (e) {
      console.log('GitHub failed:', e.message);
    }
  }

  const after = await db.count();
  await db.metaSet('lastRefresh', new Date().toISOString());
  console.log(`Refresh done: ${before} -> ${after} draws (+${after - before} new)`);
  return after;
}

function toISODraw(d) {
  return { ...d, date: toISODate(d.date) };
}

function toResponse(draws) {
  return draws.map(d => ({
    id: d.draw,
    year: d.date ? d.date.split('-')[0] : '',
    no: d.draw ? parseInt(d.draw.split('/')[1]) || 0 : 0,
    drawDate: d.date ? d.date + '+08:00' : '',
    status: 'Result',
    drawResult: {
      drawnNo: typeof d.numbers === 'string' ? JSON.parse(d.numbers) : d.numbers,
      xDrawnNo: d.special,
    }
  }));
}

async function sendDraws(res, body) {
  const { lastNDraw = 10 } = body;
  const total = await db.count();

  if (total > 0) {
    const draws = await db.getDraws(lastNDraw);
    console.log(`Serving ${draws.length} draws from DB (${total} total)`);
    return res.json({
      data: { lotteryDraws: toResponse(draws) },
      source: 'database',
      totalCached: total,
      lastRefresh: await db.metaGet('lastRefresh')
    });
  }

  res.json({
    data: { lotteryDraws: [] },
    source: 'empty',
    totalCached: 0,
    message: 'No data yet. Call POST /api/marksix/refresh first.'
  });
}

app.post('/api/marksix', async (req, res) => {
  try {
    await sendDraws(res, req.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/marksix/refresh', async (req, res) => {
  try {
    await refreshData();
    const total = await db.count();
    const draws = await db.getDraws(req.body.lastNDraw || 10);
    return res.json({
      data: { lotteryDraws: toResponse(draws) },
      source: 'refreshed',
      totalCached: total,
      lastRefresh: await db.metaGet('lastRefresh')
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/marksix/history', async (req, res) => {
  try {
    const { year, from, to, limit } = req.body;
    let draws;

    if (year) {
      draws = await db.getDrawsByYear(year);
    } else if (from || to) {
      draws = await db.getDrawsRange(from, to);
    } else {
      draws = await db.getDraws(limit || 50);
    }

    return res.json({
      data: { lotteryDraws: toResponse(draws) },
      source: 'database',
      totalCached: await db.count(),
      returned: draws.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Mark Six server running at http://localhost:${PORT}`);
  try {
    const count = await db.count();
    console.log(`DB has ${count} draws (last refresh: ${await db.metaGet('lastRefresh') || 'never'})`);

    if (count === 0) {
      console.log('DB empty, building initial history from GitHub...');
      try {
        const ghDraws = await fetchGitHubData();
        if (ghDraws.length > 0) {
          await db.upsertBatch(ghDraws.map(d => ({ ...d, date: toISODate(d.date) })));
          await db.metaSet('lastRefresh', new Date().toISOString());
          console.log(`Initial build: ${ghDraws.length} draws loaded`);
        }
      } catch (e) {
        console.log('Initial build failed:', e.message);
      }
    }
  } catch (e) {
    console.log('Database check failed:', e.message);
  }
});
