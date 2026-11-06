#!/usr/bin/env bash
# Deploys the application (api, web, worker) of one environment to the server.
# Usage: pnpm deploy:dev            (= scripts/deploy-app.sh dev)
#        ADELIE_HOST=192.168.3.158 pnpm deploy:dev
#
# Ships the committed HEAD (`git archive`, so no local files, .env or build output), builds the
# image on the server and restarts the containers. Secrets: ~/adelie/env/<env>.env on the server.
set -euo pipefail

ENV_NAME="${1:?usage: deploy-app.sh <dev|staging|prod>}"
HOST="${ADELIE_HOST:-adelie}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="adelie/app/$ENV_NAME"

cd "$ROOT"
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has uncommitted changes — commit first (only HEAD is deployed)." >&2
  exit 1
fi
REV=$(git rev-parse --short HEAD)
echo "Deploying $REV to $ENV_NAME on $HOST…"

git archive --format=tar HEAD | ssh -o BatchMode=yes "adelie@$HOST" "
  set -e
  rm -rf ~/$REMOTE_DIR/src && mkdir -p ~/$REMOTE_DIR/src && tar -x -C ~/$REMOTE_DIR/src
  echo $REV > ~/$REMOTE_DIR/src/REVISION
"

ssh -o BatchMode=yes "adelie@$HOST" "
  set -e
  ENV_FILE=~/adelie/env/$ENV_NAME.env
  test -f \$ENV_FILE || { echo \"Missing \$ENV_FILE on the server\" >&2; exit 1; }
  get() { sed -n \"s/^\$1=//p\" \$ENV_FILE | head -1; }
  cd ~/$REMOTE_DIR/src
  docker build -q -f infra/app/Dockerfile -t adelie-app:$ENV_NAME \
    --build-arg NEXT_PUBLIC_API_URL=\$(get NEXT_PUBLIC_API_URL) \
    --build-arg NEXT_PUBLIC_APP_ENV=\$(get NEXT_PUBLIC_APP_ENV) . >/dev/null
  APP_ENV=$ENV_NAME ENV_FILE=\$ENV_FILE docker compose -f infra/app/docker-compose.yml up -d --remove-orphans
  docker image prune -f >/dev/null
  APP_ENV=$ENV_NAME ENV_FILE=\$ENV_FILE docker compose -f infra/app/docker-compose.yml ps --format 'table {{.Service}}\t{{.Status}}'
"
echo "Deployed $REV to $ENV_NAME."
