# Admin Users Created Date ALL

## Goal

Make `ALL` the default Created date selection on the admin Users page so the
initial directory query includes users from the complete history.

## Dashboard Design

- The Users Created date presets start with `ALL`, followed by the existing
  rolling and calendar ranges plus Custom.
- Users date state is independent from the shared Analytics date state.
- `ALL` is selected on initial load, after `Clear all`, and after removing the
  Created query chip.
- The range summary and Current query chip display `ALL` clearly.
- When `ALL` is applied, the Users request omits `from` and `to`. Explicit
  presets and Custom continue sending inclusive/exclusive UTC boundaries.

## API Contract

For `GET /admin/users` only:

- Neither `from` nor `to` means no created-at constraint.
- An explicit date range keeps the existing validation and 400-day limit.
- All-time mode returns `from: null` and `to: null`.
- Search, bot, tier, active, last-seen, sorting, count, and pagination semantics
  are unchanged.
- Streak aggregation uses all available activity in all-time mode and the
  selected window when a Created date range is applied.

## Verification

- API tests cover omitted `from/to` and assert nullable SQL parameters,
  optional created/activity predicates, and null range metadata.
- Existing explicit-range and combined-filter tests remain green.
- Miniapp production build succeeds.
- Browser or bundle verification confirms `ALL` is the first and default Users
  Created date option.
- Production deployment must finish with healthy API/app endpoints and running
  application containers.
