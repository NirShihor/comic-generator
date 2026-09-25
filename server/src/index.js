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
    // SEO/content pages: any site/<name>.html is served at its extensionless
    // URL (and at the .html spelling) — new pages need no server change.
    const pageMatch = req.path.match(/^\/([\w-]+?)(?:\.html)?$/);
    if (pageMatch && pageMatch[1] !== 'index' && !pageMatch[1].includes('template')) {
      const pageFile = path.join(SITE_DIR, `${pageMatch[1]}.html`);
      if (require('fs').existsSync(pageFile)) {
        res.set('Cache-Control', 'no-store');
        return res.sendFile(pageFile);
      }
    }
    if (req.path === '/favicon.png' || req.path === '/favicon.ico') {
      return res.sendFile(path.join(SITE_DIR, 'favicon.png'));
    }
    if (req.path === '/favicon-512.png' || req.path === '/apple-touch-icon.png') {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.join(SITE_DIR, 'favicon-512.png'));
    }
    if (req.path === '/og-image.jpg') {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.join(SITE_DIR, 'og-image.jpg'));
    }
    if (req.path.startsWith('/assets/')) {
      // Content-hashed filenames from site/build.py — safe to cache forever.
      const f = req.path.slice('/assets/'.length);
      if (/^[\w.\-]+\.(webp|jpg|png|mp3)$/.test(f)) {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(path.join(SITE_DIR, 'assets-dist', f), err => { if (err) res.status(404).end(); });
      }
      return res.status(404).end();
    }
    if (req.path === '/robots.txt') {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.join(SITE_DIR, 'robots.txt'));
    }
    if (req.path === '/sitemap.xml') {
      // Built from the .html files actually in site/, so new public pages are
      // picked up automatically. index.html is the homepage.
      const fsSync = require('fs');
      const entries = fsSync.readdirSync(SITE_DIR).filter(f => f.endsWith('.html') && !f.includes('.template.')).map(f => {
        // Extensionless canonical URLs (the server serves both spellings).
        const loc = f === 'index.html' ? 'https://comigo.net/' : `https://comigo.net/${f.replace(/\.html$/, '')}`;
        const lastmod = fsSync.statSync(path.join(SITE_DIR, f)).mtime.toISOString().slice(0, 10);
        return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
      });
      res.set('Cache-Control', 'public, max-age=3600');
      return res.type('application/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`);
    }
    if (req.path === '/demo-poster.jpg') {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.join(SITE_DIR, 'demo-poster.jpg'));
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
