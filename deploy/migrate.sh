#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/.env.api"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy deploy/.env.api.example to deploy/.env.api and fill it in." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set in $ENV_FILE" >&2
  exit 1
fi

docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" \
  -v "$ROOT_DIR/db:/db" \
  ghcr.io/amacneil/dbmate:2.12 --no-dump-schema up
