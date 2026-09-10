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

// Dashboard SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Life Tool server running at http://localhost:${PORT}`);
  console.log('  Dashboard:  /');
  console.log('  Mark Six:    /mark-six/');
  await ensureInitialData();
});