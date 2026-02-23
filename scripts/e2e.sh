#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/e2e/docker-compose.yml"
PROJECT_NAME="languagebot-e2e"
TMP_DIR=""

cleanup() {
  local exit_code=$?

  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi

  docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v >/dev/null 2>&1 || true
  if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}" >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}
trap cleanup EXIT

cd "$ROOT_DIR"

echo "[e2e] Installing API dependencies"
npm --prefix apps/api ci

echo "[e2e] Starting Postgres + n8n"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d

echo "[e2e] Waiting for Postgres"
for i in {1..60}; do
  if docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" exec -T postgres pg_isready -U postgres -d languagebot >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ "$i" -eq 60 ]]; then
    echo "[e2e] Postgres did not become ready" >&2
    exit 1
  fi
done

echo "[e2e] Applying migrations"
docker run --rm \
  --network host \
  -e DATABASE_URL='postgres://postgres:postgres@127.0.0.1:54329/languagebot?sslmode=disable' \
  -v "$ROOT_DIR/db:/db" \
  ghcr.io/amacneil/dbmate:2.12 --no-dump-schema up

echo "[e2e] Rendering n8n workflows"
TMP_DIR="$(mktemp -d)"
E2E_BOTS_DIR="${TMP_DIR}/bots"
mkdir -p "${E2E_BOTS_DIR}"

E2E_LOCALE_JSON="$(
  node -e '
    const fs = require("fs");
    const wf = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const setNode = (wf.nodes || []).find((n) => n && n.name === "Set Locale");
    if (!setNode) throw new Error("Set Locale node not found in ai-bot.json");
    const assignments =
      setNode.parameters?.assignments?.assignments ||
      setNode.parameters?.values?.values; // legacy export shape
    if (!Array.isArray(assignments)) throw new Error("Set Locale assignments not found");
    const out = {};
    for (const entry of assignments) {
      if (!entry || typeof entry.name !== "string") continue;
      out[entry.name] = entry.value;
    }
    process.stdout.write(JSON.stringify(out));
  ' "$ROOT_DIR/deploy/workflows/ai-bot.json"
)"

cat > "${E2E_BOTS_DIR}/uk-en.json" <<EOF
{
  "bot_key": "uk-en",
  "base_language": "uk",
  "learning_language": "en",
  "telegram_credential_id": "e2e-telegram-cred",
  "telegram_bot_token": "0000000000:TESTTOKEN",
  "locale": ${E2E_LOCALE_JSON}
}
EOF

N8N_CRED_OPENAI_ID="e2e-openai-cred" \
N8N_CRED_POSTGRES_ID="e2e-postgres-cred" \
python3 "$ROOT_DIR/scripts/render-n8n-workflows.py" \
  --input "$ROOT_DIR/deploy/workflows" \
  --output "$ROOT_DIR/deploy/workflows/.rendered" \
  --bots "${E2E_BOTS_DIR}"

echo "[e2e] Importing n8n workflows"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" exec -T n8n sh -lc '
  set -euo pipefail
  found=0
  for f in /workflows/.rendered/*.json; do
    if [ ! -f "$f" ]; then
      continue
    fi
    found=1
    n8n import:workflow --input "$f" --overwrite
  done
  if [ "$found" -ne 1 ]; then
    echo "No rendered workflows found" >&2
    exit 1
  fi
'

echo "[e2e] Starting API"
(
  cd "$ROOT_DIR/apps/api"
  DATABASE_URL='postgres://postgres:postgres@127.0.0.1:54329/languagebot?sslmode=disable' \
  WEBAPP_URL='http://localhost:4173' \
  STRIPE_SECRET_KEY='sk_test_e2e' \
  STRIPE_WEBHOOK_SECRET='whsec_e2e_secret' \
  JWT_SECRET='e2e-jwt-secret' \
  API_PORT='3001' \
  node src/server.js
) >/tmp/languagebot-e2e-api.log 2>&1 &
API_PID=$!

echo "[e2e] Running smoke test"
node "$ROOT_DIR/e2e/smoke.e2e.mjs"

echo "[e2e] Done"
