# Dev Bot Configs (`deploy/bots-dev/*.json`)

Local development bot configurations. Use these with local n8n so credential IDs point to your local n8n credentials instead of production.

**The `*.json` files in this directory are gitignored** so local credential IDs are never committed. If you don't have them yet, copy from `deploy/bots/` (e.g. `cp deploy/bots/uk-de.json deploy/bots-dev/uk-de.json`) then set `telegram_credential_id` in each file to your local n8n credential ID.

## Quick setup

### 1. Start local n8n

Ensure n8n is running in Docker (e.g. `docker ps | grep n8n`). Default container name is `n8n`; override with `N8N_CONTAINER` if needed.

### 2. Create credentials in n8n UI

1. Open **http://localhost:5678**
2. Go to **Credentials** (or **Settings → Credentials**)
3. Create credentials for:
   - **Telegram API** – one per bot (e.g. one for uk-de, one for uk-en). Use [@BotFather](https://t.me/BotFather) to create test bots.
   - **OpenAI API** – your OpenAI API key
   - **Postgres** – connection to your local Postgres (same as `DATABASE_URL` from `deploy/.env.api`)

### 3. Get credential IDs

In n8n, open a credential. The URL looks like:

`http://localhost:5678/credentials/EDIT/AbCdEfGhIjKlMnOp`

The **credential ID** is the last segment: `AbCdEfGhIjKlMnOp`.

- Note the **Telegram** credential ID for each bot (uk-de, uk-en).
- Note the **OpenAI** and **Postgres** credential IDs once.

### 4. Update dev bot configs

Edit each file in `deploy/bots-dev/`:

- **uk-de.json** – set `"telegram_credential_id": "YOUR_LOCAL_TELEGRAM_CRED_ID_uk_de"` to the Telegram credential ID for your German (uk-de) test bot.
- **uk-en.json** – set `"telegram_credential_id": "YOUR_LOCAL_TELEGRAM_CRED_ID_uk_en"` to the Telegram credential ID for your English (uk-en) test bot.

You can use the same Telegram credential for both if you only have one test bot; the workflows will still render.

### 5. Update deploy/.env.dev

Set the shared credential IDs (used by the render script for non-Telegram nodes):

```bash
N8N_CRED_OPENAI_ID=YourOpenAICredentialId
N8N_CRED_POSTGRES_ID=YourPostgresCredentialId
```

**Note:** `N8N_CRED_TELEGRAM_ID` is **not used** in multi-bot mode. Telegram credential IDs come from the `telegram_credential_id` field in each bot config file (`deploy/bots-dev/*.json`) instead.

### 6. Render and deploy workflows

From the project root:

```bash
./scripts/dev-n8n-full.sh
```

Or step by step:

```bash
./scripts/dev-n8n-render.sh   # Render workflows using deploy/bots-dev and .env.dev
./scripts/dev-n8n-import.sh  # Import into local n8n container
./scripts/dev-n8n-activate.sh # Activate workflows
```

## File naming and schema

Same as production: `deploy/bots-dev/<base>-<learning>.json` (e.g. `uk-de.json`, `uk-en.json`).

Schema matches `deploy/bots/` (see [deploy/bots/README.md](../bots/README.md)):

- `bot_key`, `base_language`, `learning_language`
- `telegram_credential_id` – **must be your local n8n Telegram credential ID**
- `locale` – same UI text structure as production (loader/messages/buttons/etc.)
  - LLM prompts are generated from `deploy/prompts/*.md` during render.

## Dev vs production

| Aspect           | Production           | Development        |
|-----------------|----------------------|--------------------|
| Bot configs     | `deploy/bots/`       | `deploy/bots-dev/` |
| Credential IDs  | `deploy/.env.prod`   | `deploy/.env.dev` + bot JSONs |
| Telegram bots   | Production tokens    | Test bot tokens    |
| n8n             | Production instance  | Local Docker       |

## Troubleshooting

- **"Missing required credential env vars"** – Set `N8N_CRED_OPENAI_ID` and `N8N_CRED_POSTGRES_ID` in `deploy/.env.dev`.
- **"Invalid bot config (missing telegram_credential_id)"** – Replace the placeholder in each `deploy/bots-dev/*.json` with the real credential ID from the n8n UI.
- **Import fails / container not found** – Ensure the n8n container is running and name matches. Use `N8N_CONTAINER=your_container_name` when running the scripts if different from `n8n`.
