# Landing (Vercel)

Nuxt 3 marketing site for `ai-language-school.online`, deployed to Vercel with Nitro server routes and prerendered marketing pages.

Teacher pages are generated from `deploy/bots/*.json` at build time (secrets are not included in the public bundle).
Teacher thumbnails are generated into `apps/landing/public/teachers/thumbnail/*.png` from source images in `apps/landing/public/teachers/*`.

## Env vars

Optional:

- `NUXT_PUBLIC_SITE_URL` — canonical site origin for SEO links and sitemap URLs (defaults to `https://ai-language-school.online`).
- `LANDING_DISCORD_WEBHOOK_URL` — private Discord incoming webhook URL used by `POST /api/contact` to deliver landing contact-form messages directly to Discord.
- `PRICING_API_BASE` — private API base URL used only at build-time to generate `src/generated/pricing.js` with all currencies and locale mappings. This is the preferred way to keep the API URL out of the public bundle.
- `PRICING_CURRENCY` — optional default fallback currency for locales without explicit currency config (defaults to `EUR`).

Temporary backwards-compatible fallbacks are supported:

- `API_BASE_URL`
- `VITE_API_BASE`
- `VITE_SITE_URL`

## Local dev

```bash
cd apps/landing
npm install
npm run dev
```

To regenerate teacher thumbnails manually:

```bash
cd apps/landing
npm run prepare:thumbnails
```

## Build / prerender

```bash
cd apps/landing
npm run build
```

This produces a Nitro build for Vercel while still prerendering the configured marketing routes during the build.

## Nitro API

- `GET /api/health` is served by Nitro and returns a small health payload for landing-local backend smoke checks.
- `POST /api/contact` validates landing contact-form submissions and forwards them to Discord via `LANDING_DISCORD_WEBHOOK_URL`.
- The frontend can consume it via the landing helper in `src/composables/useLandingHealth.js`.

## Vercel

- Framework preset: **Nuxt.js**
- Root directory: `apps/landing`
- Build command: `npm run build`
- Output directory: leave unset so Vercel uses the Nuxt/Nitro output automatically
- Recommended pricing env: set `PRICING_API_BASE` in Vercel project settings. The landing no longer fetches pricing from the browser at runtime.
- Nitro server routes and prerendered pages are deployed together as one full-stack Nuxt app.

### Deploy (CLI)

From repo root:

```bash
./scripts/vercel-deploy-landing.sh prod
```

No env vars are required for a basic deploy. Teacher links come from `deploy/bots/*.json`.

Set `NUXT_PUBLIC_SITE_URL` to the canonical production host. Current canonical target is non-`www`: `https://ai-language-school.online`.
