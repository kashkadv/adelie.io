#!/usr/bin/env bash
# Deploys the public edge (Cloudflare Tunnel + static site) to the dev server.
# Usage: pnpm deploy:edge      (host defaults to "adelie" via Tailscale)
set -euo pipefail

HOST="${ADELIE_HOST:-adelie}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ssh -o BatchMode=yes "adelie@$HOST" 'mkdir -p ~/adelie/infra/edge ~/adelie/apps/site'
rsync -a --delete "$ROOT/infra/edge/" "adelie@$HOST:adelie/infra/edge/"
rsync -a --delete "$ROOT/apps/site/" "adelie@$HOST:adelie/apps/site/"
ssh -o BatchMode=yes "adelie@$HOST" '
  cd ~/adelie/infra/edge
  docker compose up -d --remove-orphans
  docker compose restart site >/dev/null
  docker compose ps --format "table {{.Service}}\t{{.Status}}"
'
