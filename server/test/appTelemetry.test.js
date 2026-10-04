// Anonymous aggregate telemetry (services/appTelemetry): the allow-list, the
// forbidden properties, environment separation, the fixed identity, the
// global limiter and the HTTP route — and that nothing about a request
// (address, user agent) can reach PostHog or a log.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const t = require('../src/services/appTelemetry');

const COMMON = { app_version: '1.1.1', build_number: '204', entitlement: 'free', access_model: 'new_model' };
const FULL = {   // every event with its complete allowed property set
  aggregate_app_opened: {},
  aggregate_collection_viewed: { collection_id: 'col-1', collection_name: 'EL REY NEGRO', level: 'beginner' },
  aggregate_comic_started: { comic_id: 'comic-58336632', comic_name: 'Operadora de emergencias', collection_id: 'col-1', level: 'intermediate', is_free: true },
  aggregate_comic_page_viewed: { comic_id: 'comic-1', page_number: 3, total_pages: 14 },
  aggregate_comic_completed: { comic_id: 'comic-1', comic_name: 'La casa', collection_id: 'col-2', level: 'beginner' },
  aggregate_audio_played: { comic_id: 'comic-1', page_number: 2, audio_type: 'word' },
  aggregate_translation_revealed: { comic_id: 'comic-1', page_number: 2 },
  aggregate_practice_started: { comic_id: 'comic-1', practice_type: 'read_speak' },
  aggregate_practice_completed: { comic_id: 'comic-1', practice_type: 'quiz' },
  aggregate_locked_content_tapped: { comic_id: 'comic-9', collection_id: 'col-1' },
  aggregate_paywall_viewed: { source: 'comic_locked' },
  aggregate_trial_offer_viewed: { source: 'settings', product_id: 'com.comigo.unlimited.monthly' },
};
const batch = (events, environment = 'production') => ({ environment, events });

test('every aggregate event is accepted with its full property set plus the common properties', () => {
  for (const [name, properties] of Object.entries(FULL)) {
    const e = t.validateEvent({ name, properties: { ...properties, ...COMMON } });
    assert.ok(e, name);
    assert.deepStrictEqual(e, { name, properties: { ...properties, ...COMMON } });
  }
  assert.deepStrictEqual(Object.keys(t.SCHEMA).sort(), Object.keys(FULL).sort(), 'the test covers the whole schema');
});

test('the original (opt-in SDK) event names are not accepted here — the layers never share a name', () => {
  for (const sdkName of ['app_opened', 'comic_started', 'comic_page_viewed', 'paywall_viewed', 'trial_started', 'purchase_completed', 'subscription_started', 'spanish_level_selected']) {
    assert.strictEqual(t.validateEvent({ name: sdkName, properties: {} }), null, sdkName);
  }
});

test('an unknown property rejects the event — identifiers and request details can never ride along', () => {
  const base = { comic_id: 'comic-1', page_number: 1, total_pages: 2 };
  for (const [k, v] of Object.entries({
    distinct_id: 'abc', $distinct_id: 'abc', session_id: 's', $session_id: 's', device_id: 'd', install_id: 'i', idfv: 'x',
    app_account_token: '6f1c3b0e-5d8a-4f7e-9a41-2c9d7e0b3a55', ip: '1.2.3.4', $ip: '1.2.3.4', user_agent: 'x', $device_model: 'iPhone',
    locale: 'en_GB', timezone: 'Europe/London', spanish_level: 'beginner', email: 'a@b.c', text: 'Nueve uno uno', timestamp: '2026-10-04T00:00:00Z',
  })) {
    assert.strictEqual(t.validateEvent({ name: 'aggregate_comic_page_viewed', properties: { ...base, [k]: v } }), null, k);
  }
});

test('types, enumerations, ranges and required properties are enforced', () => {
  const bad = [
    ['aggregate_comic_page_viewed', { comic_id: 'comic-1', page_number: '3', total_pages: 14 }],          // string, not integer
    ['aggregate_comic_page_viewed', { comic_id: 'comic-1', page_number: 0, total_pages: 14 }],
    ['aggregate_comic_page_viewed', { comic_id: 'comic-1', page_number: 15, total_pages: 14 }],           // past the end
    ['aggregate_comic_page_viewed', { comic_id: 'comic-1', page_number: 1, total_pages: 501 }],
    ['aggregate_comic_page_viewed', { comic_id: 'comic-1', page_number: 1.5, total_pages: 2 }],
    ['aggregate_comic_page_viewed', { page_number: 1, total_pages: 2 }],                                   // comic_id required
    ['aggregate_audio_played', { comic_id: 'comic-1', audio_type: 'sentence_and_word' }],
    ['aggregate_practice_started', { comic_id: 'comic-1', practice_type: 'flow' }],                        // hidden mode
    ['aggregate_paywall_viewed', { source: 'email_campaign' }],
    ['aggregate_paywall_viewed', {}],
    ['aggregate_collection_viewed', { collection_id: 'col 1' }],                                           // id with a space
    ['aggregate_collection_viewed', { collection_name: 'x'.repeat(81) }],
    ['aggregate_collection_viewed', { collection_name: '<script>' }],
    ['aggregate_comic_started', { comic_id: 'comic-1', is_free: 'yes' }],
    ['aggregate_comic_started', { comic_id: 'comic-1', level: 'expert' }],
    ['aggregate_app_opened', { entitlement: 'vip' }],
    ['aggregate_app_opened', { access_model: 'old' }],
    ['aggregate_app_opened', { app_version: '1.1.1 (203)' }],
    ['aggregate_app_opened', { comic_id: 'comic-1' }],                                                      // not this event's property
  ];
  for (const [name, properties] of bad) assert.strictEqual(t.validateEvent({ name, properties }), null, `${name} ${JSON.stringify(properties)}`);
  assert.strictEqual(t.validateEvent({ name: 'aggregate_app_opened', properties: [] }), null);
  assert.strictEqual(t.validateEvent({ name: 'aggregate_app_opened', properties: 'x' }), null);
  assert.strictEqual(t.validateEvent(null), null);
  assert.strictEqual(t.validateEvent({ name: '__proto__', properties: {} }), null);
  assert.ok(t.validateEvent({ name: 'aggregate_app_opened' }), 'properties may be omitted');
});

test('a batch needs a known environment, 1–50 valid events, and at most 8 KB', () => {
  const ok = batch([{ name: 'aggregate_app_opened' }]);
  assert.deepStrictEqual(t.validateBatch(ok), { environment: 'production', events: [{ name: 'aggregate_app_opened', properties: {} }] });
  assert.strictEqual(t.validateBatch(batch([{ name: 'aggregate_app_opened' }], 'development')).environment, 'development');
  assert.strictEqual(t.validateBatch(batch([{ name: 'aggregate_app_opened' }], 'staging')).error, 'bad environment');
  assert.strictEqual(t.validateBatch({ events: [{ name: 'aggregate_app_opened' }] }).error, 'bad environment');
  assert.strictEqual(t.validateBatch(batch([])).error, 'no events');
  assert.strictEqual(t.validateBatch(batch(Array(51).fill({ name: 'aggregate_app_opened' }))).error, 'too many events');
  assert.ok(!t.validateBatch(batch(Array(50).fill({ name: 'aggregate_app_opened' }))).error);
  assert.strictEqual(t.validateBatch(batch([{ name: 'aggregate_app_opened' }, { name: 'nope' }])).error, 'invalid event', 'one bad event rejects the batch');
  assert.strictEqual(t.validateBatch(ok, t.MAX_BODY_BYTES + 1).error, 'too large');
  assert.strictEqual(t.validateBatch([]).error, 'bad body');
  assert.strictEqual(t.validateBatch({ environment: 'production', events: 'x' }).error, 'no events');
});

test('forwarder: one fixed identity, no person profile, no GeoIP, the right project per environment', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  const env = { FLY_APP_NAME: 'comic-generator', POSTHOG_PROJECT_TOKEN_PRODUCTION: 'phc_prod', POSTHOG_PROJECT_TOKEN_DEVELOPMENT: 'phc_dev' };
  const forward = t.makeForwarder({ fetchImpl, env, log: { warn() {} } });
  const events = [{ name: 'aggregate_comic_started', properties: { comic_id: 'comic-1', level: 'beginner' } }, { name: 'aggregate_app_opened', properties: {} }];
  assert.strictEqual(await forward('production', events), true);
  assert.strictEqual(await forward('development', events), true);
  assert.strictEqual(calls[0].body.api_key, 'phc_prod');
  assert.strictEqual(calls[1].body.api_key, 'phc_dev');
  assert.strictEqual(calls[0].url, 'https://eu.i.posthog.com/batch/');
  for (const item of calls[0].body.batch) {
    assert.strictEqual(item.distinct_id, t.DISTINCT_ID);
    assert.strictEqual(item.distinct_id, 'comigo-app-aggregate');
    assert.strictEqual(item.properties.$process_person_profile, false);
    assert.strictEqual(item.properties.$geoip_disable, true);
    assert.strictEqual(item.properties.$lib, 'comigo-app-aggregate');
    assert.match(item.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  }
  assert.deepStrictEqual(Object.keys(calls[0].body.batch[0].properties).sort(), ['$geoip_disable', '$lib', '$process_person_profile', 'comic_id', 'level']);
  // The payload carries nothing else: no $ip, $set, $anon_distinct_id, uuid, session.
  assert.ok(!JSON.stringify(calls[0].body).match(/\$ip|\$set|anon_distinct_id|session|uuid/));
});

test('forwarder: development without a dev token is dropped; never from a non-production server; never throws', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true }; };
  const quiet = { warn() {} };
  const prodOnly = { FLY_APP_NAME: 'a', POSTHOG_PROJECT_TOKEN_PRODUCTION: 'phc_prod' };
  assert.strictEqual(await t.makeForwarder({ fetchImpl, env: prodOnly, log: quiet })('development', [{ name: 'aggregate_app_opened', properties: {} }]), false);
  assert.strictEqual(await t.makeForwarder({ fetchImpl, env: { POSTHOG_PROJECT_TOKEN_PRODUCTION: 'phc_prod' }, log: quiet })('production', [{ name: 'aggregate_app_opened', properties: {} }]), false);
  assert.strictEqual(await t.makeForwarder({ fetchImpl, env: prodOnly, log: quiet })('production', []), false);
  assert.strictEqual(calls, 0);
  assert.strictEqual(await t.makeForwarder({ fetchImpl: async () => { throw new Error('down'); }, env: prodOnly, log: quiet })('production', [{ name: 'aggregate_app_opened', properties: {} }]), false);
  assert.strictEqual(await t.makeForwarder({ fetchImpl: async () => ({ ok: false, status: 500 }), env: prodOnly, log: quiet })('production', [{ name: 'aggregate_app_opened', properties: {} }]), false);
});

test('the global limiter counts requests and events per window with no per-client state', () => {
  let clock = 0;
  const allow = t.makeGlobalLimiter({ maxRequests: 3, maxEvents: 10, windowMs: 1000, now: () => clock });
  assert.strictEqual(allow(4), true);
  assert.strictEqual(allow(4), true);
  assert.strictEqual(allow(4), false, 'events over the window cap');
  assert.strictEqual(allow(1), true);
  assert.strictEqual(allow(1), false, 'requests over the window cap');
  clock = 1000;
  assert.strictEqual(allow(10), true, 'a new window');
});

// --- the route, through a real express app --------------------------------------
async function withRoute(fn, { allow } = {}) {
  const forwarded = [], logs = [];
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.post('/api/reader/telemetry', t.makeHandler({ forward: async (environment, events) => { forwarded.push({ environment, events }); return true; }, allow }));
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const origLog = console.log, origWarn = console.warn;
  console.log = (...a) => logs.push(a.join(' ')); console.warn = console.log;
  try { await fn(base, forwarded, logs); } finally { console.log = origLog; console.warn = origWarn; server.close(); }
}
const post = (base, body, headers = {}) => fetch(`${base}/api/reader/telemetry`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Comigo/1.1.1 (iPhone; iOS 19.0)', 'x-forwarded-for': '203.0.113.9', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const settle = () => new Promise(r => setImmediate(r));

test('route: a valid batch is accepted with 204 and forwarded as validated; nothing about the request is logged or forwarded', async () => {
  await withRoute(async (base, forwarded, logs) => {
    const res = await post(base, batch([
      { name: 'aggregate_comic_page_viewed', properties: { comic_id: 'comic-1', page_number: 1, total_pages: 12, app_version: '1.1.1' } },
      { name: 'aggregate_app_opened' },
    ], 'development'));
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('set-cookie'), null);
    await settle();
    assert.strictEqual(forwarded.length, 1);
    assert.strictEqual(forwarded[0].environment, 'development');
    assert.deepStrictEqual(forwarded[0].events[1], { name: 'aggregate_app_opened', properties: {} });
    assert.ok(!JSON.stringify(forwarded).match(/203\.0\.113|Comigo\/1\.1\.1|iPhone/), 'address and user agent never reach the forwarder');
    assert.deepStrictEqual(logs, [], 'nothing logged');
  });
});

test('route: bad batches get 400, oversize 413, and nothing is forwarded', async () => {
  await withRoute(async (base, forwarded) => {
    assert.strictEqual((await post(base, batch([{ name: 'comic_started', properties: { comic_id: 'c' } }]))).status, 400);
    assert.strictEqual((await post(base, batch([{ name: 'aggregate_app_opened', properties: { distinct_id: 'x' } }]))).status, 400);
    assert.strictEqual((await post(base, batch([{ name: 'aggregate_app_opened' }], 'testflight'))).status, 400);
    assert.strictEqual((await post(base, { events: [{ name: 'aggregate_app_opened' }] })).status, 400);
    const big = batch(Array(50).fill({ name: 'aggregate_collection_viewed', properties: { collection_name: 'x'.repeat(80), collection_id: 'y'.repeat(64) } }));
    assert.ok(JSON.stringify(big).length > t.MAX_BODY_BYTES);
    assert.strictEqual((await post(base, big)).status, 413);
    assert.strictEqual((await post(base, batch(Array(51).fill({ name: 'aggregate_app_opened' })))).status, 400);
    await settle();
    assert.strictEqual(forwarded.length, 0);
  });
});

test('route: over the global limit → 429, the batch is dropped (no queue)', async () => {
  let n = 0;
  await withRoute(async (base, forwarded) => {
    assert.strictEqual((await post(base, batch([{ name: 'aggregate_app_opened' }]))).status, 204);
    assert.strictEqual((await post(base, batch([{ name: 'aggregate_app_opened' }]))).status, 429);
    await settle();
    assert.strictEqual(forwarded.length, 1);
  }, { allow: () => n++ < 1 });
});
