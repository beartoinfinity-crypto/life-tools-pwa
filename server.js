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

// Mount a static subpath app at /<name> with an exact-match redirect and an SPA fallback
function mountStatic(name, buildDir) {
  app.use(`/${name}`, (req, res, next) => {
    const p = req.originalUrl.split('?')[0];
    if (p === `/${name}`) return res.redirect(`/${name}/`);
    next();
  });
  const staticApp = express();
  staticApp.use(express.static(buildDir, { index: false }));
  staticApp.use((req, res) => {
    const last = (req.path.split('/').pop() || '');
    if (last.includes('.')) return res.status(404).end('Not found');
    res.sendFile(path.join(buildDir, 'index.html'));
  });
  app.use(`/${name}`, staticApp);
}

// HK Bus ETA — original upstream PWA (v11.2.0, hkbus/hk-independent-bus-eta)
// Served at /bus-eta/ because the bundle is baked for that base path.
mountStatic('bus-eta', path.join(__dirname, 'apps', 'hk-bus-eta', 'build-upstream'));

// HK Bus ETA — edited "lite" UI (vanilla JS, route/stop search)
mountStatic('bus-eta-lite', path.join(__dirname, 'apps', 'hk-bus-eta', 'build'));

// Dashboard SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Life Tool server running at http://localhost:${PORT}`);
  console.log('  Dashboard:  /');
  console.log('  Mark Six:     /mark-six/');
  console.log('  HK Bus ETA:   /bus-eta/      (upstream)');
  console.log('  HK Bus Lite:  /bus-eta-lite/');
  await ensureInitialData();
});