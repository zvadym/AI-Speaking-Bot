# Landing (Vercel)

Static marketing site for `ai-language-school.online`.

Teacher pages are generated from `deploy/bots/*.json` at build time (secrets are not included in the public bundle).

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

### Deploy (CLI)

From repo root:

```bash
./scripts/vercel-deploy-landing.sh prod
```

No env vars are required for the landing site. Teacher links come from `deploy/bots/*.json`.
