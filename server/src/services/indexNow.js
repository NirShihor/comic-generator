// IndexNow: tell participating search engines (Bing, Yandex, Seznam, Naver…)
// which comigo.net URLs were added, changed or removed.
//
// Pages go live when the site is DEPLOYED (Publish only writes files locally,
// site/build.py builds them, `fly deploy` ships them), so the notification runs
// on the production server shortly after it starts: it compares the deployed
// site/indexnow-manifest.json (every public URL + a content fingerprint, written
// by build.py) with the manifest it last submitted successfully (kept on the
// /data volume) and submits only the differences. Nothing here may ever break
// serving or deploying — every failure is logged and swallowed, and the state
// is left as it was so the next start retries.
//
// The key file lives in site/indexnow/<key>.txt (containing just the key) and
// is served at https://comigo.net/<key>.txt, as the protocol requires.
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const HOST = 'comigo.net';
const SITE_URL = `https://${HOST}`;

/** The key from site/indexnow/<key>.txt (the file must contain exactly its name). */
function readKey(siteDir) {
  const dir = path.join(siteDir, 'indexnow');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return null; }
  for (const f of files) {
    const m = f.match(/^([a-f0-9]{8,128})\.txt$/);
    if (m && fs.readFileSync(path.join(dir, f), 'utf8').trim() === m[1]) return m[1];
  }
  return null;
}

/** Public page URLs only: https://comigo.net/<path>, no API, assets or files, no query. */
function isSubmittable(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname !== HOST || u.port) return false;
  if (u.search || u.hash || u.username || u.password) return false;
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/assets/')) return false;
  if (/\.[a-z0-9]+$/i.test(u.pathname)) return false;   // files (.txt, .xml, .mp3, .html…)
  return true;
}

/** URLs that are new, whose fingerprint changed, or that disappeared. */
function selectUrls(previous, current) {
  previous = previous || {};
  current = current || {};
  const out = new Set();
  for (const [url, fp] of Object.entries(current)) if (previous[url] !== fp) out.add(url);
  for (const url of Object.keys(previous)) if (!(url in current)) out.add(url);
  return [...out].filter(isSubmittable).sort();
}

/** POST the URLs to IndexNow. Never throws: resolves { ok, status, error }. */
async function submit(urls, { key, fetchImpl = fetch, log = console } = {}) {
  urls = (urls || []).filter(isSubmittable);
  if (!key) return { ok: false, error: 'no IndexNow key' };
  if (urls.length === 0) return { ok: true, status: null, submitted: 0 };
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key, keyLocation: `${SITE_URL}/${key}.txt`, urlList: urls.slice(0, 10000) }),
      signal: AbortSignal.timeout(20000),
    });
    // 200 OK / 202 Accepted (key validation pending) are successes.
    const ok = res.status === 200 || res.status === 202;
    if (!ok) {
      let body = '';
      try { body = (await res.text()).slice(0, 300); } catch {}
      log.warn(`[IndexNow] submission rejected: HTTP ${res.status} ${body}`);
    }
    return { ok, status: res.status, submitted: ok ? urls.length : 0 };
  } catch (err) {
    log.warn(`[IndexNow] submission failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/** Is the key file live at https://comigo.net/<key>.txt with the right contents? */
async function keyFileLive(key, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${SITE_URL}/${key}.txt`, { signal: AbortSignal.timeout(15000) });
    return res.status === 200 && (await res.text()).trim() === key;
  } catch {
    return false;
  }
}

/**
 * Express handler for the key file: serves https://comigo.net/<key>.txt as
 * UTF-8 text containing the key; any other request passes through.
 */
function keyFileHandler(siteDir) {
  const key = readKey(siteDir);
  return (req, res, next) => {
    if (!key || req.path !== `/${key}.txt`) return next();
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('text/plain; charset=utf-8').send(key);
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Submit what changed since the last successful submission. Returns a small
 * summary object; never throws.
 */
async function syncChangedUrls({ siteDir, statePath, fetchImpl = fetch, log = console } = {}) {
  try {
    const key = readKey(siteDir);
    const manifest = readJson(path.join(siteDir, 'indexnow-manifest.json'));
    if (!key || !manifest) {
      log.warn(`[IndexNow] skipped: ${!key ? 'no key file in site/indexnow/' : 'no site/indexnow-manifest.json'}`);
      return { skipped: true };
    }
    const previous = readJson(statePath) || {};
    const urls = selectUrls(previous, manifest);
    if (urls.length === 0) {
      log.log('[IndexNow] no added, changed or removed pages since the last submission');
      return { submitted: 0 };
    }
    if (!(await keyFileLive(key, { fetchImpl }))) {
      log.warn(`[IndexNow] not submitting ${urls.length} URL(s): ${SITE_URL}/${key}.txt is not reachable with the key — will retry on the next start`);
      return { submitted: 0, error: 'key file not reachable' };
    }
    const result = await submit(urls, { key, fetchImpl, log });
    if (result.ok) {
      fs.writeFileSync(statePath, JSON.stringify(manifest, null, 1));
      log.log(`[IndexNow] submitted ${urls.length} URL(s), HTTP ${result.status}: ${urls.join(' ')}`);
    }
    return { ...result, urls };
  } catch (err) {
    log.warn(`[IndexNow] sync failed: ${err.message}`);
    return { submitted: 0, error: err.message };
  }
}

/**
 * Production only (Fly sets FLY_APP_NAME; the /data volume holds the state):
 * run the sync a minute after start, when the new release is serving, and
 * retry once ten minutes later if it failed. Local/dev servers never submit.
 */
function scheduleAfterDeploy({ siteDir, delayMs = 60000, retryMs = 600000 } = {}) {
  if (!process.env.FLY_APP_NAME || !fs.existsSync('/data')) return false;
  const statePath = '/data/indexnow-state.json';
  const run = async (retry) => {
    const r = await syncChangedUrls({ siteDir, statePath });
    if (retry && r && r.error) setTimeout(() => run(false), retryMs).unref();
  };
  setTimeout(() => run(true), delayMs).unref();
  return true;
}

module.exports = { ENDPOINT, HOST, readKey, keyFileHandler, isSubmittable, selectUrls, submit, keyFileLive, syncChangedUrls, scheduleAfterDeploy };
