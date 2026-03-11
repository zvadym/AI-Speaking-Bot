# Landing (Vercel)

Static marketing site for `ai-language-school.online`, built with Nuxt 3 SSR + prerendered output.

Teacher pages are generated from `deploy/bots/*.json` at build time (secrets are not included in the public bundle).
Teacher thumbnails are generated into `apps/landing/public/teachers/thumbnail/*.png` from source images in `apps/landing/public/teachers/*`.

## Env vars

Optional:

- `NUXT_PUBLIC_SITE_URL` — canonical site origin for SEO links and sitemap URLs (defaults to `https://ai-language-school.online`).
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

This generates static, prerendered HTML under `.output/public`.

## Vercel

- Framework preset: **Nuxt.js**
- Root directory: `apps/landing`
- Build command: `npm run build`
- Output directory: `.output/public`
- Recommended pricing env: set `PRICING_API_BASE` in Vercel project settings. The landing no longer fetches pricing from the browser at runtime.

### Deploy (CLI)

From repo root:

```bash
./scripts/vercel-deploy-landing.sh prod
```

No env vars are required for a basic deploy. Teacher links come from `deploy/bots/*.json`.

Set `NUXT_PUBLIC_SITE_URL` to the canonical production host. Current canonical target is non-`www`: `https://ai-language-school.online`.
