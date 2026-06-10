#!/bin/sh
set -e

# Create data directories on the persistent volume
mkdir -p /data/projects /data/uploads

# Symlink from app paths to volume paths
ln -sfn /data/projects /app/server/projects
ln -sfn /data/uploads /app/server/uploads

# Start the server
exec node server/src/index.js
