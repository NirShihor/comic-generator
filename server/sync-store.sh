#!/bin/bash
# Sync comic exports from this machine to the fly.io volume so the
# reader-app store serves the latest bundles.
#
# Usage:
#   ./sync-store.sh                 sync exports modified in the last 24h
#   ./sync-store.sh comic-9832e1ed  sync one specific comic
#   ./sync-store.sh --all           sync every export
#
# Requires flyctl (logged in). Interim solution until file storage moves
# to cloud object storage.
set -euo pipefail

APP="comic-generator"
PROJECTS_DIR="$(cd "$(dirname "$0")/projects" && pwd)"
cd "$PROJECTS_DIR"

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

# Wake the fly machine and keep it awake — fly stops the machine when HTTP
# traffic goes quiet, and ssh uploads don't count as traffic, so long
# uploads get their connection killed mid-transfer without this.
echo "Waking fly machine..."
curl -s -o /dev/null --max-time 30 https://comic-generator.fly.dev/api/health || true
( while true; do curl -s -o /dev/null --max-time 10 https://comic-generator.fly.dev/api/health || true; sleep 20; done ) &
KEEPALIVE_PID=$!
trap 'kill $KEEPALIVE_PID 2>/dev/null' EXIT

for dir in $dirs; do
  id=$(dirname "$dir")
  tarfile="/tmp/sync-$id.tar"
  echo "--- $id"
  tar -cf "$tarfile" "$dir"
  echo "  uploading $(du -h "$tarfile" | cut -f1 | tr -d ' ')..."
  # Upload the tar fully BEFORE touching the existing export — deleting
  # first means a failed upload leaves the comic with no bundle at all.
  flyctl ssh console -a "$APP" -C "rm -f /data/sync-$id.tar" >/dev/null 2>&1 || true
  flyctl ssh sftp put "$tarfile" "/data/sync-$id.tar" -a "$APP" >/dev/null
  flyctl ssh console -a "$APP" -C "sh -c 'rm -rf /data/projects/$id/export && tar -xf /data/sync-$id.tar -C /data/projects && rm /data/sync-$id.tar'" >/dev/null 2>&1
  rm -f "$tarfile"
  echo "  done"
done

echo "All synced. Re-download the comic(s) in the reader app to get the new bundles."
