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

# Show help
./scripts/dev-migrate.sh help
