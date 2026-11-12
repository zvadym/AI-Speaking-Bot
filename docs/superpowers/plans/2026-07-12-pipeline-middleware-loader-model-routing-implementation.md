# Universal Pipeline Middleware, Loader, and Model Routing Implementation Plan

Design source:
`docs/superpowers/specs/2026-07-12-pipeline-middleware-loader-model-routing-design.md`

Every release below is independently deployable and testable. Database changes
are forward-only. Existing handler versions and prepared-update contract version
remain unchanged.

## R1: Pipeline Middleware Contract (No Behavior Change)

1. Add `bot-runtime/pipeline.ts` with:
   - immutable execution context;
   - onion-style handler middleware;
   - named-stage middleware;
   - duplicate name and duplicate `next()` protection;
   - a no-op direct execution context.
2. Extend `BotHandler.execute` with an optional pipeline context.
3. Route claimed executions through the runner in `processBotUpdateJob`.
4. Keep the production middleware list empty.
5. Add focused ordering, error, stage, and duplicate-call tests.
6. Run API tests, typecheck, and build.

Deploy smoke:

- health and webhooks remain healthy;
- text/voice execution succeeds with no loader behavior;
- no unexpected retryable executions appear.

## R2: Canonical Progress Service and One-shot Jobs (Dark)

1. Add `bot-runtime/progress-service.ts` as the only loader lifecycle owner.
2. Move normalization, state transition, session-scoped stop, Telegram cleanup,
   rotation enqueue, and timeout enqueue behind this service.
3. Convert `loader-rotate` from a long loop to one edit per job and schedule the
   next step with a session/step singleton key.
4. Make legacy internal loader endpoints delegate to the same service.
5. Keep typed pipeline progress middleware unregistered.
6. Add tests for start, rollback, session replacement, stop mismatch, one-shot
   rotation, timeout, and Telegram-gone behavior.
7. Run API tests, typecheck, build, and compose validation.

Deploy smoke:

- invoke the internal compatibility endpoint with a controlled smoke chat;
- verify send, edit, stop/delete, and no stale job/session;
- restart worker during a session and verify timeout cleanup.

## R3: Progress Middleware Canary

1. Add `ProgressIndicatorMiddleware` for `conversation.generate`.
2. Wrap text conversation external work in the named stage after quota guard.
3. Wrap voice download/transcription/conversation work in the same stage after
   duration validation and quota guard.
4. Add `BOT_PROGRESS_ENABLED_BOT_KEYS` parsing with empty default.
5. Add tests proving no loader for quota block, invalid voice, commands, or
   callbacks and cleanup before first business delivery.
6. Enable only `uk-de` in production.

Deploy smoke:

- authorized text and voice smoke on `uk-de`;
- controlled delay proves at least one edit;
- blocked free account proves no loader and no AI;
- inspect stale flags/jobs and worker errors.

## R4: Progress Middleware Global Rollout

1. Enable all configured bot keys after canary evidence passes.
2. Update documentation and env examples.
3. Audit all 15 bot configs for non-empty `waiting_text` and loader variants.

Deploy smoke:

- one base-language and one non-base-language bot;
- all webhooks healthy and no pending updates;
- no active loader older than 60 seconds;
- no non-terminal orphan rotation jobs.

## R5: Model Routing and Telemetry (No Model Change)

1. Add `BOT_SUPPORT_MODEL` and explicit per-operation model selection.
2. Add a forward-only `llm_call_events` migration and update `db/schema.sql`.
3. Record model, operation, reasoning effort, duration, status, and OpenAI usage
   counters without storing content.
4. Make telemetry best-effort and add tests for success, OpenAI error, and DB
   telemetry failure.
5. Keep active production model defaults unchanged.
6. Add daily cost-estimate query/documentation.

Deploy smoke:

- run one conversation and one support callback;
- verify telemetry rows contain counts but no content;
- verify telemetry failure injection does not block a response.

## R6: Reproducible Balanced Model Evaluation

1. Add a versioned evaluation fixture covering all target languages, levels,
   correction cases, language mismatch, mixed language, topics, and imperfect
   transcripts.
2. Add an evaluation runner for:
   - baseline `gpt-5.4`;
   - candidate `gpt-5.6-luna` with reasoning `none`;
   - candidate `gpt-5.6-luna` with reasoning `low`.
3. Validate schemas and hard constraints deterministically.
4. Use a fixed judge model/rubric for pairwise quality and publish aggregate
   quality, latency, tokens, and estimated cost.
5. Select a candidate only if every gate in the design spec passes.

No deployment occurs in this release.

## R7: Model Canary and Global Rollout

1. Set the passing conversation candidate for `uk-de` only through model policy
   configuration; route all support operations to `gpt-5.4-mini`.
2. Keep transcription and TTS unchanged.
3. Compare canary telemetry and sampled response quality against baseline.
4. If canary passes, enable the balanced policy globally and set:
   - idiom translation to `gpt-5.4-mini`;
   - reminders unchanged.
5. If canary fails, restore the prior model config without reverting middleware
   or telemetry.

Final production audit:

- commit and deployed SHA match;
- API/worker healthy;
- all webhooks healthy;
- all route flags enabled;
- queue has no unexpected non-terminal jobs;
- loader lifecycle passes real text/voice smoke;
- quota-blocked smoke invokes neither loader nor AI;
- model telemetry proves selected model mapping and expected cost reduction;
- synthetic data is removed;
- local and production worktrees are clean.
