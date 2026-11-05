#!/usr/bin/env bash
# Pinterest API PoC (stage 0). Runs ON the dev server; token is read from ~/adelie/poc.env
# (PINTEREST_POC_TOKEN=...), never passed on the command line.
# Usage: ssh adelie@adelie 'bash -s' < scripts/pinterest-poc.sh
set -uo pipefail
set -a; . ~/adelie/poc.env; set +a
API=https://api.pinterest.com/v5
END=$(date -u +%F)
START=$(date -u -d '89 days ago' +%F)
TOO_OLD=$(date -u -d '120 days ago' +%F)

call() {
  local name=$1 path=$2
  echo "=== $name  GET $path"
  curl -s -D /tmp/poc.h -o /tmp/poc.b -w 'HTTP %{http_code}\n' \
    -H "Authorization: Bearer $PINTEREST_POC_TOKEN" "$API$path"
  grep -iE '^x-ratelimit|^x-userendpoint|^retry-after' /tmp/poc.h | tr -d '\r'
  head -c 1500 /tmp/poc.b; echo; echo
}

call "user_account" "/user_account"
call "boards" "/boards?page_size=5"
call "pins (+metrics)" "/pins?page_size=5&pin_metrics=true"
call "account analytics 90d" "/user_account/analytics?start_date=$START&end_date=$END&content_type=ORGANIC"
call "account analytics >90d (expect error)" "/user_account/analytics?start_date=$TOO_OLD&end_date=$END"
call "top pins" "/user_account/analytics/top_pins?start_date=$START&end_date=$END&sort_by=IMPRESSION&num_of_pins=5"
call "followers" "/user_account/followers?page_size=5"
