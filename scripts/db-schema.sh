#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_PATH="$ROOT_DIR/db/schema.sql"

DBMATE_IMAGE="${DBMATE_IMAGE:-ghcr.io/amacneil/dbmate:2.12}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-app}"

MODE="${1:-help}"
NETWORK_NAME=""
POSTGRES_CONTAINER=""
TMP_SCHEMA=""

usage() {
  cat <<'EOF'
Usage: ./scripts/db-schema.sh <command>

Commands:
  update   Regenerate db/schema.sql from db/migrations using an ephemeral Postgres
  check    Verify db/schema.sql is in sync with db/migrations
  help     Show this help
EOF
}

cleanup() {
  if [[ -n "$TMP_SCHEMA" && -f "$TMP_SCHEMA" ]]; then
    rm -f "$TMP_SCHEMA"
  fi

  if [[ -n "$POSTGRES_CONTAINER" ]]; then
    docker rm -f "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  fi

  if [[ -n "$NETWORK_NAME" ]]; then
    docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
  fi
}

ensure_dependencies() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required to build and verify db/schema.sql" >&2
    exit 1
  fi
}

start_ephemeral_postgres() {
  NETWORK_NAME="db-schema-$RANDOM-$(date +%s)"
  POSTGRES_CONTAINER="${NETWORK_NAME}-pg"

  docker network create "$NETWORK_NAME" >/dev/null

  docker run -d --rm \
    --name "$POSTGRES_CONTAINER" \
    --network "$NETWORK_NAME" \
    -e POSTGRES_USER="$POSTGRES_USER" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e POSTGRES_DB="$POSTGRES_DB" \
    "$POSTGRES_IMAGE" >/dev/null

  for _ in $(seq 1 60); do
    if docker exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      return
    fi

    sleep 1
  done

  echo "Timed out waiting for ephemeral Postgres to become ready" >&2
  exit 1
}

dbmate() {
  local database_url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_CONTAINER}:5432/${POSTGRES_DB}?sslmode=disable"

  docker run --rm \
    --network "$NETWORK_NAME" \
    -e DATABASE_URL="$database_url" \
    -v "$ROOT_DIR/db:/db" \
    "$DBMATE_IMAGE" "$@"
}

dbmate_dump_to_file() {
  local output_file="$1"
  local output_dir
  local output_name
  local database_url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_CONTAINER}:5432/${POSTGRES_DB}?sslmode=disable"

  output_dir="$(dirname "$output_file")"
  output_name="$(basename "$output_file")"

  docker run --rm \
    --network "$NETWORK_NAME" \
    -e DATABASE_URL="$database_url" \
    -v "$ROOT_DIR/db:/db" \
    -v "$output_dir:/schema-output" \
    "$DBMATE_IMAGE" \
    --schema-file "/schema-output/$output_name" dump >/dev/null
}

generate_schema_to_file() {
  local output_file="$1"
  dbmate --no-dump-schema up >/dev/null
  dbmate_dump_to_file "$output_file"
}

update_schema() {
  # Force /tmp so the dockerized dbmate dump can write to the bind-mount on CI.
  # Some CI environments set TMPDIR to a non-world-writable directory.
  TMP_SCHEMA="$(mktemp "/tmp/db-schema.XXXXXX")"
  generate_schema_to_file "$TMP_SCHEMA"

  if [[ -f "$SCHEMA_PATH" ]] && cmp -s "$SCHEMA_PATH" "$TMP_SCHEMA"; then
    echo "db/schema.sql is already up to date"
    return
  fi

  mv "$TMP_SCHEMA" "$SCHEMA_PATH"
  chmod 644 "$SCHEMA_PATH"
  TMP_SCHEMA=""
  echo "Updated db/schema.sql"
}

check_schema() {
  if [[ ! -f "$SCHEMA_PATH" ]]; then
    echo "Missing db/schema.sql. Run ./scripts/db-schema.sh update and commit it." >&2
    exit 1
  fi

  # Force /tmp so the dockerized dbmate dump can write to the bind-mount on CI.
  # Some CI environments set TMPDIR to a non-world-writable directory.
  TMP_SCHEMA="$(mktemp "/tmp/db-schema.XXXXXX")"
  generate_schema_to_file "$TMP_SCHEMA"

  if ! diff -u "$SCHEMA_PATH" "$TMP_SCHEMA"; then
    echo "" >&2
    echo "db/schema.sql is out of sync with db/migrations." >&2
    echo "Run: ./scripts/db-schema.sh update" >&2
    exit 1
  fi

  echo "db/schema.sql is in sync with db/migrations"
}

case "$MODE" in
  update|check)
    ensure_dependencies
    trap cleanup EXIT
    start_ephemeral_postgres

    if [[ "$MODE" == "update" ]]; then
      update_schema
    else
      check_schema
    fi
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    echo "Unknown command: $MODE" >&2
    usage >&2
    exit 1
    ;;
esac
