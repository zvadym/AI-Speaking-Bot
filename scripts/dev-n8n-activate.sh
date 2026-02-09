#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOWS_DIR="$ROOT_DIR/deploy/workflows/.rendered"

if [[ ! -d "$WORKFLOWS_DIR" ]]; then
  echo "Missing workflows dir" >&2
  exit 1
fi

N8N_CONTAINER="${N8N_CONTAINER:-n8n}"

for f in "$WORKFLOWS_DIR"/*.json; do
  [[ ! -f "$f" ]] && continue

  workflow_id="$(python3 -c "import json; print(json.load(open('$f')).get('id', ''))")"
  workflow_name="$(python3 -c "import json; print(json.load(open('$f')).get('name', ''))")"

  if [[ -z "$workflow_id" ]]; then
    echo "Skipping $(basename "$f") (no ID)" >&2
    continue
  fi

  echo "Activating: $workflow_name ($workflow_id)"
  docker exec "$N8N_CONTAINER" n8n update:workflow --id="$workflow_id" --active=true || true
done

echo "Activation complete"
