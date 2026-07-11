# Local Development

The bot runs as an API process plus a pg-boss worker. Both use
`deploy/.env.api`; the Mini App uses `deploy/.env.miniapp`.

## Environment

```bash
cp deploy/.env.api.example deploy/.env.api
cp deploy/.env.miniapp.example deploy/.env.miniapp
```

For local Mini App development, set:

```bash
VITE_API_BASE=http://localhost:3000
```

Postgres must be reachable through `DATABASE_URL`. The API also requires valid
Stripe, JWT, OpenAI, and Telegram bot credentials. Bot tokens and locale data
come from `deploy/bots/*.json`.

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
cd apps/api
npm run worker:dev
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
`apps/api/scripts/telegram-webhooks.mjs`.

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
