# End-to-End smoke tests

Run the local end-to-end smoke suite:

```bash
./scripts/e2e.sh
```

What this does:

1. Installs API dependencies.
2. Starts Postgres and n8n with Docker Compose (`e2e/docker-compose.yml`).
3. Applies all DB migrations using dbmate.
4. Renders and imports n8n workflows.
5. Starts API on `http://127.0.0.1:3001` with test env vars.
6. Runs `e2e/smoke.e2e.mjs`, which verifies:
   - API health endpoint.
   - Telegram auth flow with signed `initData`.
   - Authorized `/me` and `/plans` endpoints.
   - Stripe webhook signature verification and subscription state transition (`free -> pro`).

The script always tears down the e2e containers and volumes after completion.
