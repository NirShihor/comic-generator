// Aggregate, server-side measurement for comigo.net (the Google Search Ads
// experiment): how often the reading-practice pages are viewed, and how often
// the App Store buttons are tapped and where from — COUNTS only.
//
// Nothing is stored on or read from the visitor's device (no cookies, no
// browser storage, no scripts), and nothing identifies or recognises a
// visitor: no IP address, user agent, referrer, click ID (gclid) or any
// per-visitor/per-visit identifier is recorded or sent. Every event goes to
// PostHog under one fixed distinct_id with person profiles and GeoIP off.
//
// A campaign visit is carried through the visit by adding the ad's utm_*
// tags (campaign-level, identical for everyone who clicks that ad) to the
// page's internal links as it is served. The App Store buttons link to
// /go/app-store, which counts the click and redirects — to the Apple campaign
// link for campaign visitors, to the plain App Store page otherwise.

const APP_STORE_URL = 'https://apps.apple.com/app/id6760253260';
const APPLE_PROVIDER_TOKEN = '128624331';
// utm_campaign (Google Ads final URL suffix) → Apple campaign token (ct).
const APPLE_CAMPAIGNS = { 'google-reading-practice': 'GoogleSearch' };
const DISTINCT_ID = 'comigo-website';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const BUTTON_LOCATIONS = new Set(['nav', 'menu', 'hero', 'band']);

/** Only the five utm_* tags, each a short plain token; everything else (gclid…) is dropped. */
function cleanUtm(query) {
  const out = {};
  for (const k of UTM_KEYS) {
    const v = query && query[k];
    if (typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v)) out[k] = v;
  }
  return out;
}

/** The approved tags of a request as a query string ("?utm_source=…" or ""), for redirects — nothing else rides along. */
function campaignQuery(query) {
  const utm = cleanUtm(query);
  const qs = UTM_KEYS.filter(k => utm[k]).map(k => `${k}=${utm[k]}`).join('&');
  return qs ? `?${qs}` : '';
}

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|scrapy/i;
/** Crawlers, link previewers and scripts aren't counted (the user agent is only checked, never recorded). */
function isBot(userAgent) {
  return !userAgent || BOT_UA.test(userAgent);
}

/** A real page view by a browser: GET, not a prefetch/prerender, not a bot. */
function countable(req) {
  if (req.method !== 'GET') return false;
  const purpose = String(req.headers['sec-purpose'] || req.headers.purpose || '').toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('prerender')) return false;
  return !isBot(req.headers['user-agent']);
}

/**
 * Add the campaign's utm tags to every internal page link in the HTML (not
 * assets, not other sites, not the privacy policy — a legal page, no
 * attribution value), so the campaign is carried through the visit without
 * any storage. Only href="/…" links: the site has no other kind of internal
 * navigation (no scripted navigation, no forms).
 */
function addUtmToLinks(html, utm) {
  const qs = UTM_KEYS.filter(k => utm[k]).map(k => `${k}=${utm[k]}`).join('&amp;');
  if (!qs) return html;
  return html.replace(/href="(\/(?!\/|assets\/)[^"#]*)(#[^"]*)?"/g, (m, path, hash) => {
    if (/\.[a-z0-9]+(\?|$)/i.test(path)) return m;       // files (favicon.png, …)
    if (/^\/privacy(\?|$)/.test(path)) return m;
    const sep = path.includes('?') ? '&amp;' : '?';
    return `href="${path}${sep}${qs}${hash || ''}"`;
  });
}

/** Where the App Store button sends this visitor. */
function appStoreTarget(utm) {
  const ct = APPLE_CAMPAIGNS[utm.utm_campaign];
  return ct ? `https://apps.apple.com/app/apple-store/id6760253260?pt=${APPLE_PROVIDER_TOKEN}&ct=${encodeURIComponent(ct)}&mt=8` : APP_STORE_URL;
}

/** The page a button was on: "/", "/spanish-reading-practice", "/spanish-reading-practice/<slug>", … */
function cleanFrom(from) {
  return typeof from === 'string' && /^\/[a-z0-9/-]{0,80}$/.test(from) ? from : 'unknown';
}

function campaignProps(utm) {
  return { ...utm, from_campaign: Boolean(utm.utm_source || utm.utm_campaign) };
}

/** The event for a served reading-practice page. */
function pageViewEvent({ pageType, exercise, utm }) {
  return {
    name: 'site_page_viewed',
    properties: { surface: 'website', page_type: pageType, ...(exercise && { exercise }), ...campaignProps(utm) },
  };
}

/** The event for an App Store button tap. */
function ctaClickEvent({ from, loc, utm }) {
  const fromPage = cleanFrom(from);
  const exMatch = fromPage.match(/^\/spanish-reading-practice\/([a-z0-9-]+)$/);
  return {
    name: 'app_store_cta_clicked',
    properties: {
      surface: 'website',
      from_page: fromPage,
      page_type: exMatch ? 'exercise' : fromPage === '/spanish-reading-practice' ? 'hub' : 'other',
      ...(exMatch && { exercise: exMatch[1] }),
      button: BUTTON_LOCATIONS.has(loc) ? loc : 'unknown',
      apple_campaign: APPLE_CAMPAIGNS[utm.utm_campaign] || null,
      ...campaignProps(utm),
    },
  };
}

/**
 * Send one event to PostHog: fixed distinct_id, no person profile, no GeoIP,
 * no visitor data. Production server only (Fly), to the Production project;
 * never throws.
 */
function makeSender({ fetchImpl = fetch, env = process.env, log = console } = {}) {
  return async function send(event) {
    const token = env.POSTHOG_PROJECT_TOKEN_PRODUCTION;
    if (!env.FLY_APP_NAME || !token) return false;         // local/dev servers never send
    try {
      const host = env.POSTHOG_HOST || 'https://eu.i.posthog.com';
      const res = await fetchImpl(`${host}/batch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: token,
          batch: [{
            event: event.name,
            timestamp: new Date().toISOString(),
            distinct_id: DISTINCT_ID,
            properties: { ...event.properties, $lib: 'comigo-site-server', $process_person_profile: false, $geoip_disable: true },
          }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) log.warn(`[site-analytics] PostHog ${res.status}`);
      return res.ok;
    } catch (err) {
      log.warn(`[site-analytics] send failed: ${err.message}`);
      return false;
    }
  };
}

/**
 * Serve a comigo.net HTML page: campaign tags carried into its links, and a
 * page view counted for the reading-practice hub and exercises.
 * `page` = { pageType: 'hub' | 'exercise' | 'other', exercise? }.
 */
function servePage(req, res, html, page, send) {
  const utm = cleanUtm(req.query);
  if (page.pageType !== 'other' && countable(req)) {
    Promise.resolve(send(pageViewEvent({ ...page, utm }))).catch(() => {});
  }
  res.set('Cache-Control', 'no-store');
  res.type('html').send(addUtmToLinks(html, utm));
}

/** GET /go/app-store?from=…&loc=…[&utm_…] — count the tap, redirect to the App Store. */
function appStoreRedirect(req, res, send) {
  const utm = cleanUtm(req.query);
  if (countable(req)) {
    Promise.resolve(send(ctaClickEvent({ from: req.query.from, loc: req.query.loc, utm }))).catch(() => {});
  }
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.redirect(302, appStoreTarget(utm));
}

module.exports = {
  APP_STORE_URL, APPLE_CAMPAIGNS, DISTINCT_ID, cleanUtm, campaignQuery, isBot, countable, addUtmToLinks, appStoreTarget,
  pageViewEvent, ctaClickEvent, makeSender, servePage, appStoreRedirect,
};
