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
print("\\n".join(ids))
PY
)"

if [[ -z "${workflow_ids}" ]]; then
  echo "No workflow IDs found in ${WORKFLOWS_DIR}" >&2
  exit 1
fi

activate_cmd="publish"
if ! docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n publish:workflow --help >/dev/null 2>&1; then
  activate_cmd="update"
fi

while IFS= read -r workflow_id; do
  if [[ -z "${workflow_id}" ]]; then
    continue
  fi
  if [[ "${activate_cmd}" == "update" ]]; then
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n update:workflow --id="${workflow_id}" --active=true
  else
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" exec -T n8n n8n publish:workflow --id="${workflow_id}"
  fi
done <<< "${workflow_ids}"

# Changes take effect after restarting n8n.
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" restart n8n
