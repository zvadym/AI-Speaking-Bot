#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/.env.api"
SCHEMA_SCRIPT="$ROOT_DIR/scripts/db-schema.sh"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

load_database_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo -e "${RED}✗ Missing $ENV_FILE${NC}" >&2
    echo "  Copy deploy/.env.api.example to deploy/.env.api and fill it in." >&2
    exit 1
  fi

  set -a
  source "$ENV_FILE"
  set +a

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo -e "${RED}✗ DATABASE_URL is not set in $ENV_FILE${NC}" >&2
    exit 1
  fi
}

# Default command is "up" (apply migrations)
COMMAND="${1:-up}"

case "$COMMAND" in
  up)
    load_database_env
    echo -e "${GREEN}→ Applying pending migrations...${NC}"
    docker run --rm \
      -e DATABASE_URL="$DATABASE_URL" \
      -v "$ROOT_DIR/db:/db" \
      ghcr.io/amacneil/dbmate:2.12 --no-dump-schema up
    echo -e "${GREEN}→ Refreshing db/schema.sql snapshot...${NC}"
    "$SCHEMA_SCRIPT" update
    echo -e "${GREEN}✓ Migrations applied${NC}"
    ;;
  
  down)
    load_database_env
    echo -e "${YELLOW}→ Rolling back last migration...${NC}"
    docker run --rm \
      -e DATABASE_URL="$DATABASE_URL" \
      -v "$ROOT_DIR/db:/db" \
      ghcr.io/amacneil/dbmate:2.12 --no-dump-schema down
    echo -e "${GREEN}→ Refreshing db/schema.sql snapshot...${NC}"
    "$SCHEMA_SCRIPT" update
    echo -e "${GREEN}✓ Rollback complete${NC}"
    ;;
  
  status)
    load_database_env
    echo -e "${GREEN}→ Checking migration status...${NC}"
    docker run --rm \
      -e DATABASE_URL="$DATABASE_URL" \
      -v "$ROOT_DIR/db:/db" \
      ghcr.io/amacneil/dbmate:2.12 status
    ;;
  
  new)
    load_database_env
    if [[ -z "${2:-}" ]]; then
      echo -e "${RED}✗ Please provide a migration name${NC}" >&2
      echo "  Usage: $0 new <migration_name>" >&2
      exit 1
    fi
    echo -e "${GREEN}→ Creating new migration: $2${NC}"
    docker run --rm \
      -e DATABASE_URL="$DATABASE_URL" \
      -v "$ROOT_DIR/db:/db" \
      ghcr.io/amacneil/dbmate:2.12 new "$2"
    echo -e "${GREEN}✓ Migration file created in db/migrations/${NC}"
    echo -e "${YELLOW}⚠ After editing the migration, run '$0 up' to apply it and refresh db/schema.sql${NC}"
    ;;

  schema-update)
    echo -e "${GREEN}→ Regenerating db/schema.sql from migrations...${NC}"
    "$SCHEMA_SCRIPT" update
    echo -e "${GREEN}✓ db/schema.sql updated${NC}"
    ;;

  schema-check)
    echo -e "${GREEN}→ Verifying db/schema.sql is in sync with migrations...${NC}"
    "$SCHEMA_SCRIPT" check
    echo -e "${GREEN}✓ Schema snapshot is in sync${NC}"
    ;;
  
  help|--help|-h)
    echo "Dev Migration Helper"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  up       Apply pending migrations (default)"
    echo "  down     Rollback the last migration"
    echo "  status   Show migration status"
    echo "  new      Create a new migration file"
    echo "  schema-update  Regenerate db/schema.sql from db/migrations"
    echo "  schema-check   Verify db/schema.sql matches db/migrations"
    echo "  help     Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0              # Apply all pending migrations"
    echo "  $0 up           # Apply all pending migrations"
    echo "  $0 down         # Rollback last migration"
    echo "  $0 status       # Check which migrations are applied"
    echo "  $0 new add_user_column  # Create new migration"
    echo "  $0 schema-update # Refresh db/schema.sql manually"
    echo "  $0 schema-check  # Verify db/schema.sql is current"
    ;;
  
  *)
    echo -e "${RED}✗ Unknown command: $COMMAND${NC}" >&2
    echo "  Run '$0 help' for usage information" >&2
    exit 1
    ;;
esac
