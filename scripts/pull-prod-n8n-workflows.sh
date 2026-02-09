#!/usr/bin/env bash
set -euo pipefail

# Pull exported workflows JSON from a remote n8n instance (Docker Compose) and
# optionally sync deploy/bots/*.json locale/credential values from it.

DEPLOY_HOST="${DEPLOY_HOST:-languagebot}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/ai-speaking-bot}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
PROJECT="${PROJECT:-languagebot}"

OUT_DIR="${OUT_DIR:-deploy/workflows/.prod-export}"
OUT_FILE="${OUT_FILE:-${OUT_DIR}/workflows-export.json}"

SYNC_BOTS="${SYNC_BOTS:-true}"
BOTS_DIR="${BOTS_DIR:-deploy/bots}"

log() {
  echo "==> $1"
}

mkdir -p "${OUT_DIR}"

log "Check SSH connectivity to ${DEPLOY_HOST}"
ssh -o BatchMode=yes -o ConnectTimeout=10 "${DEPLOY_HOST}" "echo 'SSH OK'" >/dev/null

log "Export workflows from remote n8n"
ssh "${DEPLOY_HOST}" \
  "DEPLOY_DIR='${DEPLOY_DIR}' COMPOSE_FILE='${COMPOSE_FILE}' PROJECT='${PROJECT}' bash -se" <<'REMOTE' >"${OUT_FILE}"
set -euo pipefail

cd "${DEPLOY_DIR}"

dc() {
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" "$@"
}

# Export all workflows as JSON. Prefer exporting into a temp file, then cat it,
# to avoid mixed stdout logs for some n8n CLI variants.
dc run -T --rm --no-deps --entrypoint sh n8n -lc '
  set -euo pipefail
  tmp="/tmp/workflows-export.json"
  if n8n export:workflow --all --output "$tmp" >/dev/null 2>&1; then
    cat "$tmp"
    exit 0
  fi
  # Fallback for older CLI: export to stdout
  n8n export:workflow --all
'
REMOTE

log "Saved export to ${OUT_FILE}"

if [[ "${SYNC_BOTS}" == "true" ]]; then
  log "Sync bot configs from export"
  python3 scripts/sync-bot-config-from-workflow-export.py --input "${OUT_FILE}" --bots-dir "${BOTS_DIR}"
fi

log "Done"

