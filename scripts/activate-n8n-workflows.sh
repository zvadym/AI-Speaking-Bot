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
  dc run -T --rm --no-deps --entrypoint n8n n8n "$@" </dev/null
}

did_stop="false"
cleanup() {
  if [[ "${did_stop}" == "true" ]]; then
    dc start n8n >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

probe_cmd() {
  local cmd="$1"
  local out=""
  out="$(n8n_cli "${cmd}" --help 2>&1 || true)"
  if echo "${out}" | grep -qiE "Unknown command|not found|did you mean"; then
    return 1
  fi
  return 0
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
  echo "Debug: n8n --version" >&2
  n8n_cli --version >&2 || true
  echo "Debug: n8n --help (first 200 lines)" >&2
  n8n_cli --help 2>&1 | sed -n '1,200p' >&2 || true
  dc start n8n >/dev/null 2>&1 || true
  exit 1
fi

if [[ "${STOP_N8N_BEFORE}" == "true" ]]; then
  dc stop n8n >/dev/null 2>&1 || true
  did_stop="true"
fi

# Extract all workflow IDs and names upfront (single pass per file, then single container)
workflow_ids=()
failed=0
for path in "${workflow_files[@]}"; do
  workflow_id="$(python3 - "$path" <<'PY'
import json
import sys
from pathlib import Path
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except Exception:
    print("")
    raise SystemExit(0)
print(data.get("id", ""))
PY
)"
  workflow_name="$(python3 - "$path" <<'PY'
import json
import sys
from pathlib import Path
path = Path(sys.argv[1])
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
  workflow_ids+=("${workflow_id}")
done

if [[ "${failed}" -ne 0 ]] && [[ ${#workflow_ids[@]} -eq 0 ]]; then
  echo "One or more workflows failed to activate." >&2
  dc start n8n >/dev/null 2>&1 || true
  exit 1
fi

if [[ ${#workflow_ids[@]} -gt 0 ]]; then
  # Single container: loop inside to avoid one container per workflow
  activate_cmd=""
  extra_args=""
  if [[ "${has_publish}" == "true" ]]; then
    activate_cmd="publish:workflow"
  elif [[ -n "${has_activate}" ]]; then
    activate_cmd="${has_activate}"
  elif [[ "${has_update}" == "true" ]]; then
    activate_cmd="update:workflow"
    extra_args="--active=true"
  fi
  if ! dc run -T --rm --no-deps --entrypoint sh n8n -c 'for id in "$@"; do n8n '"${activate_cmd}"' --id="$id" '"${extra_args}"' || exit 1; done' sh "${workflow_ids[@]}" </dev/null; then
    echo "One or more workflows failed to activate." >&2
    dc start n8n >/dev/null 2>&1 || true
    exit 1
  fi
fi

if [[ "${failed}" -ne 0 ]]; then
  echo "One or more workflows failed to activate." >&2
  dc start n8n >/dev/null 2>&1 || true
  exit 1
fi

# Ensure changes take effect (and n8n is running).
dc restart n8n >/dev/null
