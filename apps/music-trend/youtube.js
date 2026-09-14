/**
 * Resolve a song to a YouTube video id by scraping youtube.com search results.
 * No API key required. The results page embeds ytInitialData JSON; the first
 * videoRenderer block is the top hit. A CONSENT cookie keeps EU consent walls
 * out of the way.
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

/** Extract the top videoRenderer {videoId,title} from a search results page. */
function extractFirstVideo(html) {
  const m = html.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/);
  if (!m) return null;
  const after = html.slice(m.index, m.index + 2000);
  const t = after.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
  let title = '';
  if (t) { try { title = JSON.parse('"' + t[1] + '"'); } catch { title = t[1]; } }
  return { videoId: m[1], title };
}

/**
 * Find the YouTube video id for a song. Returns { videoId, title } or null.
 * Optional known filter narrows the query to official/lyrical uploads.
 */
async function searchYouTube(song) {
  const q = `${song.name} ${song.artist}`;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  try {
    const { status, body } = await get(url, 10000);
    if (status !== 200) return null;
    return extractFirstVideo(body);
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

module.exports = { searchYouTube, mapLimit, extractFirstVideo };