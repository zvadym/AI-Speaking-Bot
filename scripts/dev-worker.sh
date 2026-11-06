#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/private-env.sh"
load_private_env "$API_ENV_FILE"
cd "$ROOT_DIR/apps/api"
npm run worker:dev
