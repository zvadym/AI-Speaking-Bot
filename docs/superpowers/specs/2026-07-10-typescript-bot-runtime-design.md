# TypeScript Bot Runtime Migration Design

Status: Approved for implementation planning

Date: 2026-07-10

## Context

The main Telegram workflow currently contains 230 nodes, including 56 `If` nodes,
24 Code nodes, and no Switch node. Only the ingress routing chains should be
collapsed into route-based dispatch. Local decisions such as cache hits, usage
limits, TTS mode, topic access, and retry eligibility remain local to their
handlers.

The first extraction already exists in local commit `adff30e`:

- `POST /internal/bot/prepare-update`
- Telegram update normalization
- persistent keyboard intent detection
- route selection
- keyboard and pending-feedback state loading
- unit and endpoint tests

The workflow template and renderer also have uncommitted changes that call this
endpoint as a disconnected shadow branch. The local branch is one commit ahead
of `origin/main`. No migration release is considered production-verified only
because it exists locally.

The API currently runs Node.js ESM JavaScript directly. The target language for
new bot runtime code is TypeScript.

## Goals

1. Move deterministic routing and business behavior from n8n into a typed,
   testable TypeScript runtime.
2. Keep every release independently deployable, testable, and reversible.
3. Keep n8n as a temporary Telegram adapter and legacy fallback during the
   migration.
4. Use the existing `pg-boss` worker for durable migrated-route execution,
   retries, and backoff.
5. Prevent duplicate update processing through update, job, handler-step, and
   delivery idempotency.
6. Make route promotion observable and controlled one route at a time.
7. End with n8n as a replaceable thin adapter rather than the owner of business
   logic.

## Non-goals

- Mechanically replacing all n8n `If` nodes with one Switch node.
- Rewriting every existing API file in TypeScript before route migration.
- Building a generic workflow DSL or durable workflow engine.
- Migrating text and voice conversation processing before simple handlers prove
  the runtime boundaries.
- Removing legacy nodes in the same release that first routes production traffic
  to a new handler.
- Promising exactly-once delivery where Telegram does not provide an idempotency
  primitive.

## Target Architecture

### n8n adapter

During migration, n8n owns:

- Telegram Trigger and bot credentials
- minimal ingress filtering required by the current workflow
- a synchronous call to Prepare Update
- a route Switch with explicit migrated-route cases
- the complete legacy workflow as the default branch
- an enqueue call for routes promoted to the TypeScript runtime

n8n must not reinterpret a prepared route. It either hands the update to a
migrated handler or follows the unchanged legacy path.

### TypeScript bot runtime

The runtime remains inside `apps/api` until a second runtime consumer justifies a
separate package. It has these boundaries:

1. `TelegramUpdateAdapter` validates and normalizes a raw Telegram update.
2. `UpdateContextLoader` reads route-time state without side effects.
3. `UpdateRouter` is a pure function that returns a typed route and routing facts.
4. `BotUpdateIngestion` durably enqueues accepted migrated updates.
5. `HandlerRegistry` maps migrated routes to typed handlers.
6. Handlers use injected Postgres, Telegram, OpenAI, STT, and TTS service
   interfaces.

No handler imports Express or reads n8n node output. Bot configuration and locale
are loaded from the existing API runtime configuration.

### pg-boss worker

The existing worker executes migrated handlers. Enqueue uses
`singletonKey = bot-update:<botKey>:<updateId>` as transport-level deduplication.
The HTTP ingestion response is successful only after `boss.send()` confirms a
durable job insert or reports the singleton as an existing duplicate.

`singletonKey` is not the authoritative exactly-once mechanism. A duplicate job
may be created after the singleton window or retention boundary, so every
state-changing handler step also uses a durable idempotency key.

## Prepare Update Contract

TypeScript uses camelCase internally and in the version 1 response. The request
may continue accepting the existing snake_case aliases while n8n is migrated.

```ts
type PreparedUpdate = {
  contractVersion: 1;
  decisionId: string;
  botKey: string;
  updateId: number;
  route: Route;
  input: NormalizedTelegramUpdate;
  routingFacts: RoutingFacts;
  context: RouteTimeContext;
};
```

`decisionId` is deterministic: `v1:<botKey>:<updateId>`. A real Telegram-triggered
request without an integer `update_id` is rejected as an invalid contract input.

`context` is a route-time snapshot used for routing, shadow comparison, and
diagnostics. It is not authoritative for mutable state when a queued handler
runs.

`routingFacts` records the facts that selected the route, including:

- command and start payload
- callback group and payload
- persistent keyboard intent
- pending-feedback state
- ingress guard result

The endpoint is read-only. It must not write to Postgres, enqueue work, call
Telegram, or call an AI provider.

### Route type

The initial union preserves the routes already represented by the extracted
router:

```ts
type Route =
  | 'ignore'
  | 'guard.private_only'
  | 'guard.bot_sender'
  | 'callback.busy'
  | 'callback.idiom_more'
  | 'callback.transcript_translate'
  | 'callback.translate'
  | 'callback.hints'
  | 'callback.vocab'
  | 'callback.lang'
  | 'callback.level'
  | 'callback.reply'
  | 'callback.topic'
  | 'callback.onboarding'
  | 'callback.unknown'
  | 'command.start'
  | 'command.voice'
  | 'command.lang'
  | 'command.level'
  | 'command.stats'
  | 'command.xp'
  | 'command.topic'
  | 'command.feedback'
  | 'command.unknown'
  | 'reply_keyboard.voice_toggle'
  | 'pending_feedback.voice'
  | 'pending_feedback.text'
  | 'pending_feedback.unsupported'
  | 'message.voice'
  | 'message.text'
  | 'message.unsupported';
```

Route parsing semantics must be fixed by fixtures before any Switch case uses
the contract. Bot-qualified commands, command arguments, empty callback data,
unknown bot keys, non-private chat types, and precedence between guards,
callbacks, commands, pending feedback, and normal messages all require explicit
fixture coverage.

## Migration Data Flow

1. Telegram delivers an update to the n8n trigger.
2. The existing n8n ignore, group, bot-sender, and user-upsert path runs before
   business-route migration. n8n then calls Prepare Update with a two-second
   timeout.
3. A timeout, non-2xx response, invalid contract version, or unknown route goes
   to the legacy workflow and records a fallback reason.
4. The route Switch sends only explicitly promoted routes to Bot Update
   Ingestion. Every other route uses the legacy workflow.
5. Ingestion verifies the contract, checks that the route is currently enabled,
   and durably enqueues the update.
6. If durable acceptance is not confirmed, n8n uses the legacy branch.
7. Once ingestion confirms acceptance or an existing singleton duplicate, n8n
   stops processing that update.
8. The worker reloads mutable context and executes the registered handler.

The no-double-processing boundary is durable acceptance. Legacy fallback is
allowed before that boundary and forbidden after it.

## Pipeline Contract

A pipeline is a focused typed handler, not a configurable DSL.

```ts
type BotHandler<R extends Route> = {
  route: R;
  version: number;
  execute(
    update: RoutedUpdate<R>,
    dependencies: HandlerDependencies
  ): Promise<HandlerOutcome>;
};
```

A handler is composed from explicit functions with these conceptual stages:

1. Load current mutable context.
2. Validate handler preconditions.
3. Make pure domain decisions.
4. Persist idempotent state changes and action events.
5. Perform external delivery through injected services.

The route, normalized input, contract version, handler version, decision ID, and
route-critical facts are frozen after acceptance. Plan tier, usage, preferences,
topic state, conversation history, and other mutable records are reloaded by the
worker.

A generic pipeline builder may be introduced only after at least three migrated
pipelines demonstrate the same meaningful structure. Until then, plain typed
functions keep control flow visible and testable.

## Idempotency and Delivery

The update processing key is `<botKey>:<updateId>`. Each state-changing step uses
an idempotency key derived from the decision and step, for example
`<decisionId>:stats-delivered:v1`.

Duplicate execution that finds a completed idempotency record returns a
successful no-op. It is not treated as an error and must not send another
message.

Telegram does not guarantee exactly-once `sendMessage` behavior. Delivery uses a
durable delivery record with `pending`, `delivered`, `failed`, or `unknown`
status:

- a confirmed success becomes `delivered`
- a clearly rejected request may retry according to error classification
- an ambiguous timeout after the request may have reached Telegram becomes
  `unknown` and is not blindly resent
- idempotent edit operations may retry when repeating the same edit is safe

An `unknown` delivery is observable and available for manual reconciliation.

R5 adds two forward-only runtime tables:

- `bot_update_executions`, keyed by `decision_id` and unique on
  `(bot_key, update_id)`, records route, handler version, status, attempts, and
  terminal error code
- `bot_update_deliveries`, unique on `(decision_id, step_key)`, records Telegram
  method, delivery status, Telegram message ID when known, attempts, and bounded
  error metadata

The existing user-level Telegram delivery state continues tracking whether a bot
can reach a user. It does not replace per-update execution and delivery records.

## Error Handling

Errors are classified at the boundary where they can be handled correctly:

- Prepare timeout, bad response, or contract mismatch: record metric and use
  legacy fallback.
- Enqueue failure before durable acceptance: record metric and use legacy
  fallback.
- Existing singleton job: return accepted and do not run legacy.
- Worker transient dependency error: bounded pg-boss retry with backoff.
- Worker permanent validation or business error: no retry; record terminal
  outcome.
- Exhausted retries: dead-letter outcome plus Sentry and Discord notification.

The worker never invokes legacy n8n as an error handler.

## Observability

The correlation chain is:

`updateId -> decisionId -> jobId -> handlerStep -> deliveryId`

Structured telemetry includes:

- contract and handler versions
- bot key and route
- prepare, enqueue, queue, handler, and delivery durations
- fallback reason
- worker attempt and outcome
- idempotency result
- delivery status

Logs and metrics must not include raw user message text, voice payloads, bot
tokens, internal secrets, or full Telegram updates. Sentry may receive bounded
metadata but not message content.

Shadow parity is added only at the legacy branch entry for the route currently
being promoted. That branch records its known legacy route and compares it with
the prepared route. This avoids modifying every branch before it is needed.

## Testing Strategy

### Contract tests

- fixture table covering every Route value
- command and callback parsing edge cases
- full route-precedence table
- persistent keyboard locale and onboarding states
- invalid update ID, unknown bot, and unsupported message cases
- response contract version validation

### Handler tests

- pure decisions tested without Postgres or network access
- service interfaces replaced by explicit fakes
- duplicate execution returns a successful no-op
- retryable and permanent failures are classified correctly
- ambiguous Telegram delivery becomes `unknown`

### Integration tests

- real Postgres schema for handler persistence and idempotency
- pg-boss enqueue, singleton conflict, retry, and dead-letter behavior
- internal endpoint authentication and validation
- additive migration and `db/schema.sql` consistency when tables change

### Workflow tests

- template JSON validation
- renderer compilation
- successful rendering of all 15 production bot workflows
- no unresolved placeholders
- one complete bot smoke test after each deploy
- route-specific shadow parity before promotion

## Route Promotion Gate

A route may receive production traffic only when:

1. Its contract and precedence fixtures pass.
2. Its handler tests pass with fake dependencies.
3. Postgres and pg-boss integration tests pass.
4. Duplicate execution has been verified as a successful no-op.
5. The legacy branch and prepared route have zero observed parity mismatches
   during the defined shadow window.
6. Its rollback consists of removing one Switch case.

The shadow window lasts at least 24 hours and requires 20 matching observations
for the route. If natural traffic does not produce 20 observations within seven
days, run 20 authenticated canary invocations across at least three bot configs
and require every natural observation from that seven-day window to match.

The first production route is `command.stats`. It is read-only from the user's
perspective, does not require an AI provider, and exercises configuration,
Postgres reads, localization, Telegram delivery, queueing, and idempotency.

## Deployment Sequence

### R1: Baseline API

Deploy local commit `adff30e` without connecting it to routing. Verify API health,
internal authentication, a representative prepare response, and unchanged bot
behavior. Roll back to the previous API image if needed.

### R2: TypeScript build foundation

Add TypeScript with `module: "NodeNext"`, `target: "ES2022"`, `allowJs: true`,
and `checkJs: false`. Use `tsx --test` for source-level tests and `tsc` for the
compiled production runtime. API and worker start from the compiled output. This
release does not change the prepare contract or workflow.

Verify tests, typecheck, build, API startup, worker startup, and Docker image
startup. Rollback changes only packaging.

### R3: Contract version 1

Convert bot runtime modules to TypeScript and introduce the Route union,
`contractVersion`, `updateId`, deterministic `decisionId`, explicit routing
facts, configured-bot validation, and the complete fixture matrix. Deploy the
API without an n8n consumer.

### R4: Observable shadow

Connect Prepare Update as a disconnected n8n shadow call after `Create User`.
Record route, contract version, latency, error, and the reason that would cause
fallback. The legacy route remains the only behavioral path. This phase observes
private human business routes; existing ingress guards remain authoritative.
Verify template JSON and all 15 rendered workflows.

### R5: Dark stats handler

Add Bot Update Ingestion, the pg-boss job, handler registry,
`bot_update_executions`, `bot_update_deliveries`, and the `command.stats`
handler. Keep production traffic on legacy. Verify direct ingestion, singleton
conflict, duplicate handler execution, delivery states, schema consistency, and
worker retries.

### R6: Stats canary

Make Prepare Update an ordered step after `Create User` and before the existing
user-data fan-out, preserving the legacy path when the HTTP call fails. Add one
n8n Switch case for `command.stats`. Start with one bot for at least 24 hours and
20 successful invocations. Prepare or enqueue failure before acceptance falls
back to the old stats branch. Verify a normal request, duplicate update, API
outage, worker retry, and Switch-case rollback.

### R7 and later: Route batches

Promote routes in this order, with a separate deploy and promotion gate for each
route or tightly coupled route pair:

1. read-only commands and menus
2. level, reply mode, feedback, and topic state transitions
3. callbacks
4. text conversation
5. voice conversation, STT, and TTS

### Final cleanup

Delete legacy routing and duplicate n8n Code/SQL nodes only after every route is
stable, legacy fallback traffic has been zero for seven days, and a tagged
legacy workflow export has been retained. Destructive database changes are not
bundled with workflow cleanup.

## Internal Secret Rotation

Secret cleanup is independent from route migration:

1. Replace tracked workflow secret values with a non-secret renderer sentinel.
2. Add temporary `INTERNAL_API_SECRET_PREVIOUS` support to internal API
   authentication.
3. Deploy the API accepting current and previous secrets.
4. Rotate `INTERNAL_API_SECRET` and render/import every workflow with the new
   value
5. Verify internal calls, then remove previous-secret support in a later deploy

The value currently present in Git history is treated as compromised even after
it is removed from the current template.

## Rollback Rules

- R1 through R5 leave the legacy workflow behavior unchanged.
- A promoted route rolls back by removing its Switch case, not by editing its
  handler during an incident.
- No handler release removes the legacy branch it replaces.
- No retry after durable acceptance may trigger legacy processing.
- Database migrations required by the runtime are additive and forward-only.
- Workflow cleanup occurs only after the seven-day zero-fallback gate.

## Success Criteria

The migration is successful when:

- all Telegram business routes use typed TypeScript handlers
- n8n contains no business-routing chain or duplicated keyboard computation
- all accepted updates have traceable decision, job, handler, and delivery IDs
- duplicate updates do not repeat state changes or confirmed deliveries
- each route can be promoted or rolled back independently until final cleanup
- the API and worker own business behavior, while n8n is only a replaceable
  ingress adapter
# Historical Migration Design

This design describes the transition architecture used during the July 2026
cutover. The temporary n8n adapter documented below has been retired. Current
runtime and deployment contracts are documented in `AGENTS.md` and
`deploy/README.md`.
