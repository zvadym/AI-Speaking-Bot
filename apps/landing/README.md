# Landing (Vercel)

Static marketing site for `ai-language-school.online`.

## Local dev

```bash
cd apps/landing
npm install
npm run dev
```

## Vercel

- Framework preset: **Vite**
- Root directory: `apps/landing`
- Build command: `npm run build`
- Output directory: `dist`

### Env vars

- `VITE_TELEGRAM_BOT_URL` (recommended): Telegram bot link used by the primary CTA (example: `https://t.me/<bot_username>`).

Copy `apps/landing/.env.example` to `apps/landing/.env` for local dev.
