# Practice Quota Enforcement Implementation Plan

## Objective

Restore global plan enforcement for text and voice practice without changing
plan amounts, billing state, or non-practice routes.

## Deploy-Safe Steps

### Step 1: Centralize entitlement calculation

- Add `apps/api/src/bot-runtime/entitlement-context.ts` as the implementation
  of effective tier, plan period, global usage, remaining quota, and validation.
- Keep `stats-context.ts` as a compatibility re-export so existing `/stats`
  behavior remains unchanged.
- Add unit coverage for free, monthly, expired, override, cross-bot, and invalid
  configuration cases.
- Verification: API test subset, typecheck, and build.

### Step 2: Add the durable practice guard

- Add `apps/api/src/bot-runtime/practice-quota.ts`.
- Record `paywall_shown` through a versioned durable effect.
- Deliver the localized paywall and subscription button through the existing
  durable delivery repository.
- Make context/effect/delivery dependencies injectable for focused tests.
- Verification: guard tests for allowed, blocked, duplicate, URL, and failure
  behavior.

### Step 3: Integrate text and voice handlers

- Run the guard before typing actions, Telegram file work, or OpenAI calls.
- Remove the voice handler's bot-scoped quota SQL.
- Pass `webappUrl` into both handler factories from worker registration.
- Reload entitlement before TTS; skip TTS and return the durable paywall when
  inbound usage consumes the final remainder.
- Bump handler versions for `message.text` and `message.voice` so queued jobs
  cannot silently execute against mismatched behavior.
- Verification: handler regression tests prove blocked updates never reach AI.

### Step 4: Full local verification

- Run API tests, typecheck, and build.
- Run Mini App and landing production builds.
- Validate all bot configs and Docker Compose.
- Review diff for unrelated generated artifacts and secret exposure.

### Step 5: Commit, deploy, and production smoke

- Commit and push the implementation.
- Deploy API and worker with a full application recreate.
- Verify health, route flags, worker startup, and all 15 Telegram webhooks.
- Create isolated over-limit synthetic users and submit signed text and voice
  updates with impossible Telegram chat/file IDs.
- Confirm paywall routing occurs before AI/file processing, no conversation
  messages are stored, and synthetic rows are removed.
- Monitor production aggregates and logs for unexpected failures.

## Rollback

Deploy the previous application commit. This change has no migration and does
not alter existing billing or usage data.
