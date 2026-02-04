#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
PROJECT="${PROJECT:-languagebot}"
WORKFLOWS_DIR="${WORKFLOWS_DIR:-deploy/workflows/.rendered}"
export WORKFLOWS_DIR
STOP_N8N_BEFORE="${STOP_N8N_BEFORE:-true}"

if [[ ! -d "${WORKFLOWS_DIR}" ]]; then
  echo "Missing workflows dir: ${WORKFLOWS_DIR}" >&2
  exit 1
fi

workflow_files=("${WORKFLOWS_DIR}"/*.json)
if [[ ! -e "${workflow_files[0]}" ]]; then
  echo "No workflow JSON files found in ${WORKFLOWS_DIR}" >&2
  exit 1
fi

dc() {
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" "$@"
}

n8n_cli() {
  dc run --rm --no-deps --entrypoint n8n n8n "$@"
}

probe_cmd() {
  local cmd="$1"
  local out=""
  out="$(n8n_cli "${cmd}" --help 2>&1)" || true
  if echo "${out}" | grep -qiE "Unknown command|not found|did you mean"; then
    return 1
  fi
  if echo "${out}" | grep -qiE "Usage:|Options:"; then
    return 0
  fi
  return 1
}

has_publish="false"
has_activate=""
has_update="false"

if probe_cmd "publish:workflow"; then
  has_publish="true"
fi

if probe_cmd "workflow:activate"; then
  has_activate="workflow:activate"
elif probe_cmd "activate:workflow"; then
  has_activate="activate:workflow"
fi

if probe_cmd "update:workflow"; then
  has_update="true"
fi

if [[ "${has_publish}" != "true" && -z "${has_activate}" && "${has_update}" != "true" ]]; then
  echo "No supported activation commands found in n8n container." >&2
  exit 1
fi

if [[ "${STOP_N8N_BEFORE}" == "true" ]]; then
  dc stop n8n >/dev/null 2>&1 || true
fi

failed=0
for path in "${workflow_files[@]}"; do
  workflow_id="$(python3 - <<PY
import json
from pathlib import Path
path = Path(${path@Q})
try:
    data = json.loads(path.read_text())
except Exception:
    print("")
    raise SystemExit(0)
print(data.get("id", ""))
PY
)"
  workflow_name="$(python3 - <<PY
import json
from pathlib import Path
path = Path(${path@Q})
try:
    data = json.loads(path.read_text())
except Exception:
    print("")
    raise SystemExit(0)
print(data.get("name", ""))
PY
)"

  if [[ -z "${workflow_id}" ]]; then
    echo "Skipping ${path} (missing workflow id)" >&2
    failed=1
    continue
  fi

  echo "Activating workflow: ${workflow_name:-unnamed} (${workflow_id})"

  if [[ "${has_publish}" == "true" ]]; then
    if ! n8n_cli publish:workflow --id="${workflow_id}"; then
      echo "Failed to publish workflow ${workflow_id}" >&2
      failed=1
    fi
    continue
  fi

  if [[ -n "${has_activate}" ]]; then
    if ! n8n_cli "${has_activate}" --id="${workflow_id}"; then
      echo "Failed to activate workflow ${workflow_id}" >&2
      failed=1
    fi
  elif [[ "${has_update}" == "true" ]]; then
    if ! n8n_cli update:workflow --id="${workflow_id}" --active=true; then
      echo "Failed to activate workflow ${workflow_id}" >&2
      failed=1
    fi
  fi
done

if [[ "${failed}" -ne 0 ]]; then
  echo "One or more workflows failed to activate." >&2
  exit 1
fi

# Ensure changes take effect (and n8n is running).
dc restart n8n >/dev/null
