#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load dev credential IDs
if [[ -f "$ROOT_DIR/deploy/.env.dev" ]]; then
  set -a
  source "$ROOT_DIR/deploy/.env.dev"
  set +a
fi

# Render workflows with dev bots
python3 "$ROOT_DIR/scripts/render-n8n-workflows.py" \
  --input "$ROOT_DIR/deploy/workflows" \
  --output "$ROOT_DIR/deploy/workflows/.rendered" \
  --bots "$ROOT_DIR/deploy/bots-dev"
