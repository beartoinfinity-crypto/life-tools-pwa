/**
 * YouTube URL resolver — extracts video ids, titles, durations and
 * playlist entries by scraping YouTube pages (no API key required).
 *
 * The pages embed `ytInitialPlayerResponse` (single video) and
 * `ytInitialData` (playlist contents) as inline JSON.
 */

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url, timeout = 20000) {
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

/** Parse a YouTube URL into { videoId, playlistId } (either may be null). */
function parseYouTubeUrl(raw) {
  const url = String(raw || '').trim();
  const out = { videoId: null, playlistId: null };

  // youtu.be/VIDEO_ID
  let m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) out.videoId = m[1];

  // youtube.com/watch?v=VIDEO_ID
  if (!out.videoId) {
    m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) out.videoId = m[1];
  }

  // youtube.com/playlist?list=PLAYLIST_ID
  m = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) out.playlistId = m[1];

  // youtube.com/embed/VIDEO_ID
  if (!out.videoId) {
    m = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
    if (m) out.videoId = m[1];
  }

  // youtube.com/shorts/VIDEO_ID
  if (!out.videoId) {
    m = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
    if (m) out.videoId = m[1];
  }

  return out;
}

/** Extract the first balanced JSON object starting at the marker. */
function extractJSON(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) return null;
  try { return JSON.parse(html.slice(start + marker.length, i)); } catch { return null; }
}

/** "PT1H2M3S" -> "1:02:03"; "PT2M3S" -> "2:03" */
function fmtDuration(iso) {
  if (!iso) return '';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = parseInt(m[1] || 0, 10);
  const min = parseInt(m[2] || 0, 10);
  const s = parseInt(m[3] || 0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

/** Raw seconds (number or string) -> "h:mm:ss" or "m:ss" */
function fmtSeconds(sec) {
  const total = parseInt(sec, 10);
  if (isNaN(total)) return '';
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

/** Fetch a single video's metadata from its watch page. */
async function resolveVideo(videoId) {
  const { status, body } = await get(`https://www.youtube.com/watch?v=${videoId}`);
  if (status !== 200) throw new Error(`YouTube returned ${status}`);
  // The watch page embeds: var ytInitialPlayerResponse = {...};
  const player = extractJSON(body, 'var ytInitialPlayerResponse = ')
    || extractJSON(body, '"ytInitialPlayerResponse":');
  if (!player) throw new Error('could not parse player response');

  const details = (player.videoDetails && player.videoDetails) || {};
  return {
    id: videoId,
    title: details.title || '',
    duration: fmtSeconds(details.lengthSeconds),
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    channel: details.author || ''
  };
}

/** Fetch all videos in a playlist from its page. */
async function resolvePlaylist(playlistId) {
  const { status, body } = await get(`https://www.youtube.com/playlist?list=${playlistId}`);
  if (status !== 200) throw new Error(`YouTube returned ${status}`);
  const data = extractJSON(body, 'var ytInitialData = ')
    || extractJSON(body, '"ytInitialData":');
  if (!data) throw new Error('could not parse playlist data');

  const items = [];
  const seen = new Set();

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.playlistVideoRenderer && node.playlistVideoRenderer.videoId) {
      const v = node.playlistVideoRenderer;
      const id = v.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title = (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text) || '';
        const dur = fmtSeconds(v.lengthSeconds);
        items.push({
          id,
          title,
          duration: dur,
          thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          channel: ''
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (node[key] && typeof node[key] === 'object') walk(node[key]);
    }
  }
  walk(data);

  return items;
}

/** Main entry: resolve any YouTube URL into an array of video metadata. */
async function resolveUrl(url) {
  const parsed = parseYouTubeUrl(url);
  if (!parsed.videoId && !parsed.playlistId) {
    throw new Error('not a valid YouTube URL');
  }
  const videos = [];
  if (parsed.playlistId) {
    videos.push(...await resolvePlaylist(parsed.playlistId));
  }
  if (parsed.videoId && !videos.some((v) => v.id === parsed.videoId)) {
    videos.unshift(await resolveVideo(parsed.videoId));
  }
  return videos;
}

module.exports = { resolveUrl, resolveVideo, resolvePlaylist, parseYouTubeUrl, get };
