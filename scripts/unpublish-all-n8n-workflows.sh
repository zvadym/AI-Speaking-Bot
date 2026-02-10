#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
PROJECT="${PROJECT:-languagebot}"
STOP_N8N_BEFORE="${STOP_N8N_BEFORE:-true}"

dc() {
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" "$@"
}

n8n_cli() {
  dc run -T --rm --no-deps --entrypoint n8n n8n "$@" </dev/null
}

n8n_sh() {
  local cmd="$1"
  dc run -T --rm --no-deps --entrypoint sh n8n -lc "${cmd}" </dev/null
}

probe_cmd() {
  local cmd="$1"
  local out=""
  out="$(n8n_cli "${cmd}" --help 2>&1 || true)"
  if echo "${out}" | grep -qiE "Unknown command|not found|did you mean"; then
    return 1
  fi
  return 0
}

did_stop="false"
cleanup() {
  if [[ "${did_stop}" == "true" ]]; then
    dc start n8n >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "${STOP_N8N_BEFORE}" == "true" ]]; then
  dc stop n8n >/dev/null 2>&1 || true
  did_stop="true"
fi

unpublish_cmd=""
if probe_cmd "unpublish:workflow"; then
  unpublish_cmd="unpublish:workflow"
elif probe_cmd "workflow:deactivate"; then
  unpublish_cmd="workflow:deactivate"
elif probe_cmd "deactivate:workflow"; then
  unpublish_cmd="deactivate:workflow"
elif probe_cmd "update:workflow"; then
  unpublish_cmd="update:workflow"
else
  echo "No supported workflow deactivation/unpublish commands found in n8n container." >&2
  echo "Debug: n8n --version" >&2
  n8n_cli --version >&2 || true
  echo "Debug: n8n --help (first 200 lines)" >&2
  n8n_cli --help 2>&1 | sed -n '1,200p' >&2 || true
  exit 1
fi

list_cmd=""
if probe_cmd "list:workflow"; then
  list_cmd="list:workflow"
elif probe_cmd "workflow:list"; then
  list_cmd="workflow:list"
elif probe_cmd "export:workflow"; then
  list_cmd="export:workflow"
else
  echo "No supported workflow list/export commands found in n8n container." >&2
  exit 1
fi

list_out=""
if [[ "${list_cmd}" == "export:workflow" ]]; then
  # Prefer exporting to a temp file, then cat it, to avoid mixed stdout logs.
  # Fall back to stdout export for older CLI variants.
  if ! list_out="$(
    n8n_sh 'set -euo pipefail; tmp="/tmp/workflows-export.json"; if n8n export:workflow --all --output "$tmp" >/dev/null 2>&1; then cat "$tmp"; else n8n export:workflow --all; fi' 2>&1
  )"; then
    echo "Failed to export workflows via n8n CLI." >&2
    echo "${list_out}" >&2
    exit 1
  fi
else
  if ! list_out="$(n8n_cli "${list_cmd}" 2>&1)"; then
    echo "Failed to list workflows via n8n CLI." >&2
    echo "${list_out}" >&2
    exit 1
  fi
fi

workflow_ids="$(
  printf '%s' "${list_out}" | python3 - <<'PY'
import json
import re
import sys

s = sys.stdin.read().strip()
if not s:
    sys.exit(0)

def try_json(payload: str):
    try:
        return json.loads(payload)
    except Exception:
        return None

data = try_json(s)
if data is None:
    # Try to extract the JSON part from mixed output.
    starts = [i for i in (s.find("["), s.find("{")) if i != -1]
    if starts:
        start = min(starts)
        end = max(s.rfind("]"), s.rfind("}"))
        if end != -1 and end > start:
            data = try_json(s[start : end + 1])

ids = []
if isinstance(data, list):
    for item in data:
        if isinstance(item, dict) and "id" in item:
            ids.append(str(item["id"]))
elif isinstance(data, dict):
    # Some variants export a wrapper object.
    if "workflows" in data and isinstance(data["workflows"], list):
        for item in data["workflows"]:
            if isinstance(item, dict) and "id" in item:
                ids.append(str(item["id"]))
    elif "id" in data:
        ids.append(str(data["id"]))

if not ids:
    # Fallback: parse numeric IDs from a table-like output.
    ids = re.findall(r"(?m)^\s*(\d+)\b", s)

seen = set()
for wid in ids:
    if wid in seen:
        continue
    seen.add(wid)
    print(wid)
PY
)"

if [[ -z "${workflow_ids}" ]]; then
  echo "No workflows found; nothing to unpublish/deactivate."
  exit 0
fi

# Convert newline-separated IDs to array for single-container batch
workflow_id_arr=()
while IFS= read -r workflow_id; do
  [[ -z "${workflow_id}" ]] && continue
  echo "Unpublishing/deactivating workflow: ${workflow_id}"
  workflow_id_arr+=("${workflow_id}")
done <<<"${workflow_ids}"

# Single container: loop inside to avoid one container per workflow
extra_args=""
if [[ "${unpublish_cmd}" == "update:workflow" ]]; then
  extra_args="--active=false"
fi
if ! dc run -T --rm --no-deps --entrypoint sh n8n -c 'for id in "$@"; do n8n '"${unpublish_cmd}"' --id="$id" '"${extra_args}"' || exit 1; done' sh "${workflow_id_arr[@]}" </dev/null; then
  echo "One or more workflows failed to unpublish/deactivate." >&2
  exit 1
fi
