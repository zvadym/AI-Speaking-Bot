# Admin Dashboard Updates - Multi-Bot Support

## Summary

Added bot-specific statistics and charts to the admin dashboard to track per-bot usage and engagement.

## Changes Made ✅

### 1. New API Endpoints (in `apps/api/src/server.js`)

#### `/admin/metrics/bot-stats` (NEW)
Returns real-time statistics per bot from the `bot_stats` view.

**Response:**
```json
{
  "bots": [
    {
      "bot_key": "uk-de",
      "total_users": 1250,
      "active_users": 892,
      "users_last_7_days": 345,
      "users_last_30_days": 678,
      "new_users_7_days": 89,
      "new_users_30_days": 234,
      "first_user_at": "2025-01-15T10:23:45Z",
      "last_activity_at": "2026-02-09T14:32:10Z"
    },
    {
      "bot_key": "uk-en",
      "total_users": 843,
      "active_users": 521,
      ...
    }
  ]
}
```

**Usage:**
```bash
GET /admin/metrics/bot-stats
Headers: X-Admin-Password: <password>
```

---

#### `/admin/metrics/active-users-by-day-by-bot` (NEW)
Returns daily active users split by bot for the specified date range.

**Response:**
```json
{
  "tz": "UTC",
  "from": "2026-01-10T00:00:00.000Z",
  "to": "2026-02-10T00:00:00.000Z",
  "payload": null,
  "series": [
    { "day": "2026-01-10", "bot_key": "uk-de", "count": 67 },
    { "day": "2026-01-10", "bot_key": "uk-en", "count": 45 },
    { "day": "2026-01-11", "bot_key": "uk-de", "count": 71 },
    { "day": "2026-01-11", "bot_key": "uk-en", "count": 52 },
    ...
  ]
}
```

**Usage:**
```bash
GET /admin/metrics/active-users-by-day-by-bot?from=2026-01-01&to=2026-02-01
Headers: X-Admin-Password: <password>
```

**Query Parameters:**
- `from` - Start date (UTC, YYYY-MM-DD)
- `to` - End date (UTC, YYYY-MM-DD, exclusive)
- `payload` - Optional acquisition payload filter

---

### 2. Frontend Changes (in `apps/miniapp/src/screens/AdminDashboardScreen.vue`)

#### New Bot Statistics Cards

Added a new section showing per-bot metrics:
- Total users per bot
- Active users per bot
- Users active in last 7 days
- Users active in last 30 days

**Visual:**
```
┌─────────────────────────────────────────┐
│ BOT STATISTICS                          │
│                                         │
│ ┌──────────┐  ┌──────────┐            │
│ │ uk-de    │  │ uk-en    │            │
│ │ 1250 users│  │ 843 users│            │
│ │          │  │          │            │
│ │ Active: 892│ │ Active: 521│         │
│ │ Last 7d: 345│ │ Last 7d: 201│       │
│ │ Last 30d: 678│ │ Last 30d: 412│     │
│ └──────────┘  └──────────┘            │
└─────────────────────────────────────────┘
```

#### New Stacked Bar Chart

Added **"Active users by day by bot"** chart after the existing "Active users by day" chart.

**Features:**
- Stacked bar chart showing daily active users split by bot
- Different color per bot (uk-en = teal, uk-de = orange)
- Legend automatically generated based on available bots
- Uses existing `AdminChart` component (already supports stacking)

**Visual:**
```
Active users by day by bot
┌─────────────────────────────────────────┐
│         ███ ← uk-en (teal)              │
│     ███ ███ ███                         │
│ ███ ███ ███ ███                         │
│ ███ ███ ███ ███ ← uk-de (orange)       │
│ ███ ███ ███ ███                         │
└─────────────────────────────────────────┘
 Day1 Day2 Day3 Day4
```

#### Data Transformation Function

Added `transformByBotData()` helper function:
```javascript
// Transforms API response from:
[
  { day: '2026-02-01', bot_key: 'uk-de', count: 67 },
  { day: '2026-02-01', bot_key: 'uk-en', count: 45 },
  ...
]

// Into chart-ready format:
[
  { day: '2026-02-01', uk_de: 67, uk_en: 45 },
  { day: '2026-02-02', uk_de: 71, uk_en: 52 },
  ...
]
```

**Features:**
- Converts `bot-key` to `bot_key` (valid JS property)
- Dynamically discovers available bots
- Generates series config with appropriate colors
- Handles missing data gracefully

---

### 3. Bot Color Scheme

Default colors for bots:
- **uk-en** (English): `rgba(31, 107, 99, 0.88)` - Teal/green
- **uk-de** (German): `rgba(199, 90, 36, 0.88)` - Orange/rust
- **Other bots**: `rgba(100, 100, 100, 0.85)` - Gray (fallback)

Colors can be customized in the `transformByBotData()` function.

---

## UI Flow

### Before (Single Bot)
```
┌─────────────────────────┐
│ Total Users: 1250       │
│ Pro: 60                 │
└─────────────────────────┘
│ Active users by day     │ ← Single bar per day
```

### After (Multi-Bot)
```
┌─────────────────────────┐
│ Total Users: 2093       │
│ Pro: 98                 │
└─────────────────────────┘
┌─────────────────────────┐
│ BOT STATISTICS          │
│ uk-de: 1250  uk-en: 843 │
│ Active: 892  Active: 521│
└─────────────────────────┘
│ Active users by day     │ ← Total (combined)
│ Active by day by bot    │ ← Split by bot (stacked)
```

---

## Data Sources

All metrics pull from:
- **`user_bots` table** - Per-bot user relationships and activity
- **`voice_usage_events` table** - Per-bot usage events (with `bot_key` column)
- **`bot_stats` view** - Precomputed bot statistics
- **`users` table** - User identity and billing (still global)

---

## Testing Checklist

### API Endpoints
- [ ] Test `/admin/metrics/bot-stats` returns data
- [ ] Test `/admin/metrics/active-users-by-day-by-bot` with date range
- [ ] Test with `payload` filter parameter
- [ ] Verify data matches database queries

### Frontend
- [ ] Bot statistics cards display correctly
- [ ] Stacked bar chart renders properly
- [ ] Legend shows all bots with correct colors
- [ ] Chart updates when date range changes
- [ ] Works with only one bot (uk-de)
- [ ] Works with multiple bots (uk-de + uk-en)
- [ ] Responsive design works on mobile

### Database Queries
```sql
-- Verify bot stats
SELECT * FROM bot_stats;

-- Verify daily data
SELECT 
  date_trunc('day', occurred_at)::date as day,
  bot_key,
  COUNT(DISTINCT chat_id) as dau
FROM voice_usage_events
WHERE occurred_at >= NOW() - INTERVAL '7 days'
GROUP BY day, bot_key
ORDER BY day, bot_key;
```

---

## Example Scenarios

### Scenario 1: Only uk-de Bot Active
**Bot Stats:**
```
uk-de: 1250 users
  Active: 892
  Last 7d: 345
```

**Chart:**
- Shows only uk-de bars (orange)
- Legend shows only uk-de

### Scenario 2: Both Bots Active
**Bot Stats:**
```
uk-de: 1250 users          uk-en: 843 users
  Active: 892               Active: 521
  Last 7d: 345              Last 7d: 201
```

**Chart:**
- Each day shows stacked bar (orange bottom, teal top)
- Legend shows both uk-de and uk-en
- Total height = uk-de + uk-en users for that day

### Scenario 3: User Uses Both Bots Same Day
**Data:**
- User #12345 sends voice to uk-de bot → counted in uk-de
- User #12345 sends voice to uk-en bot → counted in uk-en
- Chart shows both contributions (user counted in both)

**SQL behavior:**
```sql
-- User is counted separately per bot
SELECT bot_key, COUNT(DISTINCT chat_id)
FROM voice_usage_events
WHERE chat_id = 12345 AND occurred_at::date = '2026-02-09'
GROUP BY bot_key;

-- Result:
-- bot_key | count
-- uk-de   | 1      ← same user
-- uk-en   | 1      ← same user
```

This is correct behavior - we want to track **bot engagement**, not unique users.

---

## Future Enhancements

### Add More Charts
- **New users by day by bot** - Which bot is growing faster?
- **Usage seconds by day by bot** - Which bot gets more voice time?
- **Retention by bot** - Which bot keeps users engaged longer?

### Add Filters
- **Bot selector dropdown** - Filter all charts by specific bot
- **Compare mode** - Show uk-en vs uk-de side-by-side

### Add Bot Comparison Table
```
┌────────────────────────────────────────────────┐
│ Bot      │ Users │ Active │ DAU (7d) │ Growth  │
├────────────────────────────────────────────────┤
│ uk-de    │ 1250  │ 892    │ 345      │ +12.4%  │
│ uk-en    │ 843   │ 521    │ 201      │ +8.7%   │
└────────────────────────────────────────────────┘
```

---

## Technical Notes

### Data Aggregation Strategy

The chart aggregates data at the **bot-user-day** level:
- Primary key: `(chat_id, bot_key, day)`
- A user can be counted in multiple bots on the same day
- This measures bot engagement, not unique user reach

### Performance Considerations

- `bot_stats` view is a materialized query (computed on demand)
- For large datasets, consider caching or materialized views
- Current implementation uses database indexes effectively
- Chart data is limited by date range (recommend max 90 days)

### Color Accessibility

Current colors have sufficient contrast:
- Teal (#1f6b63): WCAG AA compliant
- Orange (#c75a24): WCAG AA compliant
- Text labels ensure accessibility

---

## Deployment Steps

1. **Deploy database migration** (creates user_bots, extends usage tables)
2. **Deploy API changes** (new endpoints)
3. **Deploy miniapp changes** (new charts)
4. **Test with existing uk-de bot**
5. **Add uk-en bot** and verify stacked chart appears
6. **Monitor for errors** in production

---

## Rollback Plan

If issues occur:
1. Frontend gracefully handles empty `botStats` array (section won't render)
2. If API endpoint fails, chart shows "No data"
3. Can temporarily hide new section via CSS if needed
4. Database views can be dropped without breaking existing functionality

---

## Success Metrics

After deployment, verify:
- ✅ Bot stats cards appear with correct numbers
- ✅ Stacked chart shows multiple colors when multiple bots active
- ✅ Chart updates when date range changes
- ✅ Data matches database queries
- ✅ No performance degradation on dashboard load
