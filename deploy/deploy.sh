#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/deploy"

LANGUAGEBOT_CONFIG_DIR="${DEPLOY_CONFIG_DIR:-/etc/ai-speaking-bot}"
source "$ROOT_DIR/scripts/private-env.sh"
python3 "$ROOT_DIR/scripts/private_env.py" check "$API_ENV_FILE" "$MINIAPP_ENV_FILE" --bots-dir "$ROOT_DIR/deploy/bots" --deployment
load_private_env --override "$API_ENV_FILE" "$MINIAPP_ENV_FILE"

"$ROOT_DIR/deploy/migrate.sh"

docker compose -f docker-compose.yml build

docker compose -f docker-compose.yml up -d --remove-orphans

docker compose -f docker-compose.yml exec -T api node ./scripts/telegram-webhooks.mjs set
