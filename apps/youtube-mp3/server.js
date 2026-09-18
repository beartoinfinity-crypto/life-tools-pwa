const express = require('express');
const { spawn } = require('child_process');
const { resolveUrl, get } = require('./youtube');

const app = express();
app.use(express.json());

// Static PWA (mounted at /youtube-mp3/ by the hub)
app.use(express.static(require('path').join(__dirname)));

/** Whether yt-dlp is available, and which command to use (checked once, lazily). */
let ytdlpInfo = null;
function detectYtDlp() {
  if (ytdlpInfo !== null) return Promise.resolve(ytdlpInfo);
  // Try in order: "yt-dlp" on PATH, "python3 -m yt_dlp" (pip user install)
  const tries = [
    { cmd: 'yt-dlp', args: ['--version'] },
    { cmd: 'python3', args: ['-m', 'yt_dlp', '--version'] },
    { cmd: 'python', args: ['-m', 'yt_dlp', '--version'] },
  ];
  return new Promise((resolve) => {
    let i = 0;
    function next() {
      if (i >= tries.length) { ytdlpInfo = null; return resolve(null); }
      const t = tries[i++];
      const child = spawn(t.cmd, t.args, { stdio: 'ignore' });
      child.on('error', () => next());
      child.on('exit', (code) => {
        if (code === 0) { ytdlpInfo = t; return resolve(t); }
        next();
      });
    }
    next();
  });
}

/** Locate ffmpeg: on PATH, or bundled inside Python's imageio_ffmpeg. */
let ffmpegPath = undefined;
function detectFfmpeg() {
  if (ffmpegPath !== undefined) return Promise.resolve(ffmpegPath);
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    child.on('error', () => {
      // Not on PATH — try Python's imageio_ffmpeg bundled binary
      const py = spawn('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      py.stdout.on('data', (d) => { out += d; });
      py.on('exit', () => {
        const p = out.trim();
        ffmpegPath = p || null;
        resolve(ffmpegPath);
      });
      py.on('error', () => { ffmpegPath = null; resolve(null); });
    });
    child.on('exit', (code) => {
      ffmpegPath = code === 0 ? null : null; // null = already on PATH, no --ffmpeg-location needed
      resolve(ffmpegPath);
    });
  });
}

/** Find the best audio stream URL from the player response (fallback path). */
async function bestAudioUrl(videoId) {
  const { status, body } = await get(`https://www.youtube.com/watch?v=${videoId}`);
  if (status !== 200) throw new Error(`YouTube returned ${status}`);
  const marker = 'var ytInitialPlayerResponse = ';
  const start = body.indexOf(marker);
  if (start === -1) throw new Error('no player response');
  let depth = 0, end = -1;
  for (let i = start + marker.length; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error('malformed player response');
  const player = JSON.parse(body.slice(start + marker.length, end));
  const formats = (player.streamingData && (player.streamingData.adaptiveFormats || player.streamingData.formats)) || [];
  const audio = formats
    .filter((f) => f.mimeType && /audio\//.test(f.mimeType))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (!audio.length) throw new Error('no audio formats');
  return audio[0].url;
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

// Download a single video as best-quality MP3.
app.get('/api/download', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const title = String(req.query.title || 'audio');
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return res.status(400).json({ error: 'invalid video id' });

    const safeTitle = title.replace(/[^\w\u4e00-\u9fff\u3040-\u30ff()-]+/g, '_').slice(0, 80);
    const filename = encodeURIComponent(safeTitle + '.mp3');

    const yt = await detectYtDlp();

    if (yt) {
      // Stream true MP3 (best quality) via yt-dlp + ffmpeg.
      const args = yt.args.slice(0, -1).concat([ // drop '--version'
        '-f', 'bestaudio/best',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--no-warnings',
        '--no-playlist',
      ]);
      // If ffmpeg isn't on PATH but imageio_ffmpeg has one, point yt-dlp at it
      const ff = await detectFfmpeg();
      if (ff) args.push('--ffmpeg-location', ff);
      args.push('-o', '-', `https://www.youtube.com/watch?v=${id}`);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      const child = spawn(yt.cmd, args);
      child.stdout.pipe(res);
      child.stderr.on('data', () => {});
      child.on('error', () => {
        if (!res.headersSent) res.status(500).json({ error: 'yt-dlp failed to start' });
      });
      child.on('exit', (code) => {
        if (code !== 0 && !res.headersSent) {
          res.status(500).json({ error: 'yt-dlp exited with code ' + code });
        }
      });
      req.on('close', () => { child.kill(); });
    } else {
      // Fallback: redirect to the best audio stream YouTube serves directly
      // (WebM/Opus or MP4/AAC — not MP3, but highest available audio quality).
      const audioUrl = await bestAudioUrl(id);
      res.redirect(302, audioUrl);
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'index.html'));
});

module.exports = { app, detectYtDlp };
