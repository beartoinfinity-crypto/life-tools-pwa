import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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