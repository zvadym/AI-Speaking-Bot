# AGENTS.md

This file orients automated agents working in this repo. Keep it accurate as the project evolves.

## Project Overview
- Telegram language-learning bot with voice transcription, corrections, and paid plans.
- n8n handles bot workflows; API and Mini-app are custom services.
- Stripe subscriptions drive entitlements; Postgres is the source of truth.
- Deployments run via Docker Compose with Caddy as the edge proxy.

## Repo Layout
- `apps/api`: Node.js (Express, ESM) API for Telegram auth, Stripe billing, and DB access.
- `apps/miniapp`: Vue 3 + Vite SPA used inside Telegram Mini App.
- `db/migrations`: Forward-only SQL migrations (dbmate).
- `db/schema.sql`: Canonical Postgres schema snapshot generated from migrations.
- `deploy`: Docker Compose stack, Caddy config, deploy/migrate scripts, n8n workflows.
- `scripts`: Local dev helpers and n8n workflow render/activation scripts.

## Local Dev
- API:
  - `scripts/dev-api.sh` (loads `deploy/.env.api` if present).
  - Or `cd apps/api && npm install && npm run dev`.
- Mini-app:
  - `scripts/dev-miniapp.sh` (loads `deploy/.env.miniapp` if present).
  - Or `cd apps/miniapp && npm install && npm run dev`.
- End-to-end smoke checks are available via `scripts/e2e.sh` (boots Postgres + n8n + API, runs migrations, imports workflows, and validates key API/webhook flows).

## Env & Secrets
- API required env vars (see `apps/api/src/env.js`):
  - `DATABASE_URL`, `WEBAPP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`.
  - Telegram bot tokens: configured in `deploy/bots/*.json` files (mounted into container as read-only volume).
- API optional env vars: `API_PORT`, `API_BASE_URL`, `CORS_ORIGINS`,
  `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `TELEGRAM_INITDATA_MAX_AGE`,
  `STRIPE_PORTAL_CONFIG_ID`.
- Mini-app: `VITE_API_BASE`.
- n8n: `deploy/.env` and `deploy/.env.prod` (credential IDs for workflow rendering).
- Do not commit secrets. Note: `deploy/.env` is not currently ignored in `.gitignore`.

## DB / Migrations
- Run migrations via `deploy/migrate.sh` (uses `ghcr.io/amacneil/dbmate:2.12`).
- Migrations live in `db/migrations` and should be forward-only.
- `db/schema.sql` must stay in sync with migrations:
  - Update: `./scripts/db-schema.sh update` (or `./scripts/dev-migrate.sh up`, which refreshes it automatically).
  - Verify: `./scripts/db-schema.sh check` (also enforced in CI for migration-related changes).
- Every migration PR must include the corresponding `db/schema.sql` update.

## Deployment
- `deploy/deploy.sh` runs migrations and `docker compose` for API + mini-app + Caddy + n8n.
- `scripts/deploy-remote.sh` performs the same on the server via SSH and renders workflows.

## n8n Workflows
- Source: `deploy/workflows`.
- Main workflow: `ai-bot.json` (includes conversation flow, plan-changed notifications, and broadcast send-message).
- Deprecated: `plan-changed.json` and `admin-broadcast.json` were merged into `ai-bot.json`.
- Render: `scripts/render-n8n-workflows.py --input deploy/workflows --output deploy/workflows/.rendered`.
- Activate: `scripts/activate-n8n-workflows.sh`.
- See `WEBHOOK_CONSOLIDATION.md` for details on the workflow consolidation.

## Conventions / Safety
- API code is ESM; keep `import`/`export` style.
- Avoid hardcoding secrets; use env vars.
- When changing API responses used by the mini-app or n8n, update the consumer.
- If you add new env vars, update docs and consider `.gitignore` as needed.

## Smoke Checks
- API health: `GET /healthz`.
- Deployed URLs and verification steps are documented in `deploy/README.md`.
