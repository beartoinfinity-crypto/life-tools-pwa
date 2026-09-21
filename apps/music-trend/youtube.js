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
 *   +10  title contains "official" and "mv" or "music video"
 *   +5   title contains "official"
 *   +5   channel name contains "vevo"
 *   +3   title contains "mv"
 *   -50  video too short (< 60s, likely a teaser/clip)
 * Returns the best match or null if nothing looks like a correct match.
 */
function pickOfficialMV(videos, songName) {
  if (!videos.length) return null;
  const lowerName = (songName || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const v of videos) {
    const t = v.title.toLowerCase();
    const ch = (v.channel || '').toLowerCase();
    let score = 0;
    if (lowerName && t.includes(lowerName)) score += 20;
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
      const best = pickOfficialMV(videos, song.name);
      if (best) return { videoId: best.videoId, title: best.title };
    }
  } catch { /* fall through */ }

  // Pass 2: plain search — prefer results containing the song name, skip short videos
  try {
    const { status, body } = await get(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(plain)}`,
      10000
    );
    if (status !== 200) return null;
    const videos = extractVideos(body);
    if (!videos.length) return null;
    // Prefer videos with song name in title, duration >= 60s
    const lowerName = song.name.toLowerCase();
    const good = videos.filter((v) => v.duration >= 60 && v.title.toLowerCase().includes(lowerName));
    const anyLong = videos.filter((v) => v.duration >= 60);
    const best = good[0] || anyLong[0] || videos[0];
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

module.exports = { searchYouTube, mapLimit, extractFirstVideo, extractVideos, pickOfficialMV };