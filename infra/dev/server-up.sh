#!/usr/bin/env bash
# Run on the dev server: creates .env with random secrets (once) and starts the stack.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  umask 077
  {
    echo "BIND_ADDR=$(tailscale ip -4)"
    echo "POSTGRES_USER=adelie"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "POSTGRES_DB=adelie"
    echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
  } > .env
fi
docker compose up -d --wait
docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
