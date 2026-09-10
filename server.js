require('dotenv').config();
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Dashboard (served at the root)
app.use(express.static(path.join(__dirname, 'public')));

// Redirect /mark-six -> /mark-six/ so relative paths in the app resolve correctly
app.use('/mark-six', (req, res, next) => {
  const p = req.originalUrl.split('?')[0];
  if (p === '/mark-six') return res.redirect('/mark-six/');
  next();
});

// Mount the Mark Six PWA
const { app: markSixApp, ensureInitialData } = require('./apps/mark-six/server');
app.use('/mark-six', markSixApp);

// Redirect /bus-eta -> /bus-eta/
app.use('/bus-eta', (req, res, next) => {
  const p = req.originalUrl.split('?')[0];
  if (p === '/bus-eta') return res.redirect('/bus-eta/');
  next();
});

// Mount the HK Bus ETA PWA (prebuilt static bundle + SPA fallback)
const BUS_ETA_BUILD = path.join(__dirname, 'apps', 'hk-bus-eta', 'build');
const busEtaApp = express();
busEtaApp.use(express.static(BUS_ETA_BUILD, { index: false }));
busEtaApp.use((req, res) => {
  const last = (req.path.split('/').pop() || '');
  if (last.includes('.')) return res.status(404).end('Not found');
  res.sendFile(path.join(BUS_ETA_BUILD, 'index.html'));
});
app.use('/bus-eta', busEtaApp);

// Dashboard SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Life Tool server running at http://localhost:${PORT}`);
  console.log('  Dashboard:  /');
  console.log('  Mark Six:    /mark-six/');
  console.log('  HK Bus ETA:  /bus-eta/');
  await ensureInitialData();
});