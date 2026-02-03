#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-languagebot}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/ai-speaking-bot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

APP_COMPOSE="${APP_COMPOSE:-deploy/docker-compose.app.yml}"
N8N_COMPOSE="${N8N_COMPOSE:-deploy/docker-compose.yml}"
MIGRATE_SCRIPT="${MIGRATE_SCRIPT:-deploy/migrate.sh}"
APP_PROJECT="${APP_PROJECT:-languagebot-app}"
N8N_PROJECT="${N8N_PROJECT:-languagebot-n8n}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-10}"
HEALTH_DELAY_SEC="${HEALTH_DELAY_SEC:-3}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-5}"

log() {
  echo "==> $1"
}

log "🔌 Step 1/7: Check SSH connectivity to ${DEPLOY_HOST}"
ssh -o BatchMode=yes -o ConnectTimeout=10 "${DEPLOY_HOST}" "echo 'SSH OK'" >/dev/null

log "🚀 Step 2/7: Run remote deploy commands"
ssh "${DEPLOY_HOST}" \
  "DEPLOY_DIR='${DEPLOY_DIR}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' APP_COMPOSE='${APP_COMPOSE}' N8N_COMPOSE='${N8N_COMPOSE}' MIGRATE_SCRIPT='${MIGRATE_SCRIPT}' APP_PROJECT='${APP_PROJECT}' N8N_PROJECT='${N8N_PROJECT}' HEALTH_ATTEMPTS='${HEALTH_ATTEMPTS}' HEALTH_DELAY_SEC='${HEALTH_DELAY_SEC}' HEALTH_TIMEOUT_SEC='${HEALTH_TIMEOUT_SEC}' bash -se" <<'REMOTE'
set -euo pipefail

step() { echo "==> $1"; }

step "📁 2.1/7: Verify repo directory"
if [[ ! -d "${DEPLOY_DIR}" ]]; then
  echo "Missing ${DEPLOY_DIR} on server" >&2
  exit 1
fi
cd "${DEPLOY_DIR}"

step "🧹 2.2/7: Ensure clean git state"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Repo has uncommitted changes. Please commit/stash before deploy." >&2
  exit 1
fi

git fetch origin

git checkout "${DEPLOY_BRANCH}"

git pull --ff-only origin "${DEPLOY_BRANCH}"

step "🔐 2.3/7: Verify required env files (won't overwrite)"
for f in deploy/.env deploy/.env.api deploy/.env.miniapp; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f on server" >&2
    exit 1
  fi
done

step "🌱 2.3.1/7: Load env for build args"
set -a
source deploy/.env.api
source deploy/.env.miniapp
set +a

step "🗄️ 2.4/7: Run DB migrations"
bash "${MIGRATE_SCRIPT}"

step "🐳 2.5/7: Build & restart API + miniapp + caddy"
docker compose -p "${APP_PROJECT}" -f "${APP_COMPOSE}" build

docker compose -p "${APP_PROJECT}" -f "${APP_COMPOSE}" up -d --remove-orphans

step "🔄 2.6/7: Start/refresh n8n"
docker compose -p "${N8N_PROJECT}" -f "${N8N_COMPOSE}" up -d --remove-orphans

step "✅ 2.7/7: Health checks"
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

  check_url https://learn-language-api.notarobot.dev/healthz
  check_url https://learn-language-app.notarobot.dev/
  echo "✅ Health checks OK"
else
  echo "⚠️ curl not found; skipping health checks"
fi
REMOTE

log "🎉 Done"
