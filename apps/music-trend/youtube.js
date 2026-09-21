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
 * Returns [{ videoId, title, channel }] sorted by appearance order.
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
    results.push({ videoId: m[1], title, channel });
  }
  return results;
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
    // Song name match is the most important signal
    if (lowerName && t.includes(lowerName)) score += 20;
    if (t.includes('official') && (t.includes('mv') || t.includes('music video'))) score += 10;
    else if (t.includes('official')) score += 5;
    if (ch.includes('vevo')) score += 5;
    if (t.includes(' mv')) score += 3;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  // Require at least the song name to match (score >= 20)
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

  // Pass 2: plain search — prefer results containing the song name
  try {
    const { status, body } = await get(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(plain)}`,
      10000
    );
    if (status !== 200) return null;
    const videos = extractVideos(body);
    if (!videos.length) return null;
    // Prefer a video whose title contains the song name
    const lowerName = song.name.toLowerCase();
    const nameMatch = videos.find((v) => v.title.toLowerCase().includes(lowerName));
    const best = nameMatch || videos[0];
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