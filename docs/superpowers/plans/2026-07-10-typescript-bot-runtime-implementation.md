# TypeScript Bot Runtime Migration Implementation Plan

Design: `docs/superpowers/specs/2026-07-10-typescript-bot-runtime-design.md`

## Execution Rule

This plan is executed one release at a time. After each release:

1. Commit locally without push.
2. Report the exact commit and verification results.
3. Stop.
4. The user pushes, deploys, and performs the production smoke test.
5. Start the next release only after the user confirms the deploy result.

Do not combine release commits, database migrations, workflow activation, or
secret rotation across these gates.

## Current Checkpoint

- `adff30e` contains the JavaScript Prepare Update endpoint.
- `ff49ac5` contains the approved design spec.
- Local branch `main` is two commits ahead of `origin/main`.
- The early shadow workflow patch is preserved in local stash
  `codex/r4-prepare-update-shadow` and is intentionally absent from the R1
  worktree.
- The worktree is clean before this plan file is added.
- API tests pass: 61 tests, 0 failures.

## R1: Baseline Prepare Update API

Goal: deploy the existing endpoint without changing n8n behavior.

### Local verification

Run:

```bash
cd apps/api
npm test
```

Expected: all tests pass, including the pure bot runtime tests and
`POST /internal/bot/prepare-update` endpoint test.

Confirm no workflow files are present in the deploy diff:

```bash
git status --short
git diff origin/main...HEAD -- deploy/workflows scripts/render-n8n-workflows.py
```

Expected: no workflow or renderer diff.

### User deploy

The remote deploy script resets the server to `origin/main`, so the user must
push the local commits before deployment. The agent does not push.

Deploy only API, worker, mini-app, and Caddy:

```bash
scripts/deploy-remote.sh --skip-n8n
```

### Production smoke

Verify public health:

```bash
curl -fsS https://learn-language-api.notarobot.dev/healthz
```

From the server, call the internal endpoint inside the API container so the
secret is read from process environment and never printed:

```bash
cd /opt/ai-speaking-bot
docker compose -p languagebot -f deploy/docker-compose.yml exec -T api \
  node --input-type=module -e '
    const response = await fetch("http://127.0.0.1:3000/internal/bot/prepare-update", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET
      },
      body: JSON.stringify({
        bot_key: "uk-de",
        telegram_update: {
          message: {
            message_id: 1,
            text: "R1 prepare smoke",
            chat: { id: 999999999, type: "private" },
            from: { id: 999999999, is_bot: false }
          }
        }
      })
    });
    const body = await response.json();
    if (response.status !== 200 || body.route !== "message.text") {
      throw new Error(JSON.stringify({ status: response.status, body }));
    }
    console.log(JSON.stringify({ status: response.status, route: body.route }));
  '
```

Perform one normal bot smoke using the existing n8n workflow:

- `/stats`
- one text practice message
- one voice practice message
- one existing inline callback

Expected: behavior is unchanged because n8n does not call Prepare Update yet.

### R1 stop gate

Do not start R2 until the user confirms API health, internal prepare smoke, and
normal bot smoke.

## R2: TypeScript Build Foundation

Goal: compile the existing API and worker without changing application behavior
or the Prepare Update response.

### Task 1: Add TypeScript tooling

Modify:

- `apps/api/package.json`
- `apps/api/package-lock.json`
- `.gitignore`

Add development dependencies:

- `typescript`
- `tsx`
- `@types/node`
- `@types/express`
- `@types/pg`

Add `engines.node >= 22.12.0` and scripts. This matches the minimum runtime
required by the installed `pg-boss@12.14.0`:

```json
{
  "build": "tsc -p tsconfig.json",
  "typecheck": "tsc -p tsconfig.test.json",
  "test": "tsx --test test/*.test.js test/*.test.ts",
  "dev": "tsx watch src/server.js",
  "worker:dev": "tsx src/worker.js",
  "start": "node --import ./dist/instrument-api.js dist/server.js",
  "worker": "node --import ./dist/instrument-worker.js dist/worker.js"
}
```

Development runs source through `tsx`; production runs compiled output. Ignore
`apps/api/dist`.

### Task 2: Add compiler configuration

Create `apps/api/tsconfig.json` with these required choices:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "allowJs": true,
    "checkJs": false,
    "strict": true,
    "noEmitOnError": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.js", "src/**/*.ts"]
}
```

Do not enable `checkJs`; R2 is a packaging release, not an API-wide typing
project.

### Task 3: Build a production image from compiled output

Modify `apps/api/Dockerfile` into a multi-stage image:

1. Copy `package.json` and `package-lock.json`.
2. Run `npm ci` with development dependencies in the build stage.
3. Copy `src` and `scripts`.
4. Run `npm run build`.
5. Prune development dependencies.
6. Copy `dist`, production `node_modules`, `scripts`, and `src` to the runtime
   image.
7. Start through `npm start`.

`src` remains in the runtime image only because
`scripts/import-idiom-phrases.mjs` imports source modules. API and worker entry
points must execute from `dist`.

### Task 4: Verify R2

Create `.github/workflows/api.yml` with Node.js 22 and path filters for
`apps/api/**`. It runs `npm ci`, `npm test`, `npm run typecheck`, and
`npm run build`. This gives later TypeScript releases a required automated gate.

Run:

```bash
cd apps/api
npm test
npm run typecheck
npm run build
docker build -t languagebot-api:ts-foundation .
```

Verify the image contains `dist/server.js`, `dist/worker.js`, API scripts, and
production dependencies. Start API and worker through the existing Compose file
with the local env and verify `/healthz` plus worker startup logs.

Commit only R2 files:

```text
Add TypeScript build foundation
```

### R2 deploy gate

User pushes and runs:

```bash
scripts/deploy-remote.sh --skip-n8n
```

Verify API health, worker startup, one queued existing job, and the normal bot
smoke. Stop before R3.

## R3: Typed Prepare Update Contract v1

Goal: introduce typed runtime boundaries and exhaustive route fixtures while no
n8n workflow consumes the contract.

### Task 1: Split the current runtime by responsibility

Create:

- `apps/api/src/bot-runtime/contracts.ts`
- `apps/api/src/bot-runtime/telegram-update.ts`
- `apps/api/src/bot-runtime/keyboard-state.ts`
- `apps/api/src/bot-runtime/update-router.ts`
- `apps/api/src/bot-runtime/context-loader.ts`
- `apps/api/src/bot-runtime/prepare-update-service.ts`

Remove the superseded JavaScript modules only after all imports use the new
modules:

- `apps/api/src/bot-runtime/update-preparation.js`
- `apps/api/src/bot-runtime/prepare-update-service.js`

Keep `.js` import specifiers in TypeScript source so NodeNext emits valid ESM.

### Task 2: Define and validate Contract v1

Implement the exact approved contract:

- `contractVersion: 1`
- deterministic `decisionId = v1:<botKey>:<updateId>`
- configured `botKey`
- integer Telegram `updateId`
- typed `route`
- normalized `input`
- `routingFacts`
- route-time `context`

The endpoint continues accepting request aliases `bot_key`, `botKey`,
`telegram_update`, `telegramUpdate`, and `update`. Its version 1 response uses
camelCase only.

Reject before database access:

- missing or non-integer `update_id`
- unknown bot key
- non-object Telegram update

Return `invalid_update` for missing/non-integer `update_id` or a non-object
Telegram update. Return `unknown_bot` for a normalized key absent from the bot
catalog.

### Task 3: Make routing exhaustive

Export the Route union and route constants from `contracts.ts`. Use an exhaustive
router implementation so adding a route requires test and type updates.

Preserve current behavior unless a fixture explicitly defines a correction.
Document command semantics for bot-qualified commands and command arguments.

### Task 4: Add the full fixture matrix

Create:

- `apps/api/test/bot-runtime-contract.test.ts`
- `apps/api/test/fixtures/telegram-updates.ts`
- `apps/api/tsconfig.test.json`

Update:

- `apps/api/test/app.test.js`

Cover every Route value and these precedence rules:

1. ignore
2. private/group guard
3. bot-sender guard
4. callback
5. command or persistent-keyboard intent
6. pending feedback
7. voice/text/unsupported message

Include all callback groups, command aliases, `/start` payloads, localized
keyboard values, onboarding disabled state, unknown callback and command,
missing user state, invalid update ID, and unknown bot.

### Task 5: Verify and commit R3

Run:

```bash
cd apps/api
npm test
npm run typecheck
npm run build
docker build -t languagebot-api:contract-v1 .
```

Commit:

```text
Add typed bot update contract
```

### R3 deploy gate

Deploy with `scripts/deploy-remote.sh --skip-n8n`. Run Contract v1 internal smoke
with a real `update_id`, verify no workflow behavior changed, then stop before
R4.

## R4: Observable n8n Shadow

Goal: observe Contract v1 in production without affecting routing.

### Task 1: Restore the parked patch as a reference

Locate the stash by message rather than assuming its index:

```bash
shadow_stash="$(git stash list --format='%gd %s' \
  | awk '/codex\/r4-prepare-update-shadow/ { print $1; exit }')"
test -n "$shadow_stash"
git stash apply "$shadow_stash"
```

Review the applied diff against Contract v1. Do not commit the original
JavaScript response assumptions. Drop the stash only after the final R4 diff is
committed and verified.

### Task 2: Harden the template secret handling

Modify:

- `deploy/workflows/ai-bot.json`
- `scripts/render-n8n-workflows.py`

Replace every committed `x-internal-secret` value with a non-secret sentinel.
Make the renderer scan every HTTP Request node that has an
`x-internal-secret` header and inject `INTERNAL_API_SECRET`. Keep explicit URL
patching separate from generic secret injection.

Rendering must fail if an internal HTTP node retains the sentinel or if a
tracked secret-like value remains.

### Task 3: Add the disconnected shadow branch

After `Create User`, call `POST /internal/bot/prepare-update` with:

- bot key from `Settings`
- raw Telegram update from `Telegram Trigger`
- two-second timeout
- `continueOnFail: true`

Do not connect the result to existing routing. Add a terminal normalization Code
node that records only:

- `shadow_ok`
- `contract_version`
- `route`
- `duration_ms` when available
- bounded `failure_reason`

Do not retain raw message text in normalized telemetry.

### Task 4: Add route-level API telemetry

Update the internal route/service to emit structured logs for contract version,
bot key, route, duration, and bounded error code. Do not log message content,
tokens, secrets, or full updates.

### Task 5: Verify and commit R4

Run:

```bash
cd apps/api
npm test
npm run typecheck
npm run build
cd ../..
python3 -m json.tool deploy/workflows/ai-bot.json >/dev/null
python3 -m py_compile scripts/render-n8n-workflows.py
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
tmpdir="$(mktemp -d)"
set -a
source deploy/.env.dev
set +a
python3 scripts/render-n8n-workflows.py \
  --input deploy/workflows \
  --output "$tmpdir" \
  --bots deploy/bots
rm -rf "$tmpdir"
git diff --check
```

Expected: all 15 workflows render, no sentinel remains in rendered files, and
the old router connections are unchanged.

Commit:

```text
Add observable prepare-update shadow
```

### R4 deploy gate

Deploy without `--skip-n8n`, inspect shadow executions, perform the normal bot
smoke, and observe at least 24 hours before dark handler work. Stop before R5.

## Security Track: Rotate the Internal Secret

This track is separate from route promotion and can run after R4 verification.

### S1: Add dual-secret authentication

Modify:

- `apps/api/src/env.js`
- `apps/api/src/middleware/internal-api.js`
- `apps/api/test/app.test.js`
- env documentation/example files

Add optional `INTERNAL_API_SECRET_PREVIOUS`. Use timing-safe comparison against
the current and previous secret. Test current accepted, previous accepted,
invalid rejected, and no configured secret returning 404.

Commit and deploy API only. Stop and verify old workflows still authenticate.

### S2: Rotate workflow credentials

On the server:

1. Preserve the old value as `INTERNAL_API_SECRET_PREVIOUS` in `.env.api`.
2. Set a new `INTERNAL_API_SECRET` in `.env.api` and `.env.prod`.
3. Restart API with dual-secret support.
4. Render, import, and activate every workflow with the new value.
5. Verify all internal HTTP nodes.

No secret value is written to Git or command output.

### S3: Retire the old secret

Remove `INTERNAL_API_SECRET_PREVIOUS` from server env, deploy API, and verify old
credentials receive 401. Keep dual-secret code only if future rotations require
it; otherwise remove it in a separate code commit.

## R5: Dark `command.stats` Handler

Goal: deploy the complete queue and handler path with route flags disabled, so no
production update can enter it.

### Task 1: Add forward-only runtime tables

Create:

- `db/migrations/20260710120000_add_bot_update_runtime.sql`

Update:

- `db/schema.sql`

Add `bot_update_executions`:

- primary key `decision_id`
- unique `(bot_key, update_id)`
- route and handler version
- status, attempts, bounded terminal error code
- current pg-boss job ID and a finite execution lease timestamp
- created, updated, started, and completed timestamps

Add `bot_update_deliveries`:

- generated primary key
- foreign key to execution
- unique `(decision_id, step_key)`
- Telegram method and message ID
- `pending`, `delivered`, `failed`, or `unknown` status
- attempts and bounded error metadata
- created and updated timestamps

Run:

```bash
./scripts/db-schema.sh update
./scripts/db-schema.sh check
```

### Task 2: Add route flags and ingestion

Modify:

- `apps/api/src/env.js`
- `apps/api/src/routes/internal.js`

Create:

- `apps/api/src/bot-runtime/route-flags.ts`
- `apps/api/src/bot-runtime/ingestion-service.ts`

Add optional `BOT_RUNTIME_ROUTE_FLAGS_JSON`, mapping bot keys to enabled routes.
Default to no enabled routes. Invalid configuration fails startup.

Add `POST /internal/bot/ingest-update`. It accepts Contract v1, verifies that its
bot and route are enabled, and publishes a job with singleton key
`bot-update:<botKey>:<updateId>`. Return:

- 202 `{ accepted: true, duplicate: false, jobId }` after durable insert
- 202 `{ accepted: true, duplicate: true }` for singleton conflict
- 409 `{ accepted: false, error: "route_not_enabled" }` while dark
- 400 for invalid Contract v1
- 500 for enqueue failure

### Task 3: Add queue registration and worker boundary

Modify:

- `apps/api/src/queue.js`
- `apps/api/src/worker.js`

Create:

- `apps/api/src/bot-runtime/register-worker.ts`
- `apps/api/src/bot-runtime/execution-repository.ts`
- `apps/api/src/bot-runtime/delivery-repository.ts`
- `apps/api/src/bot-runtime/handler-registry.ts`

Register `bot-update-process` with bounded retry and backoff. Keep bot runtime
worker registration outside the existing large `jobs.js` file.

On execution:

1. Atomically claim `bot_update_executions` using decision ID and pg-boss job ID.
2. A missing row is inserted as `running` with a finite lease.
3. A `succeeded` row returns a successful duplicate no-op.
4. A `running` row owned by another unexpired job returns an in-progress
   duplicate no-op.
5. The same pg-boss job ID, a retryable-failed row, or an expired lease may
   reclaim execution and increment attempts.
6. Resolve an enabled typed handler.
7. Record `succeeded`, `retryable_failed`, or `permanent_failed` with a bounded
   error code.

Test the claim operation with concurrent transactions so two different job IDs
cannot both receive `claimed` for one decision.

### Task 4: Extract the stats vertical slice

Create:

- `apps/api/src/bot-runtime/handlers/stats.ts`
- `apps/api/src/bot-runtime/stats-context.ts`
- `apps/api/src/bot-runtime/stats-message.ts`

Port the current n8n stats query and localized message exactly. Keep formatting a
pure function. Load current plan and usage in the worker rather than trusting the
route-time snapshot.

Before Telegram delivery, create or load the unique delivery record for
`stats-message:v1`. A delivered record returns success without sending. A new
record calls the existing Telegram client, stores Telegram message ID, and marks
the execution successful. An ambiguous timeout records `unknown` and is not
automatically resent.

### Task 5: Test the dark runtime

Create focused tests for:

- route flag parsing and startup validation
- ingestion disabled by default
- Contract v1 validation
- singleton conflict treated as accepted duplicate
- execution duplicate no-op
- free and pro stats formatting
- delivery status transitions
- ambiguous timeout classification
- worker retryable versus permanent errors

Run API tests, typecheck, build, Docker build, and DB schema check.

Commit migrations, schema, runtime, and tests together because the dark handler
cannot run safely without its tables:

```text
Add dark stats bot handler
```

### R5 deploy gate

Deploy migrations and API/worker with `BOT_RUNTIME_ROUTE_FLAGS_JSON` unset. Verify
the ingestion endpoint returns `route_not_enabled`, queue registration succeeds,
and no production Telegram message is sent by the new handler. Stop before R6.

## R6: `command.stats` Canary

Goal: move one bot's stats route while every failure before acceptance still
falls back to legacy.

### Task 1: Make preparation ordered

Modify `deploy/workflows/ai-bot.json` so `Create User` calls Prepare Update before
the existing `Get plan data` and `Get User Data` fan-out. Keep
`continueOnFail: true`. Existing named-node expressions must continue receiving
the same inputs.

### Task 2: Add migration dispatch

Modify both:

- `deploy/workflows/ai-bot.json`
- `scripts/render-n8n-workflows.py`

After persistent-keyboard tracking and before `Is /[command]`, add:

1. a Switch reading the prepared route
2. one `command.stats` output to `POST /internal/bot/ingest-update`
3. a default output to the current `Is /[command]`
4. an acceptance check after ingestion
5. accepted=true ends n8n processing
6. any non-accepted response or HTTP failure returns to `Is /[command]`

The fallback path therefore reaches the existing `/stats` branch.
The renderer injects the internal API base URL and secret into the ingestion
HTTP node and fails if either remains unresolved.

### Task 3: Configure one canary bot

Set server `BOT_RUNTIME_ROUTE_FLAGS_JSON` so only one bot enables
`command.stats`. Other bots receive `route_not_enabled` and use legacy.

Use a dedicated canary bot when available. Do not enable every production bot in
the first deploy.

### Task 4: Verify canary and rollback

Before deploy, render all 15 workflows and verify graph connections. In
production test:

- normal `/stats`
- duplicate Telegram update
- API unavailable before preparation
- enqueue failure before acceptance
- worker transient retry after acceptance
- confirmed Telegram delivery
- ambiguous delivery test using a fake dependency outside production

Immediate rollback is setting route flags to empty and restarting API, causing
all stats updates to fall back. Structural rollback removes the Switch case and
reimports workflows.

Keep one bot enabled for at least 24 hours and 20 successful invocations with
zero parity mismatches before expansion.

Commit:

```text
Route stats through bot runtime canary
```

### R6 stop gate

Do not promote another route until the user confirms canary metrics and has
exercised the rollback once.

## R7+: Route-by-Route Expansion

For each route:

1. Add branch-level legacy parity telemetry.
2. Implement and test the typed handler in dark mode.
3. Deploy with route flags disabled.
4. Observe shadow parity for at least 24 hours and 20 observations.
5. Enable one canary bot.
6. Exercise immediate rollback.
7. Expand bot coverage.
8. Remove the legacy branch only during final cleanup.

Promotion order:

1. `command.xp`, topic menu, level menu, and voice menu
2. level, reply mode, feedback, and topic state transitions
3. callbacks
4. text conversation
5. voice, STT, and TTS conversation

Each promoted route receives its own local commit and deploy gate unless two
routes share one indivisible persistence operation.

## Final Cleanup

After all business routes are stable and fallback traffic has been zero for
seven days:

1. Export and tag the last legacy workflow.
2. Remove the command and callback routing chains.
3. Remove duplicate persistent-keyboard Code nodes and SQL reads.
4. Remove migration Switch fallback branches.
5. Render and verify all 15 workflows.
6. Deploy cleanup without destructive DB changes.

The final workflow retains only Telegram ingress, credentials, the runtime call,
and operational error handling.
