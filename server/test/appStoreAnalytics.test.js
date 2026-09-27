const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createProcessor, eventUuid } = require('../src/services/appStoreAnalytics');
const { memoryRepo } = require('../src/services/appStoreRepo');

const MONTHLY = 'com.comigo.unlimited.monthly';
const LIFETIME = 'com.comigo.unlimited.lifetime';
const TOKEN = '3f2a9c1e-7b44-4d0a-9e5f-1a2b3c4d5e6f';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1);

function setup({ failSends = 0, clock = { now: T0 + 10 * DAY } } = {}) {
  const repo = memoryRepo();
  const sent = [];
  let failures = failSends;
  const send = async (environment, distinctId, events) => {
    if (failures > 0) { failures--; throw new Error('PostHog 503'); }
    for (const e of events) sent.push({ environment, distinctId, ...e });
  };
  const processor = createProcessor({ repo, send, now: () => clock.now });
  return { repo, sent, processor, clock };
}

let seq = 0;
function note(type, subtype, tx, extra = {}) {
  seq++;
  return {
    environment: extra.environment || 'Sandbox',
    notification: { notificationType: type, subtype, notificationUUID: extra.uuid || `n-${seq}`, signedDate: extra.signedDate || tx.purchaseDate + 1000 },
    transaction: { originalTransactionId: 'otx-1', appAccountToken: TOKEN, productId: MONTHLY, ...tx },
  };
}
const trialTx = { transactionId: 't1', purchaseDate: T0, expiresDate: T0 + 7 * DAY, offerType: 1, offerDiscountType: 'FREE_TRIAL', price: 0 };
const paidTx = (id, day) => ({ transactionId: id, purchaseDate: T0 + day * DAY, expiresDate: T0 + (day + 30) * DAY, price: 7990 });
const names = (sent) => sent.map((e) => e.name);

async function withMapping(p) {
  await p.processor.registerMapping({ token: TOKEN, distinctId: 'anon-123', accessModel: 'new_model' });
}

test('7-day trial start: no server event (the app sends trial_started), trial remembered', async () => {
  const p = setup(); await withMapping(p);
  const r = await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', trialTx));
  assert.equal(r.status, 'no_events');
  assert.deepEqual(p.sent, []);
  assert.ok(p.repo.states.get('otx-1').trialStartedAt);
});

test('trial → first paid period: subscription_started(via_trial=true) + purchase_completed, once', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', trialTx));
  const conv = note('DID_RENEW', undefined, paidTx('t2', 7));
  await p.processor.processNotification(conv);
  assert.deepEqual(names(p.sent), ['subscription_started', 'purchase_completed']);
  assert.equal(p.sent[0].properties.via_trial, true);
  assert.equal(p.sent[1].properties.purchase_type, 'subscription');
  assert.equal(p.sent[0].distinctId, 'anon-123');
  assert.equal(p.sent[0].properties.access_model, 'new_model');
  assert.equal(p.sent[0].timestamp, new Date(T0 + 7 * DAY).toISOString(), 'dated at the start of the paid period');

  // Apple retries the same notification: nothing new is sent.
  const again = await p.processor.processNotification(conv);
  assert.equal(again.status, 'duplicate');
  assert.equal(p.sent.length, 2);
});

test('renewals after the conversion are subscription_renewed, never new subscriptions', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', trialTx));
  await p.processor.processNotification(note('DID_RENEW', undefined, paidTx('t2', 7)));
  await p.processor.processNotification(note('DID_RENEW', undefined, paidTx('t3', 37)));
  await p.processor.processNotification(note('DID_RENEW', undefined, paidTx('t4', 67)));
  assert.deepEqual(names(p.sent), ['subscription_started', 'purchase_completed', 'subscription_renewed', 'subscription_renewed']);
});

test('a second conversion-looking notification for the same subscription cannot convert again', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', trialTx));
  await Promise.all([
    p.processor.processNotification(note('DID_RENEW', undefined, paidTx('t2', 7))),
    p.processor.processNotification(note('DID_RENEW', 'BILLING_RECOVERY', paidTx('t2b', 7))),
  ]);
  assert.equal(p.sent.filter((e) => e.name === 'subscription_started').length, 1);
});

test('auto-renew turned off during the trial is visible, and is not an expiry', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', trialTx));
  await p.processor.processNotification(note('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_DISABLED', trialTx, { signedDate: T0 + 2 * DAY }));
  assert.deepEqual(names(p.sent), ['subscription_auto_renew_changed']);
  assert.equal(p.sent[0].properties.auto_renew, 'off');
  assert.equal(p.sent[0].properties.in_trial, true);
  assert.ok(!p.sent.some((e) => e.name === 'subscription_expired'));
});

test('trial ends without converting: subscription_expired(was_trial=true)', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', trialTx));
  await p.processor.processNotification(note('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_DISABLED', trialTx, { signedDate: T0 + 2 * DAY }));
  await p.processor.processNotification(note('EXPIRED', 'VOLUNTARY', trialTx, { signedDate: T0 + 7 * DAY }));
  const expired = p.sent.find((e) => e.name === 'subscription_expired');
  assert.equal(expired.properties.reason, 'voluntary');
  assert.equal(expired.properties.was_trial, true);
  assert.ok(!p.sent.some((e) => e.name === 'subscription_started'));
});

test('direct paid subscription (no trial): subscription_started(via_trial=false) + purchase_completed', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', paidTx('t1', 0)));
  assert.deepEqual(names(p.sent), ['subscription_started', 'purchase_completed']);
  assert.equal(p.sent[0].properties.via_trial, false);
  await p.processor.processNotification(note('DID_RENEW', undefined, paidTx('t2', 30)));
  assert.equal(p.sent.at(-1).name, 'subscription_renewed', 'its first renewal is a renewal, not a conversion');
});

test('resubscribing after a lapsed trial is a direct paid start, and its renewals are renewals', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', trialTx));
  await p.processor.processNotification(note('EXPIRED', 'VOLUNTARY', trialTx, { signedDate: T0 + 7 * DAY }));
  await p.processor.processNotification(note('SUBSCRIBED', 'RESUBSCRIBE', paidTx('t5', 40)));
  await p.processor.processNotification(note('DID_RENEW', undefined, paidTx('t6', 70)));
  assert.deepEqual(names(p.sent), ['subscription_expired', 'subscription_started', 'purchase_completed', 'subscription_renewed']);
  assert.equal(p.sent[1].properties.via_trial, false);
});

test('billing recovery after the trial counts as the conversion', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', trialTx));
  await p.processor.processNotification(note('DID_FAIL_TO_RENEW', 'GRACE_PERIOD', trialTx, { signedDate: T0 + 7 * DAY }));
  await p.processor.processNotification(note('DID_RENEW', 'BILLING_RECOVERY', paidTx('t2', 9)));
  assert.deepEqual(names(p.sent), ['subscription_started', 'purchase_completed']);
  assert.equal(p.sent[0].properties.via_trial, true);
});

test('refund and revocation: subscription_refunded with purchase_type', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('REFUND', undefined, paidTx('t2', 7)));
  await p.processor.processNotification(note('REVOKE', undefined, paidTx('t3', 37)));
  await p.processor.processNotification(note('REFUND', undefined, { transactionId: 'L1', originalTransactionId: 'otx-L', productId: LIFETIME, purchaseDate: T0, price: 49990 }));
  assert.deepEqual(names(p.sent), ['subscription_refunded', 'subscription_refunded', 'subscription_refunded']);
  assert.deepEqual(p.sent.map((e) => e.properties.purchase_type), ['subscription', 'subscription', 'lifetime']);
});

test('lifetime purchase: no server event (the app sends purchase_completed)', async () => {
  const p = setup(); await withMapping(p);
  const r = await p.processor.processNotification(note('ONE_TIME_CHARGE', undefined, { transactionId: 'L1', originalTransactionId: 'otx-L', productId: LIFETIME, purchaseDate: T0, price: 49990 }));
  assert.equal(r.status, 'no_events');
  assert.deepEqual(p.sent, []);
});

test('notification before the mapping exists waits, then is delivered when the app registers', async () => {
  const p = setup();
  const r = await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', paidTx('t1', 0)));
  assert.equal(r.status, 'pending_attribution');
  assert.deepEqual(p.sent, []);
  await withMapping(p);
  assert.deepEqual(names(p.sent), ['subscription_started', 'purchase_completed']);
  assert.equal(p.sent[0].distinctId, 'anon-123');
});

test('purchase made without analytics consent (no token) is never attributed', async () => {
  const p = setup(); await withMapping(p);
  const n = note('SUBSCRIBED', 'INITIAL_BUY', paidTx('t1', 0));
  delete n.transaction.appAccountToken;
  const r = await p.processor.processNotification(n);
  assert.equal(r.status, 'unattributed');
  assert.deepEqual(p.sent, []);
});

test('opting out deletes the mapping and discards anything still waiting', async () => {
  const p = setup();
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', paidTx('t1', 0)));
  await p.processor.deleteMapping(TOKEN);
  assert.equal(await p.repo.getMapping(TOKEN), null);
  const waiting = [...p.repo.notifications.values()][0];
  assert.equal(waiting.status, 'unattributed');
  assert.deepEqual(waiting.events, []);
  await p.processor.processNotification(note('DID_RENEW', undefined, paidTx('t2', 30)));
  assert.deepEqual(p.sent, [], 'later notifications for the token are not sent either');
});

test('a PostHog failure never fails processing, and the sweep retries with identical event ids', async () => {
  const p = setup({ failSends: 1 }); await withMapping(p);
  const r = await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', paidTx('t1', 0), { uuid: 'fixed-uuid' }));
  assert.equal(r.status, 'send_failed');
  await p.processor.sweep();
  assert.deepEqual(names(p.sent), ['subscription_started', 'purchase_completed']);
  assert.equal(p.sent[0].uuid, eventUuid('fixed-uuid', 'subscription_started'));
});

test('a notification left mid-processing is reprocessed with the same conversion events', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', trialTx));
  const conv = note('DID_RENEW', undefined, paidTx('t2', 7), { uuid: 'conv-1' });
  await p.processor.processNotification(conv);
  // Simulate a crash after sending: the row is still 'processing' and old.
  Object.assign(p.repo.notifications.get('conv-1'), { status: 'processing', receivedAt: new Date(T0) });
  await p.processor.processNotification(conv);
  const starts = p.sent.filter((e) => e.name === 'subscription_started');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].uuid, starts[1].uuid, 'same uuid + timestamp: PostHog de-duplicates');
  assert.ok(!p.sent.some((e) => e.name === 'subscription_renewed'));
});

test('Sandbox goes to the Development project, Production to Production', async () => {
  process.env.POSTHOG_PROJECT_TOKEN_PRODUCTION = 'phc_prod';
  process.env.POSTHOG_PROJECT_TOKEN_DEVELOPMENT = 'phc_dev';
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
  try {
    const { sendToPostHog } = require('../src/services/appStoreServer');
    const ev = [{ name: 'subscription_renewed', uuid: 'u', timestamp: new Date(T0).toISOString(), properties: { product_id: MONTHLY } }];
    await sendToPostHog('Sandbox', 'anon', ev);
    await sendToPostHog('Production', 'anon', ev);
    assert.deepEqual(calls.map((c) => c.body.api_key), ['phc_dev', 'phc_prod']);
    assert.equal(calls[0].url, 'https://eu.i.posthog.com/batch/');
    const sentProps = calls[0].body.batch[0].properties;
    assert.equal(sentProps.$process_person_profile, false);
    assert.equal(sentProps.$geoip_disable, true);
  } finally {
    global.fetch = realFetch;
  }
});

test('payloads not signed by Apple are rejected', async () => {
  const { verifyNotification, claimedEnvironment } = require('../src/services/appStoreServer');
  await assert.rejects(verifyNotification('not-a-jws'));
  // A well-formed ES256 JWS signed by some other key (no Apple certificate chain).
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = enc({ alg: 'ES256' });
  const payload = enc({ notificationType: 'TEST', notificationUUID: 'x', data: { environment: 'Sandbox', bundleId: 'com.comicreader.app' } });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const forged = `${header}.${payload}.${sig}`;
  assert.equal(claimedEnvironment(forged), 'Sandbox');
  await assert.rejects(verifyNotification(forged));
});

test('legacy (grandfathered) users: access_model from the app is attached to server events', async () => {
  const p = setup();
  await p.processor.registerMapping({ token: TOKEN, distinctId: 'anon-legacy', accessModel: 'legacy' });
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', paidTx('t1', 0)));
  assert.ok(p.sent.length > 0);
  assert.ok(p.sent.every((e) => e.properties.access_model === 'legacy' && e.distinctId === 'anon-legacy'));
});

test('re-registering after opting back in attributes later events to the new analytics ID', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.deleteMapping(TOKEN);
  await p.processor.registerMapping({ token: TOKEN, distinctId: 'anon-456', accessModel: 'new_model' });
  await p.processor.processNotification(note('SUBSCRIBED', 'INITIAL_BUY', paidTx('t1', 0)));
  assert.ok(p.sent.every((e) => e.distinctId === 'anon-456'));
});

test('an active subscriber keeps the mapping beyond 12 months: every renewal is activity', async () => {
  const p = setup(); await withMapping(p);
  for (let month = 1; month <= 18; month++) {
    p.clock.now = T0 + month * 30 * DAY;
    await p.processor.processNotification(note('DID_RENEW', undefined, paidTx(`r${month}`, month * 30)));
    await p.processor.sweep();
  }
  assert.ok(await p.repo.getMapping(TOKEN), 'still attributed after 18 months of renewals');
  assert.equal(p.sent.filter((e) => e.name === 'subscription_renewed').length, 18);
});

test('a notification with no analytics event still counts as subscription activity', async () => {
  const p = setup(); await withMapping(p);
  p.clock.now = T0 + 200 * DAY;
  await p.processor.processNotification(note('DID_FAIL_TO_RENEW', 'GRACE_PERIOD', paidTx('t1', 199)));
  assert.equal(new Date(p.repo.mappings.get(TOKEN).lastActivityAt).getTime(), T0 + 200 * DAY);
});

test('the mapping is deleted 12 months after the last subscription activity', async () => {
  const p = setup(); await withMapping(p);                       // registered at T0+10d
  p.clock.now = T0 + 40 * DAY;
  await p.processor.processNotification(note('EXPIRED', 'VOLUNTARY', paidTx('t1', 10)));   // last activity
  p.clock.now = T0 + 40 * DAY + 364 * DAY;
  await p.processor.sweep();
  assert.ok(await p.repo.getMapping(TOKEN), 'kept just under 12 months after the last activity');
  p.clock.now = T0 + 40 * DAY + 366 * DAY;
  await p.processor.sweep();
  assert.equal(await p.repo.getMapping(TOKEN), null, 'deleted once 12 months have passed');
});

test('turning analytics off deletes the mapping immediately, even for an active subscription', async () => {
  const p = setup(); await withMapping(p);
  await p.processor.processNotification(note('DID_RENEW', undefined, paidTx('t1', 5)));
  await p.processor.deleteMapping(TOKEN);
  assert.equal(await p.repo.getMapping(TOKEN), null);
});
