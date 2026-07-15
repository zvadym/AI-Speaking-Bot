# Admin User Deletion Fix

## Problem

`POST /admin/users/delete` fails in production because its transaction attempts
to delete from `usage_week`, a table removed by migration
`20260311120000_drop_unused_schema_fields.sql`. PostgreSQL aborts the transaction
with error `42P01`, so none of the user's records are deleted.

The endpoint's explicit table list also omits `llm_call_events`, which can contain
rows associated with a user's `chat_id`.

## Scope

- Keep the existing admin endpoint, request shape, confirmation UI, and response
  shape unchanged.
- Remove the obsolete `usage_week` deletion.
- Delete matching `llm_call_events` rows as part of the same transaction.
- Preserve all-or-nothing behavior: any genuine database error rolls back the
  complete deletion.
- Add regression coverage for the endpoint's current schema contract.
- Deploy the verified change and retry deletion of `@notarobot001` using chat ID
  `8719088547`.

## Implementation

The API will continue using an explicit allowlist of tables that own data keyed
by `chat_id`. The list will match the canonical schema: `usage_week` will be
removed and `llm_call_events` added before the parent `users` row is deleted.

An explicit list is preferred over dynamically skipping missing tables. A
missing expected table should remain an observable schema/code mismatch instead
of being silently ignored. A broader foreign-key cascade migration is outside
this bug fix because many historical event tables intentionally have no foreign
key to `users`.

## Error Handling

The existing transaction remains authoritative:

1. Begin a transaction.
2. Delete all matching child records from the explicit table list.
3. Delete `user_bots`, `user_summaries`, and the parent `users` row.
4. Commit only after every statement succeeds.
5. Roll back and return the existing API error path if any statement fails.

The endpoint continues returning `404 user_not_found` when no matching data is
deleted.

## Verification

- Add an API regression test that exercises the deletion route, verifies the
  removed table is never queried, verifies `llm_call_events` is included, and
  verifies commit/response behavior.
- Run the focused API test and the complete API test suite.
- Deploy through the existing remote deployment workflow and verify `/healthz`.
- Invoke the corrected deletion for chat ID `8719088547`, then query production
  to confirm the `users` row and all known `chat_id`-scoped records are absent.

