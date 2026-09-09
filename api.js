const express = require('express');
const path = require('path');
const { createDB } = require('./db');
const { parseLotteryExtreme, parseLotteryHk, parseGitHubData, toISODate, toResponseDate } = require('./parsers');

function createApp(dbPath) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname)));

  const store = createDB(dbPath);

  function toResponse(draws) {
    return draws.map(d => ({
      id: d.draw,
      drawDate: toResponseDate(d.date),
      drawResult: {
        drawnNo: d.numbers,
        xDrawnNo: d.special,
      }
    }));
  }

  app.get('/api/marksix', (req, res) => {
    const lastNDraw = parseInt(req.query.lastNDraw) || 10;
    const total = store.count();

    if (total > 0) {
      const draws = store.getDraws(lastNDraw);
      return res.json({
        data: { lotteryDraws: toResponse(draws) },
        source: 'database',
        totalCached: total,
        lastRefresh: store.metaGet('lastRefresh')
      });
    }

    res.json({
      data: { lotteryDraws: [] },
      source: 'empty',
      totalCached: 0,
      message: 'No data yet. Call POST /api/marksix/refresh first.'
    });
  });

  app.get('/api/marksix/history', (req, res) => {
    const { year, from, to, limit } = req.query;
    let draws;

    if (year) {
      draws = store.getDrawsByYear(year);
    } else if (from || to) {
      draws = store.getDrawsRange(from || null, to || null);
    } else {
      draws = store.getDraws(parseInt(limit) || 50);
    }

    return res.json({
      data: { lotteryDraws: toResponse(draws) },
      source: 'database',
      totalCached: store.count(),
      returned: draws.length
    });
  });

  app.post('/api/marksix/refresh', async (req, res) => {
    try {
      const { scrapeLotteryExtreme } = require('./scrapers');
      const latest = await scrapeLotteryExtreme();

      if (latest.length > 0) {
        const maxDraw = store.getDraws(1)[0];
        const newDraws = maxDraw
          ? latest.filter(d => d.draw > maxDraw.draw)
          : latest;

        if (newDraws.length > 0) {
          store.upsertBatch(newDraws.map(d => ({
            ...d,
            date: toISODate(d.date),
          })));
        }
      }

      store.metaSet('lastRefresh', new Date().toISOString());
      const total = store.count();
      const draws = store.getDraws(parseInt(req.body.lastNDraw) || 10);
      return res.json({
        data: { lotteryDraws: toResponse(draws) },
        source: 'refreshed',
        totalCached: total,
        lastRefresh: store.metaGet('lastRefresh')
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app._store = store;
  return app;
}

module.exports = { createApp };
