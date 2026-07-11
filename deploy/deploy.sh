#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/deploy"

if [[ ! -f .env.api ]]; then
  echo "Missing deploy/.env.api. Copy deploy/.env.api.example to deploy/.env.api and fill it in." >&2
  exit 1
fi

if [[ ! -f .env.miniapp ]]; then
  echo "Missing deploy/.env.miniapp. Copy deploy/.env.miniapp.example to deploy/.env.miniapp and fill it in." >&2
  exit 1
fi
set -a
source .env.api
source .env.miniapp
set +a

"$ROOT_DIR/deploy/migrate.sh"

docker compose -f docker-compose.yml build

docker compose -f docker-compose.yml up -d --remove-orphans

docker compose -f docker-compose.yml exec -T api node ./scripts/telegram-webhooks.mjs set
