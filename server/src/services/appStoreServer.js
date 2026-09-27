// Apple signature verification + PostHog delivery for App Store Server
// Notifications, and the processor that ties them to MongoDB.
const fs = require('fs');
const path = require('path');
const { SignedDataVerifier, Environment } = require('@apple/app-store-server-library');
const { createProcessor } = require('./appStoreAnalytics');
const { mongoRepo } = require('./appStoreRepo');

const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.comicreader.app';
const APP_APPLE_ID = Number(process.env.APPLE_APP_APPLE_ID || 6760253260);
const CERT_DIR = path.join(__dirname, '../../certs/apple');

let verifiers = null;
function getVerifiers() {
  if (!verifiers) {
    const roots = fs.readdirSync(CERT_DIR).filter((f) => f.endsWith('.cer')).map((f) => fs.readFileSync(path.join(CERT_DIR, f)));
    // Online checks: certificate revocation is confirmed with Apple (OCSP).
    verifiers = {
      Production: new SignedDataVerifier(roots, true, Environment.PRODUCTION, BUNDLE_ID, APP_APPLE_ID),
      Sandbox: new SignedDataVerifier(roots, true, Environment.SANDBOX, BUNDLE_ID),
    };
  }
  return verifiers;
}

/** The environment Apple's payload claims — used only to pick the verifier,
 *  which then rejects the payload if its signed contents disagree. */
function claimedEnvironment(signedPayload) {
  try {
    const body = JSON.parse(Buffer.from(String(signedPayload).split('.')[1], 'base64url').toString('utf8'));
    return body && body.data && body.data.environment === 'Sandbox' ? 'Sandbox' : 'Production';
  } catch {
    return 'Production';
  }
}

/**
 * Verifies the notification JWS (Apple certificate chain, signature, bundle
 * ID, app Apple ID, environment) and the nested transaction JWS. Throws on
 * anything that doesn't verify.
 */
async function verifyNotification(signedPayload) {
  const environment = claimedEnvironment(signedPayload);
  const verifier = getVerifiers()[environment];
  const notification = await verifier.verifyAndDecodeNotification(signedPayload);
  const signedTx = notification.data && notification.data.signedTransactionInfo;
  const transaction = signedTx ? await verifier.verifyAndDecodeTransaction(signedTx) : null;
  return { notification, transaction, environment };
}

/** Sandbox (TestFlight, sandbox testers) → Comigo Development; Production → Comigo Production. */
async function sendToPostHog(environment, distinctId, events) {
  const token = environment === 'Production'
    ? process.env.POSTHOG_PROJECT_TOKEN_PRODUCTION
    : process.env.POSTHOG_PROJECT_TOKEN_DEVELOPMENT;
  if (!token) throw new Error(`no PostHog project token configured for ${environment}`);
  const host = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';
  const res = await fetch(`${host}/batch/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: token,
      batch: events.map((e) => ({
        event: e.name,
        uuid: e.uuid,               // stable per notification + event: PostHog de-duplicates re-sends
        timestamp: e.timestamp,     // the App Store's own date, also stable across re-sends
        distinct_id: distinctId,
        properties: { ...e.properties, $lib: 'comigo-server', $process_person_profile: false, $geoip_disable: true },
      })),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`PostHog ${res.status}`);
}

const processor = createProcessor({ repo: mongoRepo(), send: sendToPostHog, log: (m) => console.warn(m) });

// Retry failed deliveries, drop stale pending ones, purge rows past retention.
setInterval(() => processor.sweep().catch((e) => console.warn('[appstore] sweep failed:', e.message)), 15 * 60 * 1000).unref();

module.exports = { verifyNotification, sendToPostHog, processor, claimedEnvironment };
