#!/bin/bash
# Deploy ONLY committed code (git HEAD) to Railway.
#
# Three parallel chats share this working tree — a plain `railway up` would
# upload whatever half-finished work the other chats have on disk.
# Always deploy through this script.
#
#   ./scripts/deploy.sh              # the linked service
#   ./scripts/deploy.sh contribute   # a named service in this project
#
# `railway up <dir>` is not used: given a path outside the repo it fails with
# "prefix not found", so the archive is deployed from inside it instead. That
# means the CLI cannot read the project link from the working directory, so
# project and environment are resolved here and passed explicitly.
set -euo pipefail
cd "$(dirname "$0")/.."

service="${1:-}"
project=$(railway status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git archive HEAD | tar -x -C "$tmp"

echo "deploying $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
[ -n "$service" ] && echo "  → service: $service"

cd "$tmp"
railway up --detach --project "$project" --environment production \
  ${service:+--service "$service"}
