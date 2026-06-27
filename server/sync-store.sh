#!/bin/bash
# Sync comic exports from this machine to the fly.io volume so the
# reader-app store serves the latest bundles.
#
# Usage:
#   ./sync-store.sh                 sync exports modified in the last 24h
#   ./sync-store.sh comic-9832e1ed  sync one specific comic
#   ./sync-store.sh --all           sync every export
#
# Uploads each export over HTTPS to /api/comics/:id/upload-bundle (fly's fast,
# reliable path) — NOT the WireGuard sftp tunnel, which hangs on large files.
#
# Requires: curl, and AUTH_PASSWORD set to the deployed app's login password
# (so the upload passes the auth cookie). Override the target with COMIC_SYNC_URL.
set -euo pipefail

BASE_URL="${COMIC_SYNC_URL:-https://comic-generator.fly.dev}"
PROJECTS_DIR="$(cd "$(dirname "$0")/projects" && pwd)"
cd "$PROJECTS_DIR"

# Auth cookie = sha256(AUTH_PASSWORD), matching the server's generateToken().
if [ -z "${AUTH_PASSWORD:-}" ]; then
  echo "Warning: AUTH_PASSWORD is not set — uploads will fail if the server has a login password." >&2
  echo "         Run:  export AUTH_PASSWORD='<your app password>'" >&2
fi
token=$(printf %s "${AUTH_PASSWORD:-}" | shasum -a 256 | awk '{print $1}')

# Pick which comic export dirs to sync
if [ "${1:-}" = "--all" ]; then
  dirs=$(ls -d comic-*/export 2>/dev/null || true)
elif [ -n "${1:-}" ]; then
  [ -d "$1/export" ] || { echo "No export dir for $1"; exit 1; }
  dirs="$1/export"
else
  dirs=$(find . -maxdepth 2 -name export -type d -mtime -1 | sed 's|^\./||' || true)
fi

[ -n "$dirs" ] && dirs=$(echo "$dirs" | sort) || { echo "Nothing to sync (no exports modified in the last 24h)."; exit 0; }

echo "Will sync:"
echo "$dirs" | sed 's/^/  /'

# Wake the fly machine (auto_start_machines brings it up on the first request).
echo "Waking fly machine..."
curl -s -o /dev/null --max-time 60 "$BASE_URL/api/health" || true

# Retry a command a few times — covers a cold machine still spinning up or a
# transient network blip mid-upload.
retry() {
  local attempts=3 n=1
  until "$@"; do
    if [ "$n" -ge "$attempts" ]; then
      echo "  ! failed after $attempts attempts" >&2
      return 1
    fi
    echo "  retry $n/$attempts..." >&2
    n=$((n + 1))
    sleep 5
  done
}

for dir in $dirs; do
  id=$(dirname "$dir")
  tarfile="/tmp/sync-$id.tar"
  echo "--- $id"
  # COPYFILE_DISABLE stops macOS tar from adding ._ AppleDouble sidecar files,
  # which otherwise pollute the export dir on the volume.
  COPYFILE_DISABLE=1 tar -cf "$tarfile" "$dir"
  echo "  uploading $(du -h "$tarfile" | cut -f1 | tr -d ' ') over HTTPS..."
  retry curl -sS --fail-with-body --max-time 1800 \
    -H "Cookie: auth_token=$token" \
    -F "bundle=@$tarfile" \
    "$BASE_URL/api/comics/$id/upload-bundle" -o /dev/null
  rm -f "$tarfile"
  echo "  done"
done

echo "All synced. Re-download the comic(s) in the reader app to get the new bundles."
