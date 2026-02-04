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

- `deploy/.env.api`: `DATABASE_URL`, `WEBAPP_URL`, `TELEGRAM_BOT_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, `PLAN_CHANGED_WEBHOOK_URL`
- `deploy/.env.miniapp`: `VITE_API_BASE=https://learn-language-api.notarobot.dev`
- `deploy/.env`: n8n secrets (`N8N_*`, `WEBHOOK_URL`, DB creds if used). Set `N8N_HOST`, `N8N_EDITOR_BASE_URL`, and `WEBHOOK_URL` to `https://learn-language-n8n.notarobot.dev`.
- `deploy/.env.prod`: n8n workflow credential IDs used to render workflows for prod (`N8N_CRED_TELEGRAM_ID`, `N8N_CRED_OPENAI_ID`, `N8N_CRED_POSTGRES_ID`)

### 1.5 Run migrations + deploy app

```bash
./deploy/deploy.sh
```

This runs dbmate migrations, builds API/miniapp images, and starts API + miniapp + Caddy + n8n.

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

# activate imported workflows
COMPOSE_FILE=docker-compose.yml PROJECT=languagebot WORKFLOWS_DIR=workflows/.rendered \
  bash ../scripts/activate-n8n-workflows.sh
```

Note: n8n data is stored in `deploy/n8n-data` (bind‑mount). Ensure this directory exists and is persisted across deploys.

### 1.7 Verify

```bash
curl -s https://learn-language-api.notarobot.dev/healthz
# open https://learn-language-app.notarobot.dev/
# open https://learn-language-n8n.notarobot.dev/
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

git pull --ff-only
```

### 2.2 Run migrations + restart API/miniapp/Caddy

```bash
./deploy/deploy.sh
```

### 2.3 Restart n8n and re-import workflows (if workflow JSON changed)

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

# activate imported workflows
COMPOSE_FILE=docker-compose.yml PROJECT=languagebot WORKFLOWS_DIR=workflows/.rendered \
  bash ../scripts/activate-n8n-workflows.sh
```

## 3) Optional: Remote deploy from local machine

Use `scripts/deploy-remote.sh` to SSH into the server, run `git pull`, migrations, restarts, and health checks.
Note: SSH access requires VPN to be connected.

```bash
./scripts/deploy-remote.sh
```

Override defaults if needed:

```bash
DEPLOY_HOST=languagebot \
DEPLOY_DIR=/opt/ai-speaking-bot \
DEPLOY_BRANCH=main \
./scripts/deploy-remote.sh
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
