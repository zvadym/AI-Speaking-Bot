#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-langbot-de-1}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/ai-speaking-bot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_CONFIG_DIR="${DEPLOY_CONFIG_DIR:-/etc/ai-speaking-bot}"
SSH_FORWARD_AGENT="${SSH_FORWARD_AGENT:-true}"

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
MIGRATE_SCRIPT="${MIGRATE_SCRIPT:-deploy/migrate.sh}"
PROJECT="${PROJECT:-languagebot}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-10}"
HEALTH_DELAY_SEC="${HEALTH_DELAY_SEC:-3}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-5}"
SKIP_HEALTHCHECKS="${SKIP_HEALTHCHECKS:-false}"
RESTART_ALL="${RESTART_ALL:-false}"
UPDATE_PHRASES="${UPDATE_PHRASES:-false}"

HEALTHCHECK_API_URL="${HEALTHCHECK_API_URL:-https://learn-language-api.notarobot.dev/healthz}"
HEALTHCHECK_APP_URL="${HEALTHCHECK_APP_URL:-https://learn-language-app.notarobot.dev/}"

usage() {
  cat <<'EOF'
Usage: scripts/deploy-remote.sh [--restart-all] [--update-phrases] [--help]

Options:
  --restart-all     Force recreation of all application containers.
  --update-phrases  Import the idiom phrase catalog after the build.
  --help            Show this help message.
EOF
}

log() {
  echo "==> $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart-all)
      RESTART_ALL="true"
      shift
      ;;
    --update-phrases)
      UPDATE_PHRASES="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

for value_name in SSH_FORWARD_AGENT SKIP_HEALTHCHECKS RESTART_ALL UPDATE_PHRASES; do
  value="${!value_name}"
  if [[ "${value}" != "true" && "${value}" != "false" ]]; then
    echo "Invalid ${value_name}=${value} (expected: true|false)" >&2
    exit 1
  fi
done

ssh_cmd() {
  if [[ "${SSH_FORWARD_AGENT}" == "true" ]]; then
    ssh -A "$@"
  else
    ssh "$@"
  fi
}

for value_name in DEPLOY_DIR DEPLOY_BRANCH DEPLOY_CONFIG_DIR COMPOSE_FILE MIGRATE_SCRIPT PROJECT HEALTHCHECK_API_URL HEALTHCHECK_APP_URL; do
  value="${!value_name}"
  if [[ "$value" == *"'"* || "$value" == *$'\n'* ]]; then
    echo "Invalid character in $value_name" >&2
    exit 1
  fi
done

log "Check SSH connectivity to ${DEPLOY_HOST}"
ssh_cmd -o BatchMode=yes -o ConnectTimeout=10 "${DEPLOY_HOST}" "echo 'SSH OK'" >/dev/null

log "Deploy ${DEPLOY_BRANCH} to ${DEPLOY_HOST}"
ssh_cmd "${DEPLOY_HOST}" \
  "DEPLOY_DIR='${DEPLOY_DIR}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' DEPLOY_CONFIG_DIR='${DEPLOY_CONFIG_DIR}' COMPOSE_FILE='${COMPOSE_FILE}' MIGRATE_SCRIPT='${MIGRATE_SCRIPT}' PROJECT='${PROJECT}' HEALTH_ATTEMPTS='${HEALTH_ATTEMPTS}' HEALTH_DELAY_SEC='${HEALTH_DELAY_SEC}' HEALTH_TIMEOUT_SEC='${HEALTH_TIMEOUT_SEC}' SKIP_HEALTHCHECKS='${SKIP_HEALTHCHECKS}' RESTART_ALL='${RESTART_ALL}' UPDATE_PHRASES='${UPDATE_PHRASES}' HEALTHCHECK_API_URL='${HEALTHCHECK_API_URL}' HEALTHCHECK_APP_URL='${HEALTHCHECK_APP_URL}' bash -se" <<'REMOTE'
set -euo pipefail

step() { echo "==> $1"; }

step "Verify repository"
cd "${DEPLOY_DIR}"

# Private files must already exist before deploying the sanitized branch. Do not
# pull/reset first: old JSON may be the only remaining source of bot tokens.
export API_ENV_FILE="${DEPLOY_CONFIG_DIR}/api.env"
export MINIAPP_ENV_FILE="${DEPLOY_CONFIG_DIR}/miniapp.env"
for file in "$API_ENV_FILE" "$MINIAPP_ENV_FILE"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing private env file: $file. Run the documented migration before deployment." >&2
    exit 1
  fi
done

step "Fetch and preflight target bot credentials before changing the running checkout"
git fetch origin
preflight_dir="$(mktemp -d)"
trap 'rm -rf "$preflight_dir"' EXIT
git archive "origin/${DEPLOY_BRANCH}" scripts/private_env.py deploy/bots | tar -x -C "$preflight_dir"
python3 "$preflight_dir/scripts/private_env.py" check "$API_ENV_FILE" "$MINIAPP_ENV_FILE" \
  --repo-root "$DEPLOY_DIR" --bots-dir "$preflight_dir/deploy/bots" --deployment

step "Update source"
git checkout -f "${DEPLOY_BRANCH}"
git reset --hard "origin/${DEPLOY_BRANCH}"
ROOT_DIR="$DEPLOY_DIR"
source "$ROOT_DIR/scripts/private-env.sh"
load_private_env --override "$API_ENV_FILE" "$MINIAPP_ENV_FILE"

step "Run database migrations"
bash "${MIGRATE_SCRIPT}"

step "Build application images"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" build api worker miniapp

if [[ "${UPDATE_PHRASES}" == "true" ]]; then
  step "Import idiom phrase catalog"
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" run -T --rm --no-deps \
    -e IDIOM_PHRASES_DIR=/deploy/phrases api node ./scripts/import-idiom-phrases.mjs </dev/null
fi

step "Start application services"
up_args=(-d --remove-orphans)
if [[ "${RESTART_ALL}" == "true" ]]; then
  up_args+=(--force-recreate)
fi
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up "${up_args[@]}" api worker miniapp caddy

check_url() {
  local url="$1"
  for attempt in $(seq 1 "${HEALTH_ATTEMPTS}"); do
    if curl -fsS --max-time "${HEALTH_TIMEOUT_SEC}" "${url}" >/dev/null; then
      echo "${url} OK"
      return 0
    fi
    echo "${url} not ready (${attempt}/${HEALTH_ATTEMPTS})"
    sleep "${HEALTH_DELAY_SEC}"
  done
  return 1
}

if [[ "${SKIP_HEALTHCHECKS}" != "true" ]]; then
  step "Run HTTP health checks"
  [[ -z "${HEALTHCHECK_API_URL}" ]] || check_url "${HEALTHCHECK_API_URL}"
  [[ -z "${HEALTHCHECK_APP_URL}" ]] || check_url "${HEALTHCHECK_APP_URL}"
fi

step "Register and verify Telegram webhooks"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T api \
  node ./scripts/telegram-webhooks.mjs set
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T api \
  node ./scripts/telegram-webhooks.mjs inspect

step "Deployment complete"
REMOTE
