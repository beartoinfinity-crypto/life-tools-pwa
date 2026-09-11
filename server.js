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
  await ensureInitialData();

  // Traffic news: scrape now, then refresh every minute
  refreshTrafficNews().catch((e) => console.log('traffic news refresh failed:', e.message));
  const timer = setInterval(() => {
    refreshTrafficNews().catch((e) => console.log('traffic news refresh failed:', e.message));
  }, 60 * 1000);
  timer.unref && timer.unref();
});