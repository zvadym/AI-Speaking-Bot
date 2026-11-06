#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
explicit_landing_env="${LANDING_ENV_FILE:-}"
source "$ROOT_DIR/scripts/private-env.sh"
if [[ -n "$explicit_landing_env" || -f "$LANDING_ENV_FILE" ]]; then
  load_private_env "$LANDING_ENV_FILE"
fi
cd "$ROOT_DIR/apps/landing"
npm run dev
