# Practice Quota Enforcement Design

## Status

Approved for implementation.

## Context

The TypeScript cutover introduced a quota-enforcement regression:

- `message.text` does not check the user's plan or practice quota.
- `message.voice` checks usage only for the current `bot_key`.
- The legacy workflow and `/stats` calculate practice usage globally by
  `chat_id`, across every bot.
- Production data confirms the regression: after direct webhook cutover, two
  over-limit users sent 33 practice messages and received 31 assistant
  messages.

The product rule remains unchanged: a user's plan is global. When the plan's
practice quota is exhausted, regular text and voice practice must be blocked in
every bot. Commands, subscription management, onboarding, feedback, and other
non-practice routes remain available.

## Goals

1. Make effective-plan and usage calculation a single source of truth.
2. Enforce the same quota before text and voice AI work starts.
3. Preserve localized paywall behavior and subscription entry attribution.
4. Prevent duplicate paywall effects or Telegram deliveries during retries.
5. Keep `/stats` and runtime enforcement consistent by construction.
6. Detect invalid entitlement configuration instead of silently granting
   unlimited practice.

## Non-Goals

- Changing plan prices, quota amounts, or quota periods.
- Making text messages consume voice seconds.
- Blocking commands, feedback, callbacks, or Mini App access.
- Changing the existing rule that an accepted voice message may use the final
  positive remainder and cross the limit during that message.
- Sending unsolicited messages to existing users during verification.

## Entitlement Context

Introduce an API-owned entitlement context as the only implementation of:

- effective tier selection;
- plan expiry and temporary override handling;
- plan quota and period lookup;
- global usage aggregation by `chat_id`;
- remaining quota and `limitReached` calculation.

The context returns:

```ts
interface EntitlementContext {
  tier: string;
  planExpiresOn: string | null;
  planAutorenew: boolean;
  pendingPlanTier: string | null;
  pendingPlanEffectiveOn: string | null;
  limitPeriod: 'lifetime' | 'month';
  limitSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  limitReached: boolean;
}
```

The SQL must not filter `usage_hourly` by `bot_key`. For monthly plans it sums
usage from the current calendar month; for lifetime plans it sums all usage.
Override tier wins only while `override_expires_at` is in the future. A paid
plan wins only while `plan_expires_at` is in the future; otherwise the effective
tier is `free`.

The existing stats loader becomes a compatibility re-export of this context so
that `/stats` and runtime handlers cannot drift. A missing user, missing plan
row, non-positive limit, or unsupported period is treated as an entitlement
configuration error and reported through the normal worker/Sentry failure path;
it must not become implicit unlimited access.

## Practice Quota Guard

A shared guard runs at the start of both `message.text` and `message.voice`,
before typing actions, file download, transcription, or any OpenAI request.

When quota remains, the guard returns `allowed` and the existing handler
continues unchanged.

When quota is exhausted, the guard:

1. Executes a durable effect keyed by the update decision ID.
2. Inserts `paywall_shown` into `action_events` with source `bot_runtime` and a
   daily `chat_id + bot_key` idempotency key.
3. Sends the localized `msg_limit_reached` text through the durable Telegram
   delivery repository.
4. Includes a localized `btn_open_subscription` web-app button pointing to
   `/subscription?bot-key=<bot-key>&entry=limit_reached`.
5. Returns the delivery outcome without invoking the conversation handler.

The effect and delivery use stable versioned step keys. Worker retries therefore
reuse the database result and never duplicate the action event or Telegram
message.

## Voice Reply Boundary

The entry guard restores the legacy hard block for users already at the limit.
After a permitted voice input is processed and its inbound seconds are recorded,
the handler reloads the entitlement context before generating TTS.

If the inbound message consumed the remaining quota, no additional TTS request
or outbound usage is created. The already-generated text correction/reply is
delivered as text, followed by the same durable subscription paywall. This
prevents extra paid TTS work while preserving the useful response for the voice
message that was accepted with positive quota.

## Error Handling

- Database and entitlement configuration failures are retryable handler errors.
- Telegram 4xx delivery failures remain permanent through the existing delivery
  classifier.
- Telegram timeouts remain unknown/non-retryable to avoid duplicate messages.
- OpenAI is never called for an update rejected by the entry guard.
- Paywall telemetry failure must not bypass the block; the durable effect is
  retried before delivery.

## Testing

Add focused tests for:

- free lifetime quota below and at the limit;
- paid monthly quota with current-month filtering;
- expired paid plan falling back to free;
- active override tier precedence;
- global usage aggregated across multiple bot keys;
- text handler blocks before chat action and AI;
- voice handler blocks before download, STT, and AI;
- allowed text and voice paths remain unchanged;
- TTS is skipped when inbound voice consumes the final remainder;
- paywall action and delivery are idempotent across worker retries;
- localized message and subscription button URL;
- missing or invalid plan configuration fails closed.

The full API test suite, typecheck, build, Mini App build, bot config validation,
and Compose validation run before deployment.

## Deployment And Verification

Deploy as one application-only change with no schema migration:

1. Build and recreate API and worker containers.
2. Verify API health and all 15 Telegram webhooks.
3. Create an isolated synthetic free user with usage above the limit.
4. Submit signed text and voice updates to direct webhook ingress.
5. Confirm no message rows or OpenAI effects are created and only the paywall
   delivery is attempted.
6. Remove all synthetic rows and confirm worker logs have no unexpected errors.
7. Re-run an aggregate production query to ensure no new assistant messages are
   produced for effective-free users already at their limit.

Rollback is the previous application commit. No database rollback is required.
