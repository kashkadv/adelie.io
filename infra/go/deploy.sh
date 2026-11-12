#!/usr/bin/env bash
# Deploys the go.adelie.space Worker (ADR-0027) with the Cloudflare API. Runs on the server, where
# the token lives (~/adelie/env/dev.env): CF_ACCOUNT_ID, CF_API_TOKEN, GO_CLICK_SECRET, API_URL.
# Idempotent: creates the KV namespace once (prints its id for GO_KV_NAMESPACE_ID), uploads the
# script with its bindings and attaches the custom domain.
set -euo pipefail

ENV_FILE="${ENV_FILE:-$HOME/adelie/env/dev.env}"
get() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }
ACCOUNT=$(get CF_ACCOUNT_ID)
TOKEN=$(get CF_API_TOKEN)
SECRET=$(get GO_CLICK_SECRET)
API_URL=$(get API_URL)
HOSTNAME=go.adelie.space
ZONE=adelie.space
SCRIPT=adelie-go
DIR="$(cd "$(dirname "$0")" && pwd)"
for v in ACCOUNT TOKEN SECRET API_URL; do
  [ -n "${!v}" ] || { echo "Missing $v in $ENV_FILE" >&2; exit 1; }
done

cf() {
  local out
  out=$(curl -sS -H "Authorization: Bearer $TOKEN" "$@")
  if [ "$(jq -r '.success' <<<"$out")" != "true" ]; then
    echo "Cloudflare API error: $(jq -c '.errors' <<<"$out")" >&2
    exit 1
  fi
  printf '%s' "$out"
}
API=https://api.cloudflare.com/client/v4

# 1. The KV namespace (by title).
NS=$(cf "$API/accounts/$ACCOUNT/storage/kv/namespaces?per_page=100" |
  jq -r '.result[] | select(.title=="adelie-go-links") | .id')
if [ -z "$NS" ]; then
  NS=$(cf -X POST "$API/accounts/$ACCOUNT/storage/kv/namespaces" \
    -H 'Content-Type: application/json' --data '{"title":"adelie-go-links"}' | jq -r '.result.id')
  echo "Created KV namespace adelie-go-links"
fi
if [ "$(get GO_KV_NAMESPACE_ID)" != "$NS" ]; then
  echo "Set GO_KV_NAMESPACE_ID=$NS in $ENV_FILE and redeploy the app (pnpm deploy:dev)."
fi

# 2. The script with its bindings.
METADATA=$(jq -n --arg ns "$NS" --arg api "$API_URL" --arg secret "$SECRET" '{
  main_module: "worker.js",
  compatibility_date: "2026-10-01",
  bindings: [
    { type: "kv_namespace", name: "LINKS", namespace_id: $ns },
    { type: "plain_text", name: "API_URL", text: $api },
    { type: "secret_text", name: "CLICK_SECRET", text: $secret }
  ]
}')
cf -X PUT "$API/accounts/$ACCOUNT/workers/scripts/$SCRIPT" \
  -F "metadata=$METADATA;type=application/json" \
  -F "worker.js=@$DIR/worker.js;type=application/javascript+module" >/dev/null
echo "Uploaded Worker $SCRIPT"

# 3. The custom domain (Cloudflare creates the DNS record and certificate).
ZONE_ID=$(cf "$API/zones?name=$ZONE" | jq -r '.result[0].id')
cf -X PUT "$API/accounts/$ACCOUNT/workers/domains" -H 'Content-Type: application/json' \
  --data "$(jq -n --arg h "$HOSTNAME" --arg z "$ZONE_ID" --arg s "$SCRIPT" \
    '{hostname: $h, zone_id: $z, service: $s, environment: "production"}')" >/dev/null
echo "https://$HOSTNAME → $SCRIPT"
