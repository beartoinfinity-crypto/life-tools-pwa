require('dotenv').config();
const app = require('./app');
const { ensureInitialData } = require('./apps/mark-six/server');
const { refreshTrafficNews } = require('./apps/traffic-news/server');

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Life Tool server running at http://localhost:${PORT}`);
  console.log('  Dashboard:  /');
  console.log('  Mark Six:     /mark-six/');
  console.log('  HK Bus ETA:   /bus-eta/      (upstream)');
  console.log('  HK Bus Lite:  /bus-eta-lite/');
  console.log('  Traffic News: /traffic-news/api/news');
  console.log('  Music Trend:  /music-trend/api/playlists');
  console.log('  YouTube MP3:  /youtube-mp3/');
  await ensureInitialData();

  // Traffic news: scrape now, then refresh every minute
  refreshTrafficNews().catch((e) => console.log('traffic news refresh failed:', e.message));
  const timer = setInterval(() => {
    refreshTrafficNews().catch((e) => console.log('traffic news refresh failed:', e.message));
  }, 60 * 1000);
  timer.unref && timer.unref();

  // Music trend: scrape all countries at boot, then hourly round-robin
  // (one country per 6-minute tick so bursts stay small)
  const { refreshMusicTrend, COUNTRIES } = require('./apps/music-trend/server');
  const ccs = Object.keys(COUNTRIES);
  const refreshCc = (cc) => refreshMusicTrend(cc).catch((e) => console.log(`music trend ${cc} refresh failed:`, e.message));
  (async () => {
    for (const cc of ccs) await refreshCc(cc);
  })();
  let rr = 0;
  const mtTimer = setInterval(() => {
    refreshCc(ccs[rr % ccs.length]);
    rr++;
  }, 6 * 60 * 1000);
  mtTimer.unref && mtTimer.unref();
});