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

// Stable key by comic id (slug can change if the title is edited).
function bundleKey(comicId) {
  return `bundles/${comicId}.zip`;
}

// Stream a local file up to the bucket (multipart-safe for large bundles).
async function uploadBundle(comicId, filePath) {
  if (!objectStoreEnabled) return false;
  const upload = new Upload({
    client: client(),
    params: {
      Bucket: BUCKET,
      Key: bundleKey(comicId),
      Body: fs.createReadStream(filePath),
      ContentType: 'application/zip',
      // Cache aggressively at the CDN edge so a warmed object stays fast and
      // doesn't expire back to a slow origin fetch. Re-uploading the same key
      // (e.g. after a re-export) replaces the cached copy, so this is safe.
      CacheControl: 'public, max-age=2592000', // 30 days
    },
  });
  await upload.done();
  return true;
}

async function bundleExists(comicId) {
  if (!objectStoreEnabled) return false;
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: bundleKey(comicId) }));
    return true;
  } catch {
    return false;
  }
}

// Time-limited GET URL the reader can be redirected to. Tigris caches the
// underlying object at the edge, so repeat downloads are fast worldwide.
async function presignedBundleUrl(comicId, expiresIn = 3600) {
  if (!objectStoreEnabled) return null;
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: BUCKET, Key: bundleKey(comicId) }),
    { expiresIn }
  );
}

module.exports = {
  objectStoreEnabled,
  bundleKey,
  uploadBundle,
  bundleExists,
  presignedBundleUrl,
};
