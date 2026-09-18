const express = require('express');
const { spawn } = require('child_process');
const { resolveUrl, get } = require('./youtube');

const app = express();
app.use(express.json());

// Static PWA (mounted at /youtube-mp3/ by the hub)
app.use(express.static(require('path').join(__dirname)));

// yt-dlp binary bundled in the youtube-dl-exec npm package (works on Vercel)
let youtubedl = null;
function getYoutubedl() {
  if (youtubedl === null) {
    try { youtubedl = require('youtube-dl-exec'); } catch { youtubedl = false; }
  }
  return youtubedl || null;
}

// ffmpeg binary bundled in the ffmpeg-static npm package (works on Vercel)
let ffmpegPath = null;
function getFfmpeg() {
  if (ffmpegPath === null) {
    try { ffmpegPath = require('ffmpeg-static'); } catch { ffmpegPath = false; }
  }
  return ffmpegPath || null;
}

const YTDL_OPTS = {
  dumpSingleJson: true,
  noWarnings: true,
  noCallHome: true,
  noCheckCertificate: true,
  preferFreeFormats: true,
  youtubeSkipDashManifest: true,
  referer: 'https://youtube.com',
  addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0'],
};

/** Resolve the best audio-only format URL for a video. */
async function bestAudio(videoId) {
  const ydl = getYoutubedl();
  if (!ydl) throw new Error('yt-dlp not available');
  const info = await ydl(`https://www.youtube.com/watch?v=${videoId}`, YTDL_OPTS);
  const audio = (info.formats || [])
    .filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
    .sort((a, b) => (b.abr || 0) - (a.abr || 0));
  if (!audio.length) throw new Error('no audio formats found');
  return audio[0];
}

// Resolve a YouTube URL / playlist URL into video metadata.
app.post('/api/resolve', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !String(url).trim()) return res.status(400).json({ error: 'url required' });
    const videos = await resolveUrl(String(url).trim());
    if (!videos.length) return res.status(404).json({ error: 'no videos found' });
    res.json({ data: videos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Status: reports whether MP3 conversion is available
app.get('/api/status', async (req, res) => {
  try {
    const ydl = getYoutubedl();
    const ff = getFfmpeg();
    res.json({ ytdlp: !!ydl, ffmpeg: !!ff });
  } catch {
    res.json({ ytdlp: false, ffmpeg: false });
  }
});

// Download a single video as best-quality MP3.
// Uses youtube-dl-exec (bundled yt-dlp) to resolve the audio URL,
// then ffmpeg-static to transcode to 320kbps MP3, streamed to client.
app.get('/api/download', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const title = String(req.query.title || 'audio');
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return res.status(400).json({ error: 'invalid video id' });

    const ydl = getYoutubedl();
    const ffPath = getFfmpeg();
    if (!ydl || !ffPath) return res.status(503).json({ error: 'MP3 conversion unavailable (yt-dlp or ffmpeg missing)' });

    const safeTitle = title.replace(/[^\w\u4e00-\u9fff\u3040-\u30ff()-]+/g, '_').slice(0, 80);
    const filename = encodeURIComponent(safeTitle + '.mp3');

    const fmt = await bestAudio(id);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);

    const ff = spawn(ffPath, [
      '-i', fmt.url,
      '-f', 'mp3',
      '-ab', '320k',
      '-map', 'a',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1',
    ]);

    ff.stdout.pipe(res);
    ff.stderr.on('data', () => {});
    ff.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'ffmpeg failed to start' });
    });
    ff.on('exit', (code) => {
      if (code !== 0 && !res.headersSent) res.status(500).json({ error: 'ffmpeg exited with code ' + code });
    });
    req.on('close', () => { try { ff.kill(); } catch {} });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'index.html'));
});

module.exports = { app };
