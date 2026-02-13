**Goal**
Replace Telegram Stars with Stripe subscriptions inside a Telegram Mini App, with a Vue frontend and a self-hosted Node.js API. Keep n8n as the bot brain and drive entitlements from Postgres.

**Decisions**
- Stripe-only inside Telegram, hosted Stripe Checkout.
- API domain: learn-language-api.notarobot.dev
- Mini-app domain: learn-language-app.notarobot.dev
- Migrations via dbmate.

**Architecture**
- Telegram bot logic stays in n8n.
- Mini-app is a Vue SPA that authenticates via Telegram WebApp initData.
- Node API validates initData, creates Stripe Checkout Sessions, and receives Stripe webhooks.
- Postgres is the source of truth for plans and entitlements.

**Data Model Changes**
- Remove all Telegram Stars fields.
- Add Stripe identifiers on users and payments.
- Add plan_prices table for multi-currency pricing and Stripe price IDs.

**Migration Strategy**
- Use dbmate with SQL migrations in `db/migrations`.
- Provide a forward-only migration that drops Stars columns and creates Stripe tables/columns.
- Production migration is a single `ALTER` batch and safe to run once.

**Stripe Model**
- Subscriptions for Pro with monthly and annual billing intervals (annual launch: EUR).
- Auto-renew on by default, user can cancel at period end.
- Webhook-driven entitlements based on `customer.subscription.*` and `invoice.*` events.

**API Endpoints**
- `POST /auth/telegram` validate initData, upsert user, issue short-lived JWT.
- `GET /plans` return plan limits and pricing for current currency (optionally all billing intervals).
- `POST /billing/checkout` create hosted Stripe Checkout Session (monthly/annual).
- `POST /billing/cancel` set cancel_at_period_end=true.
- `POST /billing/resume` set cancel_at_period_end=false.
- `POST /stripe/webhook` validate Stripe signature and update entitlements.

**Mini-App UX**
- Plan cards with limits and price.
- Current plan status and renewal state.
- Subscribe, Cancel, Resume actions.
- Open Stripe Checkout via Telegram WebApp openLink.

**n8n Updates**
- Remove Stars invoice, pre-checkout, payload parsing, and successful_payment nodes.
- Replace `/plans` and `/buy` flows with a mini-app link.
- Read entitlements from users table and plan_prices instead of Stars.

**Deploy**
- Docker services: api, miniapp, caddy.
- Caddy routes API and miniapp on their subdomains.
- Deploy script builds images, runs migrations, then restarts containers.

**Rollout**
- Apply DB migration.
- Deploy API + miniapp.
- Update n8n workflow to stop Stars usage and link to miniapp.
- Verify Stripe webhooks and entitlement updates before opening to users.
