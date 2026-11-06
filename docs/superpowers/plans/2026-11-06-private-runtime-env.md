# Private Runtime Environment Implementation Plan

> **For agentic workers:** Execute inline in this session. The user explicitly approved the design and instructed implementation; no extra execution-choice gate is needed.

**Goal:** Remove runtime secrets from tracked bot configuration without changing bot identities or credentials.

**Architecture:** Public bot metadata stays in JSON; credentials come from external env files. SSH deployment preflights the complete token set and uses host-side private configuration. A migration utility preserves existing values and creates a private rollback backup.

**Tech Stack:** Node ESM / dotenv, Python standard library, Bash, Docker Compose.

## Global Constraints

- Keep SSH deployment. No production deployment under scripts/AGENTS.md.
- Do not rewrite history or rotate credentials in this phase.
- Do not alter unrelated docs/research work or applied database migrations.
- Secret values must never be printed, committed or added to generated assets.

## Task 1: Runtime and test configuration

- [x] Add explicit external-env loading with absolute/outside-checkout path validation.
- [x] Add `botTokenEnvName(botKey)` and environment-only `extractBotTokens()`; preserve metadata-only `loadBotConfigs()` and support BOTS_DIR for fixtures/CLI.
- [x] Add fixture-only test bootstrap and tests for missing/malformed tokens, rejection of inline credentials, env precedence and path restrictions.
- [x] Run API tests/typecheck/build.

## Task 2: Private migration and admin tools

- [x] Add Python dotenv helpers with non-executing parsing and safe shell export generation.
- [x] Add migration CLI with dry-run, private backup, conflict refusal, token parity checks and optional removal of old files/token fields.
- [x] Update provisioning, webhook and OGG tools to read external tokens; preflight every target before mutation.
- [x] Verify using temporary synthetic repositories, including idempotency/conflict/permissions and secret-free persisted configs.

## Task 3: Development and SSH deployment

- [x] Update Compose, local launchers (including worker), migration wrappers and bootstrap to external env paths.
- [x] Update SSH deploy to preflight before checkout/reset and before migrations/container changes; leave actual production untouched.
- [x] Add source-only Docker context exclusions and broad env ignore rules with example exceptions.
- [x] Validate shell syntax and mocked deployment paths without network/production writes.

## Task 4: Local migration, documentation and release checks

- [x] Execute local migration only after migration tests; compare all original environment values and 15 tokens to external configuration before deleting local originals.
- [x] Update env examples, AGENTS, bot/deploy/local docs, skill invocation and CI fixture bootstrap.
- [x] Build API/Mini App/landing using safe fixtures; validate generated output contains no tokens.
- [x] Scan current tracked files, inspect only redacted diffs and record checks and production migration/rollback instructions.


## Verification results — 2026-11-06

- Local migration completed: 15 original token values and all original api/miniapp env values preserved; originals backed up privately outside Git. Public bot metadata is unchanged apart from removing token fields.
- API: 198 tests passed; one existing opt-in PostgreSQL integration test skipped because BOT_RUNTIME_TEST_DATABASE_URL was not configured. Typecheck and build passed on Node 22.22.2.
- Python: 8 tests passed, including real SSH-wrapper execution with mocked SSH/Git/Docker and missing-target-token rejection before checkout/reset/migrations.
- All 15 bot configs passed provisioning sync and apply dry-run; no Telegram requests made.
- Mini App and landing production builds passed in a temporary source export. Landing used existing public pricing data (PRICING_ALLOW_STALE=true), not production API credentials. No generated outputs changed in the checkout.
- Docker Compose parsed the actual external files with exact API/worker env parity; no backend secrets were injected into Mini App.
- Current-source Gitleaks scan found only two reviewed non-secret matches: the queue schedule key and public Ahrefs analytics identifier. Exact private-value scan found no current-source matches.
- Shell syntax and git diff whitespace checks passed. Production, credential rotation and GitHub settings were not changed; Git history was not rewritten. Follow deploy/PRIVATE_ENV_MIGRATION.md for the separately authorized production rollout and rollback preparation.
