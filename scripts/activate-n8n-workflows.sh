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

workflow_ids="$(
python3 - <<'PY'
import json
import os
from pathlib import Path

workflow_dir = Path(os.environ.get("WORKFLOWS_DIR", "deploy/workflows/.rendered"))
ids = []
for path in sorted(workflow_dir.glob("*.json")):
    try:
        data = json.loads(path.read_text())
    except Exception:
        continue
    wid = data.get("id")
    if wid:
        ids.append(str(wid))
print("\n".join(ids))
PY
)"

if [[ -z "${workflow_ids}" ]]; then
  echo "No workflow IDs found in ${WORKFLOWS_DIR}" >&2
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

while IFS= read -r workflow_id; do
  if [[ -z "${workflow_id}" ]]; then
    continue
  fi
  if [[ "${has_publish}" == "true" ]]; then
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n publish:workflow --id="${workflow_id}"
  fi
  if [[ "${has_activate}" == "update:workflow" ]]; then
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n update:workflow --id="${workflow_id}" --active=true
  elif [[ -n "${has_activate}" ]]; then
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n "${has_activate}" --id="${workflow_id}"
  fi
done <<< "${workflow_ids}"

# Changes take effect after restarting n8n.
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" restart n8n
