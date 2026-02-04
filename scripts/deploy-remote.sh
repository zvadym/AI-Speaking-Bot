#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-languagebot}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/ai-speaking-bot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
MIGRATE_SCRIPT="${MIGRATE_SCRIPT:-deploy/migrate.sh}"
PROJECT="${PROJECT:-languagebot}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-10}"
HEALTH_DELAY_SEC="${HEALTH_DELAY_SEC:-3}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-5}"

log() {
  echo "==> $1"
}

log "🔌 Step 1/9: Check SSH connectivity to ${DEPLOY_HOST}"
ssh -o BatchMode=yes -o ConnectTimeout=10 "${DEPLOY_HOST}" "echo 'SSH OK'" >/dev/null

log "🚀 Step 2/9: Run remote deploy commands"
ssh "${DEPLOY_HOST}" \
  "DEPLOY_DIR='${DEPLOY_DIR}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' COMPOSE_FILE='${COMPOSE_FILE}' MIGRATE_SCRIPT='${MIGRATE_SCRIPT}' PROJECT='${PROJECT}' HEALTH_ATTEMPTS='${HEALTH_ATTEMPTS}' HEALTH_DELAY_SEC='${HEALTH_DELAY_SEC}' HEALTH_TIMEOUT_SEC='${HEALTH_TIMEOUT_SEC}' bash -se" <<'REMOTE'
set -euo pipefail

step() { echo "==> $1"; }

step "📁 2.1/9: Verify repo directory"
if [[ ! -d "${DEPLOY_DIR}" ]]; then
  echo "Missing ${DEPLOY_DIR} on server" >&2
  exit 1
fi
cd "${DEPLOY_DIR}"

step "🧹 2.2/9: Ensure clean git state"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Repo has uncommitted changes. Please commit/stash before deploy." >&2
  exit 1
fi

git fetch origin

git checkout "${DEPLOY_BRANCH}"

git pull --ff-only origin "${DEPLOY_BRANCH}"

step "🔐 2.3/9: Verify required env files (won't overwrite)"
for f in deploy/.env deploy/.env.api deploy/.env.miniapp deploy/.env.prod; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f on server" >&2
    exit 1
  fi
done

step "🌱 2.3.1/9: Load env for build args + workflow render"
set -a
source deploy/.env.api
source deploy/.env.miniapp
source deploy/.env.prod
set +a

step "🧩 2.3.2/9: Render n8n workflows"
python3 scripts/render-n8n-workflows.py --input deploy/workflows --output deploy/workflows/.rendered

step "🗄️ 2.4/9: Run DB migrations"
bash "${MIGRATE_SCRIPT}"

step "🐳 2.5/9: Build & restart services"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" build

docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d --remove-orphans

step "📦 2.6/9: Import n8n workflows"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" stop n8n >/dev/null 2>&1 || true
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" run --rm --no-deps n8n-import

step "✅ 2.7/9: Activate n8n workflows"
COMPOSE_FILE="${COMPOSE_FILE}" PROJECT="${PROJECT}" WORKFLOWS_DIR="deploy/workflows/.rendered" bash scripts/activate-n8n-workflows.sh

step "✅ 2.8/9: Health checks"
if command -v curl >/dev/null 2>&1; then
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

  check_url https://learn-language-api.notarobot.dev/healthz
  check_url https://learn-language-app.notarobot.dev/
  check_url_http https://learn-language-n8n.notarobot.dev/ "200 301 302 401 403"
  check_url_http http://127.0.0.1:5678/ "200 301 302 401 403"
  echo "✅ Health checks OK"
else
  echo "⚠️ curl not found; skipping health checks"
fi
REMOTE

log "🎉 Done"
