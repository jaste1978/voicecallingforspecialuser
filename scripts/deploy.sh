#!/bin/bash
# Deploy ONLY committed code (git HEAD) to Railway.
# Three parallel chats share this working tree — a plain `railway up`
# would upload whatever half-finished work the other chats have on disk.
# Always deploy through this script.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git archive HEAD | tar -x -C "$tmp"
echo "deploying $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
railway up --detach "$tmp"
