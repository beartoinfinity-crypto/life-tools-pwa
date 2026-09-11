const app = require('../app');
const { ensureInitialData } = require('../apps/mark-six/server');
const { refreshTrafficNews, readTrafficNews } = require('../apps/traffic-news/server');

let backfillPromise = null;

module.exports = async function handler(req, res) {
  // On a fresh Supabase DB, lazily backfill the full Mark Six history on the
  // first data request (client already POSTs /api/marksix on page load).
  if (!backfillPromise && req.method === 'POST' && (req.url || '').indexOf('/mark-six/api/marksix') === 0) {
    backfillPromise = ensureInitialData().catch((e) => {
      console.error('initial backfill failed:', e.message);
    });
  }
  try {
    if (backfillPromise) await backfillPromise;
  } catch (e) {
    // backfill is best-effort; serve whatever state the DB is in
    console.error('backfill await failed:', e.message);
  }

  // Traffic news stale-while-revalidate: no always-on process on serverless,
  // so kick a background refresh when the cached copy is older than 60 s.
  if (req.method === 'POST' && (req.url || '').indexOf('/traffic-news/api/news') === 0) {
    try {
      const { lastRefresh } = await readTrafficNews({ limit: 1 });
      if (!lastRefresh || Date.now() - new Date(lastRefresh).getTime() > 60 * 1000) {
        refreshTrafficNews().catch(() => {});
      }
    } catch (e) { /* serve stale */ }
  }

  return app(req, res);
};