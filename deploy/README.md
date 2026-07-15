# Deploy Guide

The production stack contains four Docker Compose services:

- `api`: Express API and direct Telegram webhook ingress
- `worker`: pg-boss jobs and typed bot pipelines
- `miniapp`: Vue application served by nginx
- `caddy`: TLS termination and reverse proxy

The marketing site under `apps/landing` deploys separately to Vercel.

## Server Setup

The server needs Git, Docker Engine, and the Docker Compose plugin. Point these
domains to it:

- `learn-language-api.notarobot.dev`
- `learn-language-app.notarobot.dev`

Clone the repository and create the two runtime env files:

```bash
mkdir -p /opt/ai-speaking-bot
cd /opt/ai-speaking-bot
git clone <YOUR_REPO_URL> .

cp deploy/.env.api.example deploy/.env.api
cp deploy/.env.miniapp.example deploy/.env.miniapp
```

`deploy/.env.api` must contain the database, Stripe, JWT, OpenAI, and internal
API secrets. Telegram bot tokens are read from `deploy/bots/*.json`.
`deploy/.env.miniapp` must define `VITE_API_BASE` and the Mini App build values.
Never commit populated env files or new bot tokens.

Interactive onboarding v2 is opt-in per bot through
`BOT_ONBOARDING_V2_ENABLED_BOT_KEYS`. Use a comma-separated list of bot keys
for a canary rollout, for example `uk-en,en-de`. The value `*` enables every
configured bot; an empty value keeps the legacy onboarding flow. The API
validates both the bot keys and each enabled bot's `locale.onboarding_v2`
contract during startup.

For an enabled bot, a private `/start` creates or restarts interactive
onboarding even for an existing user. The reset affects only onboarding state;
level, XP, messages, subscription, and other preferences are preserved.

## Deploy

From the repository root on the server:

```bash
./deploy/deploy.sh
```

This command runs forward-only dbmate migrations, builds the application
images, starts the stack with orphan cleanup, and idempotently registers every
configured Telegram webhook against the API.

From a development machine with SSH access:

```bash
./scripts/deploy-remote.sh
```

Useful options:

```bash
./scripts/deploy-remote.sh --restart-all
./scripts/deploy-remote.sh --update-phrases
```

`--restart-all` force-recreates all four application containers.
`--update-phrases` imports the curated idiom catalog after the build.

## Telegram Webhooks

The webhook path is `https://learn-language-api.notarobot.dev/telegram/webhook/<bot-key>`.
Manage all configured bots from inside the API container:

```bash
docker compose -p languagebot -f deploy/docker-compose.yml exec -T api \
  node ./scripts/telegram-webhooks.mjs inspect

docker compose -p languagebot -f deploy/docker-compose.yml exec -T api \
  node ./scripts/telegram-webhooks.mjs set
```

`set` installs a deterministic secret token per bot. The API validates
`X-Telegram-Bot-Api-Secret-Token` before accepting or enqueueing an update.

## Migrations

Run migrations through the deploy scripts or directly:

```bash
./deploy/migrate.sh
```

For migration changes, keep `db/schema.sql` synchronized:

```bash
./scripts/db-schema.sh update
./scripts/db-schema.sh check
```

## Smoke Checks

```bash
curl -fsS https://learn-language-api.notarobot.dev/healthz
curl -fsS https://learn-language-app.notarobot.dev/ >/dev/null

docker compose -p languagebot -f deploy/docker-compose.yml ps
docker compose -p languagebot -f deploy/docker-compose.yml logs --tail=100 api worker
```

Then verify one bot with `/stats`, one short text message, and one short voice
message. The webhook inspection should show the API URL, zero pending updates,
and no recent Telegram delivery error for every bot.

For an onboarding canary, also verify `/start`, each scenario callback, the
voice and text first-response paths, level confirmation, and both bonus actions.

## Rollback

Roll back application code by deploying a known-good Git commit. Database
migrations are forward-only, so schema rollback requires a new migration.
Before infrastructure cutovers, retain external backups of service state and
Telegram webhook configuration until the new runtime has passed production
smoke checks.

## Landing Deploy

```bash
./scripts/vercel-deploy-landing.sh preview
./scripts/vercel-deploy-landing.sh prod
```
