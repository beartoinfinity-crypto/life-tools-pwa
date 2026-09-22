/**
 * Resolve a song to a YouTube video id by scraping youtube.com search results.
 * No API key required. The results page embeds ytInitialData JSON; videoRenderer
 * blocks are the video hits. A CONSENT cookie keeps EU consent walls away.
 *
 * Search strategy (two-pass):
 *  1. Search "{name} {artist} official mv" → if a result exists, use it
 *  2. Fall back to plain "{name} {artist}" search
 */

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'SOCS=CAI; CONSENT=YES+cb'
      }
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location, timeout));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Extract ALL videoRenderer blocks from search results.
 * Returns [{ videoId, title, channel, duration }] sorted by appearance order.
 */
function extractVideos(html) {
  const results = [];
  const re = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const after = html.slice(m.index, m.index + 3000);
    let title = '';
    const t = after.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    if (t) { try { title = JSON.parse('"' + t[1] + '"'); } catch { title = t[1]; } }
    let channel = '';
    const c = after.match(/"longBylineText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    if (c) { try { channel = JSON.parse('"' + c[1] + '"'); } catch { channel = c[1]; } }
    let duration = 0;
    const d = after.match(/"lengthText":\{"accessibility":\{"accessibilityData":\{"label":"([^"]+)"\}\}/);
    if (d) { duration = parseDuration(d[1]); }
    results.push({ videoId: m[1], title, channel, duration });
  }
  return results;
}

/** Parse YouTube duration label like "3:45" or "1:23:45" or "3 分 45 秒" to seconds. */
function parseDuration(label) {
  if (!label) return 0;
  // Try HH:MM:SS or MM:SS
  const colons = label.match(/(\d+):(\d+)(?::(\d+))?/);
  if (colons) {
    if (colons[3]) return parseInt(colons[1]) * 3600 + parseInt(colons[2]) * 60 + parseInt(colons[3]);
    return parseInt(colons[1]) * 60 + parseInt(colons[2]);
  }
  // Try "X 分 Y 秒" or "X minutes Y seconds"
  let total = 0;
  const hm = label.match(/(\d+)\s*(?:分|minutes?|mins?)/i);
  if (hm) total += parseInt(hm[1]) * 60;
  const hs = label.match(/(\d+)\s*(?:秒|seconds?|secs?)/i);
  if (hs) total += parseInt(hs[1]);
  return total;
}

/** Extract the top videoRenderer {videoId,title} from a search results page. */
function extractFirstVideo(html) {
  const videos = extractVideos(html);
  return videos.length ? { videoId: videos[0].videoId, title: videos[0].title } : null;
}

/**
 * Pick the best "official MV" candidate from a list of videos.
 * Scoring:
 *   +20  title contains the song name
 *   +15  title or channel contains the artist name
 *   +10  title contains "official" and "mv" or "music video"
 *   +5   title contains "official"
 *   +5   channel name contains "vevo"
 *   +3   title contains "mv"
 *   -50  video too short (< 60s, likely a teaser/clip)
 * Returns the best match or null if nothing looks like a correct match.
 */
function pickOfficialMV(videos, songName, artistName) {
  if (!videos.length) return null;
  const lowerName = (songName || '').toLowerCase();
  const lowerArtist = (artistName || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const v of videos) {
    const t = v.title.toLowerCase();
    const ch = (v.channel || '').toLowerCase();
    let score = 0;
    if (lowerName && t.includes(lowerName)) score += 20;
    if (lowerArtist && (t.includes(lowerArtist) || ch.includes(lowerArtist))) score += 15;
    if (t.includes('official') && (t.includes('mv') || t.includes('music video'))) score += 10;
    else if (t.includes('official')) score += 5;
    if (ch.includes('vevo')) score += 5;
    if (t.includes(' mv')) score += 3;
    if (v.duration > 0 && v.duration < 60) score -= 50;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return bestScore >= 20 ? best : null;
}

/**
 * Find the YouTube video id for a song. Returns { videoId, title } or null.
 * Two-pass search: first tries "official mv", then falls back to plain search.
 */
async function searchYouTube(song) {
  const plain = `${song.name} ${song.artist}`;
  const official = `${plain} official mv`;

  // Pass 1: search for official MV
  try {
    const { status, body } = await get(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(official)}`,
      10000
    );
    if (status === 200) {
      const videos = extractVideos(body);
      const best = pickOfficialMV(videos, song.name, song.artist);
      if (best) return { videoId: best.videoId, title: best.title };
    }
  } catch { /* fall through */ }

  // Pass 2: plain search — prefer results containing song name + artist, skip short videos
  try {
    const { status, body } = await get(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(plain)}`,
      10000
    );
    if (status !== 200) return null;
    const videos = extractVideos(body);
    if (!videos.length) return null;
    const lowerName = song.name.toLowerCase();
    const lowerArtist = (song.artist || '').toLowerCase();
    // Prefer: song name + artist + long, then song name + long, then any long, then first
    const both = videos.filter((v) => v.duration >= 60 && v.title.toLowerCase().includes(lowerName) && (v.title.toLowerCase().includes(lowerArtist) || v.channel.toLowerCase().includes(lowerArtist)));
    const nameMatch = videos.filter((v) => v.duration >= 60 && v.title.toLowerCase().includes(lowerName));
    const anyLong = videos.filter((v) => v.duration >= 60);
    const best = both[0] || nameMatch[0] || anyLong[0] || videos[0];
    return { videoId: best.videoId, title: best.title };
  } catch {
    return null;
  }
}

/** Run tasks with bounded concurrency, keeping order. Failed items yield undefined. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = undefined;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Classify a YouTube oEmbed HTTP status for an already-known video id.
 *  200        → alive
 *  400/404    → deleted / never existed (safe to drop)
 *  401        → private or embedding disabled (unplayable in the IFrame API)
 *  anything else (403, 429, 5xx, …) → unknown; do NOT clear the id
 */
function classifyOembedStatus(status) {
  if (status === 200) return 'ok';
  if (status === 400 || status === 404 || status === 401) return 'dead';
  return 'unknown';
}

/**
 * Should this song's cached youtubeId be re-checked?
 * Missing id → no (the resolve path owns filling those).
 * Never checked, unparsable timestamp, or older than maxAgeMs → yes.
 */
function needsYtRevalidate(song, now = Date.now(), maxAgeMs = 0) {
  if (!song || !song.youtubeId) return false;
  if (maxAgeMs <= 0) return true;
  if (!song.youtubeCheckedAt) return true;
  const t = Date.parse(song.youtubeCheckedAt);
  if (!Number.isFinite(t)) return true;
  return now - t > maxAgeMs;
}

/**
 * Ask YouTube's oEmbed endpoint whether a video id is still embeddable.
 * Returns { ok: true, title?, author? }, { ok: false } (definitively dead),
 * or { ok: null } (network / rate-limit / 5xx — leave the id alone).
 * Never rejects.
 */
async function validateYouTubeId(videoId, timeout = 8000) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) return { ok: false };
  const url =
    'https://www.youtube.com/oembed?format=json&url=' +
    encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
  try {
    const { status, body } = await get(url, timeout);
    const kind = classifyOembedStatus(status);
    if (kind === 'ok') {
      try {
        const j = JSON.parse(body);
        return { ok: true, title: j.title || '', author: j.author_name || '' };
      } catch {
        return { ok: true };
      }
    }
    if (kind === 'dead') return { ok: false };
    return { ok: null };
  } catch {
    return { ok: null };
  }
}

const YT_VALIDATE_CONCURRENCY = 4;

/**
 * Re-check a rolling window of already-cached youtubeIds via oEmbed.
 * Dead ids (deleted / private / embedding-disabled) are re-searched once;
 * a failed re-search clears the id so the next resolve pass can fill it.
 * Transient oEmbed errors leave the id untouched and do not stamp checkedAt.
 * Never rejects. Returns { candidates, checked, fixed, cleared }.
 *
 * opts: { limit, maxAgeMs, deadlineMs, now, check, search }
 *   maxAgeMs 0 = always eligible; check/search are injectable for tests.
 */
async function validateYouTubeIds(songs, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 15;
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : 7 * 24 * 60 * 60 * 1000;
  const deadlineMs = Number.isFinite(opts.deadlineMs) ? opts.deadlineMs : 40 * 1000;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const check = typeof opts.check === 'function' ? opts.check : validateYouTubeId;
  const search = typeof opts.search === 'function' ? opts.search : searchYouTube;

  const candidates = songs.filter((s) => needsYtRevalidate(s, now, maxAgeMs));
  if (!candidates.length) return { candidates: 0, checked: 0, fixed: 0, cleared: 0 };

  // Never-checked first, then oldest checkedAt — so the sweep is fair.
  candidates.sort((a, b) => {
    const t = (s) => (s.youtubeCheckedAt ? Date.parse(s.youtubeCheckedAt) || 0 : 0);
    const at = t(a) - t(b);
    if (at !== 0) return at;
    return String(a.id).localeCompare(String(b.id));
  });
  const batch = candidates.slice(0, limit);

  const deadline = Date.now() + deadlineMs;
  let checked = 0;
  let fixed = 0;
  let cleared = 0;
  await mapLimit(batch, YT_VALIDATE_CONCURRENCY, async (s) => {
    if (Date.now() > deadline) return;
    const v = await check(s.youtubeId);
    if (!v || v.ok === null) return; // unknown — retry next run, don't stamp
    s.youtubeCheckedAt = new Date().toISOString();
    checked++;
    if (v.ok) return;
    delete s.youtubeId;
    delete s.youtubeTitle;
    const hit = await search(s);
    if (hit) {
      s.youtubeId = hit.videoId;
      s.youtubeTitle = hit.title;
      fixed++;
    } else {
      cleared++; // left without an id; resolveYouTube fills it next refresh
    }
  });
  return { candidates: candidates.length, checked, fixed, cleared };
}

module.exports = {
  searchYouTube,
  mapLimit,
  extractFirstVideo,
  extractVideos,
  pickOfficialMV,
  validateYouTubeId,
  classifyOembedStatus,
  needsYtRevalidate,
  validateYouTubeIds
};