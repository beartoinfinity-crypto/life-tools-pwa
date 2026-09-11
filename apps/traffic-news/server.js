const express = require('express');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const { parseRoutejamNews, NEWS_URL } = require('./parser');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment variables');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function fetchUrl(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/** Scrape routejam news and upsert into Supabase. Returns { fetched, changed } */
async function refreshTrafficNews() {
  const { status, data: html } = await fetchUrl(NEWS_URL);
  if (status !== 200) throw new Error(`news.routejam.com returned ${status}`);
  const items = parseRoutejamNews(html);
  if (!items.length) throw new Error('no news items parsed');

  // Upsert (onConflict id): changed rows are updated, new rows inserted.
  // Keep it as a single upsert call — the full list is ~60 rows, well within limits.
  const rows = items.map((i) => ({
    id: i.id,
    posted_at: i.postedAt,
    category: i.category,
    status: i.status,
    location: i.location,
    detail: i.detail,
    source: i.source,
    lat: i.lat,
    lng: i.lng
  }));
  const { error } = await supabase.from('traffic_news').upsert(rows, { onConflict: 'id' });
  if (error) throw error;

  await supabase.from('meta').upsert(
    { key: 'trafficNewsLastRefresh', value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  return { fetched: items.length };
}

/** Latest news straight from Supabase (no scraping). Only the last 12 hours. */
async function readTrafficNews({ limit = 30, status, hours = 12 } = {}) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from('traffic_news')
    .select('*')
    .gte('posted_at', since)
    .order('posted_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(parseInt(limit) || 30, 100));
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  const lastRefresh = await supabase
    .from('meta')
    .select('value')
    .eq('key', 'trafficNewsLastRefresh')
    .single();
  return {
    data: data || [],
    lastRefresh: lastRefresh.data ? lastRefresh.data.value : null
  };
}

const app = express();
app.use(express.json());

// Static PWA (mounted at /traffic-news/ by the hub)
app.use(express.static(require('path').join(__dirname)));

// Read the latest cached news (fast path, no scrape)
app.post('/api/news', async (req, res) => {
  try {
    const { limit, status, hours } = req.body || {};
    res.json(await readTrafficNews({ limit, status, hours }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scrape + upsert, then return the latest
app.post('/api/news/refresh', async (req, res) => {
  try {
    const r = await refreshTrafficNews();
    const { limit, status, hours } = req.body || {};
    const out = await readTrafficNews({ limit, status, hours });
    res.json({ ...out, fetched: r.fetched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'index.html'));
});

let ensurePromise = null;
/** Scrape once at startup / first request (idempotent, reuses in-flight promise). */
function ensureTrafficNews() {
  if (!ensurePromise) {
    ensurePromise = refreshTrafficNews().catch((e) => {
      console.log('traffic news initial refresh failed:', e.message);
      ensurePromise = null; // retry on the next call
    });
  }
  return ensurePromise;
}

module.exports = { app, refreshTrafficNews, readTrafficNews, ensureTrafficNews };