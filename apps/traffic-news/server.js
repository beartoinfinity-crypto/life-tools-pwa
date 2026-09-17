const express = require('express');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const { parseRoutejamNews, parse881903TrafficNews, NEWS_URL, TRAFFIC_881903_URL } = require('./parser');

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

/** Scrape routejam + 881903 news and upsert into Supabase. Returns { fetched } */
async function refreshTrafficNews() {
  // Scrape both sources in parallel
  const [routejamRes, traffic881903Res] = await Promise.allSettled([
    fetchUrl(NEWS_URL).then(({ status, data }) => {
      if (status !== 200) throw new Error(`news.routejam.com returned ${status}`);
      return parseRoutejamNews(data);
    }),
    fetchUrl(TRAFFIC_881903_URL).then(({ status, data }) => {
      if (status !== 200) throw new Error(`881903.com returned ${status}`);
      return parse881903TrafficNews(data);
    })
  ]);

  const routejamItems = routejamRes.status === 'fulfilled' ? routejamRes.value : [];
  const traffic881903Items = traffic881903Res.status === 'fulfilled' ? traffic881903Res.value : [];

  if (routejamRes.status === 'rejected') console.log('routejam scrape failed:', routejamRes.reason.message);
  if (traffic881903Res.status === 'rejected') console.log('881903 scrape failed:', traffic881903Res.reason.message);

  const allItems = [...routejamItems, ...traffic881903Items];
  if (!allItems.length) throw new Error('no news items parsed from any source');

  const rows = allItems.map((i) => ({
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
  return { fetched: allItems.length };
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
/** Scrape at the first call (idempotent, reuses in-flight promise). */
function ensureTrafficNews() {
  if (!ensurePromise) {
    ensurePromise = refreshTrafficNews().catch((e) => {
      console.log('traffic news initial refresh failed:', e.message);
      ensurePromise = null; // retry on the next call
    });
  }
  return { then: null } && ensurePromise || ensurePromise;
}

let busyRefresh = null;
/** Periodic re-scrape (standalone: scrape once, then every 60s, overlap-guarded; unref in servers with a ref-counting loop). */
function scheduleTrafficNewsRefresh() {
  if (busyRefresh) return;
  busyRefresh = refreshTrafficNews().catch(function (e) {
    console.log('traffic news periodic refresh failed:', e.message);
  }).finally(function () { busyRefresh = null; });
}

scheduleTrafficNewsRefresh();
var si = setInterval(scheduleTrafficNewsRefresh, 60 * 1000);
if (si.unref) si.unref();
module.exports = { app, refreshTrafficNews, readTrafficNews, ensureTrafficNews };