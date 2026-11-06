#!/usr/bin/env bash
# Source this helper from a script that has already set ROOT_DIR.
PRIVATE_CONFIG_DIR="${LANGUAGEBOT_CONFIG_DIR:-${HOME}/.config/ai-speaking-bot}"
export API_ENV_FILE="${API_ENV_FILE:-${PRIVATE_CONFIG_DIR}/api.env}"
export MINIAPP_ENV_FILE="${MINIAPP_ENV_FILE:-${PRIVATE_CONFIG_DIR}/miniapp.env}"
export LANDING_ENV_FILE="${LANDING_ENV_FILE:-${PRIVATE_CONFIG_DIR}/landing.env}"

load_private_env() {
  local exports
  # The parser rejects shell syntax and quotes every value. Capture status before
  # eval so a missing/invalid file stops deployment rather than yielding empty env.
  exports="$(python3 "${ROOT_DIR}/scripts/private_env.py" shell "$@")" || return 1
  eval "$exports"
}
