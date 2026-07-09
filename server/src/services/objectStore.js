// Tigris (S3-compatible) object storage for comic download bundles.
//
// Credentials come from fly secrets (set by `fly storage create`): AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_ENDPOINT_URL_S3, BUCKET_NAME. They are read
// from the environment only — never hardcoded or committed.
//
// We mirror each comic's prebuilt {slug}.zip here on sync, and the reader's
// /bundle endpoint redirects to a presigned URL so downloads come from the Tigris
// CDN edge near each user instead of streaming from the single fly machine.

const fs = require('fs');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');

const BUCKET = process.env.BUCKET_NAME;
const ENDPOINT = process.env.AWS_ENDPOINT_URL_S3;

const objectStoreEnabled = !!(
  BUCKET &&
  ENDPOINT &&
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY
);

let _client = null;
function client() {
  if (!_client) {
    _client = new S3Client({
      region: process.env.AWS_REGION || 'auto',
      endpoint: ENDPOINT,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

// Object key by comic id, versioned by a short content hash of the bundle.
// Tigris caches by object PATH honouring our long max-age, and does NOT evict
// on overwrite — so a fixed key would pin every reader to the first upload for
// 30 days. Versioning the key means each re-export is a brand-new URL the CDN
// has never seen (guaranteed fresh); stale edges for old versions age out on
// their own. `version` is empty only for comics mirrored before this change or
// not yet re-synced, which fall back to the legacy fixed key.
function bundleKey(comicId, version) {
  return version ? `bundles/${comicId}-${version}.zip` : `bundles/${comicId}.zip`;
}

// Stream a local file up to the bucket (multipart-safe for large bundles).
async function uploadBundle(comicId, filePath, version) {
  if (!objectStoreEnabled) return false;
  const upload = new Upload({
    client: client(),
    params: {
      Bucket: BUCKET,
      Key: bundleKey(comicId, version),
      Body: fs.createReadStream(filePath),
      ContentType: 'application/zip',
      // Cache aggressively at the CDN edge — safe now that keys are versioned,
      // so a new bundle never collides with a cached older one.
      CacheControl: 'public, max-age=2592000', // 30 days
    },
  });
  await upload.done();
  return true;
}

async function bundleExists(comicId, version) {
  if (!objectStoreEnabled) return false;
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: bundleKey(comicId, version) }));
    return true;
  } catch {
    return false;
  }
}

// Time-limited GET URL the reader can be redirected to. Tigris caches the
// underlying object at the edge, so repeat downloads are fast worldwide.
async function presignedBundleUrl(comicId, version, expiresIn = 3600) {
  if (!objectStoreEnabled) return null;
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: BUCKET, Key: bundleKey(comicId, version) }),
    { expiresIn }
  );
}

// Pre-warm the CDN for a freshly-uploaded bundle: fetch it once so the first
// real reader isn't the one paying the cold origin-fetch cost. Warms the edge
// nearest wherever this runs (the fly machine's region) and pulls the object
// into Tigris's cache path. Drains the body without buffering it all in memory.
async function warmBundle(comicId, version) {
  if (!objectStoreEnabled) return false;
  try {
    const url = await presignedBundleUrl(comicId, version, 600);
    const res = await fetch(url);
    if (!res.ok || !res.body) return false;
    for await (const _chunk of res.body) { /* discard — we only want the fetch */ }
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  objectStoreEnabled,
  bundleKey,
  uploadBundle,
  bundleExists,
  presignedBundleUrl,
  warmBundle,
};
