import { cpSync, rmSync, mkdirSync, existsSync, chmodSync, createWriteStream, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'vercel-out');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copyEntry = (src, ...dest) => cpSync(join(root, src), join(out, ...dest), { recursive: true });

// Dashboard at /
copyEntry('public', '');

// Static sub-apps mounted at their hub paths
copyEntry('apps/hk-bus-eta/build', 'bus-eta-lite');
copyEntry('apps/hk-bus-eta/build-upstream', 'bus-eta');

// Mark Six static assets only (its API is served by the Express function)
for (const f of ['index.html', 'app.js', 'styles.css', 'manifest.json', 'sw.js', 'icons']) {
  copyEntry(`apps/mark-six/${f}`, 'mark-six', f);
}

// Traffic news static assets only (its API is served by the Express function)
for (const f of ['index.html', 'app.js', 'styles.css', 'manifest.json', 'sw.js', 'icons']) {
  copyEntry(`apps/traffic-news/${f}`, 'traffic-news', f);
}

// Music trend static assets only (its API is served by the Express function)
for (const f of ['index.html', 'app.js', 'styles.css', 'manifest.json', 'sw.js', 'icons']) {
  copyEntry(`apps/music-trend/${f}`, 'music-trend', f);
}

// YouTube MP3 static assets only (its API is served by the Express function)
for (const f of ['index.html', 'app.js', 'styles.css', 'manifest.json', 'sw.js', 'icons']) {
  copyEntry(`apps/youtube-mp3/${f}`, 'youtube-mp3', f);
}

console.log('vercel-out assembled');

// youtube-dl-exec downloads the yt-dlp *Python script* on Linux, but Vercel
// serverless has no python3. Fetch the standalone single-file binary instead
// and overwrite the script so it runs without a Python interpreter.
await ensureYtDlpStandalone();
console.log('yt-dlp standalone binary ready');

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureYtDlpStandalone() {
  const binPath = join(root, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp');
  try {
    // Check if the existing file is a Python script (starts with #!)
    const content = readFileSync(binPath, 'utf8');
    if (content.startsWith('#!')) {
      console.log('yt-dlp is a Python script, replacing with standalone binary...');
    } else {
      console.log('yt-dlp already a standalone binary, skipping');
      return;
    }
  } catch {
    console.log('yt-dlp binary not found, downloading standalone...');
  }

  // Get the latest release URL from GitHub API
  const apiUrl = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
  const body = await new Promise((resolve, reject) => {
    https.get(apiUrl, { headers: { 'User-Agent': 'node', Accept: 'application/vnd.github+json' } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
  const release = JSON.parse(body);
  const asset = (release.assets || []).find((a) => a.name === 'yt-dlp_linux');
  if (!asset) throw new Error('yt-dlp_linux asset not found in latest release');
  console.log('downloading', asset.browser_download_url);
  await download(asset.browser_download_url, binPath);
  chmodSync(binPath, 0o755);
  console.log('standalone yt-dlp installed:', binPath);
}