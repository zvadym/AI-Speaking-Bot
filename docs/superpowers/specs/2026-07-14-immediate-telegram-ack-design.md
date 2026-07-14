# Immediate Telegram Acknowledgement

Date: 2026-07-14
Status: Approved

## Context

The typed bot runtime already shows a localized durable progress message while
generating text and voice conversation replies. That message starts in the
worker's `conversation.generate` stage, after webhook validation, user
bootstrap, route preparation, pg-boss enqueueing and polling, durable execution
claiming, and the practice-quota check.

Production measurements confirm that this ordering creates a visible silent
period:

- PostgreSQL round trips are about 123 ms p50;
- route-preparation reads are 128 ms p50 and 1,036 ms p95;
- text queue delay is 432 ms p50 and 1,891 ms p95;
- recent voice samples spent about 1.5 seconds in the worker before creating
  the durable progress message;
- one correlated production sample took about 4.2 seconds from the completed
  user bootstrap to the progress message;
- Telegram API connectivity itself is fast at 28 ms p50 and 94 ms p95.

The current `sendChatAction("typing")` call does not address the gap because it
runs inside the generation operation, after the progress middleware has already
started its durable message.

## Goal

Show Telegram's native `typing...` status as close as possible to webhook
receipt, normally within 100-300 ms, without weakening durable ingestion,
changing business behavior, or transferring progress-message ownership from
the worker to the API.

## Non-goals

- Reducing model, transcription, or TTS latency.
- Changing the existing rotating progress-message lifecycle.
- Changing pg-boss queue concurrency or its global `exclusive` policy.
- Introducing a durable acknowledgement record or a database migration.
- Sending an acknowledgement for callback queries, group messages, service
  updates, or messages sent by bots.
- Guaranteeing the ephemeral status when Telegram is unavailable.

## Design

### Responsibility Boundary

A small `ImmediateTelegramAck` component owns only the early ephemeral Telegram
chat action. It does not read or write Postgres, enqueue jobs, inspect plans, or
participate in durable execution state.

The webhook route keeps ownership of validation and orchestration. The worker
keeps ownership of the localized `waiting_text`, loader rotation, timeout
cleanup, and final response delivery.

### Request Flow

For a valid webhook request, the API performs these steps:

1. Normalize the bot key and verify the per-bot webhook secret.
2. Normalize the Telegram update.
3. Determine immediate-ack eligibility using only normalized update data and
   the configured bot-key rollout set.
4. For an eligible update, start a best-effort `sendChatAction` request with
   `action: "typing"` and a 500 ms hard timeout.
5. Continue user bootstrap, route preparation, and durable pg-boss ingestion
   without waiting for the acknowledgement request.
6. Return the existing webhook response based only on durable ingestion.
7. Let the worker create and clean up the existing localized progress message
   exactly as it does today.

The acknowledgement promise handles its own success, timeout, and failure. It
must never become an unhandled rejection and must never change the webhook HTTP
status or the accepted update contract.

### Eligibility

An update is eligible when all conditions are true:

- its bot key is enabled by `BOT_IMMEDIATE_ACK_ENABLED_BOT_KEYS`;
- it is a private Telegram `message` update;
- the sender is a user, not a bot;
- it contains non-empty text or a voice attachment.

Commands are eligible because command handlers can also take multiple seconds.
Callback queries are not eligible because Telegram already presents a native
button spinner. Invalid webhook signatures are rejected before any Telegram
API request is attempted.

The action is always `typing`, including voice input. The API does not yet know
the user's reply mode, and `typing` truthfully communicates that the bot is
preparing a response without implying that the response will be audio.

### Failure Semantics

The acknowledgement is explicitly best-effort:

- success has no durable side effect;
- timeout aborts the Telegram request after 500 ms;
- network, Telegram, and abort errors are normalized and logged;
- acknowledgement failure does not delay or fail bootstrap and ingestion;
- duplicate webhook delivery may repeat `sendChatAction`, which is harmless
  because Telegram chat actions are ephemeral and do not create messages.

The existing worker progress message remains the durable fallback when
processing continues. If durable ingestion fails after a successful chat
action, the action expires naturally and no cleanup is required.

### Configuration

`BOT_IMMEDIATE_ACK_ENABLED_BOT_KEYS` uses the same activation semantics as the
existing progress rollout configuration:

- empty: disabled for every bot;
- comma-separated bot keys: enabled only for those bots;
- `*`: enabled for all configured bots;
- unknown bot keys: fail configuration validation at startup.

The setting is optional and defaults to empty so deployment and activation are
separate rollback points.

### Observability

Each attempted acknowledgement emits a privacy-safe structured event with:

- bot key;
- update type classification;
- outcome: `succeeded`, `timed_out`, or `failed`;
- milliseconds from webhook handler entry to acknowledgement completion;
- Telegram request duration;
- normalized error code when unsuccessful.

Logs must not contain chat IDs, message text, usernames, bot tokens, or raw
Telegram payloads. Acknowledgement telemetry is operational logging, not a new
database table.

## Testing

Focused unit and router tests must prove:

1. Enabled private text and voice messages start `sendChatAction("typing")`.
2. The acknowledgement starts before the first bootstrap database operation.
3. Durable bootstrap and ingestion continue while the acknowledgement is
   unresolved.
4. Telegram rejection and timeout do not change webhook status or enqueueing.
5. Invalid secrets, callbacks, groups, bot senders, service updates, and
   disabled bot keys do not send a chat action.
6. Commands remain eligible.
7. Unknown configured bot keys fail startup validation.
8. Background failures are handled without unhandled promise rejections.

The full API test suite and TypeScript build must pass before deployment.

## Deployment

The change is split into independently reversible steps:

1. Deploy code with `BOT_IMMEDIATE_ACK_ENABLED_BOT_KEYS` empty and verify API,
   worker, mini-app, and all Telegram webhooks.
2. Enable one canary bot, initially `uk-de`, and recreate only the API service.
3. Send representative text, voice, and command updates; confirm the immediate
   native status, the later durable loader, normal replies, and clean logs.
4. Confirm acknowledgement latency from structured production events and check
   that queue, execution, delivery, effect, and loader state remain healthy.
5. Set the flag to `*`, recreate only the API service, and repeat the health and
   webhook audit.

Rollback consists of clearing the flag and recreating only the API service. No
database rollback, worker restart, webhook re-registration, or message cleanup
is required.

## Success Criteria

- Eligible canary messages normally show Telegram `typing...` within 300 ms.
- At least 95% of successful acknowledgement requests complete within 500 ms.
- Acknowledgement errors never change webhook acceptance or durable execution.
- Existing progress messages and final bot responses behave unchanged.
- No new failed or stale bot executions, deliveries, effects, loaders, or
  progress jobs appear during canary or global rollout.

## Follow-up

Overall response latency remains a separate concern. The global pg-boss
`exclusive` policy serializes all bot updates, so one slow model or voice job
can delay later users. Any concurrency change must preserve per-chat ordering
and durable idempotency and requires its own design and rollout.
