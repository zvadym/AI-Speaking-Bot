#!/usr/bin/env bash
set -euo pipefail

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
if [[ -f "$ROOT_DIR/apps/landing/.vercel/project.json" ]]; then
  VERCEL_CWD="$ROOT_DIR/apps/landing"
elif [[ -f "$ROOT_DIR/.vercel/project.json" ]]; then
  VERCEL_CWD="$ROOT_DIR"
fi

cd "$VERCEL_CWD"

if [[ ! -f .vercel/project.json ]]; then
  echo ""
  echo "Project not linked yet. Running: vercel link"
  echo "(Tip: set Root Directory to apps/landing in the prompts.)"
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
