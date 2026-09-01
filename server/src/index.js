const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');

const comicRoutes = require('./routes/comics');
const collectionRoutes = require('./routes/collections');
const imageRoutes = require('./routes/images');
const audioRoutes = require('./routes/audio');
const chatRoutes = require('./routes/chat');
const readerRoutes = require('./routes/reader');
const notebookRoutes = require('./routes/notebook');
const backgroundRoutes = require('./routes/backgrounds');
const loginRoutes = require('./routes/login');
const { authMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
connectDB();

// Daily EJSON dump of the whole DB (volume-backed on Fly, Time-Machine'd locally)
require('./services/dbBackup').startDailyBackups();

// Marketing site: requests arriving via comigo.net get the static landing
// page (and privacy policy) and nothing else — no auth gate, no app routes.
// The generator app remains exactly as-is on its own hostnames.
const SITE_DIR = path.join(__dirname, '../../site');
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (host === 'comigo.net' || host === 'www.comigo.net') {
    if (req.path === '/privacy' || req.path === '/privacy.html') {
      res.set('Cache-Control', 'no-store');
      return res.sendFile(path.join(SITE_DIR, 'privacy.html'));
    }
    if (req.path === '/favicon.png' || req.path === '/favicon.ico' || req.path === '/apple-touch-icon.png') {
      return res.sendFile(path.join(SITE_DIR, 'favicon.png'));
    }
    if (req.path === '/demo.mp4') {
      // The demo clip may be cached (unlike the HTML): it only changes when we
      // ship a new video, and 3MB per visit is worth saving.
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.join(SITE_DIR, 'demo.mp4'));
    }
    // no-store: mobile Safari clung to multi-MB cached copies through
    // deploys, making site updates invisible on phones.
    res.set('Cache-Control', 'no-store');
    return res.sendFile(path.join(SITE_DIR, 'index.html'));
  }
  next();
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Password gate (no-op unless AUTH_PASSWORD is set)
app.use(authMiddleware);
app.use('/login', loginRoutes);

// Serve uploaded files. no-store on project assets: regenerated audio/images
// overwrite the SAME filename, so any browser caching serves the OLD file —
// the editor's Play kept playing stale audio after a Regen until the cache
// happened to evict (looked like the regeneration "taking many attempts").
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/projects', express.static(path.join(__dirname, '../projects'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// Routes
app.use('/api/comics', comicRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reader', readerRoutes);
app.use('/api/notebook', notebookRoutes);
app.use('/api/backgrounds', backgroundRoutes);
app.use('/api/marketing', require('./routes/marketing'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve client build
const clientBuildPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientBuildPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Increase server timeout to 10 minutes for long-running image generation requests
server.timeout = 600000;
server.keepAliveTimeout = 600000;
server.headersTimeout = 601000;
