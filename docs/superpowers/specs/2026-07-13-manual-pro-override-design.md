# Manual PRO override in the internal dashboard

## Goal

Allow an administrator to grant, extend, or revoke temporary PRO access from the internal dashboard's `Users` tab. Every manual grant must have an explicit end date.

## Scope

- Reuse the existing `users.override_plan_tier` and `users.override_expires_at` columns.
- Add authenticated admin API operations for granting and revoking the override.
- Show the effective tier source and manual expiry in the user directory.
- Add controls for granting PRO, changing its expiry, and revoking it.
- Add API coverage and verify the mini-app production build.

No database migration, Stripe mutation, payment record, notification, or new audit table is included.

## Entitlement behavior

- A grant always writes `override_plan_tier = 'pro'` and a non-null `override_expires_at`.
- The submitted date uses the dashboard's UTC convention and is inclusive. For an `expires_on` value of `2026-07-31`, the API stores `2026-08-01T00:00:00.000Z`.
- The API accepts today when the resulting stored instant is still in the future; past or already elapsed dates are rejected.
- While the override is active, the effective tier is PRO for the user's global `chat_id`, so it applies across all bots.
- Revocation clears only `override_plan_tier` and `override_expires_at`.
- After revocation or expiry, existing entitlement precedence applies: an active paid plan remains effective; otherwise the user is free.
- Manual changes do not create, update, or cancel anything in Stripe.

## Admin API

### Grant or change expiry

`PUT /admin/users/:chatId/plan-override`

Request body:

```json
{
  "tier": "pro",
  "expires_on": "2026-07-31"
}
```

Validation:

- `chatId` must be a valid positive Telegram chat ID.
- The user must exist.
- `tier` must be exactly `pro`.
- `expires_on` must be a real `YYYY-MM-DD` UTC calendar date whose exclusive upper bound is in the future.

The response returns the user ID, override tier, stored expiry timestamp, inclusive expiry date, effective tier, and effective tier source. The route requires the existing admin password middleware and disables caching.

### Revoke

`DELETE /admin/users/:chatId/plan-override`

The route validates the user, clears the override fields, and returns the resulting effective tier and source. Revoking when no active override exists is idempotent for an existing user.

### Directory response

`GET /admin/users` continues to return the effective tier and additionally returns:

- `tier_source`: `manual`, `subscription`, or `free`;
- `override_expires_at`: the stored exclusive UTC timestamp when a manual override is active;
- `override_expires_on`: the corresponding inclusive UTC calendar date when a manual override is active.

Expired override metadata is not presented as active manual access.

## Users interface

- The `Tier` cell shows the effective tier plus a compact source label.
- An active manual override also shows `until YYYY-MM-DD`.
- The actions cell shows:
  - `Grant PRO` when no manual override is active;
  - `Change expiry` and `Revoke` when manual PRO is active;
  - the existing destructive `Delete` action.
- Granting or changing expiry opens a focused modal with the user identity, an accessible required date input, the UTC/inclusive-date explanation, cancel, and submit actions.
- Changing expiry pre-fills the current inclusive expiry date.
- Revoke uses a confirmation prompt that explains the fallback to the user's underlying plan.
- Mutations disable competing actions for that user, show success or error feedback, and refresh the current users page without resetting pagination or filters.

The controls will follow the existing dashboard's restrained utilitarian visual language rather than introducing a new page-level aesthetic.

## Error handling

- Invalid input returns HTTP 400 with a stable error code.
- A missing user returns HTTP 404 with `user_not_found`.
- Unexpected database failures flow to the existing final error handler.
- The UI preserves the open grant modal after a recoverable API error so the administrator can correct the date and retry.

## Verification

API tests cover:

- granting PRO with an inclusive UTC end date;
- updating an existing override expiry;
- rejecting malformed, impossible, and elapsed dates;
- returning 404 for a missing user;
- revoking an override and exposing the underlying paid tier;
- idempotent revocation for an existing user;
- directory source and expiry fields.

Implementation verification runs the relevant API tests, the full API test suite if practical, and the mini-app production build.
