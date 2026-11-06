# Local Development

The bot runs as an API process plus a pg-boss worker. Use Node **22.12+** and Python 3.
All populated env files live outside the repository. Defaults are under
`~/.config/ai-speaking-bot`; override paths with `API_ENV_FILE`,
`MINIAPP_ENV_FILE`, `LANDING_ENV_FILE`, or the directory with `LANGUAGEBOT_CONFIG_DIR`.

## Environment

For a new development installation:

```bash
mkdir -p "$HOME/.config/ai-speaking-bot"
chmod 700 "$HOME/.config/ai-speaking-bot"
install -m 600 deploy/.env.api.example "$HOME/.config/ai-speaking-bot/api.env"
install -m 600 deploy/.env.miniapp.example "$HOME/.config/ai-speaking-bot/miniapp.env"
install -m 600 apps/landing/.env.example "$HOME/.config/ai-speaking-bot/landing.env"
```

Fill the private files with your own development settings. Never overwrite an existing
private env file with a template. Existing installations must follow
[the migration runbook](deploy/PRIVATE_ENV_MIGRATION.md) to preserve credentials.

Set local Mini App `VITE_API_BASE=http://localhost:3000`. `VITE_*` values are public
browser build inputs; backend secrets belong only in `api.env`.
Postgres must be reachable through `DATABASE_URL`. API/worker also need Stripe,
JWT, OpenAI and Telegram configuration. Public bot JSON must never contain tokens.
For each bot key, set its corresponding environment variable, for example
`TELEGRAM_BOT_TOKEN_UK_EN` for `uk-en`. Local runtime can enable a subset of bots;
production deployment requires credentials for every JSON config.

Files use dotenv assignments, with no shell expansion. Quote literal values containing
`#` or `$` with single quotes; do not use shell commands or variable references.
Explicit process environment values take precedence over file values.

## Database

```bash
./scripts/dev-migrate.sh
./scripts/dev-migrate.sh status
./scripts/dev-migrate.sh schema-check
```

`./scripts/dev-migrate.sh up` applies migrations and refreshes `db/schema.sql`.

## Run

Use separate terminals:

```bash
./scripts/dev-api.sh
```

```bash
./scripts/dev-worker.sh
```

```bash
./scripts/dev-miniapp.sh
```

The VS Code `All` launch configuration starts all three processes. The landing
site is optional and runs with `./scripts/dev-landing.sh`.

## Telegram Updates

Do not point a production bot webhook at localhost. For local handler work,
prefer the API test suite and route fixtures:

```bash
cd apps/api
npm test
npm run typecheck
```

For an isolated real-bot test, use a dedicated bot config and an HTTPS tunnel,
then set its webhook to `/telegram/webhook/<bot-key>` with
`apps/api/scripts/telegram-webhooks.mjs` after the API build. For direct Node/npm
commands, opt into the private file explicitly:

```bash
API_ENV_FILE="$HOME/.config/ai-speaking-bot/api.env" npm --prefix apps/api run worker:dev
```

`npm test` uses synthetic credentials and does not load the private file. The optional
Postgres integration test uses only an explicitly configured `BOT_RUNTIME_TEST_DATABASE_URL`.

## Production Deploy

```bash
./scripts/deploy-remote.sh
./scripts/deploy-remote.sh --restart-all
```

The deploy runs migrations, builds API/worker/Mini App images, recreates the
application services, and re-registers every configured Telegram webhook.

## Troubleshooting

- Wrong Mini App API: verify `VITE_API_BASE` and restart the Vite process.
- No bot response: confirm both API and worker are running, then inspect worker logs.
- Database errors: verify `DATABASE_URL` and run `./scripts/dev-migrate.sh status`.
- Schema check failure: run `./scripts/dev-migrate.sh schema-update` and commit the snapshot.
- Webhook failure: inspect Telegram webhooks from the deployed API container as documented in `deploy/README.md`.
