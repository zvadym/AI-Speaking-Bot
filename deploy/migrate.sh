#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LANGUAGEBOT_CONFIG_DIR="${DEPLOY_CONFIG_DIR:-/etc/ai-speaking-bot}"
source "$ROOT_DIR/scripts/private-env.sh"
ENV_FILE="$API_ENV_FILE"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing private API_ENV_FILE: $ENV_FILE" >&2
  exit 1
fi

load_private_env --override "$ENV_FILE"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set in $ENV_FILE" >&2
  exit 1
fi

docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" \
  -v "$ROOT_DIR/db:/db" \
  ghcr.io/amacneil/dbmate:2.12 --no-dump-schema up
