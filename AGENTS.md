# AGENTS.md

This file orients automated agents working in this repo. Keep it accurate as the project evolves.

## Project Overview
- Multi-bot Telegram language-learning product with voice transcription, corrections, feedback threads, broadcasts, admin metrics, and paid plans.
- n8n orchestrates bot workflows; the API and Mini-app are custom services backed by Postgres and Stripe.
- `deploy/bots/*.json` is the runtime source of truth for bot/language-pair configuration and also feeds landing-page generation.
- The app stack (`api` + `miniapp` + `n8n` + `caddy`) deploys via Docker Compose; the marketing landing site in `apps/landing` deploys separately to Vercel.

## Repo Layout
- `apps/api`: Node.js (Express, ESM) API for Telegram auth, Stripe billing, and DB access.
- `apps/miniapp`: Vue 3 + Vite SPA used inside Telegram Mini App.
- `apps/landing`: Nuxt 3 marketing site for `ai-language-school.online`; prerenders teacher/blog pages and generates static output for Vercel.
- `db/migrations`: Forward-only SQL migrations (dbmate).
- `db/schema.sql`: Canonical Postgres schema snapshot generated from migrations.
- `deploy`: Docker Compose stack, Caddy config, env files, n8n workflows, prompts, and bot configs.
- `deploy/bots`: Production bot configs consumed by the API, workflow renderer, and landing generators.
- `deploy/bots-dev`: Local-only bot configs for local n8n credentials; JSON files here are gitignored.
- `deploy/prompts`: Template source of truth for rendered multi-bot LLM prompts.
- `scripts`: Local dev, migration, deploy, workflow render/import/activation, and bot provisioning helpers.

## Local Dev
- API:
  - `scripts/dev-api.sh` (loads `deploy/.env.api` if present).
  - Or `cd apps/api && npm install && npm run dev`.
  - Tests: `cd apps/api && npm test`.
- Mini-app:
  - `scripts/dev-miniapp.sh` (loads `deploy/.env.miniapp` if present).
  - Or `cd apps/miniapp && npm install && npm run dev`.
- Landing:
  - `scripts/dev-landing.sh` (loads `deploy/.env.landing` if present).
  - Or `cd apps/landing && npm install && npm run dev`.
- Local n8n:
  - `scripts/dev-n8n-full.sh` renders, imports, and activates local workflows.
  - Individual steps: `scripts/dev-n8n-render.sh`, `scripts/dev-n8n-import.sh`, `scripts/dev-n8n-activate.sh`.
- API has a `node:test` suite; run it with `cd apps/api && npm test`.

## Env & Secrets
- API required env vars (see `apps/api/src/env.js`):
  - `DATABASE_URL`, `WEBAPP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`.
  - At least one valid `deploy/bots/*.json` with `telegram_bot_token` is also required at runtime.
- API optional env vars: `API_PORT`, `API_BASE_URL`, `CORS_ORIGINS`,
  `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `TELEGRAM_INITDATA_MAX_AGE`,
  `STRIPE_BILLING_PRODUCT_ID` (required to manage Stripe product prices from the admin dashboard),
  `STRIPE_PORTAL_CONFIG_ID`, `WEBAPP_RETURN_URL`, `PLAN_CHANGED_WEBHOOK_URL`,
  `ADMIN_DASHBOARD_PASSWORD`, `BROADCAST_WEBHOOK_URL`, `BROADCAST_WEBHOOK_SECRET`,
  `BROADCAST_MAX_RECIPIENTS`, `BROADCAST_PROCESS_BATCH_SIZE`,
  `BROADCAST_PER_MESSAGE_DELAY_MS`, `BROADCAST_MEDIA_CHAT_ID`, `DEFAULT_BOT_KEY`,
  `BOT_KEY_BY_TARGET_LANG_JSON`, `WEBHOOKS_APPEND_BOT_KEY`.
- Mini-app env vars:
  - Required: `VITE_API_BASE`.
  - Optional: `VITE_ADMIN_PATH`, `VITE_STRIPE_EMBEDDED_CHECKOUT`, `VITE_STRIPE_PUBLISHABLE_KEY`,
    `VITE_SCHOOL_URL`, `VITE_DEBUG_UI`.
- Landing env vars:
  - Optional runtime/build vars include `NUXT_PUBLIC_SITE_URL`, `PRICING_API_BASE`,
    and legacy fallbacks `VITE_SITE_URL`, `API_BASE_URL`, `VITE_API_BASE`.
  - `apps/landing/scripts/generate-pricing.mjs` fetches `/public/plans` at build time; in CI/Vercel it fails hard if pricing env is missing.
- n8n:
  - `deploy/.env` is used by Docker Compose for the running instance.
  - `deploy/.env.prod` and `deploy/.env.dev` provide credential IDs for workflow rendering.
- Do not commit secrets. `deploy/.env.api`, `deploy/.env.miniapp`, `deploy/.env.prod`, `deploy/.env.dev`, and `deploy/bots-dev/*.json` are gitignored, but `deploy/.env` is still not ignored.

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
- `scripts/vercel-deploy-landing.sh [prod|preview]` deploys `apps/landing` to Vercel.

## n8n Workflows
- Source: `deploy/workflows`.
- Template workflow: `ai-bot.json`. Loader rotation now runs via API + worker jobs.
- In multi-bot mode, `scripts/render-n8n-workflows.py` renders per-bot workflow JSON into `deploy/workflows/.rendered`.
- Prompt templates come from `deploy/prompts/*.md` and render fails on missing or unresolved placeholders.
- Render: `scripts/render-n8n-workflows.py --input deploy/workflows --output deploy/workflows/.rendered`.
- Activate: `scripts/activate-n8n-workflows.sh`.
- Use `scripts/convert-workflow-to-template.py` when pulling bot-specific PROD workflow edits back into template files.

## Bot Configs
- Production bot configs live in `deploy/bots/*.json`; local n8n variants live in `deploy/bots-dev/*.json`.
- API startup reads `deploy/bots/*.json` directly via `apps/api/src/bot-configs.js`.
- `scripts/provision-bots.py sync` validates/normalizes Telegram presentation fields; `scripts/provision-bots.py apply` pushes them to Telegram.
- When changing bot config shape or meaning, verify all three consumers: API, workflow renderer, and landing generators.

## Generated Artifacts
- Do not hand-edit `apps/landing/src/generated/teachers.js` or `apps/landing/src/generated/pricing.js`; they are generated by landing scripts.
- Teacher data is generated from `deploy/bots/*.json`.
- Pricing data is generated from the API `/public/plans` endpoint.

## Conventions / Safety
- API code is ESM; keep `import`/`export` style.
- Avoid hardcoding secrets; use env vars.
- When changing API responses used by the mini-app, landing generators, or n8n, update the consumer in the same change.
- When changing bot config fields, workflow prompt placeholders, or generated landing inputs, update the relevant docs/scripts together.
- Prefer editing source templates over generated outputs.
- If you add new env vars, update docs and consider `.gitignore` as needed.

## Smoke Checks
- API health: `GET /healthz`.
- Mini-app production build: `cd apps/miniapp && npm run build`.
- Landing production build: `cd apps/landing && npm run build`.
- Deployed URLs and verification steps are documented in `deploy/README.md`.
