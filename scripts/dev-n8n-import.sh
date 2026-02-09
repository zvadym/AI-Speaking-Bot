#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOWS_DIR="$ROOT_DIR/deploy/workflows/.rendered"

if [[ ! -d "$WORKFLOWS_DIR" ]]; then
  echo "Missing workflows dir. Run ./scripts/dev-n8n-render.sh first" >&2
  exit 1
fi

# Default container name; override with N8N_CONTAINER if your n8n container has a different name
N8N_CONTAINER="${N8N_CONTAINER:-n8n}"

found=0
for f in "$WORKFLOWS_DIR"/*.json; do
  [[ ! -f "$f" ]] && continue
  found=1
  echo "Importing: $(basename "$f")"
  docker exec -i "$N8N_CONTAINER" n8n import:workflow --input=/dev/stdin --overwrite < "$f" || exit 1
done

if [[ "$found" != "1" ]]; then
  echo "No workflow JSON files found in $WORKFLOWS_DIR" >&2
  exit 1
fi

echo "Import complete"
