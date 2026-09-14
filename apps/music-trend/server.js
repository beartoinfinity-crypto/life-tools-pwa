const express = require('express');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const { buildPlaylists, FEED_URL } = require('./parser');
const { searchYouTube, mapLimit } = require('./youtube');

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

// How many songs to (re-)resolve to YouTube ids per refresh run. Apple charts
// move slowly, so a rolling window keeps the cache fresh without hammering
// youtube or blowing serverless timeouts. Best-effort: a slow YouTube never
// fails the refresh, it just resolves fewer songs this run.
const YT_RESOLVE_PER_RUN = 20;
const YT_CONCURRENCY = 4;
const YT_DEADLINE_MS = 50 * 1000;

/**
 * Resolve YouTube ids for songs, reusing ids cached from previous runs
 * (matched by song id) so only new/missing songs hit youtube — a rolling
 * window per run keeps scrapes bounded. Never rejects.
 */
async function resolveYouTube(songs) {
  // Reuse previously cached ids
  let cached = new Map();
  try {
    const { data } = await supabase.from('music_trend').select('songs').eq('list', 'trending').single();
    for (const s of JSON.parse(data.songs || '[]')) {
      if (s.youtubeId) cached.set(String(s.id), { youtubeId: s.youtubeId, youtubeTitle: s.youtubeTitle });
    }
  } catch { /* first run / no cache */ }

  for (const s of songs) {
    const c = cached.get(String(s.id));
    if (c) { s.youtubeId = c.youtubeId; s.youtubeTitle = c.youtubeTitle; }
  }

  const need = songs.filter((s) => !s.youtubeId).slice(0, YT_RESOLVE_PER_RUN);
  if (!need.length) return;

  const deadline = Date.now() + YT_DEADLINE_MS;
  await mapLimit(need, YT_CONCURRENCY, async (s) => {
    if (Date.now() > deadline) return; // stop resolving, keep this run short
    const hit = await searchYouTube(s);
    if (hit) {
      s.youtubeId = hit.videoId;
      s.youtubeTitle = hit.title;
    }
  });
}

/**
 * Scrape the Apple Music HK top-songs feed, split into playlists,
 * resolve YouTube ids (rolling window), and cache each playlist as one
 * JSON row in Supabase.
 */
async function refreshMusicTrend() {
  const { status, data } = await fetchUrl(FEED_URL);
  if (status !== 200) throw new Error(`Apple feed returned ${status}`);
  const lists = buildPlaylists(JSON.parse(data));
  if (!lists.trending.length) throw new Error('feed had no songs');

  await resolveYouTube(lists.trending);

  // resolveYouTube mutates only the trending copies of each song; propagate the
  // resolved ids to the cantonese/chinese playlists (same songs, new objects).
  const ytById = new Map(lists.trending.filter((s) => s.youtubeId).map((s) => [String(s.id), s]));
  for (const name of ['cantonese', 'chinese']) {
    for (const s of lists[name]) {
      const src = ytById.get(String(s.id));
      if (src) { s.youtubeId = src.youtubeId; s.youtubeTitle = src.youtubeTitle; }
    }
  }

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
  return {
    fetched: lists.trending.length,
    resolved: lists.trending.filter((s) => s.youtubeId).length
  };
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