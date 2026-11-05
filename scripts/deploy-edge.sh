#!/usr/bin/env bash
# Deploys the public edge (Cloudflare Tunnel + static site) to the dev server.
# Usage: pnpm deploy:edge      (host defaults to "adelie" via Tailscale)
set -euo pipefail

HOST="${ADELIE_HOST:-adelie}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ssh -o BatchMode=yes "adelie@$HOST" 'mkdir -p ~/adelie/infra/edge ~/adelie/apps/site'
rsync -a --delete "$ROOT/infra/edge/" "adelie@$HOST:adelie/infra/edge/"
rsync -a --delete "$ROOT/apps/site/" "adelie@$HOST:adelie/apps/site/"

# Cache busting: append ?v=<hash of site files> to asset URLs in the deployed HTML
# (repo HTML stays clean). Cloudflare caches assets, so a new URL forces a fresh copy.
REV=$(cd "$ROOT/apps/site" && find . -type f ! -name '*.html' -print0 | sort -z | xargs -0 shasum | shasum | cut -c1-10)
ssh -o BatchMode=yes "adelie@$HOST" "cd ~/adelie/apps/site && find . -name '*.html' -exec sed -i -E 's#(href|src)=\"/(style\.css|theme\.js|logo\.svg|favicon\.svg|favicon\.ico|apple-touch-icon\.png)\"#\1=\"/\2?v=$REV\"#g; s#href=\"/logo\.svg\#mark\"#href=\"/logo.svg?v=$REV\#mark\"#g' {} +"

ssh -o BatchMode=yes "adelie@$HOST" '
  cd ~/adelie/infra/edge
  docker compose up -d --remove-orphans
  docker compose restart site >/dev/null
  docker compose ps --format "table {{.Service}}\t{{.Status}}"
'
