// Storage for appStoreAnalytics: MongoDB in production, memory in tests.
const { PurchaseAttribution, AppStoreNotification, SubscriptionState } = require('../models/AppStoreAnalytics');

const RETRYABLE = ['send_failed', 'pending_attribution'];
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;   // 12 months after last activity (privacy policy)

function mongoRepo() {
  return {
    async insertNotification(doc) {
      try {
        await AppStoreNotification.create(doc);
        return true;
      } catch (err) {
        if (err.code === 11000) return false;   // already received
        throw err;
      }
    },
    getNotification: (uuid) => AppStoreNotification.findOne({ notificationUUID: uuid }).lean(),
    updateNotification: (uuid, patch) => AppStoreNotification.updateOne({ notificationUUID: uuid }, { $set: patch }),
    getState: (otid) => SubscriptionState.findOne({ originalTransactionId: otid }).lean(),
    upsertState: (otid, patch) => SubscriptionState.updateOne({ originalTransactionId: otid }, { $set: patch }, { upsert: true }),
    async claimConversion(otid, at, notificationUUID) {
      // Atomic: only one notification can ever set convertedAt for a subscription.
      const res = await SubscriptionState.updateOne(
        { originalTransactionId: otid, $or: [{ convertedAt: null }, { conversionNotificationUUID: notificationUUID }] },
        { $set: { convertedAt: at, conversionNotificationUUID: notificationUUID } },
      );
      return res.matchedCount === 1;
    },
    getMapping: (token) => PurchaseAttribution.findOne({ token }).lean(),
    upsertMapping: (token, patch) => PurchaseAttribution.updateOne({ token }, { $set: patch }, { upsert: true }),
    touchMapping: (token, at) => PurchaseAttribution.updateOne({ token }, { $set: { lastActivityAt: at } }),
    deleteMapping: (token) => PurchaseAttribution.deleteOne({ token }),
    findDeliverableByToken: (token) => AppStoreNotification.find({ token, status: { $in: RETRYABLE } }).lean(),
    discardPendingForToken: (token) => AppStoreNotification.updateMany(
      { token, status: { $in: RETRYABLE } }, { $set: { status: 'unattributed', events: [] } }),
    findRetryable: () => AppStoreNotification.find({ status: 'send_failed' }).limit(500).lean(),
    async expirePending(before, nowMs = Date.now()) {
      await AppStoreNotification.updateMany(
        { status: 'pending_attribution', receivedAt: { $lt: before } }, { $set: { status: 'unattributed', events: [] } });
      const old = new Date(nowMs - RETENTION_MS);
      await AppStoreNotification.deleteMany({ receivedAt: { $lt: old } });
      await SubscriptionState.deleteMany({ updatedAt: { $lt: old } });
      // Mappings: 12 months after the last subscription activity (or registration).
      await PurchaseAttribution.deleteMany({ lastActivityAt: { $lt: old } });
    },
  };
}

function memoryRepo() {
  const notifications = new Map(), states = new Map(), mappings = new Map();
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  return {
    notifications, states, mappings,
    async insertNotification(doc) {
      if (notifications.has(doc.notificationUUID)) return false;
      notifications.set(doc.notificationUUID, { ...doc });
      return true;
    },
    getNotification: async (uuid) => clone(notifications.get(uuid)),
    updateNotification: async (uuid, patch) => { Object.assign(notifications.get(uuid), patch); },
    getState: async (otid) => clone(states.get(otid)),
    upsertState: async (otid, patch) => { states.set(otid, { ...(states.get(otid) || { originalTransactionId: otid }), ...patch }); },
    async claimConversion(otid, at, notificationUUID) {
      const s = states.get(otid);
      if (!s || (s.convertedAt && s.conversionNotificationUUID !== notificationUUID)) return false;
      s.convertedAt = at; s.conversionNotificationUUID = notificationUUID;
      return true;
    },
    getMapping: async (token) => clone(mappings.get(token)),
    upsertMapping: async (token, patch) => { mappings.set(token, { token, ...(mappings.get(token) || {}), ...patch }); },
    touchMapping: async (token, at) => { if (mappings.has(token)) mappings.get(token).lastActivityAt = at; },
    deleteMapping: async (token) => { mappings.delete(token); },
    findDeliverableByToken: async (token) => [...notifications.values()].filter((n) => n.token === token && RETRYABLE.includes(n.status)).map(clone),
    discardPendingForToken: async (token) => {
      for (const n of notifications.values()) if (n.token === token && RETRYABLE.includes(n.status)) { n.status = 'unattributed'; n.events = []; }
    },
    findRetryable: async () => [...notifications.values()].filter((n) => n.status === 'send_failed').map(clone),
    expirePending: async (before, nowMs = Date.now()) => {
      for (const n of notifications.values()) {
        if (n.status === 'pending_attribution' && new Date(n.receivedAt) < before) { n.status = 'unattributed'; n.events = []; }
      }
      const old = nowMs - RETENTION_MS;
      for (const [token, m] of mappings) if (new Date(m.lastActivityAt).getTime() < old) mappings.delete(token);
    },
  };
}

module.exports = { mongoRepo, memoryRepo };
