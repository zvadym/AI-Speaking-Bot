# Deploy Guide

This repo deploys three services:

- API (Node/Express)
- Mini‑app (Vue + nginx)
- n8n (workflow engine)

It also uses Caddy as the edge proxy.

## 1) First Install

### 1.1 Server prerequisites

Install Docker + Docker Compose plugin (Ubuntu/Debian example):

```bash
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release git

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

Re‑login so Docker group changes apply.

### 1.2 DNS

Point these domains to the server IP:

- `learn-language-api.notarobot.dev`
- `learn-language-app.notarobot.dev`
- `learn-language-n8n.notarobot.dev`
- (optional) `learn-language.notarobot.dev` for redirect

### 1.3 Clone repo

```bash
mkdir -p /opt/ai-speaking-bot
cd /opt/ai-speaking-bot

git clone <YOUR_REPO_URL> .
```

### 1.4 Create env files (do not commit)

```bash
cp deploy/.env.api.example deploy/.env.api
cp deploy/.env.miniapp.example deploy/.env.miniapp
# for n8n
cp deploy/.env.example deploy/.env
cp deploy/.env.prod.example deploy/.env.prod
```

Fill these on the server:

- `deploy/.env.api`: `DATABASE_URL`, `WEBAPP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, `INTERNAL_API_SECRET` (shared secret for n8n -> API internal loader endpoints), `STRIPE_BILLING_PRODUCT_ID` (required for the admin billing price manager and Stripe-to-backend sync), `PLAN_CHANGED_WEBHOOK_URL`, `BROADCAST_MAX_RECIPIENTS` (optional), `BROADCAST_PROCESS_BATCH_SIZE` (optional), `BROADCAST_PER_MESSAGE_DELAY_MS` (optional), `BROADCAST_SEND_CONCURRENCY` (optional), `ONBOARDING_COMPLETE_IDLE_MINUTES` (optional), `ONBOARDING_COMPLETE_SCAN_LIMIT` (optional), `OPENAI_API_KEY` (optional but recommended for D3/D7 LLM-generated win-back reminders), `REMINDER_LLM_MODEL` (optional, defaults to `gpt-5-mini`), `AUTOMATED_MESSAGE_TEST_CHAT_IDS` (optional comma-separated Telegram chat IDs to limit onboarding and win-back automated sends plus admin reminder tests during testing; falls back to legacy `SCHEDULED_TASKS_TEST_CHAT_IDS` if unset), `JOB_RETRY_MAX_ATTEMPTS` (optional), `WEBHOOKS_APPEND_BOT_KEY` (optional fallback if plan-changed webhook URL has no `{bot_key}`), `ADMIN_DASHBOARD_PASSWORD` (for internal `/admin/*`), `STRIPE_PORTAL_CONFIG_ID` (optional), `WEBAPP_RETURN_URL` (optional, e.g. `https://t.me/<bot_username>/menu`; used for Stripe Checkout and Billing Portal return redirects), `SENTRY_DSN` (optional; enables Sentry for API + worker), `SENTRY_ENVIRONMENT` (optional), `SENTRY_RELEASE` (optional deploy/build identifier), `SENTRY_TRACES_SAMPLE_RATE` (optional float, defaults to `0.1`), `SENTRY_PROFILE_SESSION_SAMPLE_RATE` (optional float, defaults to `0`)
- `deploy/.env.miniapp`: `VITE_API_BASE=https://learn-language-api.notarobot.dev`, `VITE_ADMIN_PATH` (secret admin path), `VITE_STRIPE_EMBEDDED_CHECKOUT` (set `true` to use embedded Stripe Checkout), `VITE_STRIPE_PUBLISHABLE_KEY` (required when embedded checkout is enabled), `VITE_SCHOOL_URL` (optional, defaults to `https://ai-language-school.online/`; used for teacher thumbnails), `VITE_DEBUG_UI` (optional, set `true` to always show debug panel and logs in mini-app screens)
- `deploy/.env`: n8n secrets (`N8N_*`, `WEBHOOK_URL`, DB creds if used). Set `N8N_HOST`, `N8N_EDITOR_BASE_URL`, and `WEBHOOK_URL` to `https://learn-language-n8n.notarobot.dev`.
- `deploy/.env.prod`: n8n workflow render values for prod. Set `N8N_CRED_OPENAI_ID`, `N8N_CRED_POSTGRES_ID`, `LOADER_API_BASE_URL` (for example `http://api:3000`), and `INTERNAL_API_SECRET`. `N8N_CRED_TELEGRAM_ID` is legacy single-bot mode only.

**Bot configuration (required)**: Create `deploy/bots/*.json` files for each bot with `telegram_bot_token` and `telegram_credential_id` (see `deploy/bots/README.md`). At least one bot config is required. These files are mounted as a read-only volume into the API container.

### 1.5 Run migrations + deploy app

```bash
./deploy/deploy.sh
```

This runs dbmate migrations, builds API/miniapp images, and starts API + worker + miniapp + Caddy + n8n.

### 1.6 Start n8n and import workflows

```bash
cd /opt/ai-speaking-bot/deploy

# render workflows with prod credential IDs
set -a
source .env.prod
set +a
python3 ../scripts/render-n8n-workflows.py --input ./workflows --output ./workflows/.rendered

docker compose -f docker-compose.yml up -d --force-recreate
# re-import workflows from deploy/workflows/.rendered
# (this overwrites existing workflows with same IDs)
docker compose -f docker-compose.yml run -T --rm --no-deps n8n-import

# publish imported workflows without restarting n8n
COMPOSE_FILE=docker-compose.yml PROJECT=languagebot WORKFLOWS_DIR=workflows/.rendered \
  STOP_N8N_BEFORE=false RESTART_N8N_AFTER=false bash ../scripts/activate-n8n-workflows.sh
```

Note: n8n data is stored in `deploy/n8n-data` (bind‑mount). Ensure this directory exists and is persisted across deploys.

### 1.7 Verify

```bash
curl -s https://learn-language-api.notarobot.dev/healthz
# open https://learn-language-app.notarobot.dev/
# open https://learn-language-n8n.notarobot.dev/
```

### 1.8 Internal admin dashboard (optional)

1) Set:

- `deploy/.env.api`: `ADMIN_DASHBOARD_PASSWORD=...`
- `deploy/.env.miniapp`: `VITE_ADMIN_PATH=/_some_secret_path` (must start with `/`, no trailing slash)

2) Deploy (rebuilds mini-app):

```bash
./deploy/deploy.sh
```

3) Open the dashboard URL and enter the password:

```bash
https://learn-language-app.notarobot.dev/_some_secret_path
```

## 2) Update / Deploy

### One-time migration note (after unifying compose)

If you previously deployed with separate compose projects (`languagebot-app` and `languagebot-n8n`), stop them once to avoid duplicate containers and port conflicts:

```bash
learn-language-n8n
docker compose -p languagebot-app -f docker-compose.yml down
docker compose -p languagebot-n8n -f docker-compose.yml down
```

### 2.1 Pull latest code

```bash
cd /opt/ai-speaking-bot

git fetch origin
git checkout main
git reset --hard origin/main
```

### 2.2 Run migrations + restart API/miniapp/Caddy

```bash
./deploy/deploy.sh
```

### 2.2.1 Activate Pro annual price after deploy

The migration seeds `pro/EUR/year` with `active=false` and a placeholder Stripe price ID.
After creating the real yearly Stripe price, activate it in Postgres:

```sql
UPDATE public.plan_prices
SET stripe_price_id = '<REAL_YEARLY_PRICE_ID>',
    active = true,
    updated_at = NOW()
WHERE tier = 'pro'
  AND currency = 'EUR'
  AND billing_interval = 'year';
```

### 2.3 Re-import and publish n8n workflows live (if workflow JSON changed)

```bash
cd /opt/ai-speaking-bot/deploy

# render workflows with prod credential IDs
set -a
source .env.prod
set +a
python3 ../scripts/render-n8n-workflows.py --input ./workflows --output ./workflows/.rendered

docker compose -f docker-compose.yml up -d --force-recreate
# re-import workflows from deploy/workflows/.rendered
# (this overwrites existing workflows with same IDs)
docker compose -f docker-compose.yml run -T --rm --no-deps n8n-import

# publish imported workflows without restarting n8n
COMPOSE_FILE=docker-compose.yml PROJECT=languagebot WORKFLOWS_DIR=workflows/.rendered \
  STOP_N8N_BEFORE=false RESTART_N8N_AFTER=false bash ../scripts/activate-n8n-workflows.sh
```

## 3) Optional: Remote deploy from local machine

Use `scripts/deploy-remote.sh` to SSH into the server, hard-reset the repo to the target remote branch while preserving server env files, then run migrations, live n8n workflow import/publish, and health checks.
Note: SSH access requires VPN to be connected.

```bash
./scripts/deploy-remote.sh
```

Add `--restart-all` when you explicitly want a full container restart and restart-based n8n workflow activation:

```bash
./scripts/deploy-remote.sh --restart-all
```

Override defaults if needed:

```bash
DEPLOY_HOST=languagebot \
DEPLOY_DIR=/opt/ai-speaking-bot \
DEPLOY_BRANCH=main \
./scripts/deploy-remote.sh
```

## 3.1) Pull PROD workflow edits back to repo

If you made changes in the n8n UI on PROD (especially `Set Locale`), you can export workflows and sync `deploy/bots/*.json` from them:

```bash
./scripts/pull-prod-n8n-workflows.sh
```

## 4) n8n UI access

Public URL (recommended):

```bash
https://learn-language-n8n.notarobot.dev/
```

SSH access requires VPN. Use this tunnel to reach n8n locally:

```bash
ssh -L 5678:127.0.0.1:5678 languagebot -N
```

## 5) Docker Compose Commands

The project uses Docker Compose with project name `languagebot`. This is defined in `docker-compose.yml` with `name: languagebot`.

**Note:** If you're on an older deployment without the `name:` field, you may need to specify the project name with `-p languagebot` in all commands below.

### View running services

```bash
cd /opt/ai-speaking-bot/deploy
docker compose ps
```

### View logs

```bash
# API logs (last 100 lines)
docker compose logs --tail=100 api

# n8n logs (last 100 lines)
docker compose logs --tail=100 n8n

# Follow logs in real-time
docker compose logs -f api

# Search for specific errors
docker compose logs api | grep -i error
```

### Restart services

```bash
# Restart API only
docker compose restart api

# Restart all services
docker compose restart
```

### Execute commands in containers

```bash
# Check environment variables
docker compose exec api env | grep DATABASE_URL

# Get a shell
docker compose exec api sh
```

### Alternative: Use docker commands directly

If you prefer not to use the `-p` flag, you can use `docker` commands directly with container names:

```bash
# View logs
docker logs --tail=100 languagebot-api-1
docker logs -f languagebot-api-1

# Execute commands
docker exec languagebot-api-1 env
docker exec -it languagebot-api-1 sh
```

### Optional: Create an alias for convenience

For shorter commands, add this to your `~/.bashrc` or `~/.zshrc`:

```bash
alias dc='docker compose'
```

Then you can use: `dc ps`, `dc logs api`, `dc restart api`, etc.

**Legacy note:** On older deployments without `name: languagebot` in docker-compose.yml, use:
```bash
alias dc='docker compose -p languagebot'
```
