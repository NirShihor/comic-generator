#!/bin/sh
set -e

# Create data directories on the persistent volume
mkdir -p /data/projects /data/uploads

# Symlink from app paths to volume paths
# (rm first: ln cannot replace the real directories baked into the image)
rm -rf /app/server/projects /app/server/uploads
ln -s /data/projects /app/server/projects
ln -s /data/uploads /app/server/uploads

# Start the server
exec node server/src/index.js
