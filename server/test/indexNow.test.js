const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const indexNow = require('../src/services/indexNow');

const SITE_DIR = path.join(__dirname, '../../site');
const U = p => `https://comigo.net${p}`;

// --- URL selection ---------------------------------------------------------

test('only public comigo.net page URLs are submittable', () => {
  for (const ok of ['/', '/spanish-reading-practice', '/spanish-reading-practice/staying-safe', '/examples/meeting-zik', '/privacy']) {
    assert.ok(indexNow.isSubmittable(U(ok)), ok);
  }
  for (const bad of [
    U('/api/reader/catalog'), U('/assets/example-meeting-zik.c67392d4.webp'), U('/assets/ex-a-b1-1.123.mp3'),
    U('/sitemap.xml'), U('/robots.txt'), U('/0d44f7aa8425ef9956d79b80dee2de25.txt'), U('/spanish-reading-practice/staying-safe.html'),
    U('/spanish-reading-practice?utm_source=x'), 'http://comigo.net/', 'https://www.comigo.net/', 'http://localhost:3001/',
    'https://localhost/spanish-reading-practice', 'https://comic-generator.fly.dev/', 'https://comigo.net:8443/', 'not a url',
  ]) {
    assert.ok(!indexNow.isSubmittable(bad), bad);
  }
});

test('first run: every URL in the manifest is new', () => {
  const current = { [U('/')]: 'a', [U('/spanish-reading-practice')]: 'b' };
  assert.deepStrictEqual(indexNow.selectUrls(null, current), [U('/'), U('/spanish-reading-practice')]);
});

test('new, changed and removed pages are selected; unchanged ones are not', () => {
  const previous = {
    [U('/')]: 'same', [U('/spanish-reading-practice')]: 'old-hub',
    [U('/spanish-reading-practice/gone')]: 'x', [U('/spanish-reading-practice/kept')]: 'k',
  };
  const current = {
    [U('/')]: 'same', [U('/spanish-reading-practice')]: 'new-hub',
    [U('/spanish-reading-practice/kept')]: 'k', [U('/spanish-reading-practice/new-one')]: 'n',
  };
  assert.deepStrictEqual(indexNow.selectUrls(previous, current), [
    U('/spanish-reading-practice'), U('/spanish-reading-practice/gone'), U('/spanish-reading-practice/new-one'),
  ]);
});

test('a new or re-pointed redirect submits the old URL once', () => {
  const previous = { [U('/examples/a')]: 'redirect:/spanish-reading-practice/a' };
  const current = {
    [U('/examples/a')]: 'redirect:/spanish-reading-practice/a2',              // re-pointed
    [U('/spanish-reading-practice/b')]: 'redirect:/spanish-reading-practice/c', // new rename
  };
  assert.deepStrictEqual(indexNow.selectUrls(previous, current), [U('/examples/a'), U('/spanish-reading-practice/b')]);
  assert.deepStrictEqual(indexNow.selectUrls(current, current), []);
});

test('non-public URLs are never selected, even if they appear in a manifest', () => {
  const current = { [U('/assets/x.webp')]: '1', [U('/api/x')]: '1', 'http://localhost:3001/': '1', [U('/ok')]: '1' };
  assert.deepStrictEqual(indexNow.selectUrls({}, current), [U('/ok')]);
});

test('the built manifest lists exactly the public pages and redirected old URLs', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'indexnow-manifest.json'), 'utf8'));
  const partials = new Set(['nav', 'example-page', 'example-stage']);
  const expected = new Set();
  for (const f of fs.readdirSync(SITE_DIR)) {
    if (f.endsWith('.html') && !f.includes('.template.') && !partials.has(f.slice(0, -5))) {
      expected.add(f === 'index.html' ? U('/') : U('/' + f.slice(0, -5)));
    }
  }
  for (const f of fs.readdirSync(path.join(SITE_DIR, 'examples'))) {
    if (f.endsWith('.html')) expected.add(U('/spanish-reading-practice/' + f.slice(0, -5)));
  }
  const redirects = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'redirects.json'), 'utf8'));
  for (const old of Object.keys(redirects)) expected.add(U(old));
  assert.deepStrictEqual(new Set(Object.keys(manifest)), expected);
  for (const url of Object.keys(manifest)) assert.ok(indexNow.isSubmittable(url), url);
  for (const [old, target] of Object.entries(redirects)) assert.strictEqual(manifest[U(old)], `redirect:${target}`);
});

// --- key file ---------------------------------------------------------------

test('the key file exists, is UTF-8 text containing exactly its own name', () => {
  const key = indexNow.readKey(SITE_DIR);
  assert.match(key, /^[a-f0-9]{32}$/);
  const raw = fs.readFileSync(path.join(SITE_DIR, 'indexnow', `${key}.txt`));
  assert.strictEqual(raw.toString('utf8'), key);
});

test('a key file whose contents do not match its name is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-'));
  fs.mkdirSync(path.join(dir, 'indexnow'));
  fs.writeFileSync(path.join(dir, 'indexnow', 'abcdef0123456789.txt'), 'something-else');
  assert.strictEqual(indexNow.readKey(dir), null);
});

test('the key file is served at /<key>.txt as text/plain UTF-8', async () => {
  const key = indexNow.readKey(SITE_DIR);
  const app = express();
  app.use(indexNow.keyFileHandler(SITE_DIR));
  app.use((req, res) => res.status(404).end());
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/${key}.txt`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/plain; charset=utf-8/);
    assert.strictEqual(await res.text(), key);
    assert.strictEqual((await fetch(`${base}/0000000000000000.txt`)).status, 404);
    assert.strictEqual((await fetch(`${base}/indexnow/${key}.txt`)).status, 404);
  } finally {
    server.close();
  }
});

// --- submission + failure handling ----------------------------------------

const quiet = { log() {}, warn() {} };
const response = (status, body = '') => ({ status, text: async () => body });

test('submit posts host, key, keyLocation and only public URLs', async () => {
  let sent;
  const r = await indexNow.submit([U('/a'), U('/assets/x.webp')], {
    key: 'k123', log: quiet,
    fetchImpl: async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return response(200); },
  });
  assert.strictEqual(sent.url, 'https://api.indexnow.org/indexnow');
  assert.deepStrictEqual(sent.body, { host: 'comigo.net', key: 'k123', keyLocation: 'https://comigo.net/k123.txt', urlList: [U('/a')] });
  assert.deepStrictEqual(r, { ok: true, status: 200, submitted: 1 });
  assert.strictEqual((await indexNow.submit([U('/a')], { key: 'k', log: quiet, fetchImpl: async () => response(202) })).ok, true);
});

test('submit never throws: network errors and rejections resolve to ok:false', async () => {
  const boom = await indexNow.submit([U('/a')], { key: 'k', log: quiet, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.deepStrictEqual(boom, { ok: false, error: 'ECONNRESET' });
  for (const status of [400, 403, 422, 429, 500]) {
    const r = await indexNow.submit([U('/a')], { key: 'k', log: quiet, fetchImpl: async () => response(status, 'nope') });
    assert.strictEqual(r.ok, false, String(status));
  }
});

function tempSite(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-site-'));
  fs.mkdirSync(path.join(dir, 'indexnow'));
  fs.writeFileSync(path.join(dir, 'indexnow', 'feedfacefeedface.txt'), 'feedfacefeedface');
  fs.writeFileSync(path.join(dir, 'indexnow-manifest.json'), JSON.stringify(manifest));
  return { dir, statePath: path.join(dir, 'state.json') };
}
// A fake network: the key file is live (or not), IndexNow answers `status` (or throws).
function fakeNet({ keyLive = true, status = 200, fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (url.endsWith('.txt')) return keyLive ? response(200, 'feedfacefeedface') : response(404);
    if (fail) throw new Error('network down');
    return response(status);
  };
  return { fetchImpl, calls, submitted: () => calls.filter(c => c.body).map(c => c.body.urlList) };
}

test('sync: first deploy submits everything and records the state', async () => {
  const { dir, statePath } = tempSite({ [U('/')]: '1', [U('/spanish-reading-practice')]: '2' });
  const net = fakeNet();
  const r = await indexNow.syncChangedUrls({ siteDir: dir, statePath, fetchImpl: net.fetchImpl, log: quiet });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(net.submitted(), [[U('/'), U('/spanish-reading-practice')]]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), { [U('/')]: '1', [U('/spanish-reading-practice')]: '2' });
});

test('sync: an unchanged redeploy submits nothing; a later change submits only the difference', async () => {
  const { dir, statePath } = tempSite({ [U('/')]: '1', [U('/spanish-reading-practice')]: '2', [U('/spanish-reading-practice/x')]: '3' });
  await indexNow.syncChangedUrls({ siteDir: dir, statePath, fetchImpl: fakeNet().fetchImpl, log: quiet });
  const again = fakeNet();
  assert.deepStrictEqual(await indexNow.syncChangedUrls({ siteDir: dir, statePath, fetchImpl: again.fetchImpl, log: quiet }), { submitted: 0 });
  assert.strictEqual(again.calls.length, 0);
  // Exercise x removed (now redirected), hub changed, a new exercise y.
  fs.writeFileSync(path.join(dir, 'indexnow-manifest.json'), JSON.stringify({
    [U('/')]: '1', [U('/spanish-reading-practice')]: '2b',
    [U('/spanish-reading-practice/x')]: 'redirect:/spanish-reading-practice/y', [U('/spanish-reading-practice/y')]: '4',
  }));
  const later = fakeNet();
  await indexNow.syncChangedUrls({ siteDir: dir, statePath, fetchImpl: later.fetchImpl, log: quiet });
  assert.deepStrictEqual(later.submitted(), [[U('/spanish-reading-practice'), U('/spanish-reading-practice/x'), U('/spanish-reading-practice/y')]]);
});

test('sync: failures never throw and leave the state for a retry', async () => {
  for (const net of [fakeNet({ fail: true }), fakeNet({ status: 429 }), fakeNet({ keyLive: false })]) {
    const { dir, statePath } = tempSite({ [U('/')]: '1' });
    const r = await indexNow.syncChangedUrls({ siteDir: dir, statePath, fetchImpl: net.fetchImpl, log: quiet });
    assert.ok(!r.ok);
    assert.ok(!fs.existsSync(statePath), 'state not written after a failure');
  }
  // Key file not live: nothing is sent to IndexNow at all.
  const net = fakeNet({ keyLive: false });
  const { dir, statePath } = tempSite({ [U('/')]: '1' });
  await indexNow.syncChangedUrls({ siteDir: dir, statePath, fetchImpl: net.fetchImpl, log: quiet });
  assert.deepStrictEqual(net.submitted(), []);
  // Missing key or manifest: skipped, no throw.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-empty-'));
  assert.deepStrictEqual(await indexNow.syncChangedUrls({ siteDir: empty, statePath: path.join(empty, 's.json'), log: quiet }), { skipped: true });
});

test('only production schedules a submission (never from a local/dev server)', () => {
  const had = process.env.FLY_APP_NAME;
  delete process.env.FLY_APP_NAME;
  try {
    assert.strictEqual(indexNow.scheduleAfterDeploy({ siteDir: SITE_DIR }), false);
  } finally {
    if (had !== undefined) process.env.FLY_APP_NAME = had;
  }
});
