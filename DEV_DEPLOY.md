# Dev environment – run and update

Essential steps to run and update the project locally. Env files and secrets are not committed; create them from examples below.

---

## 1. Env files

| File | Purpose | Create from |
|------|---------|-------------|
| `deploy/.env.api` | API: DB, Telegram, Stripe, JWT | `deploy/.env.api.example` |
| `deploy/.env.miniapp` | Miniapp: API URL, Stripe, PostHog | `deploy/.env.miniapp.example` |
| `deploy/.env.dev` | n8n dev: URL, credential IDs | See below |

**Miniapp → local API:** in `deploy/.env.miniapp` set:
```bash
VITE_API_BASE=http://localhost:3000
```

**n8n dev** – create `deploy/.env.dev` (or copy from existing). Minimum:
```bash
N8N_ENV_FILE=.env.dev
N8N_HOST=localhost
N8N_PROTOCOL=http
N8N_PORT=5678
N8N_EDITOR_BASE_URL=http://localhost:5678
WEBHOOK_URL=http://localhost:5678

N8N_CRED_OPENAI_ID=<from n8n UI>
N8N_CRED_POSTGRES_ID=<from n8n UI>
```

---

## 2. Database

- Postgres must be running and reachable at `DATABASE_URL` from `deploy/.env.api`.

**Apply migrations:**
```bash
./scripts/dev-migrate.sh
# or: ./scripts/dev-migrate.sh up
```

`./scripts/dev-migrate.sh up` now also refreshes `db/schema.sql`.

**Other:** `./scripts/dev-migrate.sh status` | `down` | `new <name>` | `schema-update` | `schema-check` | `help`

---

## 3. Run services

**n8n (Docker):**
```bash
cd deploy
N8N_ENV_FILE=.env.dev docker compose up -d n8n
# Or your usual way to start n8n; ensure it’s on http://localhost:5678
```

**API:**
```bash
./scripts/dev-api.sh
# Uses deploy/.env.api → http://localhost:3000
```

**Miniapp:**
```bash
./scripts/dev-miniapp.sh
# Uses deploy/.env.miniapp → http://localhost:5173
```

**Optional – landing:**
```bash
./scripts/dev-landing.sh
```

---

## 4. n8n workflows (dev)

Use **dev** bot configs and credentials so production is untouched.

**One-time setup:**

1. In n8n (http://localhost:5678) create credentials: **Telegram** (per bot), **OpenAI**, **Postgres**. Copy each credential ID from the URL when editing (last path segment).
2. **Bot configs:** `deploy/bots-dev/*.json` are gitignored. If missing, copy from prod and set local Telegram cred IDs:
   ```bash
   cp deploy/bots/uk-de.json deploy/bots-dev/uk-de.json
   cp deploy/bots/uk-en.json deploy/bots-dev/uk-en.json
   ```
   Edit each file: set `telegram_credential_id` to your local n8n Telegram credential ID.
3. In `deploy/.env.dev` set `N8N_CRED_OPENAI_ID` and `N8N_CRED_POSTGRES_ID`.

**Render, import, activate (after changing workflows or bot configs):**
```bash
./scripts/dev-n8n-full.sh
```

Step by step:
```bash
./scripts/dev-n8n-render.sh    # render from deploy/bots-dev + .env.dev
./scripts/dev-n8n-import.sh   # import into local n8n container
./scripts/dev-n8n-activate.sh # activate workflows
```

If n8n runs in Docker Compose with another container name:
```bash
N8N_CONTAINER=<your-n8n-container-name> ./scripts/dev-n8n-full.sh
```

Details: `deploy/bots-dev/README.md`.

---

## 5. Quick reference

| Task | Command |
|------|--------|
| Migrations up | `./scripts/dev-migrate.sh` |
| Migrations status | `./scripts/dev-migrate.sh status` |
| Refresh schema snapshot | `./scripts/dev-migrate.sh schema-update` |
| Verify schema snapshot | `./scripts/dev-migrate.sh schema-check` |
| API | `./scripts/dev-api.sh` |
| Miniapp | `./scripts/dev-miniapp.sh` |
| n8n workflows (render + import + activate) | `./scripts/dev-n8n-full.sh` |
| API health | `curl http://localhost:3000/healthz` |
| n8n UI | http://localhost:5678 |

---

## 6. Troubleshooting

- **Miniapp calls wrong API** – Set `VITE_API_BASE=http://localhost:3000` in `deploy/.env.miniapp` and restart miniapp.
- **“Missing required credential env vars”** – Set `N8N_CRED_OPENAI_ID` and `N8N_CRED_POSTGRES_ID` in `deploy/.env.dev`.
- **“Invalid bot config (missing telegram_credential_id)”** – Edit `deploy/bots-dev/*.json` and set `telegram_credential_id` to the ID from the n8n credentials page.
- **Import/activate fails** – Check n8n container is running; use `N8N_CONTAINER=...` if the container name is not `n8n`.
- **Migrations** – `./scripts/dev-migrate.sh` reads `DATABASE_URL` from `deploy/.env.api`; ensure that file exists and is correct.
- **Schema check fails** – Run `./scripts/dev-migrate.sh schema-update` and commit `db/schema.sql`.
