require('dotenv').config();
const app = require('./app');
const { ensureInitialData } = require('./apps/mark-six/server');

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Life Tool server running at http://localhost:${PORT}`);
  console.log('  Dashboard:  /');
  console.log('  Mark Six:     /mark-six/');
  console.log('  HK Bus ETA:   /bus-eta/      (upstream)');
  console.log('  HK Bus Lite:  /bus-eta-lite/');
  await ensureInitialData();
});