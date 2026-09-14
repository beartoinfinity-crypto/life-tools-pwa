const express = require('express');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const { buildPlaylists, FEED_URL } = require('./parser');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment variables');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function fetchUrl(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(res.headers.location, timeout));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Scrape the Apple Music HK top-songs feed, split into playlists,
 * and cache them as one JSON row per playlist in Supabase.
 */
async function refreshMusicTrend() {
  const { status, data } = await fetchUrl(FEED_URL);
  if (status !== 200) throw new Error(`Apple feed returned ${status}`);
  const lists = buildPlaylists(JSON.parse(data));
  if (!lists.trending.length) throw new Error('feed had no songs');

  const rows = ['trending', 'cantonese', 'chinese'].map((list) => ({
    list,
    chart_title: lists.chartTitle,
    updated_at_src: lists.updatedAt,
    songs: JSON.stringify(lists[list]),
    refreshed_at: new Date().toISOString()
  }));
  const { error } = await supabase.from('music_trend').upsert(rows, { onConflict: 'list' });
  if (error) throw error;

  await supabase.from('meta').upsert(
    { key: 'musicTrendLastRefresh', value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  return { fetched: lists.trending.length };
}

/** Cached playlists straight from Supabase. Returns { data, lastRefresh }. */
async function readMusicTrend(list) {
  let query = supabase
    .from('music_trend')
    .select('list, chart_title, updated_at_src, refreshed_at, songs')
    .order('list', { ascending: true });
  if (list) query = query.eq('list', list);
  const { data, error } = await query;
  if (error) throw error;

  const lastRefresh = await supabase
    .from('meta')
    .select('value')
    .eq('key', 'musicTrendLastRefresh')
    .single();

  return {
    data: (data || []).map((r) => ({
      list: r.list,
      chartTitle: r.chart_title,
      updatedAtSrc: r.updated_at_src,
      songs: JSON.parse(r.songs)
    })),
    lastRefresh: lastRefresh.data ? lastRefresh.data.value : null
  };
}

const app = express();
app.use(express.json());

// Static PWA (mounted at /music-trend/ by the hub)
app.use(express.static(require('path').join(__dirname)));

// Cached playlists (fast path, no scrape)
app.post('/api/playlists', async (req, res) => {
  try {
    const { list } = req.body || {};
    res.json(await readMusicTrend(list));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scrape + upsert, then return the cached playlists
app.post('/api/playlists/refresh', async (req, res) => {
  try {
    const r = await refreshMusicTrend();
    const { list } = req.body || {};
    const out = await readMusicTrend(list);
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
function ensureMusicTrend() {
  if (!ensurePromise) {
    ensurePromise = refreshMusicTrend().catch((e) => {
      console.log('music trend initial refresh failed:', e.message);
      ensurePromise = null; // retry on the next call
    });
  }
  return ensurePromise;
}

module.exports = { app, refreshMusicTrend, readMusicTrend, ensureMusicTrend };