// Anonymous aggregate product telemetry from the Comigo app (the reader's
// AggregateTelemetryService): COUNTS of actions, never users.
//
// The app posts small batches of allow-listed events; this module validates
// every event name, property name, type and value against SCHEMA, discards
// the rest, and forwards what passes to PostHog under ONE fixed identity for
// the whole app, with person profiles and GeoIP off. There is no device,
// install, session or user identifier anywhere in this path: nothing from the
// HTTP request (address, user agent, headers, timing) is stored, hashed,
// forwarded, logged or used as a key. Rate limiting is global (per process),
// not per client. Failed sends are dropped — no retry queue.
//
// The event names are deliberately distinct from the opt-in PostHog SDK
// layer's (aggregate_*), so a consenting user is never counted twice under
// one name.

const DISTINCT_ID = 'comigo-app-aggregate';
const MAX_EVENTS = 50;
const MAX_BODY_BYTES = 8 * 1024;
const ENVIRONMENTS = ['production', 'development'];

// --- value validators ---------------------------------------------------------
const id = v => typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v);
const name = v => typeof v === 'string' && v.length >= 1 && v.length <= 80 && !/[\u0000-\u001f<>]/.test(v);
const version = v => typeof v === 'string' && /^[A-Za-z0-9.+-]{1,32}$/.test(v);
const int = (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi;
const oneOf = list => v => typeof v === 'string' && list.includes(v);

const LEVELS = ['beginner', 'intermediate', 'advanced', 'mixed', 'unknown'];
const AUDIO_TYPES = ['sentence', 'word'];
const PRACTICE_TYPES = ['quiz', 'speaking', 'listening', 'repeat_practice', 'translate_speak', 'repeat_listen', 'origin_listen', 'key_phrases', 'read_speak'];
const PAYWALL_SOURCES = ['comic_locked', 'settings', 'trial_expired', 'landing_screen'];
const ENTITLEMENTS = ['free', 'trial', 'subscribed', 'lifetime'];
const ACCESS_MODELS = ['legacy', 'new_model'];

// Properties every event may carry (all optional).
const COMMON = {
  app_version: version,
  build_number: version,
  entitlement: oneOf(ENTITLEMENTS),
  access_model: oneOf(ACCESS_MODELS),
};

// Event → its own allowed properties (all optional unless listed in `required`).
const SCHEMA = {
  aggregate_app_opened: { props: {} },
  aggregate_collection_viewed: { props: { collection_id: id, collection_name: name, level: oneOf(LEVELS) } },
  aggregate_comic_started: { props: { comic_id: id, comic_name: name, collection_id: id, level: oneOf(LEVELS), is_free: v => typeof v === 'boolean' }, required: ['comic_id'] },
  aggregate_comic_page_viewed: { props: { comic_id: id, page_number: int(1, 500), total_pages: int(1, 500) }, required: ['comic_id', 'page_number', 'total_pages'] },
  aggregate_comic_completed: { props: { comic_id: id, comic_name: name, collection_id: id, level: oneOf(LEVELS) }, required: ['comic_id'] },
  aggregate_audio_played: { props: { comic_id: id, page_number: int(1, 500), audio_type: oneOf(AUDIO_TYPES) }, required: ['comic_id', 'audio_type'] },
  aggregate_translation_revealed: { props: { comic_id: id, page_number: int(1, 500) }, required: ['comic_id'] },
  aggregate_practice_started: { props: { comic_id: id, practice_type: oneOf(PRACTICE_TYPES) }, required: ['comic_id', 'practice_type'] },
  aggregate_practice_completed: { props: { comic_id: id, practice_type: oneOf(PRACTICE_TYPES) }, required: ['comic_id', 'practice_type'] },
  aggregate_locked_content_tapped: { props: { comic_id: id, collection_id: id }, required: ['comic_id'] },
  aggregate_paywall_viewed: { props: { source: oneOf(PAYWALL_SOURCES) }, required: ['source'] },
  aggregate_trial_offer_viewed: { props: { source: oneOf(PAYWALL_SOURCES), product_id: id }, required: ['source', 'product_id'] },
};

/**
 * Validate one event. Returns the clean event ({ name, properties } with only
 * allow-listed, valid properties) or null — any unknown or invalid property
 * rejects the whole event rather than being silently stripped, so a client
 * sending something it shouldn't is caught in tests rather than ignored.
 */
function validateEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const spec = Object.prototype.hasOwnProperty.call(SCHEMA, raw.name) ? SCHEMA[raw.name] : null;
  if (!spec) return null;
  const props = raw.properties == null ? {} : raw.properties;
  if (typeof props !== 'object' || Array.isArray(props)) return null;
  const allowed = { ...COMMON, ...spec.props };
  const clean = {};
  for (const [k, v] of Object.entries(props)) {
    const check = Object.prototype.hasOwnProperty.call(allowed, k) ? allowed[k] : null;
    if (!check || !check(v)) return null;
    clean[k] = v;
  }
  for (const k of spec.required || []) if (!(k in clean)) return null;
  if ('page_number' in clean && 'total_pages' in clean && clean.page_number > clean.total_pages) return null;
  return { name: raw.name, properties: clean };
}

/**
 * Validate a request body: { environment, events: [...] }. Returns
 * { environment, events } on success or { error } (a short reason, never
 * echoing the input).
 */
function validateBatch(body, bodyBytes) {
  if (bodyBytes != null && bodyBytes > MAX_BODY_BYTES) return { error: 'too large' };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad body' };
  if (!ENVIRONMENTS.includes(body.environment)) return { error: 'bad environment' };
  if (!Array.isArray(body.events) || body.events.length === 0) return { error: 'no events' };
  if (body.events.length > MAX_EVENTS) return { error: 'too many events' };
  const events = [];
  for (const raw of body.events) {
    const e = validateEvent(raw);
    if (!e) return { error: 'invalid event' };
    events.push(e);
  }
  return { environment: body.environment, events };
}

/**
 * The forwarder: `forward(environment, events)` sends validated events to the
 * PostHog project for that environment under the fixed identity. Production
 * events need POSTHOG_PROJECT_TOKEN_PRODUCTION; development ones go to
 * POSTHOG_PROJECT_TOKEN_DEVELOPMENT or are dropped when it isn't set — so a
 * TestFlight/Simulator build can never reach the production project. Only
 * sends from the production server (FLY_APP_NAME). Never throws.
 */
function makeForwarder({ fetchImpl = fetch, env = process.env, log = console } = {}) {
  return async function forward(environment, events) {
    if (!env.FLY_APP_NAME || !ENVIRONMENTS.includes(environment) || !events.length) return false;
    const token = environment === 'production' ? env.POSTHOG_PROJECT_TOKEN_PRODUCTION : env.POSTHOG_PROJECT_TOKEN_DEVELOPMENT;
    if (!token) return false;
    const timestamp = new Date().toISOString();   // the server's receipt time, for every event in the batch
    try {
      const host = env.POSTHOG_HOST || 'https://eu.i.posthog.com';
      const res = await fetchImpl(`${host}/batch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: token,
          batch: events.map(e => ({
            event: e.name,
            timestamp,
            distinct_id: DISTINCT_ID,
            properties: { ...e.properties, $lib: 'comigo-app-aggregate', $process_person_profile: false, $geoip_disable: true },
          })),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) log.warn(`[app-telemetry] PostHog ${res.status}`);
      return res.ok;
    } catch (err) {
      log.warn(`[app-telemetry] send failed: ${err.message}`);
      return false;
    }
  };
}

/**
 * A global (per process) limiter — no per-client state of any kind. Over the
 * limit, requests get 429 until the window moves on; only this telemetry is
 * affected, never the app.
 */
function makeGlobalLimiter({ maxRequests = 600, maxEvents = 20000, windowMs = 60 * 1000, now = Date.now } = {}) {
  let windowStart = now(), requests = 0, events = 0;
  return function allow(eventCount) {
    const t = now();
    if (t - windowStart >= windowMs) { windowStart = t; requests = 0; events = 0; }
    if (requests + 1 > maxRequests || events + eventCount > maxEvents) return false;
    requests += 1; events += eventCount;
    return true;
  };
}

/**
 * The express handler for POST /api/reader/telemetry. Responds 204 when the
 * batch is accepted (forwarding happens after the response, best-effort),
 * 400/413 for a bad batch, 429 when the global limit is hit. Nothing about the
 * request is logged.
 */
function makeHandler({ forward, allow = makeGlobalLimiter() }) {
  return (req, res) => {
    const declared = Number(req.headers['content-length']);
    const bytes = Number.isFinite(declared) ? declared : Buffer.byteLength(JSON.stringify(req.body || ''));
    if (bytes > MAX_BODY_BYTES) return res.status(413).end();
    const result = validateBatch(req.body, bytes);
    if (result.error) return res.status(400).json({ error: result.error });
    if (!allow(result.events.length)) return res.status(429).end();
    res.status(204).end();
    Promise.resolve(forward(result.environment, result.events)).catch(() => {});
  };
}

module.exports = {
  DISTINCT_ID, MAX_EVENTS, MAX_BODY_BYTES, SCHEMA, COMMON,
  validateEvent, validateBatch, makeForwarder, makeGlobalLimiter, makeHandler,
};
