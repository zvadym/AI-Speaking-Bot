FOR LOCAL MIGRATIONS:

# Apply all pending migrations (default)
./scripts/dev-migrate.sh
# or explicitly:
./scripts/dev-migrate.sh up

# Check migration status
./scripts/dev-migrate.sh status

# Rollback last migration
./scripts/dev-migrate.sh down

# Create a new migration
./scripts/dev-migrate.sh new add_bot_preferences

# Regenerate schema snapshot from migrations
./scripts/dev-migrate.sh schema-update
# or directly:
./scripts/db-schema.sh update

# Verify schema snapshot is in sync
./scripts/dev-migrate.sh schema-check
# or directly:
./scripts/db-schema.sh check

# Show help
./scripts/dev-migrate.sh help


REMEMBER:
 - Always add --migrate:up and --migrate:down to the migration file
 - Every migration change must include updated db/schema.sql
 
