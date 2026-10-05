const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const sa = require('../src/services/siteAnalytics');

const SITE_DIR = path.join(__dirname, '../../site');
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const CAMPAIGN_LINK = 'https://apps.apple.com/app/apple-store/id6760253260?pt=128624331&ct=GoogleSearch&mt=8';
const GOOGLE = { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'google-reading-practice' };
// Keys an event may ever carry — nothing about the visitor.
const ALLOWED = new Set(['surface', 'page_type', 'exercise', 'from_page', 'button', 'apple_campaign', 'from_campaign',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);

// --- campaign tags ------------------------------------------------------------

test('only the five utm tags survive, as short plain tokens; click IDs and anything else are dropped', () => {
  assert.deepStrictEqual(sa.cleanUtm({ ...GOOGLE, utm_content: 'ad-1', utm_term: 'spanish_reading', gclid: 'Cj0KCQ', fbclid: 'x', ref: 'y' }),
    { ...GOOGLE, utm_content: 'ad-1', utm_term: 'spanish_reading' });
  assert.deepStrictEqual(sa.cleanUtm({ utm_source: 'goo gle', utm_campaign: 'x'.repeat(65), utm_medium: ['a', 'b'], utm_term: '<script>' }), {});
  assert.deepStrictEqual(sa.cleanUtm(undefined), {});
});

test('bots, scripts, HEAD requests and prefetches are not counted', () => {
  const req = (ua, extra = {}) => ({ method: 'GET', headers: { 'user-agent': ua, ...extra } });
  assert.ok(sa.countable(req(SAFARI)));
  for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'AdsBot-Google (+http://www.google.com/adsbot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)', 'Mozilla/5.0 AppleWebKit/537.36; compatible; OAI-SearchBot/1.3', 'curl/8.7.1',
    'python-requests/2.32', 'facebookexternalhit/1.1', '', undefined]) {
    assert.ok(!sa.countable(req(ua)), String(ua));
  }
  assert.ok(!sa.countable({ method: 'HEAD', headers: { 'user-agent': SAFARI } }));
  assert.ok(!sa.countable(req(SAFARI, { 'sec-purpose': 'prefetch;prerender' })));
  assert.ok(!sa.countable(req(SAFARI, { purpose: 'prefetch' })));
});

test('campaign tags are added to internal page links only', () => {
  const html = [
    '<a href="/">Home</a>', '<a href="/spanish-reading-practice">Hub</a>',
    '<a href="/spanish-reading-practice/meeting-zik#study">Ex</a>',
    '<a href="/go/app-store?from=/&amp;loc=nav">App</a>',
    '<img src="/assets/x.webp">', '<link href="/favicon.png">', '<a href="https://apps.apple.com/app/id1">x</a>',
    '<a href="//cdn.example.com/x">x</a>', '<a href="mailto:nir@comigo.net">x</a>', '<a href="/privacy">Privacy</a>',
  ].join('\n');
  const out = sa.addUtmToLinks(html, GOOGLE).split('\n');
  const q = 'utm_source=google&amp;utm_medium=cpc&amp;utm_campaign=google-reading-practice';
  assert.strictEqual(out[0], `<a href="/?${q}">Home</a>`);
  assert.strictEqual(out[1], `<a href="/spanish-reading-practice?${q}">Hub</a>`);
  assert.strictEqual(out[2], `<a href="/spanish-reading-practice/meeting-zik?${q}#study">Ex</a>`);
  assert.strictEqual(out[3], `<a href="/go/app-store?from=/&amp;loc=nav&amp;${q}">App</a>`);
  assert.deepStrictEqual(out.slice(4), html.split('\n').slice(4));           // assets, other sites, the privacy policy: untouched
  assert.strictEqual(sa.addUtmToLinks(html, {}), html);
});

test('redirects carry only the approved tags: campaignQuery keeps utm_*, drops gclid/fbclid and everything else', () => {
  assert.strictEqual(sa.campaignQuery({ ...GOOGLE, gclid: 'Cj0KCQ', fbclid: 'IwAR', ref: 'x' }), '?utm_source=google&utm_medium=cpc&utm_campaign=google-reading-practice');
  assert.strictEqual(sa.campaignQuery({ utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'instagram-profile' }), '?utm_source=instagram&utm_medium=social&utm_campaign=instagram-profile');
  assert.strictEqual(sa.campaignQuery({ gclid: 'Cj0KCQ' }), '');
  assert.strictEqual(sa.campaignQuery({}), '');
  assert.strictEqual(sa.campaignQuery(undefined), '');
});

test('the App Store button sends campaign visitors to the Apple campaign link, everyone else to the plain page', () => {
  assert.strictEqual(sa.appStoreTarget(GOOGLE), CAMPAIGN_LINK);
  assert.strictEqual(sa.appStoreTarget({ utm_source: 'google', utm_campaign: 'something-else' }), 'https://apps.apple.com/app/id6760253260');
  assert.strictEqual(sa.appStoreTarget({}), 'https://apps.apple.com/app/id6760253260');
});

// --- events -------------------------------------------------------------------

test('page-view and click events carry only page/button/campaign fields', () => {
  const pv = sa.pageViewEvent({ pageType: 'exercise', exercise: 'meeting-zik', utm: GOOGLE });
  assert.strictEqual(pv.name, 'site_page_viewed');
  assert.deepStrictEqual(pv.properties, { surface: 'website', page_type: 'exercise', exercise: 'meeting-zik', ...GOOGLE, from_campaign: true });
  const click = sa.ctaClickEvent({ from: '/spanish-reading-practice/meeting-zik', loc: 'band', utm: GOOGLE });
  assert.deepStrictEqual(click.properties, {
    surface: 'website', from_page: '/spanish-reading-practice/meeting-zik', page_type: 'exercise', exercise: 'meeting-zik',
    button: 'band', apple_campaign: 'GoogleSearch', ...GOOGLE, from_campaign: true,
  });
  const organic = sa.ctaClickEvent({ from: '/spanish-reading-practice', loc: 'nav', utm: {} });
  assert.deepStrictEqual(organic.properties, { surface: 'website', from_page: '/spanish-reading-practice', page_type: 'hub', button: 'nav', apple_campaign: null, from_campaign: false });
  const junk = sa.ctaClickEvent({ from: 'https://evil.example/<x>', loc: 'sidebar', utm: {} });
  assert.strictEqual(junk.properties.from_page, 'unknown');
  assert.strictEqual(junk.properties.button, 'unknown');
  for (const e of [pv, click, organic, junk]) for (const k of Object.keys(e.properties)) assert.ok(ALLOWED.has(k), k);
});

test('sender: one fixed distinct_id, no person profile, no GeoIP — and only from production', async () => {
  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200 }; };
  const quiet = { warn() {} };
  const send = sa.makeSender({ fetchImpl, env: { FLY_APP_NAME: 'comic-generator', POSTHOG_PROJECT_TOKEN_PRODUCTION: 'phc_test' }, log: quiet });
  assert.strictEqual(await send(sa.pageViewEvent({ pageType: 'hub', utm: GOOGLE })), true);
  assert.strictEqual(sent.url, 'https://eu.i.posthog.com/batch/');
  assert.strictEqual(sent.body.api_key, 'phc_test');
  const [ev] = sent.body.batch;
  assert.strictEqual(ev.distinct_id, 'comigo-website');
  assert.strictEqual(ev.properties.$process_person_profile, false);
  assert.strictEqual(ev.properties.$geoip_disable, true);
  for (const k of ['$ip', '$user_agent', '$referrer', '$current_url', 'gclid']) assert.ok(!(k in ev.properties), k);

  // Local/dev servers (no FLY_APP_NAME) and missing tokens send nothing.
  let calls = 0;
  const counting = async () => { calls++; return { ok: true }; };
  assert.strictEqual(await sa.makeSender({ fetchImpl: counting, env: { POSTHOG_PROJECT_TOKEN_PRODUCTION: 'phc_x' }, log: quiet })({ name: 'x', properties: {} }), false);
  assert.strictEqual(await sa.makeSender({ fetchImpl: counting, env: { FLY_APP_NAME: 'a' }, log: quiet })({ name: 'x', properties: {} }), false);
  assert.strictEqual(calls, 0);
});

test('sender failures never throw', async () => {
  const env = { FLY_APP_NAME: 'a', POSTHOG_PROJECT_TOKEN_PRODUCTION: 'phc_x' };
  const quiet = { warn() {} };
  assert.strictEqual(await sa.makeSender({ fetchImpl: async () => { throw new Error('down'); }, env, log: quiet })({ name: 'x', properties: {} }), false);
  assert.strictEqual(await sa.makeSender({ fetchImpl: async () => ({ ok: false, status: 500 }), env, log: quiet })({ name: 'x', properties: {} }), false);
});

// --- serving (real express app) ----------------------------------------------

async function withServer(fn) {
  const events = [];
  const send = async (e) => { events.push(e); return true; };
  const app = express();
  app.use((req, res, next) => {
    if (req.path === '/go/app-store') return sa.appStoreRedirect(req, res, send);
    if (req.path === '/spanish-reading-practice') return sa.servePage(req, res, '<a href="/spanish-reading-practice/meeting-zik">x</a>', { pageType: 'hub' }, send);
    if (req.path === '/learn') return sa.servePage(req, res, '<a href="/">x</a>', { pageType: 'other' }, send);
    if (req.path === '/missing') { res.status(404); return sa.servePage(req, res, '<a href="/">x</a>', { pageType: 'other' }, send); }   // as index.js's 404 fallback
    // The real built pages, routed as index.js routes them.
    if (req.path === '/') return sa.servePage(req, res, fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8'), { pageType: 'other' }, send);
    if (req.path === '/hub') return sa.servePage(req, res, fs.readFileSync(path.join(SITE_DIR, 'spanish-reading-practice.html'), 'utf8'), { pageType: 'hub' }, send);
    const ex = req.path.match(/^\/spanish-reading-practice\/([a-z0-9-]+)$/);
    if (ex) return sa.servePage(req, res, fs.readFileSync(path.join(SITE_DIR, 'examples', `${ex[1]}.html`), 'utf8'), { pageType: 'exercise', exercise: ex[1] }, send);
    next();
  });
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, events); } finally { server.close(); }
}
const get = (url, ua = SAFARI, extra = {}) => fetch(url, { headers: { 'user-agent': ua, ...extra }, redirect: 'manual' });

test('App Store redirect: counts the tap and sends campaign visitors to the campaign link', async () => {
  await withServer(async (base, events) => {
    let res = await get(`${base}/go/app-store?from=/spanish-reading-practice/meeting-zik&loc=band&utm_source=google&utm_medium=cpc&utm_campaign=google-reading-practice&gclid=abc`);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), CAMPAIGN_LINK);
    assert.strictEqual(res.headers.get('set-cookie'), null);
    assert.match(res.headers.get('x-robots-tag'), /noindex/);
    res = await get(`${base}/go/app-store?from=/&loc=hero`);
    assert.strictEqual(res.headers.get('location'), 'https://apps.apple.com/app/id6760253260');
    await get(`${base}/go/app-store?from=/&loc=nav`, 'Mozilla/5.0 (compatible; bingbot/2.0)');   // bot: redirected, not counted
    await new Promise(r => setImmediate(r));
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].name, 'app_store_cta_clicked');
    assert.strictEqual(events[0].properties.exercise, 'meeting-zik');
    assert.strictEqual(events[0].properties.apple_campaign, 'GoogleSearch');
    assert.ok(!JSON.stringify(events).includes('abc'), 'gclid never recorded');
    assert.strictEqual(events[1].properties.from_campaign, false);
  });
});

test('pages: campaign tags carried into links; hub/exercise views counted, other pages not; no cookies', async () => {
  await withServer(async (base, events) => {
    let res = await get(`${base}/spanish-reading-practice?utm_source=google&utm_medium=cpc&utm_campaign=google-reading-practice`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('set-cookie'), null);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), /href="\/spanish-reading-practice\/meeting-zik\?utm_source=google&amp;utm_medium=cpc&amp;utm_campaign=google-reading-practice"/);
    await get(`${base}/spanish-reading-practice`, 'Mozilla/5.0 (compatible; Googlebot/2.1)');             // bot
    await get(`${base}/spanish-reading-practice`, SAFARI, { 'sec-purpose': 'prefetch' });               // prefetch
    await get(`${base}/learn?utm_source=google`);                                                        // not a counted page
    await new Promise(r => setImmediate(r));
    assert.deepStrictEqual(events.map(e => [e.name, e.properties.page_type, e.properties.from_campaign]), [['site_page_viewed', 'hub', true]]);
  });
});

test('a 404 keeps the campaign in its links and is not counted', async () => {
  await withServer(async (base, events) => {
    const res = await get(`${base}/missing?utm_source=google&utm_medium=cpc&utm_campaign=google-reading-practice&gclid=abc`);
    assert.strictEqual(res.status, 404);
    assert.match(await res.text(), /href="\/\?utm_source=google&amp;utm_medium=cpc&amp;utm_campaign=google-reading-practice"/);
    await new Promise(r => setImmediate(r));
    assert.strictEqual(events.length, 0);
  });
});

// A visitor's journey through the real built pages: follow the page's own
// links (as served), then tap an App Store button.
const links = html => [...html.matchAll(/href="(\/[^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
async function journey(base, start, pathnames, loc) {
  let res = await get(`${base}${start}`); assert.strictEqual(res.status, 200);
  let html = await res.text();
  for (const p of pathnames) {
    const href = links(html).find(h => h.split('?')[0] === p);
    assert.ok(href, `no link to ${p}`);
    res = await get(`${base}${href}`); assert.strictEqual(res.status, 200, href);
    html = await res.text();
  }
  const cta = links(html).find(h => h.startsWith('/go/app-store?') && h.includes(`loc=${loc}`));
  assert.ok(cta, `no ${loc} button`);
  res = await get(`${base}${cta}`); assert.strictEqual(res.status, 302);
  await new Promise(r => setImmediate(r));
  return { html, target: res.headers.get('location') };
}
const exercises = fs.readdirSync(path.join(SITE_DIR, 'examples')).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, ''));
const utmOf = url => Object.fromEntries([...new URL(url, 'https://x').searchParams].filter(([k]) => k.startsWith('utm_')));

test('journeys: campaign tags survive landing → homepage → App Store, and landing → exercise → exercise → App Store', async () => {
  const google = 'utm_source=google&utm_medium=cpc&utm_campaign=google-reading-practice';
  await withServer(async (base, events) => {
    let { target } = await journey(base, `/hub?${google}&gclid=Cj0KCQ&fbclid=IwAR`, ['/'], 'hero');
    assert.strictEqual(target, CAMPAIGN_LINK);
    let click = events.filter(e => e.name === 'app_store_cta_clicked').pop();
    assert.deepStrictEqual(click.properties, { surface: 'website', from_page: '/', page_type: 'other', button: 'hero', apple_campaign: 'GoogleSearch', ...GOOGLE, from_campaign: true });
    ({ target } = await journey(base, `/hub?${google}`, [`/spanish-reading-practice/${exercises[0]}`, `/spanish-reading-practice/${exercises[1]}`], 'band'));
    assert.strictEqual(target, CAMPAIGN_LINK);
    click = events.filter(e => e.name === 'app_store_cta_clicked').pop();
    assert.strictEqual(click.properties.from_campaign, true);
    assert.strictEqual(click.properties.exercise, exercises[1]);
    assert.ok(!JSON.stringify(events).match(/gclid|fbclid|Cj0KCQ|IwAR/), 'click IDs never reach an event');
    assert.deepStrictEqual(events.filter(e => e.name === 'site_page_viewed').map(e => e.properties.from_campaign), [true, true, true, true]);
  });
});

test('journeys: Instagram tags survive the same way; a visitor without tags stays from_campaign=false', async () => {
  const instagram = 'utm_source=instagram&utm_medium=social&utm_campaign=instagram-profile';
  await withServer(async (base, events) => {
    let { html, target } = await journey(base, `/hub?${instagram}`, [`/spanish-reading-practice/${exercises[0]}`, '/'], 'nav');
    assert.strictEqual(target, sa.APP_STORE_URL);
    let click = events.filter(e => e.name === 'app_store_cta_clicked').pop();
    assert.deepStrictEqual(utmOf(`?${instagram}`), { utm_source: click.properties.utm_source, utm_medium: click.properties.utm_medium, utm_campaign: click.properties.utm_campaign });
    assert.strictEqual(click.properties.from_campaign, true);
    assert.strictEqual(click.properties.apple_campaign, null);
    // On a campaign visit every page link carries the tags except the privacy policy; canonical/og/JSON-LD stay clean.
    for (const h of links(html).filter(h => !/\.(png|ico|jpg)$/.test(h))) {
      if (h.startsWith('/privacy')) assert.ok(!h.includes('utm_'), h); else assert.deepStrictEqual(utmOf(h), utmOf(`?${instagram}`), h);
    }
    assert.match(html, /<link rel="canonical" href="https:\/\/comigo\.net\/">/);
    assert.match(html, /property="og:url" content="https:\/\/comigo\.net\/"/);
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) assert.ok(!m[1].includes('utm_'));

    ({ html, target } = await journey(base, '/hub', [`/spanish-reading-practice/${exercises[0]}`, '/'], 'menu'));
    assert.strictEqual(target, sa.APP_STORE_URL);
    assert.ok(links(html).every(h => !h.includes('utm_')), 'clean links on an organic visit');
    click = events.filter(e => e.name === 'app_store_cta_clicked').pop();
    assert.strictEqual(click.properties.from_campaign, false);
    assert.ok(!Object.keys(click.properties).some(k => k.startsWith('utm_')));
  });
});

test('unlisted pages: served with their own baked tags, counted as page_type unlisted, taps attributed to the recipient', async () => {
  const html = '<a href="/">Home</a><a href="/go/app-store?from=/p/a-small-town-k3f9x2&amp;loc=hero&amp;utm_source=laura&amp;utm_medium=influencer&amp;utm_campaign=a-small-town">App</a>';
  assert.deepStrictEqual(sa.bakedUtm(html), { utm_source: 'laura', utm_medium: 'influencer', utm_campaign: 'a-small-town' });
  assert.strictEqual(sa.bakedUtm('<a href="/go/app-store?from=/&amp;loc=hero">x</a>'), null);
  const events = [];
  const send = async (e) => { events.push(e); return true; };
  const app = express();
  app.use((req, res, next) => {
    if (req.path === '/p/a-small-town-k3f9x2') return sa.servePage(req, res, html, { pageType: 'unlisted', exercise: 'a-small-town-k3f9x2', utm: sa.bakedUtm(html) }, send);
    if (req.path === '/go/app-store') return sa.appStoreRedirect(req, res, send);
    next();
  });
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // A visitor arriving with someone else's tags on the URL still counts for the page's recipient.
    const res = await get(`${base}/p/a-small-town-k3f9x2?utm_source=google&utm_medium=cpc&utm_campaign=google-reading-practice`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), html, 'links already carry the page tags — nothing is appended');
    const cta = await get(`${base}/go/app-store?from=/p/a-small-town-k3f9x2&loc=hero&utm_source=laura&utm_medium=influencer&utm_campaign=a-small-town`);
    assert.strictEqual(cta.headers.get('location'), sa.APP_STORE_URL, 'no Apple campaign for influencer pages');
    await new Promise(r => setImmediate(r));
    assert.deepStrictEqual(events.map(e => [e.name, e.properties.page_type, e.properties.exercise, e.properties.utm_source, e.properties.from_campaign]), [
      ['site_page_viewed', 'unlisted', 'a-small-town-k3f9x2', 'laura', true],
      ['app_store_cta_clicked', 'unlisted', 'a-small-town-k3f9x2', 'laura', true],
    ]);
  } finally { server.close(); }
});

// --- the built site ----------------------------------------------------------

function builtPages() {
  const out = [];
  for (const f of fs.readdirSync(SITE_DIR)) if (f.endsWith('.html') && !f.includes('.template.')) out.push(path.join(SITE_DIR, f));
  for (const f of fs.readdirSync(path.join(SITE_DIR, 'examples'))) if (f.endsWith('.html')) out.push(path.join(SITE_DIR, 'examples', f));
  return out.filter(f => !/(nav|example-page|example-stage)\.html$/.test(f));
}

test('the built site loads no advertising pixel or third-party script', () => {
  for (const f of builtPages()) {
    const html = fs.readFileSync(f, 'utf8');
    assert.ok(!/oaiq|bzrcdn|openai\.com\/sdk|googletagmanager|gtag\(|posthog\.init|plausible/i.test(html), f);
    assert.ok(!/<script[^>]+src="https?:/i.test(html), `external script in ${f}`);
  }
});

test('every App Store button in the built site goes through /go/app-store with its page and position', () => {
  let buttons = 0;
  for (const f of builtPages()) {
    const html = fs.readFileSync(f, 'utf8');
    assert.ok(!/<a[^>]+href="https:\/\/apps\.apple\.com/.test(html), `direct App Store link in ${f}`);
    for (const m of html.matchAll(/<a[^>]+href="\/go\/app-store\?from=([^"&]+)&amp;loc=(\w+)"[^>]*>/g)) {
      buttons++;
      assert.match(m[1], /^\/[a-z0-9/-]*$/, f);
      assert.ok(['nav', 'menu', 'hero', 'band'].includes(m[2]), f);
      assert.match(m[0], /rel="noopener nofollow"/, f);
    }
  }
  assert.ok(buttons >= 20, `${buttons} buttons`);
});
