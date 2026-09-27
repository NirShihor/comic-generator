// Subscription analytics from App Store Server Notifications V2.
//
// Apple reports what happens to a subscription while the app is closed
// (trial conversions, renewals, expiry, refunds). This module turns verified
// notifications into Comigo's analytics events and sends them to PostHog under
// the anonymous analytics ID the app registered for the purchase's
// appAccountToken — only for users who opted into analytics. Nothing here
// affects purchasing or entitlement, which StoreKit handles on the device.
//
// Event sources (each event has exactly one):
//   app    — trial_offer_viewed, trial_started, purchase_completed (lifetime)
//   server — subscription_started, purchase_completed (subscription),
//            subscription_renewed, subscription_auto_renew_changed,
//            subscription_expired, subscription_refunded
const { v5: uuidv5 } = require('uuid');

const LIFETIME_PRODUCT_ID = 'com.comigo.unlimited.lifetime';
// Fixed namespace so a notification always maps to the same PostHog event uuids.
const EVENT_NAMESPACE = '6f1c3b0e-5d8a-4f7e-9a41-2c9d7e0b3a55';
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const OFFER_TYPE_INTRODUCTORY = 1;

function isFreeTrialTx(tx) {
  if (!tx || tx.offerType !== OFFER_TYPE_INTRODUCTORY) return false;
  if (tx.offerDiscountType) return tx.offerDiscountType === 'FREE_TRIAL';
  return tx.price === 0;   // older payloads without offerDiscountType
}

function isPaidTx(tx) {
  return !!tx && !isFreeTrialTx(tx) && (tx.price == null || tx.price > 0);
}

function purchaseType(tx) {
  return tx && tx.productId === LIFETIME_PRODUCT_ID ? 'lifetime' : 'subscription';
}

function iso(ms) {
  return new Date(ms).toISOString();
}

/**
 * The events a notification implies, given what we already know about the
 * subscription. Pure: no I/O. `conversion` asks the caller to claim the one
 * trial→paid conversion for this originalTransactionId atomically; the
 * conversion events are only kept if that claim succeeds.
 */
function deriveEvents(notification, tx, state) {
  const type = notification.notificationType;
  const subtype = notification.subtype || null;
  const productId = tx && tx.productId;
  const at = (ms) => iso(ms || notification.signedDate || Date.now());
  const ev = (name, properties, ms) => ({ name, properties: { product_id: productId, ...properties }, timestamp: at(ms) });
  const out = { events: [], statePatch: {}, conversion: null };
  if (!tx) return out;

  switch (type) {
    case 'SUBSCRIBED': {
      if (isFreeTrialTx(tx)) {
        // trial_started is sent by the app; remember the trial for conversion.
        out.statePatch.trialStartedAt = new Date(tx.purchaseDate);
        out.statePatch.paidStartedAt = null;
        out.statePatch.convertedAt = null;
      } else if (isPaidTx(tx)) {
        out.statePatch.paidStartedAt = new Date(tx.purchaseDate);
        out.events.push(ev('subscription_started', { via_trial: false }, tx.purchaseDate));
        out.events.push(ev('purchase_completed', { purchase_type: 'subscription' }, tx.purchaseDate));
      }
      break;
    }
    case 'DID_RENEW': {
      if (!isPaidTx(tx)) break;
      const trialAwaitingConversion = state && state.trialStartedAt && !state.paidStartedAt
        && (!state.convertedAt || state.conversionNotificationUUID === notification.notificationUUID);
      if (trialAwaitingConversion) {
        // First paid period after the free trial (on time, or via billing recovery).
        out.conversion = {
          at: new Date(tx.purchaseDate),
          events: [
            ev('subscription_started', { via_trial: true }, tx.purchaseDate),
            ev('purchase_completed', { purchase_type: 'subscription' }, tx.purchaseDate),
          ],
          renewalFallback: [ev('subscription_renewed', {}, tx.purchaseDate)],
        };
      } else {
        out.events.push(ev('subscription_renewed', {}, tx.purchaseDate));
      }
      break;
    }
    case 'DID_CHANGE_RENEWAL_STATUS': {
      if (subtype !== 'AUTO_RENEW_ENABLED' && subtype !== 'AUTO_RENEW_DISABLED') break;
      // Turning auto-renew off is NOT an expiry: access continues until the
      // period (trial or paid) actually ends, which Apple reports as EXPIRED.
      const inTrial = isFreeTrialTx(tx) && (!tx.expiresDate || tx.expiresDate > (notification.signedDate || Date.now()));
      out.events.push(ev('subscription_auto_renew_changed', {
        auto_renew: subtype === 'AUTO_RENEW_ENABLED' ? 'on' : 'off',
        in_trial: inTrial,
      }));
      break;
    }
    case 'EXPIRED': {
      out.events.push(ev('subscription_expired', {
        reason: subtype ? subtype.toLowerCase() : 'unknown',
        was_trial: isFreeTrialTx(tx),
      }));
      break;
    }
    case 'REFUND':
    case 'REVOKE': {
      out.events.push(ev('subscription_refunded', { purchase_type: purchaseType(tx) }));
      break;
    }
    default:
      // ONE_TIME_CHARGE (lifetime: reported by the app), TEST, DID_FAIL_TO_RENEW,
      // GRACE_PERIOD_EXPIRED, OFFER_REDEEMED, PRICE_INCREASE, … — recorded, no event.
      break;
  }
  return out;
}

function eventUuid(notificationUUID, name) {
  return uuidv5(`${notificationUUID}:${name}`, EVENT_NAMESPACE);
}

/**
 * Wires derivation to storage and PostHog. `repo` is the storage interface
 * (Mongo in production, memory in tests); `send(environment, distinctId,
 * events)` delivers to the right PostHog project and throws on failure.
 */
function createProcessor({ repo, send, log = () => {}, now = () => Date.now() }) {
  async function deliver(doc, mapping) {
    if (!doc.events || !doc.events.length) return 'no_events';
    try {
      await send(doc.environment, mapping.distinctId, doc.events.map((e) => ({
        ...e,
        properties: mapping.accessModel ? { ...e.properties, access_model: mapping.accessModel } : e.properties,
      })));
      return 'sent';
    } catch (err) {
      log(`[appstore] PostHog send failed for ${doc.notificationUUID}: ${err.message}`);
      return 'send_failed';
    }
  }

  async function processNotification({ notification, transaction, environment }) {
    const notificationUUID = notification.notificationUUID;
    const token = transaction && transaction.appAccountToken ? String(transaction.appAccountToken).toLowerCase() : null;
    const originalTransactionId = transaction ? transaction.originalTransactionId : null;

    const inserted = await repo.insertNotification({
      notificationUUID,
      type: notification.notificationType,
      subtype: notification.subtype || null,
      environment,
      originalTransactionId,
      token,
      status: 'processing',
      receivedAt: new Date(now()),
    });
    if (!inserted) {
      const existing = await repo.getNotification(notificationUUID);
      const stale = existing && existing.status === 'processing' && now() - new Date(existing.receivedAt).getTime() > 5 * 60 * 1000;
      if (!stale) return { status: 'duplicate' };
    }

    const state = originalTransactionId ? await repo.getState(originalTransactionId) : null;
    const derived = deriveEvents(notification, transaction, state);
    let events = derived.events;
    if (derived.conversion) {
      // True for the first notification to claim it — and again for that same
      // notification if it's reprocessed, so a retry re-sends identical events.
      const claimed = await repo.claimConversion(originalTransactionId, derived.conversion.at, notificationUUID);
      events = claimed ? derived.conversion.events : derived.conversion.renewalFallback;
    }
    if (originalTransactionId) {
      await repo.upsertState(originalTransactionId, {
        ...derived.statePatch,
        environment,
        productId: transaction.productId,
        ...(token && { token }),
        updatedAt: new Date(now()),
      });
    }
    events = events.map((e) => ({ ...e, uuid: eventUuid(notificationUUID, e.name) }));

    // Any verified notification about this purchase is subscription activity:
    // it keeps the mapping alive while the subscription is active (monthly
    // renewals, billing retries, …). The purge deletes it 12 months after the
    // last such activity; opting out deletes it at once.
    if (token) await repo.touchMapping(token, new Date(now()));

    let status;
    if (!events.length) status = 'no_events';
    else if (!token) status = 'unattributed';       // purchase made without analytics consent
    else {
      const mapping = await repo.getMapping(token);
      status = mapping ? await deliver({ notificationUUID, environment, events }, mapping) : 'pending_attribution';
    }
    await repo.updateNotification(notificationUUID, {
      status,
      // Only keep event payloads while they may still be sent.
      events: status === 'pending_attribution' || status === 'send_failed' ? events : [],
      processedAt: new Date(now()),
    });
    return { status, events };
  }

  async function registerMapping({ token, distinctId, accessModel }) {
    await repo.upsertMapping(token, { distinctId, accessModel: accessModel || null, updatedAt: new Date(now()), lastActivityAt: new Date(now()) });
    const mapping = await repo.getMapping(token);
    const waiting = await repo.findDeliverableByToken(token);
    for (const doc of waiting) {
      const status = await deliver(doc, mapping);
      await repo.updateNotification(doc.notificationUUID, { status, events: status === 'send_failed' ? doc.events : [] });
    }
    return { delivered: waiting.length };
  }

  async function deleteMapping(token) {
    await repo.deleteMapping(token);
    // Consent withdrawn: anything still waiting is never sent.
    await repo.discardPendingForToken(token);
  }

  async function sweep() {
    for (const doc of await repo.findRetryable()) {
      const mapping = doc.token && await repo.getMapping(doc.token);
      if (mapping) {
        const status = await deliver(doc, mapping);
        await repo.updateNotification(doc.notificationUUID, { status, events: status === 'send_failed' ? doc.events : [] });
      }
    }
    await repo.expirePending(new Date(now() - PENDING_TTL_MS), now());
  }

  return { processNotification, registerMapping, deleteMapping, sweep };
}

module.exports = { deriveEvents, createProcessor, isFreeTrialTx, isPaidTx, eventUuid, LIFETIME_PRODUCT_ID };
