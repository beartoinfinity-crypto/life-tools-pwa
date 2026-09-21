const express = require('express');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const { buildPlaylists, feedUrl } = require('./parser');
const { searchYouTube, mapLimit } = require('./youtube');

/** Countries whose Apple Music charts are available (code -> label). */
const COUNTRIES = {
  hk: '香港',
  tw: '台灣',
  cn: '中國',
  jp: '日本',
  kr: '韓國',
  us: '美國',
  sg: '新加坡',
  my: '馬來西亞',
  au: '澳洲',
  gb: '英國'
};

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
 * (matched by song id, country-scoped) so only new/missing songs hit
 * youtube — a rolling window per run keeps scrapes bounded. Never rejects.
 */
async function resolveYouTube(country, songs, skipCache) {
  // Reuse previously cached ids (unless skipCache forces a full re-resolve)
  let cached = new Map();
  if (!skipCache) {
    try {
      const { data } = await supabase.from('music_trend').select('songs').eq('list', `${country}:trending`).single();
      for (const s of JSON.parse(data.songs || '[]')) {
        if (s.youtubeId) cached.set(String(s.id), { youtubeId: s.youtubeId, youtubeTitle: s.youtubeTitle });
      }
    } catch { /* first run / no cache */ }
  }

  for (const s of songs) {
    const c = cached.get(String(s.id));
    if (c) { s.youtubeId = c.youtubeId; s.youtubeTitle = c.youtubeTitle; }
  }

  const need = skipCache ? songs.filter((s) => !s.youtubeId) : songs.filter((s) => !s.youtubeId).slice(0, YT_RESOLVE_PER_RUN);
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
 * Scrape the Apple Music most-played feed for a country, split into
 * playlists, resolve YouTube ids (rolling window), and cache each playlist
 * as one JSON row in Supabase keyed "<cc>:<list>".
 */
async function refreshMusicTrend(country, { clearCache } = {}) {
  const cc = String(country || 'hk').toLowerCase();
  if (!COUNTRIES[cc]) throw new Error(`unknown country: ${cc}`);
  const { status, data } = await fetchUrl(feedUrl(cc));
  if (status !== 200) throw new Error(`Apple feed returned ${status}`);
  const lists = buildPlaylists(JSON.parse(data), cc);
  if (!lists.trending.length) throw new Error('feed had no songs');

  await resolveYouTube(cc, lists.trending, clearCache);

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
    list: `${cc}:${list}`,
    chart_title: lists.chartTitle,
    updated_at_src: lists.updatedAt,
    songs: JSON.stringify(lists[list]),
    refreshed_at: new Date().toISOString()
  }));
  const { error } = await supabase.from('music_trend').upsert(rows, { onConflict: 'list' });
  if (error) throw error;

  // One-time/idempotent cleanup: drop legacy un-prefixed rows from the pre-multi-country era
  await supabase.from('music_trend').delete().not('list', 'like', '%:%');

  await supabase.from('meta').upsert(
    { key: `musicTrendLastRefresh:${cc}`, value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  return {
    country: cc,
    fetched: lists.trending.length,
    resolved: lists.trending.filter((s) => s.youtubeId).length
  };
}

/** Cached playlists straight from Supabase. Returns { data, lastRefresh, countries }. */
async function readMusicTrend({ country, list } = {}) {
  let query = supabase
    .from('music_trend')
    .select('list, chart_title, updated_at_src, refreshed_at, songs')
    .order('list', { ascending: true });
  if (country) {
    const cc = String(country).toLowerCase();
    query = query.like('list', `${cc}:%`);
    if (list) query = query.eq('list', `${cc}:${list}`);
  } else if (list) {
    query = query.eq('list', `hk:${list}`);
  }
  const { data, error } = await query;
  if (error) throw error;

  const cc = String(country || 'hk').toLowerCase();
  const lastRefresh = await supabase
    .from('meta')
    .select('value')
    .eq('key', `musicTrendLastRefresh:${cc}`)
    .single();

  return {
    data: (data || []).map((r) => ({
      list: r.list,
      chartTitle: r.chart_title,
      updatedAtSrc: r.updated_at_src,
      songs: JSON.parse(r.songs)
    })),
    lastRefresh: lastRefresh.data ? lastRefresh.data.value : null,
    countries: COUNTRIES
  };
}

const app = express();
app.use(express.json());

// Static PWA (mounted at /music-trend/ by the hub)
app.use(express.static(require('path').join(__dirname)));

// Cached playlists (fast path, no scrape). On serverless (Vercel) there is
// no always-on process, so a stale country (>1h) is re-scraped in the
// background (stale-while-revalidate) — the response still returns the cache.
app.post('/api/playlists', async (req, res) => {
  try {
    const { country, list } = req.body || {};
    if (process.env.VERCEL) {
      const cc = String(country || 'hk').toLowerCase();
      if (COUNTRIES[cc]) {
        try {
          const { data: meta } = await supabase.from('meta').select('value').eq('key', `musicTrendLastRefresh:${cc}`).single();
          const stale = !meta || !meta.value || Date.now() - new Date(meta.value).getTime() > 60 * 60 * 1000;
          if (stale) refreshMusicTrend(cc).catch(() => {});
        } catch (e) { /* serve stale */ }
      }
    }
    res.json(await readMusicTrend({ country, list }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scrape + upsert, then return the cached playlists
app.post('/api/playlists/refresh', async (req, res) => {
  try {
    const { country, list, clearCache } = req.body || {};
    const r = await refreshMusicTrend(country, { clearCache: !!clearCache });
    const out = await readMusicTrend({ country: r.country, list });
    res.json({ ...out, fetched: r.fetched, resolved: r.resolved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manually replace a song's YouTube ID in a chart playlist
app.patch('/api/playlists/:listKey/songs/:songId', async (req, res) => {
  try {
    const listKey = decodeURIComponent(req.params.listKey);
    const songId = decodeURIComponent(req.params.songId);
    const youtubeId = String((req.body || {}).youtubeId || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) throw new Error('Invalid YouTube video ID');

    const { data: row, error: fetchErr } = await supabase
      .from('music_trend')
      .select('songs')
      .eq('list', listKey)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!row) return res.status(404).json({ error: 'playlist not found' });

    const songs = JSON.parse(row.songs || '[]');
    const song = songs.find(function (s) { return String(s.id) === String(songId); });
    if (!song) return res.status(404).json({ error: 'song not found' });
    song.youtubeId = youtubeId;
    song.youtubeTitle = (req.body || {}).youtubeTitle || song.youtubeTitle || '';

    const { error: updErr } = await supabase
      .from('music_trend')
      .update({ songs: JSON.stringify(songs) })
      .eq('list', listKey);
    if (updErr) throw updErr;
    res.json({ ok: true, youtubeId: youtubeId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cross-device my-playlist store (table music_user_playlists). The name the
// user types IS the key, so the same name on another device reloads the songs.
app.get('/api/myplaylists', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('music_user_playlists')
      .select('name, updated_at, songs')
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({
      data: (data || []).map((r) => ({
        name: r.name,
        count: JSON.parse(r.songs || '[]').length,
        updated_at: r.updated_at
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/myplaylists', async (req, res) => {
  try {
    const { name, songs } = req.body || {};
    if (!name || !String(name).trim()) throw new Error('name required');
    if (!Array.isArray(songs)) throw new Error('songs must be an array');
    const trimmed = String(name).trim().slice(0, 100);
    const { error } = await supabase.from('music_user_playlists').upsert(
      { name: trimmed, songs: JSON.stringify(songs), updated_at: new Date().toISOString() },
      { onConflict: 'name' }
    );
    if (error) throw error;
    res.json({ ok: true, name: trimmed, count: songs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/myplaylists/:name', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('music_user_playlists')
      .select('name, updated_at, songs')
      .eq('name', req.params.name)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json({ name: data.name, updated_at: data.updated_at, songs: JSON.parse(data.songs || '[]') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rename a playlist (name is PK, so create new + delete old)
app.patch('/api/myplaylists/:name', async (req, res) => {
  try {
    const oldName = decodeURIComponent(req.params.name);
    const newName = String((req.body || {}).newName || '').trim().slice(0, 100);
    if (!newName) throw new Error('newName required');

    const { data: existing, error: fetchErr } = await supabase
      .from('music_user_playlists')
      .select('name, songs')
      .eq('name', oldName)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'not found' });

    // If new name differs and already exists, block overwrite
    if (newName !== oldName) {
      const { data: dup } = await supabase
        .from('music_user_playlists')
        .select('name')
        .eq('name', newName)
        .maybeSingle();
      if (dup) throw new Error('A playlist named "' + newName + '" already exists');
    }

    const now = new Date().toISOString();
    const { error: insErr } = await supabase
      .from('music_user_playlists')
      .upsert({ name: newName, songs: existing.songs, updated_at: now }, { onConflict: 'name' });
    if (insErr) throw insErr;

    if (newName !== oldName) {
      await supabase.from('music_user_playlists').delete().eq('name', oldName);
    }
    res.json({ ok: true, name: newName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a playlist
app.delete('/api/myplaylists/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const { error } = await supabase.from('music_user_playlists').delete().eq('name', name);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add a song to a playlist
app.post('/api/myplaylists/:name/songs', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const song = (req.body || {}).song;
    if (!song || !song.id) throw new Error('song with id required');

    const { data: existing, error: fetchErr } = await supabase
      .from('music_user_playlists')
      .select('name, songs')
      .eq('name', name)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'not found' });

    const songs = JSON.parse(existing.songs || '[]');
    if (songs.some(function (s) { return String(s.id) === String(song.id); })) {
      return res.json({ ok: true, name: name, count: songs.length, duplicate: true });
    }
    songs.push(song);
    const { error: updErr } = await supabase
      .from('music_user_playlists')
      .update({ songs: JSON.stringify(songs), updated_at: new Date().toISOString() })
      .eq('name', name);
    if (updErr) throw updErr;
    res.json({ ok: true, name: name, count: songs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove a song from a playlist
app.delete('/api/myplaylists/:name/songs/:songId', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const songId = decodeURIComponent(req.params.songId);

    const { data: existing, error: fetchErr } = await supabase
      .from('music_user_playlists')
      .select('name, songs')
      .eq('name', name)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'not found' });

    const songs = JSON.parse(existing.songs || '[]');
    const filtered = songs.filter(function (s) { return String(s.id) !== String(songId); });
    const { error: updErr } = await supabase
      .from('music_user_playlists')
      .update({ songs: JSON.stringify(filtered), updated_at: new Date().toISOString() })
      .eq('name', name);
    if (updErr) throw updErr;
    res.json({ ok: true, name: name, count: filtered.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Replace a song's YouTube ID in a user playlist
app.patch('/api/myplaylists/:name/songs/:songId', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const songId = decodeURIComponent(req.params.songId);
    const youtubeId = String((req.body || {}).youtubeId || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) throw new Error('Invalid YouTube video ID');

    const { data: existing, error: fetchErr } = await supabase
      .from('music_user_playlists')
      .select('name, songs')
      .eq('name', name)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'not found' });

    const songs = JSON.parse(existing.songs || '[]');
    const song = songs.find(function (s) { return String(s.id) === String(songId); });
    if (!song) return res.status(404).json({ error: 'song not found' });
    song.youtubeId = youtubeId;
    song.youtubeTitle = (req.body || {}).youtubeTitle || song.youtubeTitle || '';

    const { error: updErr } = await supabase
      .from('music_user_playlists')
      .update({ songs: JSON.stringify(songs), updated_at: new Date().toISOString() })
      .eq('name', name);
    if (updErr) throw updErr;
    res.json({ ok: true, youtubeId: youtubeId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Resolve YouTube IDs for a user playlist ────────────────────────
app.post('/api/myplaylists/:name/resolve-youtube', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const { data, error: fetchErr } = await supabase
      .from('music_user_playlists')
      .select('songs')
      .eq('name', name)
      .single();
    if (fetchErr || !data) return res.status(404).json({ error: 'Playlist not found' });

    const songs = typeof data.songs === 'string' ? JSON.parse(data.songs) : data.songs;
    // If force=true, clear all existing youtubeIds
    if (req.body && req.body.force) {
      songs.forEach(function (s) { delete s.youtubeId; delete s.youtubeTitle; });
    }
    const need = songs.filter((s) => !s.youtubeId);
    if (!need.length) return res.json({ ok: true, resolved: 0, total: songs.length, remaining: 0 });

    // Resolve one batch of 5, save, return progress (keeps under Vercel 10s timeout)
    const BATCH = 5;
    const batch = need.slice(0, BATCH);
    await mapLimit(batch, 4, async (s) => {
      const hit = await searchYouTube(s);
      if (hit) {
        s.youtubeId = hit.videoId;
        s.youtubeTitle = hit.title;
      }
    });
    await supabase
      .from('music_user_playlists')
      .update({ songs: JSON.stringify(songs), updated_at: new Date().toISOString() })
      .eq('name', name);

    const remaining = songs.filter((s) => !s.youtubeId).length;
    const resolved = songs.length - remaining;
    res.json({ ok: true, resolved, total: songs.length, remaining });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Remove songs without YouTube ID from a user playlist ──────────
app.post('/api/myplaylists/:name/cleanup', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const { data, error: fetchErr } = await supabase
      .from('music_user_playlists')
      .select('songs')
      .eq('name', name)
      .single();
    if (fetchErr || !data) return res.status(404).json({ error: 'Playlist not found' });

    const songs = typeof data.songs === 'string' ? JSON.parse(data.songs) : data.songs;
    const before = songs.length;
    const cleaned = songs.filter((s) => s.youtubeId);

    const { error: updErr } = await supabase
      .from('music_user_playlists')
      .update({ songs: JSON.stringify(cleaned), updated_at: new Date().toISOString() })
      .eq('name', name);
    if (updErr) throw updErr;
    res.json({ ok: true, removed: before - cleaned.length, remaining: cleaned.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Parse Apple Music playlist/room URL → songs ────────────────────
app.post('/api/playlist/parse', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const isPlaylist = /pl\.[a-zA-Z0-9]+/.test(url);
    const isRoom = /\/room\/\d+/.test(url);
    const isAlbum = /\/album\/[^/]+\/\d+/.test(url);
    const isArtist = /\/artist\/[^/]+\/\d+/.test(url);
    if (!isPlaylist && !isRoom && !isAlbum && !isArtist) return res.status(400).json({ error: 'Invalid Apple Music URL (need playlist, room, album, or artist link)' });

    const pageUrl = url.startsWith('http') ? url : `https://music.apple.com${url}`;
    const pageRes = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (!pageRes.ok) return res.status(502).json({ error: 'Failed to fetch page' });
    const html = await pageRes.text();

    let trackIds = [];
    let playlistTitle = 'Imported Playlist';

    if (isPlaylist) {
      // Playlist: extract from <meta property="music:song"> tags
      const titleMatch = html.match(/<meta\s+name="apple:title"\s+content="([^"]+)"/);
      const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
      playlistTitle = (titleMatch && titleMatch[1]) || (ogTitleMatch && ogTitleMatch[1]) || 'Imported Playlist';
      const songMetaRe = /<meta\s+property="music:song"\s+content="[^"]*?\/(\d+)"/g;
      let m;
      while ((m = songMetaRe.exec(html)) !== null) { trackIds.push(m[1]); }
    } else if (isArtist) {
      // Artist: extract from <a href="...album...?i={songId}"> links
      const titleTag = html.match(/<title>\s*([^<]+?)\s*-\s*Apple\s*Music/i);
      playlistTitle = (titleTag && titleTag[1].trim()) || 'Imported Artist';
      const linkRe = /href="[^"]*\/album\/[^"]*\?i=(\d+)"/g;
      let m;
      while ((m = linkRe.exec(html)) !== null) {
        if (!trackIds.includes(m[1])) trackIds.push(m[1]);
      }
    } else {
      // Room: extract from <script id="serialized-server-data"> JSON
      const jsonMatch = html.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
      if (!jsonMatch) return res.status(404).json({ error: 'No data found in room page' });
      const pageData = JSON.parse(jsonMatch[1]);
      // Extract title from page title tag
      const titleTag = html.match(/<title>[^<]*?([^\-]+)\s*-\s*Apple\s*Music/i);
      playlistTitle = (titleTag && titleTag[1].trim()) || 'Imported Playlist';
      // Find all songs: look for storeAdamID in contentDescriptor
      const jsonStr = JSON.stringify(pageData);
      const idRe = /"contentDescriptor":\{"kind":"song","identifiers":\{"storeAdamID":"(\d+)"/g;
      let m;
      while ((m = idRe.exec(jsonStr)) !== null) {
        if (!trackIds.includes(m[1])) trackIds.push(m[1]);
      }
    }

    if (!trackIds.length) return res.status(404).json({ error: 'No tracks found' });

    // Fetch full track details from iTunes API (batch up to 200)
    const songs = [];
    for (let i = 0; i < trackIds.length; i += 200) {
      const batch = trackIds.slice(i, i + 200);
      const itunesUrl = `https://itunes.apple.com/lookup?id=${batch.join(',')}&entity=song&country=hk`;
      const itunesRes = await fetch(itunesUrl);
      const data = await itunesRes.json();
      if (data.results) {
        data.results.forEach((r) => {
          if (r.wrapperType === 'track') {
            songs.push({
              rank: songs.length + 1,
              id: String(r.trackId),
              name: r.trackName,
              artist: r.artistName,
              artistUrl: r.artistViewUrl || '',
              artwork: (r.artworkUrl100 || '').replace('100x100', '300x300'),
              releaseDate: r.releaseDate || '',
              genre: r.primaryGenreName || ''
            });
          }
        });
      }
    }

    res.json({ title: playlistTitle, songs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'index.html'));
});

let ensurePromise = null;
/** Scrape the default (hk) charts once at startup / first request. */
function ensureMusicTrend() {
  if (!ensurePromise) {
    ensurePromise = refreshMusicTrend('hk').catch((e) => {
      console.log('music trend initial refresh failed:', e.message);
      ensurePromise = null; // retry on the next call
    });
  }
  return ensurePromise;
}

module.exports = { app, refreshMusicTrend, readMusicTrend, ensureMusicTrend, COUNTRIES };