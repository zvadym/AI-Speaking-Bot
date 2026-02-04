#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
PROJECT="${PROJECT:-languagebot}"
WORKFLOWS_DIR="${WORKFLOWS_DIR:-deploy/workflows/.rendered}"
export WORKFLOWS_DIR

if [[ ! -d "${WORKFLOWS_DIR}" ]]; then
  echo "Missing workflows dir: ${WORKFLOWS_DIR}" >&2
  exit 1
fi

workflow_files=("${WORKFLOWS_DIR}"/*.json)
if [[ ! -e "${workflow_files[0]}" ]]; then
  echo "No workflow JSON files found in ${WORKFLOWS_DIR}" >&2
  exit 1
fi

has_publish="false"
has_activate=""

if docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n publish:workflow --help >/dev/null 2>&1; then
  has_publish="true"
fi

if docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n workflow:activate --help >/dev/null 2>&1; then
  has_activate="workflow:activate"
elif docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n activate:workflow --help >/dev/null 2>&1; then
  has_activate="activate:workflow"
elif docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n update:workflow --help >/dev/null 2>&1; then
  has_activate="update:workflow"
fi

if [[ "${has_publish}" != "true" && -z "${has_activate}" ]]; then
  echo "No supported activation commands found in n8n container." >&2
  exit 1
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
    if ! docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n publish:workflow --id="${workflow_id}"; then
      echo "Failed to publish workflow ${workflow_id}" >&2
      failed=1
    fi
  fi

  if [[ "${has_activate}" == "update:workflow" ]]; then
    if ! docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n update:workflow --id="${workflow_id}" --active=true; then
      echo "Failed to activate workflow ${workflow_id}" >&2
      failed=1
    fi
  elif [[ -n "${has_activate}" ]]; then
    if ! docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n "${has_activate}" --id="${workflow_id}"; then
      echo "Failed to activate workflow ${workflow_id}" >&2
      failed=1
    fi
  fi
done

if [[ "${failed}" -ne 0 ]]; then
  echo "One or more workflows failed to activate." >&2
  exit 1
fi

# Changes take effect after restarting n8n.
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" restart n8n
