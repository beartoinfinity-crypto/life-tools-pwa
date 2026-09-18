const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { resolveUrl } = require('./youtube');

const app = express();
app.use(express.json());

// Static PWA (mounted at /youtube-mp3/ by the hub)
app.use(express.static(path.join(__dirname)));

// --- runtime yt-dlp standalone binary management ---
// Vercel serverless has no python3, so the yt-dlp Python script that
// youtube-dl-exec downloads won't run. Instead we download the standalone
// single-file binary into the OS temp dir at first use and cache it.
// On Linux we get yt-dlp_linux (ELF, no interpreter needed);
// on Windows we get yt-dlp.exe for local dev.
const YTDLP_DIR = path.join(os.tmpdir(), 'ytdlp-bin');
const IS_WIN = process.platform === 'win32';
const YTDLP_FILE = IS_WIN ? 'yt-dlp.exe' : 'yt-dlp';
const YTDLP_PATH = path.join(YTDLP_DIR, YTDLP_FILE);
const YTDLP_URL = IS_WIN
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

let ffmpegCached = null;
function getFfmpeg() {
  if (ffmpegCached === null) {
    try { ffmpegCached = require('ffmpeg-static'); } catch { ffmpegCached = false; }
  }
  return ffmpegCached || null;
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('download timeout')); });
  });
}

let ytdlpPromise = null;
async function ensureYtdlp() {
  // Already downloaded and executable
  if (fs.existsSync(YTDLP_PATH)) return YTDLP_PATH;
  if (ytdlpPromise) return ytdlpPromise;

  ytdlpPromise = (async () => {
    try {
      if (!fs.existsSync(YTDLP_DIR)) fs.mkdirSync(YTDLP_DIR, { recursive: true });
      console.log('downloading standalone yt-dlp to', YTDLP_PATH);
      await download(YTDLP_URL, YTDLP_PATH);
      fs.chmodSync(YTDLP_PATH, 0o755);
      // Verify it's a real binary (ELF on Linux, MZ/PE on Windows)
      const buf = fs.readFileSync(YTDLP_PATH);
      const magic = buf.slice(0, 4).toString('hex');
      const isValid = magic === '7f454c46' || buf.slice(0, 2).toString() === 'MZ';
      if (!isValid) {
        fs.unlinkSync(YTDLP_PATH);
        throw new Error('downloaded file is not a binary');
      }
      // Log version so we can confirm which binary is running on Vercel
      const version = await new Promise((r) => {
        const c = spawn(YTDLP_PATH, ['--version']);
        let v = '';
        c.stdout.on('data', (d) => { v += d; });
        c.on('exit', () => r(v.trim()));
        c.on('error', () => r('unknown'));
      });
      console.log('yt-dlp standalone ready, version:', version);
      return YTDLP_PATH;
    } catch (e) {
      ytdlpPromise = null; // allow retry
      throw e;
    }
  })();
  return ytdlpPromise;
}

// --- status ---
app.get('/api/status', async (req, res) => {
  try {
    const ff = getFfmpeg();
    let ytdlpOk = false;
    try {
      const ytdlpPath = await ensureYtdlp();
      ytdlpOk = !!ytdlpPath;
    } catch {}
    res.json({ ytdlp: ytdlpOk, ffmpeg: !!ff });
  } catch {
    res.json({ ytdlp: false, ffmpeg: false });
  }
});

// --- resolve ---
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

// --- download MP3 ---
app.get('/api/download', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const title = String(req.query.title || 'audio');
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return res.status(400).json({ error: 'invalid video id' });

    const ffPath = getFfmpeg();
    if (!ffPath) return res.status(503).json({ error: 'ffmpeg not available' });

    const ytdlpPath = await ensureYtdlp();
    if (!ytdlpPath) return res.status(503).json({ error: 'yt-dlp not available' });

    // Log the yt-dlp version for debugging
    const ytdlpVersion = await new Promise((r) => {
      const c = spawn(ytdlpPath, ['--version']);
      let v = '';
      c.stdout.on('data', (d) => { v += d; });
      c.on('exit', () => r(v.trim()));
      c.on('error', () => r('unknown'));
    });

    const safeTitle = title.replace(/[^\w\u4e00-\u9fff\u3040-\u30ff()-]+/g, '_').slice(0, 80);
    const filename = encodeURIComponent(safeTitle + '.mp3');

    // Write a Netscape cookie file so yt-dlp sends consent cookies properly.
    const cookieFile = path.join(os.tmpdir(), 'yt-cookies.txt');
    if (!fs.existsSync(cookieFile)) {
      fs.writeFileSync(cookieFile, [
        '# Netscape HTTP Cookie File',
        '.youtube.com\tTRUE\t/\tTRUE\t0\tSOCS\tCAISFQgDEitub3RpZmljYXRpb24',
        '.youtube.com\tTRUE\t/\tTRUE\t0\tCONSENT\tYES+cb',
        '.youtube.com\tTRUE\t/\tFALSE\t0\tGPS\t1',
        '.youtube.com\tTRUE\t/\tFALSE\t0\tVISITOR_INFO1_LIVE\tKmomx7SmHKs',
      ].join('\n'));
    }

    // YouTube bot-detects Vercel datacenter IPs. Strategy:
    // 1. Skip webpage download (most likely to trigger consent wall)
    // 2. Try android player client via innertube API directly
    // 3. Use --impersonate for TLS fingerprint + cookies for consent
    const clients = [
      'youtube:player_client=android,player_skip=webpage,configs',
      'youtube:player_client=android,player_skip=webpage',
      'youtube:player_client=android',
    ];
    let info = null;
    let lastErr = '';
    for (const clientArg of clients) {
      try {
        info = await new Promise((resolve, reject) => {
          let out = '';
          let err = '';
          const child = spawn(ytdlpPath, [
            '--dump-single-json', '--no-warnings',
            '--no-check-certificate', '--prefer-free-formats',
            '--extractor-args', clientArg,
            '--cookies', cookieFile,
            '--impersonate', 'Chrome-136:Macos-15',
            `https://www.youtube.com/watch?v=${id}`,
          ]);
          child.stdout.on('data', (c) => { out += c; });
          child.stderr.on('data', (c) => { err += c; });
          child.on('error', reject);
          child.on('exit', (code) => {
            if (code !== 0) return reject(new Error(err.slice(-200)));
            try { resolve(JSON.parse(out)); } catch { reject(new Error('bad output')); }
          });
        });
        break; // success
      } catch (e) {
        lastErr = e.message;
      }
    }
    if (!info) throw new Error('yt-dlp v' + ytdlpVersion + ' failed all clients: ' + lastErr.slice(-200));

    const allFormats = info.formats || [];
    // Audio-only formats from the android client come as 'sb0'..'sb3' with
    // acodec='none' (storyboard thumbnails) plus one muxed '18'. Fall back to
    // any format that has a real audio codec.
    const audio = allFormats
      .filter((f) => {
        const ac = String(f.acodec || '');
        const vc = String(f.vcodec || '');
        // Primary: audio-only (acodec set, no video)
        if (ac && ac !== 'none' && (!vc || vc === 'none')) return true;
        // Fallback: muxed with audio (e.g. itag 18)
        if (ac && ac !== 'none') return true;
        return false;
      })
      .sort((a, b) => {
        // Prefer audio-only (no video) then highest bitrate
        const aAudioOnly = (!a.vcodec || a.vcodec === 'none') ? 1 : 0;
        const bAudioOnly = (!b.vcodec || b.vcodec === 'none') ? 1 : 0;
        if (aAudioOnly !== bAudioOnly) return bAudioOnly - aAudioOnly;
        return (b.abr || b.audioBitrate || 0) - (a.abr || a.audioBitrate || 0);
      });
    if (!audio.length) return res.status(500).json({ error: 'no audio formats found' });
    const best = audio[0];

    // Step 2: transcode to 320kbps MP3 via ffmpeg, stream to client
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);

    const ff = spawn(ffPath, [
      '-i', best.url,
      '-f', 'mp3',
      '-ab', '320k',
      '-map', 'a',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1',
    ]);
    ff.stdout.pipe(res);
    ff.stderr.on('data', () => {});
    ff.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'ffmpeg failed' });
    });
    ff.on('exit', (code) => {
      if (code !== 0 && !res.headersSent) res.status(500).json({ error: 'ffmpeg exit ' + code });
    });
    req.on('close', () => { try { ff.kill(); } catch {} });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

module.exports = { app };
