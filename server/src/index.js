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
// Pieces site/build.py assembles pages from — never pages themselves.
const SITE_PARTIALS = new Set(['nav', 'example-page', 'example-stage']);
// Aggregate server-side measurement (counts only, nothing about the visitor):
// reading-practice page views and App Store button taps (services/siteAnalytics).
const siteAnalytics = require('./services/siteAnalytics');
const siteEventSend = siteAnalytics.makeSender();
const serveSitePage = (req, res, file, page) =>
  siteAnalytics.servePage(req, res, require('fs').readFileSync(file, 'utf8'), page, siteEventSend);
// IndexNow ownership key (site/indexnow/<key>.txt), served at /<key>.txt.
const indexNow = require('./services/indexNow');
const indexNowKeyFile = indexNow.keyFileHandler(SITE_DIR);
// site/redirects.json ({ "/old/path": "/new/path" }), re-read when it changes
// (Publish adds an entry when an example is renamed).
let siteRedirectCache = { mtime: 0, map: {} };
function siteRedirects() {
  try {
    const f = path.join(SITE_DIR, 'redirects.json');
    const mtime = require('fs').statSync(f).mtimeMs;
    if (mtime !== siteRedirectCache.mtime) siteRedirectCache = { mtime, map: JSON.parse(require('fs').readFileSync(f, 'utf8')) };
  } catch { siteRedirectCache = { mtime: 0, map: {} }; }
  return siteRedirectCache.map;
}
app.use((req, res, next) => {
  let host = (req.headers.host || '').toLowerCase().split(':')[0];
  // Local preview of the site (never on the production server): open
  // http://comigo.localhost:3001/… — browsers resolve *.localhost to this machine.
  if (!process.env.FLY_APP_NAME && host === 'comigo.localhost') host = 'comigo.net';
  // Site redirects keep only the campaign's approved utm_* tags (so a campaign
  // visit survives the hop); click IDs and anything else are dropped.
  const campaignQs = siteAnalytics.campaignQuery(req.query);
  if (host === 'www.comigo.net') {
    // One hostname for the site: www redirects to the canonical comigo.net.
    return res.redirect(301, `https://comigo.net${req.path}${campaignQs}`);
  }
  if (host === 'comigo.net') {
    if (req.path === '/privacy' || req.path === '/privacy.html') {
      res.set('Cache-Control', 'no-store');
      return res.sendFile(path.join(SITE_DIR, 'privacy.html'));
    }
    if (req.path.length > 1 && req.path.endsWith('/')) {
      // A trailing slash is the same page.
      return res.redirect(301, `https://comigo.net${req.path.replace(/\/+$/, '')}${campaignQs}`);
    }
    // SEO/content pages: any site/<name>.html is served at its extensionless
    // URL (and at the .html spelling) — new pages need no server change.
    const pageMatch = req.path.match(/^\/([\w-]+?)(?:\.html)?$/);
    if (pageMatch && pageMatch[1] !== 'index' && !pageMatch[1].includes('template') && !SITE_PARTIALS.has(pageMatch[1])) {
      const pageFile = path.join(SITE_DIR, `${pageMatch[1]}.html`);
      if (require('fs').existsSync(pageFile)) {
        return serveSitePage(req, res, pageFile, { pageType: pageMatch[1] === 'spanish-reading-practice' ? 'hub' : 'other' });
      }
    }
    // Old URLs (site/redirects.json, e.g. the first /examples/<slug> pages and
    // renamed exercises): a permanent redirect straight to the current page.
    const redirectTo = siteRedirects()[req.path.replace(/\.html$/, '')];
    if (redirectTo) return res.redirect(301, `https://comigo.net${redirectTo}${campaignQs}`);
    // Reading exercises (built by site/build.py into site/examples/<slug>.html)
    // live at /spanish-reading-practice/<slug>; the .html spelling redirects.
    const exMatch = req.path.match(/^\/spanish-reading-practice\/([\w-]+?)(\.html)?$/);
    if (exMatch) {
      const exFile = path.join(SITE_DIR, 'examples', `${exMatch[1]}.html`);
      if (require('fs').existsSync(exFile)) {
        if (exMatch[2]) return res.redirect(301, `https://comigo.net/spanish-reading-practice/${exMatch[1]}${campaignQs}`);
        return serveSitePage(req, res, exFile, { pageType: 'exercise', exercise: exMatch[1] });
      }
    }
    // Unlisted example pages (site/unlisted, built by site/build.py): a page
    // made for one recipient at /p/<slug>-<token> — not listed, not in the
    // sitemap, noindex; its links carry the recipient's campaign tags.
    const unMatch = req.path.match(/^\/p\/([\w-]+)$/);
    if (unMatch) {
      const unFile = path.join(SITE_DIR, 'unlisted', `${unMatch[1]}.html`);
      if (require('fs').existsSync(unFile)) {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        const html = require('fs').readFileSync(unFile, 'utf8');
        return siteAnalytics.servePage(req, res, html, { pageType: 'unlisted', exercise: unMatch[1], utm: siteAnalytics.bakedUtm(html) }, siteEventSend);
      }
    }
    // App Store buttons: count the tap, then redirect (Apple campaign link for
    // campaign visitors, the plain App Store page otherwise).
    if (req.path === '/go/app-store') return siteAnalytics.appStoreRedirect(req, res, siteEventSend);
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
      if (/^[\w.\-]+\.(webp|jpg|png|mp3|mp4)$/.test(f)) {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(path.join(SITE_DIR, 'assets-dist', f), err => { if (err) res.status(404).end(); });
      }
      return res.status(404).end();
    }
    if (req.path.endsWith('.txt') && req.path !== '/robots.txt') return indexNowKeyFile(req, res, () => res.status(404).end());
    if (req.path === '/robots.txt') {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.join(SITE_DIR, 'robots.txt'));
    }
    if (req.path === '/sitemap.xml') {
      // site/sitemap.json (written by site/build.py) carries every public URL
      // with the date its CONTENT last changed — never the deploy date — and,
      // for an exercise, its page image (an image sitemap entry). Without the
      // file, fall back to listing the pages from the files on disk.
      const fsSync = require('fs');
      const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      let entries = [];
      let fromManifest = null;
      try { fromManifest = JSON.parse(fsSync.readFileSync(path.join(SITE_DIR, 'sitemap.json'), 'utf8')); } catch {}
      if (fromManifest && Object.keys(fromManifest).length) {
        entries = Object.entries(fromManifest).map(([loc, v]) =>
          `  <url><loc>${esc(loc)}</loc><lastmod>${esc(v.lastmod)}</lastmod>`
          + (v.image ? `<image:image><image:loc>${esc(v.image.loc)}</image:loc>`
                       + (v.image.title ? `<image:title>${esc(v.image.title)}</image:title>` : '')
                       + (v.image.caption ? `<image:caption>${esc(v.image.caption)}</image:caption>` : '') + '</image:image>' : '')
          + '</url>');
      } else {
        entries = fsSync.readdirSync(SITE_DIR).filter(f => f.endsWith('.html') && !f.includes('.template.')
          && !SITE_PARTIALS.has(f.replace(/\.html$/, ''))).map(f => {
          const loc = f === 'index.html' ? 'https://comigo.net/' : `https://comigo.net/${f.replace(/\.html$/, '')}`;
          const lastmod = fsSync.statSync(path.join(SITE_DIR, f)).mtime.toISOString().slice(0, 10);
          return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
        });
        const exDir = path.join(SITE_DIR, 'examples');
        if (fsSync.existsSync(exDir)) {
          for (const f of fsSync.readdirSync(exDir).filter(f => f.endsWith('.html')).sort()) {
            const lastmod = fsSync.statSync(path.join(exDir, f)).mtime.toISOString().slice(0, 10);
            entries.push(`  <url><loc>https://comigo.net/spanish-reading-practice/${f.replace(/\.html$/, '')}</loc><lastmod>${lastmod}</lastmod></url>`);
          }
        }
      }
      res.set('Cache-Control', 'public, max-age=3600');
      return res.type('application/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries.join('\n')}\n</urlset>\n`);
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
    // Anything else is not a page: a real 404 (visitors still see the
    // homepage, with their campaign tags carried into its links), so mistyped
    // or old URLs aren't indexed as copies of it.
    const isHome = req.path === '/' || req.path === '/index.html';
    if (!isHome) res.status(404);
    return serveSitePage(req, res, path.join(SITE_DIR, 'index.html'), { pageType: 'other' });
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
app.use('/api/appstore', require('./routes/appstore'));

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

// After a deploy: submit comigo.net pages added/changed/removed since the last
// submission to IndexNow (production only; failures are only logged).
indexNow.scheduleAfterDeploy({ siteDir: SITE_DIR });

// Increase server timeout to 10 minutes for long-running image generation requests
server.timeout = 600000;
server.keepAliveTimeout = 600000;
server.headersTimeout = 601000;
