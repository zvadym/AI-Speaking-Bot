# Deploy Guide

The production stack contains four Docker Compose services:

- `api`: Express API and direct Telegram webhook ingress
- `worker`: pg-boss jobs and typed bot pipelines
- `miniapp`: Vue application served by nginx
- `caddy`: TLS termination and reverse proxy

The marketing site under `apps/landing` deploys separately to Vercel.

## Server Setup

The server needs Git, Python 3, Docker Engine, and the Docker Compose plugin. Point these
domains to it:

- `learn-language-api.notarobot.dev`
- `learn-language-app.notarobot.dev`

For a new server, clone the repository and create two private env files outside it:

```bash
mkdir -p /opt/ai-speaking-bot
cd /opt/ai-speaking-bot
git clone <YOUR_REPO_URL> .

sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /etc/ai-speaking-bot
install -m 600 deploy/.env.api.example /etc/ai-speaking-bot/api.env
install -m 600 deploy/.env.miniapp.example /etc/ai-speaking-bot/miniapp.env
```

`/etc/ai-speaking-bot/api.env` contains database, Stripe, JWT, OpenAI and internal
API secrets, plus one `TELEGRAM_BOT_TOKEN_<BOT_KEY>` per bot (for example
`TELEGRAM_BOT_TOKEN_UK_EN`). Public `deploy/bots/*.json` contains no credentials.
`/etc/ai-speaking-bot/miniapp.env` defines `VITE_API_BASE` and public Mini App build values.
Override the server directory with `DEPLOY_CONFIG_DIR`. Files must be mode 0600,
with the directory mode 0700, readable by the SSH deployment user.

**Existing servers: follow [PRIVATE_ENV_MIGRATION.md](PRIVATE_ENV_MIGRATION.md)
before deploying this change. Do not replace existing configuration with templates.**
The SSH deploy checks all credentials from the target Git revision before resetting
the working checkout or running migrations. No secrets are uploaded during routine deploy.
The host-side Compose env files supply API/worker variables; secret files are not image inputs.

For direct Docker Compose commands outside the wrapper, export both paths:

```bash
export API_ENV_FILE=/etc/ai-speaking-bot/api.env
export MINIAPP_ENV_FILE=/etc/ai-speaking-bot/miniapp.env
```

Do not print `docker compose config` with real credentials; its output expands env values.
Use `docker compose config --quiet` for syntax validation.

Interactive onboarding v2 is opt-in per bot through
`BOT_ONBOARDING_V2_ENABLED_BOT_KEYS`. Use a comma-separated list of bot keys
for a canary rollout, for example `uk-en,en-de`. The value `*` enables every
configured bot; an empty value keeps the legacy onboarding flow. The API
validates both the bot keys and each enabled bot's `locale.onboarding_v2`
contract during startup.

For an enabled bot, a private `/start` creates or restarts interactive
onboarding even for an existing user. The reset affects only onboarding state;
language level, messages, subscription, and other preferences are preserved.

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
