const mongoose = require('mongoose');

// appAccountToken → anonymous PostHog distinct_id. Exists only while the user
// has opted into analytics (the app deletes it on opt-out). No personal data.
const PurchaseAttributionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  distinctId: { type: String, required: true },
  accessModel: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now },
  // Registration or the latest App Store notification for this purchase.
  // Deleted 12 months after this; deleted at once on analytics opt-out.
  lastActivityAt: { type: Date, default: Date.now, index: true },
}, { collection: 'purchase_attributions' });

// One row per App Store Server Notification — notificationUUID is the
// idempotency key (Apple retries with the same UUID). Event payloads are kept
// only while they may still be sent.
const AppStoreNotificationSchema = new mongoose.Schema({
  notificationUUID: { type: String, required: true, unique: true },
  type: String,
  subtype: String,
  environment: String,
  originalTransactionId: { type: String, index: true },
  token: { type: String, index: true },
  status: String,   // processing | sent | no_events | unattributed | pending_attribution | send_failed
  events: { type: Array, default: [] },
  receivedAt: Date,
  processedAt: Date,
}, { collection: 'appstore_notifications' });

// What we know about each subscription, keyed by originalTransactionId —
// enough to recognise the one trial→paid conversion.
const SubscriptionStateSchema = new mongoose.Schema({
  originalTransactionId: { type: String, required: true, unique: true },
  environment: String,
  productId: String,
  token: String,
  trialStartedAt: Date,
  paidStartedAt: Date,
  convertedAt: Date,
  conversionNotificationUUID: String,
  updatedAt: Date,
}, { collection: 'subscription_states' });

module.exports = {
  PurchaseAttribution: mongoose.model('PurchaseAttribution', PurchaseAttributionSchema),
  AppStoreNotification: mongoose.model('AppStoreNotification', AppStoreNotificationSchema),
  SubscriptionState: mongoose.model('SubscriptionState', SubscriptionStateSchema),
};
