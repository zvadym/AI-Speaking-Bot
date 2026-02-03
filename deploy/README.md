# n8n Deploy (Linode + Caddy)

1) Copy files to server (example):

```bash
scp -r deploy/* root@YOUR_SERVER:/opt/n8n/
```

2) Edit `/opt/n8n/.env` and fill secrets.

3) Start n8n:

```bash
cd /opt/n8n
docker compose up -d
```

4) Configure Caddy:

```bash
sudo cp /opt/n8n/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

5) Open https://learn-language.notarobot.dev and import `n8n.json`.

Notes:
- Ensure DNS A record for `learn-language.notarobot.dev` points to your Linode.
- Telegram webhooks use `WEBHOOK_URL`.
- If Postgres requires IP allow-listing, allow your Linode's IP.
