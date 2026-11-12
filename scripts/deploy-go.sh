#!/usr/bin/env bash
# Deploys the go.adelie.space Worker (ADR-0027) from the server, where the Cloudflare token lives.
# Usage: pnpm deploy:go      (host defaults to "adelie" via Tailscale)
set -euo pipefail

HOST="${ADELIE_HOST:-adelie}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ssh -o BatchMode=yes "adelie@$HOST" 'mkdir -p ~/adelie/infra/go'
rsync -a --delete "$ROOT/infra/go/" "adelie@$HOST:adelie/infra/go/"
ssh -o BatchMode=yes "adelie@$HOST" 'bash ~/adelie/infra/go/deploy.sh'
