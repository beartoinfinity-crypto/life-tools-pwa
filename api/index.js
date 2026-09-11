const app = require('../app');
const { ensureInitialData } = require('../apps/mark-six/server');

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
  return app(req, res);
};