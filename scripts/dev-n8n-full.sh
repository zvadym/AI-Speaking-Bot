#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Step 1/3: Rendering workflows..."
"$SCRIPT_DIR/dev-n8n-render.sh"

echo ""
echo "Step 2/3: Importing workflows..."
"$SCRIPT_DIR/dev-n8n-import.sh"

echo ""
echo "Step 3/3: Activating workflows..."
"$SCRIPT_DIR/dev-n8n-activate.sh"

echo ""
echo "Done. Check http://localhost:5678"
