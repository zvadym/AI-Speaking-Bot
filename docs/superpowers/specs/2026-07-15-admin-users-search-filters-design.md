# Admin Users Search and Filters

## Problem

The `_internal-dashboard` Users directory currently filters primarily by the
shared created-at date range and acquisition payload. Administrators cannot
search the full directory or narrow users by bot, effective plan tier, active
state, or last activity. Client-side filtering would be incorrect because the
directory uses server-side pagination.

## Goals

- Search the complete user directory by Telegram username, first name, or chat
  ID.
- Filter by bot, current effective tier, active state, created date, and last
  seen date.
- Preserve server-side sorting, totals, and pagination under every combination
  of filters.
- Make multi-bot filtering reflect the selected bot instead of only the user's
  most recently used bot.
- Keep the existing acquisition-payload filter and user actions.

## API Design

`GET /admin/users` remains the single directory endpoint and accepts these
additional query parameters:

- `q`: case-insensitive username or first-name substring, or full/partial chat
  ID. One leading `@` is ignored and the normalized query is bounded to 80
  characters.
- `bot_key`: one configured bot key.
- `tier`: `free` or `pro`, evaluated from the user's current effective tier.
- `active`: `true` or `false`.
- `last_seen_from`: optional inclusive UTC date.
- `last_seen_to`: optional inclusive UTC date, converted internally to an
  exclusive next-day boundary.

The existing `from` and `to` parameters continue to filter `users.created_at`,
and the existing acquisition payload remains supported.

All filters apply to both the count query and the page query. Sorting and
pagination therefore operate on the complete filtered result set.

### Multi-bot Semantics

When `bot_key` is selected, a user matches if any `user_bots` row has that key.
The returned `bot_key`, `last_seen_at`, and `is_active` values come from that
selected row. Active and last-seen filters are evaluated in the same bot
context.

Without `bot_key`, the returned bot remains the user's most recently active bot,
the user is active when at least one linked bot is active, and last seen is the
latest linked-bot activity.

## Dashboard Design

The Users filter panel contains:

- A prominent `Search users` field with placeholder `@username, name or chat
  ID`.
- Compact `Bot`, `Tier`, and `Active` selects.
- The existing date-range controls labelled `Created date`.
- Optional `Last seen` From and To date fields.
- `Apply` and `Clear all` actions.

Search is debounced by 300 ms and runs immediately on Enter. Applying any
changed filter resets pagination to the first page. `Refresh users` repeats the
current query without resetting filter state.

Applied conditions appear as removable query chips. Removing a chip reapplies
the remaining filters and resets pagination. On narrow screens, controls stack
vertically while the existing table remains horizontally scrollable.

If no rows match, the empty state reads `No users match the current filters`
and offers a clear-filters action.

## State and Data Flow

Draft filter state is kept separately from applied filter state so date and
select edits do not send partially configured requests. `Apply` copies the
validated draft into the applied state and refreshes offset zero. Debounced
search updates its applied value independently while preserving the other
applied filters.

Each users request receives a monotonically increasing request ID. Only the
latest request may update rows, total, timestamp, or error state, preventing an
older search response from overwriting a newer one. Existing rows remain
visible during refresh with a loading state.

## Validation and Errors

- API query values are normalized and passed as SQL parameters.
- Bot keys are checked against configured bots.
- Tier and active values use explicit allowlists.
- Date values must be real `YYYY-MM-DD` UTC dates, and From cannot be later than
  To.
- Invalid filters return HTTP 400 with a specific error code.
- The UI blocks Apply for an inverted Last seen range and displays the API error
  without discarding the previous successful page.

## Verification

API regression tests cover:

- username, name, and chat-ID search;
- bot, tier, active, created-at, and last-seen filters;
- a combined filtered request;
- selected-bot versus all-bot active and last-seen semantics;
- filtered count, sorting, and pagination parameters;
- invalid bot, enum, and date values.

Frontend verification covers query serialization, pagination reset, stale
response protection, chip removal, clear-all behavior, and invalid date state
where practical in the existing test setup. The final checks are the complete
API test suite and the miniapp production build.

