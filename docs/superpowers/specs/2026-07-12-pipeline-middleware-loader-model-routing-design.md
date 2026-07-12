# Universal Pipeline Middleware, Progress Loader, and Model Routing

Date: 2026-07-12
Status: Proposed

## Context

The typed bot runtime replaced n8n conversation workflows but did not preserve
the old progress-message experience. In the final n8n architecture, the
`Loader: Start` and `Loader: Stop` nodes called API endpoints backed by
`loader_flags` and pg-boss. The API sent an initial localized message, rotated
the text every five seconds, and deleted it when processing completed. The
database table, queue workers, helper methods, and localized
`waiting_text`/`loader_messages` configuration still exist, but the typed text
and voice handlers never start a loader session.

The current runtime also assigns `gpt-5.4` to conversation, translation,
follow-up hint, and vocabulary calls. Production does not persist per-call token
or latency telemetry, so it cannot calculate the actual cost per answer or
compare model candidates from production evidence.

## Goals

1. Introduce a reusable middleware layer for all typed bot pipelines.
2. Restore the localized rotating progress message for text and voice
   conversations without restoring n8n or adding internal HTTP coupling.
3. Preserve durable execution, retry, and delivery invariants.
4. Separate model selection by task and support a balanced quality/cost policy.
5. Add enough model-call telemetry and evaluation coverage to avoid a blind
   production model replacement.
6. Roll out every behavior change in independently deployable steps.

## Non-goals

- Rebuilding n8n workflows.
- Moving business logic back into HTTP routes.
- Showing progress messages for commands, callbacks, invalid input, quota
  paywalls, or feedback recording.
- Replacing transcription or TTS models without task-specific evaluation.
- Building a general workflow definition language or visual pipeline editor.

## Pipeline Architecture

### Runner

`processBotUpdateJob` will invoke a `BotPipelineRunner` after durable execution
claiming and before terminal execution state is recorded. The runner composes
registered middleware in deterministic onion order and then invokes the route
handler.

The execution context contains:

- the immutable `PreparedUpdate` contract;
- route and handler version;
- attempt number and job ID;
- a per-execution typed state map;
- `runStage(name, operation)` for bounded work inside a handler.

The middleware contract has two extension points:

1. `execute(context, next)` wraps the complete handler lifecycle.
2. `aroundStage(context, stage, next)` wraps explicitly named internal stages.

`next` may be called at most once. The runner rejects duplicate middleware
names and duplicate `next` calls at startup/test time. Middleware order is
declared in one production composition root, not inside handlers.

### Stages

The first named stage is `conversation.generate`. It means that input and
entitlement checks have passed and the runtime is about to perform external
work needed to create the first user-visible response.

- Text enters the stage immediately before typing action and the conversation
  AI effect.
- Voice enters the stage immediately before typing action, Telegram file
  download, transcription, and the conversation AI effect.
- The stage ends before transcript, correction, reply, paywall, or error
  delivery.

Handlers remain responsible for route-specific validation and business rules.
Middleware remains responsible for cross-cutting lifecycle behavior. This
prevents invalid or blocked requests from flashing a progress message.

Direct handler tests and non-worker consumers receive a no-op pipeline context,
so the stage API does not introduce a second behavior path.

## Progress Middleware

### Activation

`ProgressIndicatorMiddleware` reacts only to the
`conversation.generate` stage for `message.text` and `message.voice`.

At stage entry it asks the progress service to start a session. It always asks
the service to stop that exact session in `finally` when the stage returns or
throws. If the process is terminated before `finally` can run, the durable
timeout job performs cleanup.

Progress failures are best-effort. They are logged and captured as telemetry,
but they do not fail the conversation pipeline. Business execution and durable
answer delivery remain authoritative.

### Progress Service

The progress service becomes the single source of truth for loader lifecycle.
It is called directly from the worker; no request is made to the API's own HTTP
interface.

`start` performs these steps:

1. Normalize `waiting_text` and at most 32 `loader_messages` from the bot locale.
2. Stop and delete any previous loader for the same `chat_id + bot_key`.
3. Send the initial Telegram message.
4. Generate a session UUID and persist `loader_flags` with the message ID.
5. Enqueue the first rotation and 60-second timeout-cleanup jobs.
6. If persistence or enqueueing fails, delete the newly sent message and mark
   the session stopped.

`stop` accepts the session UUID. It does nothing if the stored session differs,
which prevents an older concurrent update from deleting a newer loader.

The rotation worker changes from a 60-second in-process loop to short one-shot
jobs. Each job checks the session, performs at most one edit, and schedules the
next step five seconds later with a session-and-step-scoped singleton key. This
avoids holding one of the ten loader worker slots while no work is happening.

The rotation chain continues to:

- shuffle localized variants;
- edit the same message every five seconds;
- avoid consecutive duplicate text;
- stop on deleted/uneditable messages;
- stop scheduling when the session is stopped, replaced, or 60 seconds old;
- let the independent timeout job delete an orphaned message after 60 seconds.

The legacy internal loader endpoints will delegate to the same service while
they remain present. They will not contain an independent implementation.

### User-visible Behavior

- A valid in-quota text or voice message immediately shows `waiting_text`.
- Longer work rotates the message every five seconds.
- The loader disappears before the first real response.
- Text currently completes at about 4.2 seconds p50 and voice at about 9.0
  seconds p50, so text commonly shows only the initial message while voice
  commonly shows one rotated message.
- Commands, callbacks, too-short/too-long voice messages, and blocked free
  users do not show a loader.

## Model Routing

### Current Production Policy

Production currently relies on code defaults:

| Task | Current model |
| --- | --- |
| Conversation response | `gpt-5.4` |
| Translation, hints, vocabulary | `gpt-5.4` |
| Topic generation | `gpt-5.4` |
| Reminder text | `gpt-5-mini` |
| Idiom translation | `gpt-5.4` fallback |
| Transcription | `gpt-4o-transcribe` |
| Speech generation | `gpt-4o-mini-tts` |

### Balanced Target Policy

The target policy separates model roles instead of assigning one model to every
text task:

| Task | Target | Reasoning |
| --- | --- | --- |
| Conversation response | `gpt-5.6-luna` candidate | `none` latency baseline; compare `low` in eval |
| Translation, hints, vocabulary | `gpt-5.4-mini` | `none` |
| Topic generation/admin assist | `gpt-5.6-terra` | preserve quality; low volume |
| Reminder text | keep `gpt-5-mini` | already inexpensive and bounded |
| Idiom translation | `gpt-5.4-mini` | structured translation task |
| Transcription | keep `gpt-4o-transcribe` | learner-error fidelity is quality-critical |
| Speech generation | keep `gpt-4o-mini-tts` | already the appropriate low-cost TTS model |

At current standard list prices, `gpt-5.6-luna` input/output tokens are 60%
cheaper than `gpt-5.4`, and `gpt-5.4-mini` is 70% cheaper than `gpt-5.4`.
`gpt-4o-mini-transcribe` is half the price of the current transcription model,
but saves only about USD 3 per 1,000 audio minutes and must not replace the
full model without a learner-speech word-error evaluation.

Sources:

- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/models/gpt-4o-transcribe
- https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe
- https://developers.openai.com/api/docs/models/gpt-4o-mini-tts

### Configuration

The API will keep `BOT_RUNTIME_MODEL` as the backward-compatible conversation
model variable and add `BOT_SUPPORT_MODEL`. Existing variables continue to own
topic, reminder, idiom, transcription, and TTS models. Defaults change only
after the corresponding evaluation gate passes.

The bot AI client receives explicit models per operation. It never infers a
model from a route name and never silently falls back from an unavailable model
at request time. A missing or rejected configured model is an observable
runtime error rather than an untracked quality change.

### Telemetry

Every Responses API call records a privacy-minimal event containing:

- timestamp, decision ID when available, bot key, route, and operation;
- model and reasoning effort;
- duration and success/error code;
- input, cached-input, output, and reasoning token counts returned by OpenAI.

No prompt, transcript, generated response, username, or Telegram token is
stored in model telemetry. Telemetry write failures are logged and never fail a
user request.

The telemetry table supports daily cost estimates and candidate comparison. A
forward-only migration and synchronized `db/schema.sql` update are required.

### Evaluation Gate

The conversation model changes only after a reproducible evaluation over a
representative multilingual set. The set must cover:

- every target language currently served;
- A1 through C1 levels;
- correct target-language input;
- grammatical mistakes;
- base-language and mixed-language input;
- pinned-topic and unpinned conversations;
- short text and voice-like imperfect transcripts.

`gpt-5.4` is the baseline. `gpt-5.6-luna` with `none` and `low` reasoning are
candidates. The rubric scores schema validity, target-language correctness,
correction accuracy, learner-level fit, conversational usefulness, latency,
tokens, and estimated cost.

The balanced candidate passes when:

- schema validity and hard behavioral constraints are 100%;
- no critical language or correction regression is observed;
- aggregate quality is not materially below the baseline;
- p95 latency does not regress by more than 20%;
- estimated text-model cost per conversation falls by at least 40%.

If Luna fails, production remains on `gpt-5.4`; `gpt-5.6-terra` is evaluated as
the quality-first upgrade rather than forced into production.

## Reliability and Idempotency

- Pipeline middleware runs only after an execution lease is claimed.
- Duplicate succeeded/in-progress/permanent-failed jobs do not enter the
  middleware chain.
- A progress message is ephemeral and is not added to
  `bot_update_deliveries`; durable delivery remains reserved for business
  output.
- Session-scoped cleanup and the timeout job handle retries, concurrent updates,
  worker crashes, and deploy restarts.
- Middleware errors are classified explicitly. Progress errors are swallowed
  after telemetry; policy middleware errors propagate according to their own
  contract.
- Handler versions remain unchanged because the prepared contract and durable
  business-effect keys do not change. Old accepted jobs can drain across a
  deploy.

## Testing

### Unit and Contract Tests

- Middleware ordering follows onion semantics.
- `next` cannot be called twice.
- Stage middleware surrounds only matching stages/routes.
- Stage cleanup runs on success and error.
- Progress start/stop is session-scoped and best-effort.
- Start rollback removes the Telegram message after state/enqueue failure.
- Text and voice start progress after quota acceptance and stop before first
  delivery.
- Invalid voice and quota-blocked requests never start progress.
- Direct handler invocation uses a no-op stage runner.
- Model operation-to-model mapping is explicit.
- Telemetry extracts usage without storing content and never blocks output.

### Integration and Production Smoke

- Full API tests and TypeScript build pass.
- Mini-app and landing builds remain unchanged and pass.
- Compose validation and bot-config validation pass.
- A real authorized smoke chat verifies initial send, at least one edit using a
  controlled delay, deletion, and final response.
- A blocked synthetic user verifies no loader and no AI call.
- Worker restart during a loader session verifies timeout cleanup.
- Production audit verifies no active loader row older than 60 seconds, no
  non-terminal loader jobs, healthy API, and healthy Telegram webhooks.
- Model changes use a canary bot first, then all bots only after telemetry and
  response-quality checks pass.

## Deploy-safe Sequence

1. Add the no-op middleware runner and tests without registering behavior.
2. Extract the canonical progress service and make legacy endpoints delegate to
   it; keep typed pipelines unchanged.
3. Register progress middleware for one canary bot and smoke test lifecycle,
   restart cleanup, invalid input, and quota blocking.
4. Enable progress middleware for all bots and audit production.
5. Add model-call telemetry and the support-model configuration without
   changing active model defaults.
6. Run and publish the model evaluation report.
7. Canary the passing balanced model policy, compare production telemetry, then
   enable it globally or retain the baseline if gates fail.

Each step is a separate commit and can be deployed and rolled back without a
database downgrade or n8n dependency.
