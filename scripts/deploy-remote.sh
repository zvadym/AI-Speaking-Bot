#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-langbot-de-1}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/ai-speaking-bot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
SSH_FORWARD_AGENT="${SSH_FORWARD_AGENT:-true}"

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
MIGRATE_SCRIPT="${MIGRATE_SCRIPT:-deploy/migrate.sh}"
PROJECT="${PROJECT:-languagebot}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-10}"
HEALTH_DELAY_SEC="${HEALTH_DELAY_SEC:-3}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-5}"
SKIP_HEALTHCHECKS="${SKIP_HEALTHCHECKS:-false}"
SKIP_N8N="${SKIP_N8N:-false}"
RESTART_ALL="${RESTART_ALL:-false}"
OPENAI_MODELS_CONFIG="${OPENAI_MODELS_CONFIG:-deploy/workflows/openai-models.json}"

# Override these when deploying to a new server before DNS is updated.
# Set any of them to empty string to skip that check.
HEALTHCHECK_API_URL="${HEALTHCHECK_API_URL:-https://learn-language-api.notarobot.dev/healthz}"
HEALTHCHECK_APP_URL="${HEALTHCHECK_APP_URL:-https://learn-language-app.notarobot.dev/}"
HEALTHCHECK_N8N_URL="${HEALTHCHECK_N8N_URL:-https://learn-language-n8n.notarobot.dev/}"
HEALTHCHECK_N8N_LOCAL_URL="${HEALTHCHECK_N8N_LOCAL_URL:-http://127.0.0.1:5678/}"

usage() {
  cat <<'EOF'
Usage: scripts/deploy-remote.sh [--skip-n8n] [--restart-all] [--help]

Options:
  --skip-n8n  Skip n8n workflow render/import/activation and n8n-specific health checks.
  --restart-all  Force full service restart, including restart-based n8n workflow activation.
  --help      Show this help message.
EOF
}

log() {
  echo "==> $1"
}

if [[ "${SSH_FORWARD_AGENT}" != "true" && "${SSH_FORWARD_AGENT}" != "false" ]]; then
  echo "Invalid SSH_FORWARD_AGENT=${SSH_FORWARD_AGENT} (expected: true|false)" >&2
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-n8n)
      SKIP_N8N="true"
      shift
      ;;
    --restart-all)
      RESTART_ALL="true"
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

if [[ "${SKIP_N8N}" != "true" && "${SKIP_N8N}" != "false" ]]; then
  echo "Invalid SKIP_N8N=${SKIP_N8N} (expected: true|false)" >&2
  exit 1
fi

if [[ "${RESTART_ALL}" != "true" && "${RESTART_ALL}" != "false" ]]; then
  echo "Invalid RESTART_ALL=${RESTART_ALL} (expected: true|false)" >&2
  exit 1
fi

ssh_cmd() {
  if [[ "${SSH_FORWARD_AGENT}" == "true" ]]; then
    ssh -A "$@"
  else
    ssh "$@"
  fi
}

log "🔌 Step 1/9: Check SSH connectivity to ${DEPLOY_HOST}"
ssh_cmd -o BatchMode=yes -o ConnectTimeout=10 "${DEPLOY_HOST}" "echo 'SSH OK'" >/dev/null

log "🚀 Step 2/9: Run remote deploy commands"
ssh_cmd "${DEPLOY_HOST}" \
  "DEPLOY_DIR='${DEPLOY_DIR}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' COMPOSE_FILE='${COMPOSE_FILE}' MIGRATE_SCRIPT='${MIGRATE_SCRIPT}' PROJECT='${PROJECT}' HEALTH_ATTEMPTS='${HEALTH_ATTEMPTS}' HEALTH_DELAY_SEC='${HEALTH_DELAY_SEC}' HEALTH_TIMEOUT_SEC='${HEALTH_TIMEOUT_SEC}' SKIP_HEALTHCHECKS='${SKIP_HEALTHCHECKS}' SKIP_N8N='${SKIP_N8N}' RESTART_ALL='${RESTART_ALL}' OPENAI_MODELS_CONFIG='${OPENAI_MODELS_CONFIG}' HEALTHCHECK_API_URL='${HEALTHCHECK_API_URL}' HEALTHCHECK_APP_URL='${HEALTHCHECK_APP_URL}' HEALTHCHECK_N8N_URL='${HEALTHCHECK_N8N_URL}' HEALTHCHECK_N8N_LOCAL_URL='${HEALTHCHECK_N8N_LOCAL_URL}' bash -se" <<'REMOTE'
set -euo pipefail

step() { echo "==> $1"; }

step "📁 2.1/10: Verify repo directory"
if [[ ! -d "${DEPLOY_DIR}" ]]; then
  echo "Missing ${DEPLOY_DIR} on server" >&2
  exit 1
fi
cd "${DEPLOY_DIR}"

step "🧹 2.2/10: Hard reset repo to origin/${DEPLOY_BRANCH} (preserve server env files)"
preserved_files=(
  deploy/.env
  deploy/.env.api
  deploy/.env.miniapp
  deploy/.env.prod
  deploy/.env.dev
)
backup_dir="$(mktemp -d)"
cleanup_backup() {
  rm -rf "${backup_dir}"
}
trap cleanup_backup EXIT

for f in "${preserved_files[@]}"; do
  if [[ -f "${f}" ]]; then
    mkdir -p "${backup_dir}/$(dirname "${f}")"
    cp "${f}" "${backup_dir}/${f}"
  fi
done

git fetch origin

git checkout -f "${DEPLOY_BRANCH}"

git reset --hard "origin/${DEPLOY_BRANCH}"

for f in "${preserved_files[@]}"; do
  if [[ -f "${backup_dir}/${f}" ]]; then
    cp "${backup_dir}/${f}" "${f}"
  fi
done

unexpected_changes="$(git status --porcelain | awk '$2 != "deploy/.env" && $2 != "deploy/.env.api" && $2 != "deploy/.env.miniapp" && $2 != "deploy/.env.prod" && $2 != "deploy/.env.dev" { print }')"
if [[ -n "${unexpected_changes}" ]]; then
  echo "Repo has unexpected local changes after reset:" >&2
  echo "${unexpected_changes}" >&2
  exit 1
fi

step "🔐 2.3/10: Verify required env files (won't overwrite)"
required_env_files=(deploy/.env deploy/.env.api deploy/.env.miniapp)
if [[ "${SKIP_N8N}" != "true" ]]; then
  required_env_files+=(deploy/.env.prod)
fi
for f in "${required_env_files[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f on server" >&2
    exit 1
  fi
done

if [[ "${SKIP_N8N}" == "true" ]]; then
  step "⏭️ 2.3.1/10: Skip n8n data dir permissions (--skip-n8n)"
else
  step "🗂️ 2.3.1/10: Ensure n8n data dir is writable by n8n (uid 1000)"
  mkdir -p deploy/n8n-data
  docker run --rm -u 0:0 -v "$PWD/deploy/n8n-data:/data" alpine:3.20 sh -c 'chown -R 1000:1000 /data && chmod 700 /data'
fi

step "🌱 2.3.2/10: Load env for build args + workflow render"
set -a
source deploy/.env.api
source deploy/.env.miniapp
if [[ "${SKIP_N8N}" != "true" ]]; then
  source deploy/.env.prod
fi
set +a

if [[ "${SKIP_N8N}" == "true" ]]; then
  step "⏭️ 2.3.3/10: Skip n8n workflow render (--skip-n8n)"
else
  step "🧠 2.3.3/10: Verify OpenAI models config"
  if [[ ! -f "${OPENAI_MODELS_CONFIG}" ]]; then
    echo "Missing ${OPENAI_MODELS_CONFIG} on server" >&2
    exit 1
  fi

  step "🧩 2.3.4/10: Render n8n workflows"
  python3 scripts/render-n8n-workflows.py --input deploy/workflows --output deploy/workflows/.rendered --models-config "${OPENAI_MODELS_CONFIG}"
fi

step "🗄️ 2.4/10: Run DB migrations"
bash "${MIGRATE_SCRIPT}"

if [[ "${SKIP_N8N}" == "true" ]]; then
  step "🐳 2.5/10: Build & restart api/miniapp/caddy only (--skip-n8n)"
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" build api miniapp
  if [[ "${RESTART_ALL}" == "true" ]]; then
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d --force-recreate --no-deps api miniapp caddy
  else
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d --no-deps api miniapp caddy
  fi
else
  step "🐳 2.5/10: Build & restart services"
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" build
  if [[ "${RESTART_ALL}" == "true" ]]; then
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d --force-recreate --remove-orphans
  else
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d --remove-orphans
  fi
fi

if [[ "${SKIP_N8N}" == "true" ]]; then
  step "⏭️ 2.6/10: Skip n8n stop/import/activation (--skip-n8n)"
else
  if [[ "${RESTART_ALL}" == "true" ]]; then
    step "🛑 2.6/10: Stop n8n (pre-import, --restart-all)"
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" stop n8n >/dev/null 2>&1 || true

    step "🧹 2.7/10: Unpublish/deactivate ALL n8n workflows (--restart-all)"
    COMPOSE_FILE="${COMPOSE_FILE}" PROJECT="${PROJECT}" STOP_N8N_BEFORE=false bash scripts/unpublish-all-n8n-workflows.sh
  else
    step "♻️ 2.6/10: Keep n8n running during workflow import/publish"
  fi

  step "📦 2.8/10: Import n8n workflows"
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" run -T --rm --no-deps n8n-import </dev/null

  if [[ "${RESTART_ALL}" == "true" ]]; then
    step "✅ 2.9/10: Activate n8n workflows with restart (--restart-all)"
    COMPOSE_FILE="${COMPOSE_FILE}" PROJECT="${PROJECT}" WORKFLOWS_DIR="deploy/workflows/.rendered" STOP_N8N_BEFORE=false RESTART_N8N_AFTER=true bash scripts/activate-n8n-workflows.sh
  else
    step "✅ 2.9/10: Publish n8n workflows live"
    COMPOSE_FILE="${COMPOSE_FILE}" PROJECT="${PROJECT}" WORKFLOWS_DIR="deploy/workflows/.rendered" STOP_N8N_BEFORE=false RESTART_N8N_AFTER=false bash scripts/activate-n8n-workflows.sh
  fi
fi

step "✅ 2.10/10: Health checks"
if [[ "${SKIP_HEALTHCHECKS}" == "true" ]]; then
  echo "⚠️ SKIP_HEALTHCHECKS=true; skipping health checks"
elif command -v curl >/dev/null 2>&1; then
  check_url() {
    local url="$1"
    local attempts="${HEALTH_ATTEMPTS}"
    local delay="${HEALTH_DELAY_SEC}"
    local timeout="${HEALTH_TIMEOUT_SEC}"
    for i in $(seq 1 "${attempts}"); do
      if curl -fsS --max-time "${timeout}" "${url}" >/dev/null; then
        echo "✅ ${url} OK"
        return 0
      fi
      echo "⏳ ${url} not ready (attempt ${i}/${attempts})"
      sleep "${delay}"
    done
    return 1
  }

  check_url_http() {
    local url="$1"
    local ok_codes="$2"
    local attempts="${HEALTH_ATTEMPTS}"
    local delay="${HEALTH_DELAY_SEC}"
    local timeout="${HEALTH_TIMEOUT_SEC}"
    for i in $(seq 1 "${attempts}"); do
      local code
      code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time "${timeout}" "${url}" || true)"
      if echo " ${ok_codes} " | grep -q " ${code} "; then
        echo "✅ ${url} OK (${code})"
        return 0
      fi
      echo "⏳ ${url} not ready (attempt ${i}/${attempts}, code=${code})"
      sleep "${delay}"
    done
    return 1
  }

  if [[ -n "${HEALTHCHECK_API_URL:-}" ]]; then
    check_url "${HEALTHCHECK_API_URL}"
  fi
  if [[ -n "${HEALTHCHECK_APP_URL:-}" ]]; then
    check_url "${HEALTHCHECK_APP_URL}"
  fi
  if [[ "${SKIP_N8N}" != "true" && -n "${HEALTHCHECK_N8N_URL:-}" ]]; then
    check_url_http "${HEALTHCHECK_N8N_URL}" "200 301 302 401 403"
  fi
  if [[ "${SKIP_N8N}" != "true" && -n "${HEALTHCHECK_N8N_LOCAL_URL:-}" ]]; then
    check_url_http "${HEALTHCHECK_N8N_LOCAL_URL}" "200 301 302 401 403"
  fi
  echo "✅ Health checks OK"
else
  echo "⚠️ curl not found; skipping health checks"
fi
REMOTE

log "🎉 Done"
