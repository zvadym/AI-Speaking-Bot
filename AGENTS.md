# AGENTS.md

This file orients automated agents working in this repo. Keep it accurate as the project evolves.

## Documentation and Plans — Notion First
- **Notion is the canonical workspace for project documentation, requirements, decisions, development plans, and implementation handoffs. All agents must work with the relevant Notion pages, not treat repository Markdown copies as the current plan.**
- Project home: [LanguageBot](https://app.notion.com/p/2ffe327632fc8006bfaceacf80061304).
- Current product documentation: [документація](https://app.notion.com/p/410e327632fc81409826f1692953aeaf).
- Requirements and future work: [план розвитку](https://app.notion.com/p/410e327632fc8171a8bffe625189b661).
- Relaunch execution references:
  - [Master plan and agent handoff](https://app.notion.com/p/410e327632fc813cad06f39e7a30b1e9).
  - [Relaunch specification](https://app.notion.com/p/410e327632fc81f8b82afc94080bf8b5).
  - [Implementation phases P0–P7](https://app.notion.com/p/410e327632fc814fbfabd697cfea0dde), with a separate child page for each phase.
- At the start of a task, use the connected Notion tools to read the relevant current documentation and plan pages. For a phase implementation, also read the specification, that phase's page, and dependency handoffs. Follow child-page links rather than assuming a parent page contains the complete instructions.
- Keep current behavior separate from proposed behavior. Confirm implementation claims against the owning code, migrations, configuration, and verification results; a plan or checked box alone does not prove that a feature is live. Resolve material conflicts before dependent changes, respecting the user's latest instructions.
- Write new documentation, decisions, plans, task status, and handoffs in the appropriate Notion section. After implementation, update the affected documentation and phase page with the actual result, commit IDs, checks, rollout state, and remaining work. Include the updated Notion links in the final handoff.
- Fetch a page before editing it, preserve unrelated content and nested pages, and prefer targeted updates. Never copy secrets, populated env files, or private database exports into Notion.
- Private documentation, research, relaunch specifications, development plans, and phase handoffs live only in Notion. Keep only navigation links and agent workflow rules in this file; never copy private page contents or exports into repository files, commits, PR descriptions, or public issue discussions. A private Notion link does not make its contents suitable for publication.
- Remaining public repository guides, including `DEV_DEPLOY.md` and deployment guides, are historical/reference material. The private adaptive-tutor Markdown copies have been removed from local branch history. Do not recreate them or maintain a competing Markdown plan. Local references in older instructions identify former source material; read the corresponding current Notion page first.
- This policy does not move executable sources to Notion: code, migrations, `db/schema.sql`, runtime prompt templates, bot configs, tests, and generated artifacts still belong in Git and follow their existing source-of-truth rules. Keep `AGENTS.md` in Git as the entry point for future agents.
- If Notion access is unavailable, report the access problem and which context or update is missing. Do not silently substitute local copies or claim a Notion update succeeded. Continue only independent work that does not depend on the missing context, and identify any pending documentation synchronization in the handoff.

## Project Overview
- Multi-bot Telegram language-learning product with voice transcription, corrections, feedback threads, broadcasts, admin metrics, and paid plans.
- The API accepts Telegram webhooks directly and pg-boss workers execute the typed bot pipelines backed by Postgres, OpenAI, and Stripe.
- `deploy/bots/*.json` is the runtime source of truth for bot/language-pair configuration and also feeds landing-page generation.
- Topic catalogs are DB-backed per bot pair; `bot_topic_catalog` is the only source of truth.
- The app stack (`api` + `worker` + `miniapp` + `caddy`) deploys via Docker Compose; the marketing landing site in `apps/landing` deploys separately to Vercel.

## Repo Layout
- `apps/api`: Node.js (Express, ESM) API for Telegram auth, Stripe billing, and DB access.
- `apps/miniapp`: Vue 3 + Vite SPA used inside Telegram Mini App.
- `apps/landing`: Nuxt 3 marketing site for `ai-language-school.online`; prerenders teacher/blog pages and generates static output for Vercel.
- `db/migrations`: Forward-only SQL migrations (dbmate).
- `db/schema.sql`: Canonical Postgres schema snapshot generated from migrations.
- `deploy`: Docker Compose stack, Caddy config, env files, prompts, phrases, and bot configs.
- `deploy/bots`: Production bot configs consumed by the API and landing generators.
- `deploy/prompts`: Template source of truth for the typed multi-bot runtime's LLM prompts.
- `deploy/phrases`: Curated idiomatic phrase JSON files imported into the DB for daily idiom-practice notifications.
- `scripts`: Local dev, migration, deploy, webhook management, and bot provisioning helpers.

## Local Dev
- API:
  - `scripts/dev-api.sh` / `scripts/dev-worker.sh` (load external `API_ENV_FILE`).
  - Or `cd apps/api && npm install && npm run dev`.
  - Tests: `cd apps/api && npm test`.
- Mini-app:
  - `scripts/dev-miniapp.sh` (loads external `MINIAPP_ENV_FILE`).
  - Or `cd apps/miniapp && npm install && npm run dev`.
- Landing:
  - `scripts/dev-landing.sh` (loads external `LANDING_ENV_FILE`).
  - Or `cd apps/landing && npm install && npm run dev`.
- API has a `node:test` suite; run it with `cd apps/api && npm test`.

## Env & Secrets
- API required env vars (see `apps/api/src/env.js`):
  - `DATABASE_URL`, `WEBAPP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`.
  - Public `deploy/bots/*.json` identifies bot pairs. Supply `TELEGRAM_BOT_TOKEN_<BOT_KEY>` in the environment (for example `TELEGRAM_BOT_TOKEN_UK_EN`). At least one is required at runtime; deployment preflights every configured bot.
- API optional env vars: `API_PORT`, `API_BASE_URL`, `CORS_ORIGINS`,
  `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `TELEGRAM_INITDATA_MAX_AGE`,
  `STRIPE_BILLING_PRODUCT_ID` (required to manage Stripe product prices from the admin dashboard),
  `STRIPE_PORTAL_CONFIG_ID`, `WEBAPP_RETURN_URL`,
  `DISCORD_EVENTS_WEBHOOK_URL`, `DISCORD_USER_MILESTONE_STEP`,
  `ADMIN_DASHBOARD_PASSWORD`,
  `BROADCAST_MAX_RECIPIENTS`, `BROADCAST_PROCESS_BATCH_SIZE`,
  `BROADCAST_PER_MESSAGE_DELAY_MS`, `BROADCAST_MEDIA_CHAT_ID`, `DEFAULT_BOT_KEY`,
  `BOT_KEY_BY_TARGET_LANG_JSON`, `BOT_RUNTIME_ROUTE_FLAGS_JSON`,
  `BOT_PROGRESS_ENABLED_BOT_KEYS`, `BOT_IMMEDIATE_ACK_ENABLED_BOT_KEYS`,
  `BOT_ONBOARDING_V2_ENABLED_BOT_KEYS`,
  `BOT_RUNTIME_MODEL`, `BOT_RUNTIME_REASONING_EFFORT`,
  `BOT_SUPPORT_MODEL`, `BOT_SUPPORT_REASONING_EFFORT`, `BOT_MODEL_POLICY_JSON`,
  `BOT_TRANSCRIPTION_MODEL`, `BOT_TTS_MODEL`, `OPENAI_API_KEY`,
  `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`,
  `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILE_SESSION_SAMPLE_RATE`,
  `TOPIC_GENERATION_MODEL`, `TOPIC_GENERATION_REASONING_EFFORT`,
  `REMINDER_LLM_MODEL`, `REMINDER_LLM_REASONING_EFFORT`,
  `IDIOM_PRACTICE_REASONING_EFFORT`, `IDIOM_PRACTICE_SEND_HOURS_UTC` (defaults to `7,17`),
  `IDIOM_PRACTICE_SEND_MINUTE_UTC` (defaults to `15`),
  `IDIOM_PRACTICE_SEND_HOUR_UTC` (legacy single-hour fallback),
  `IDIOM_PRACTICE_SCAN_LIMIT`, `IDIOM_PRACTICE_OPENAI_MODEL`.
- Mini-app env vars:
  - Required: `VITE_API_BASE`.
  - Optional: `VITE_ADMIN_PATH`, `VITE_STRIPE_EMBEDDED_CHECKOUT`, `VITE_STRIPE_PUBLISHABLE_KEY`,
    `VITE_SCHOOL_URL`, `VITE_DEBUG_UI`.
- Landing env vars:
  - Optional runtime/build vars include `NUXT_PUBLIC_SITE_URL`, `PRICING_API_BASE`,
    `LANDING_DISCORD_WEBHOOK_URL`,
    and legacy fallbacks `VITE_SITE_URL`, `API_BASE_URL`, `VITE_API_BASE`.
  - `apps/landing/scripts/generate-pricing.mjs` fetches `/public/plans` at build time; in CI/Vercel it fails hard if pricing env is missing.
- Keep all populated env files outside Git checkouts, mode 0600, in a directory mode 0700.
- Local defaults: `~/.config/ai-speaking-bot/{api,miniapp,landing}.env`; override with `API_ENV_FILE`, `MINIAPP_ENV_FILE`, `LANDING_ENV_FILE` or `LANGUAGEBOT_CONFIG_DIR`.
- Server default: `/etc/ai-speaking-bot/{api,miniapp}.env` (`DEPLOY_CONFIG_DIR` override).
- Node reads only an explicitly selected `API_ENV_FILE`; Docker receives env through Compose. Never put backend secrets in VITE/NUXT_PUBLIC values.
- `scripts/migrate-private-env.py` copies legacy configuration into private storage, verifies parity and creates a private backup. `--remove-legacy` removes old local env files and inline token fields only after verification. Read the current [private environment migration runbook in Notion](https://app.notion.com/p/410e327632fc81d99a20eb316551c6c9) before server rollout; `deploy/PRIVATE_ENV_MIGRATION.md` is the repository reference copy.

## DB / Migrations
- Run migrations via `deploy/migrate.sh` (uses `ghcr.io/amacneil/dbmate:2.12`).
- Migrations live in `db/migrations` and should be forward-only.
- `db/schema.sql` must stay in sync with migrations:
  - Update: `./scripts/db-schema.sh update` (or `./scripts/dev-migrate.sh up`, which refreshes it automatically).
  - Verify: `./scripts/db-schema.sh check` (also enforced in CI for migration-related changes).
- Every migration PR must include the corresponding `db/schema.sql` update.

## Deployment
- Read the current [deployment guide](https://app.notion.com/p/410e327632fc8165b40be491255f9c24) and [local development guide](https://app.notion.com/p/410e327632fc81db8eaef8b63f837edb) in Notion for the relevant operation.
- `deploy/deploy.sh` runs migrations, starts API + worker + mini-app + Caddy, and registers Telegram webhooks.
- `scripts/deploy-remote.sh` performs the same on the server via SSH.
- `scripts/vercel-deploy-landing.sh [prod|preview]` deploys `apps/landing` to Vercel.

## Bot Runtime
- Telegram sends each bot update to `/telegram/webhook/:botKey`.
- The API validates the per-bot webhook secret, persists ingestion state, and enqueues a pg-boss job.
- `apps/api/src/bot-runtime` owns route preparation, typed handlers, AI calls, durable effects, and Telegram delivery.
- `apps/api/src/bot-runtime/pipeline.ts` is the universal middleware runner;
  cross-cutting behavior wraps complete handlers or explicit named stages.
- Progress messages are enabled per bot with `BOT_PROGRESS_ENABLED_BOT_KEYS`;
  use `*` only after canary verification.
- Immediate Telegram typing acknowledgements are enabled per bot with
  `BOT_IMMEDIATE_ACK_ENABLED_BOT_KEYS`; they remain best-effort and never own
  durable ingestion state.
- `apps/api/src/bot-runtime/entitlement-context.ts` is the single source of truth for effective plan and practice quota; usage is global by `chat_id` across all bots.
- `deploy/prompts/*.md` and `shared/llm-prompts/*.md` are loaded directly by the API and worker.
- `apps/api/scripts/telegram-webhooks.mjs set|inspect|delete` manages all configured Telegram webhooks.

## Bot Configs
- Production bot configs live in `deploy/bots/*.json`.
- API startup reads public `deploy/bots/*.json` via `apps/api/src/bot-configs.js`; `extractBotTokens()` resolves private environment credentials separately. Never write tokens into JSON configs.
- `scripts/provision-bots.py sync` validates/normalizes Telegram presentation fields; `scripts/provision-bots.py apply` pushes them to Telegram.
- When changing bot config shape or meaning, verify both consumers: API and landing generators.

## Topics
- Canonical topic catalogs live in Postgres table `bot_topic_catalog`, keyed by `bot_key + topic_id`.
- Each topic also carries `access_tier` (`all`, `free`, or `pro`) so Telegram topic menus and callbacks can be filtered by the user’s effective plan tier.
- User topic selection still snapshots the chosen pack into `user_bots.topic_pack_json`.
- Admin CRUD and AI draft generation are exposed via `/admin/topics*`.
- Do not add file-based topic catalogs under `deploy/`; topics are managed in the DB/admin API only.

## Generated Artifacts
- Do not hand-edit `apps/landing/src/generated/teachers.js` or `apps/landing/src/generated/pricing.js`; they are generated by landing scripts.
- Teacher data is generated from `deploy/bots/*.json`.
- Pricing data is generated from the API `/public/plans` endpoint.
- Idiom phrase source JSON lives under `deploy/phrases/*.json`; runtime delivery reads the imported DB tables, not the JSON files directly.

## Conventions / Safety
- API code is ESM; keep `import`/`export` style.
- Avoid hardcoding secrets; use env vars.
- When changing API responses used by the mini-app or landing generators, update the consumer in the same change.
- When changing bot config fields, runtime prompt placeholders, or generated landing inputs, update the relevant Notion documentation and repository scripts together.
- When changing idiom phrase source shape or file naming under `deploy/phrases`, update the DB import script and reminder delivery code together.
- Prefer editing source templates over generated outputs.
- If you add new env vars, update Notion documentation and repository env examples/validation, and consider `.gitignore` as needed. Examples must contain no real secrets.

## Smoke Checks
- API health: `GET /healthz`.
- Mini-app production build: `cd apps/miniapp && npm run build`.
- Landing production build: `cd apps/landing && npm run build`.
- Deployed URLs and verification steps are documented in the [Notion deployment guide](https://app.notion.com/p/410e327632fc8165b40be491255f9c24); `deploy/README.md` is the repository reference copy.
