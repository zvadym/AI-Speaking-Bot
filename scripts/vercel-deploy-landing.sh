#!/usr/bin/env bash
set -euo pipefail

echo "PLEASE deploy with github"
exit 1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI not found. Install it: npm i -g vercel"
  exit 1
fi

vercel_cmd() {
  if [[ -n "${VERCEL_TOKEN:-}" ]]; then
    vercel "$@" --token "$VERCEL_TOKEN"
  else
    vercel "$@"
  fi
}

MODE="${1:-prod}"
if [[ "$MODE" != "prod" && "$MODE" != "preview" ]]; then
  echo "Usage: scripts/vercel-deploy-landing.sh [prod|preview]"
  exit 1
fi

echo "Using vercel: $(vercel_cmd --version)"

echo "Preparing teacher thumbnails..."
node "$ROOT_DIR/apps/landing/scripts/prepare-teacher-thumbnails.mjs"

echo "Generating teachers from deploy/bots/*.json (sanitised)..."
node "$ROOT_DIR/apps/landing/scripts/generate-teachers.mjs"

VERCEL_CWD="$ROOT_DIR/apps/landing"
if [[ -f "$ROOT_DIR/.vercel/project.json" ]]; then
  VERCEL_CWD="$ROOT_DIR"
elif [[ -f "$ROOT_DIR/apps/landing/.vercel/project.json" ]]; then
  VERCEL_CWD="$ROOT_DIR/apps/landing"
fi

cd "$VERCEL_CWD"

if [[ -f "$ROOT_DIR/.vercel/project.json" && -f "$ROOT_DIR/apps/landing/.vercel/project.json" ]]; then
  ROOT_PROJECT_NAME="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(j.projectName||'');" "$ROOT_DIR/.vercel/project.json")"
  APP_PROJECT_NAME="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(j.projectName||'');" "$ROOT_DIR/apps/landing/.vercel/project.json")"
  if [[ "$ROOT_PROJECT_NAME" != "$APP_PROJECT_NAME" ]]; then
    echo "Warning: found two different Vercel links:"
    echo "  repo root -> $ROOT_PROJECT_NAME"
    echo "  apps/landing -> $APP_PROJECT_NAME"
    echo "Using repo root link to avoid deploying the landing to a separate project."
  fi
fi

if [[ ! -f .vercel/project.json ]]; then
  echo ""
  echo "Project not linked yet. Running: vercel link"
  echo "(Tip: set Root Directory to apps/landing and Nuxt output to .output/public.)"
  vercel_cmd link
fi

if [[ "$MODE" == "prod" ]]; then
  echo ""
  echo "Deploying to production..."
  vercel_cmd deploy --prod --yes
else
  echo ""
  echo "Deploying preview..."
  vercel_cmd deploy --yes
fi
