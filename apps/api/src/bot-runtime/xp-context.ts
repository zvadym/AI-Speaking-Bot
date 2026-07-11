import type { Pool } from 'pg';

interface XpContextRow extends Record<string, unknown> {
  xp_total: unknown;
  streak_current: unknown;
  streak_best: unknown;
  level: unknown;
  xp_into_level: unknown;
  xp_per_level: unknown;
  xp_to_next: unknown;
  xp_daily_today: unknown;
  xp_daily_limit: unknown;
  xp_daily_remaining: unknown;
  streak_multiplier: unknown;
}

export interface XpContext {
  xpTotal: number;
  streakCurrent: number;
  streakBest: number;
  level: number;
  xpIntoLevel: number;
  xpPerLevel: number;
  xpToNext: number;
  xpDailyToday: number;
  xpDailyLimit: number;
  xpDailyRemaining: number;
  streakMultiplier: number;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function loadXpContext(
  pool: Pool,
  chatId: number,
  botKey: string
): Promise<XpContext> {
  const { rows } = await pool.query<XpContextRow>(
    `SELECT
       COALESCE(up.xp_total, 0)::int AS xp_total,
       COALESCE(up.streak_current, 0)::int AS streak_current,
       COALESCE(up.streak_best, 0)::int AS streak_best,
       FLOOR(COALESCE(up.xp_total, 0) / 200.0)::int + 1 AS level,
       MOD(COALESCE(up.xp_total, 0), 200)::int AS xp_into_level,
       200::int AS xp_per_level,
       CASE
         WHEN COALESCE(up.xp_total, 0) = 0 THEN 200
         ELSE 200 - MOD(COALESCE(up.xp_total, 0), 200)
       END AS xp_to_next,
       CASE
         WHEN up.xp_daily_date = (NOW() AT TIME ZONE 'UTC')::date
           THEN COALESCE(up.xp_daily, 0)
         ELSE 0
       END::int AS xp_daily_today,
       250::int AS xp_daily_limit,
       GREATEST(
         250 - CASE
           WHEN up.xp_daily_date = (NOW() AT TIME ZONE 'UTC')::date
             THEN COALESCE(up.xp_daily, 0)
           ELSE 0
         END,
         0
       )::int AS xp_daily_remaining,
       1.00::numeric(4,2) AS streak_multiplier
     FROM (SELECT 1) seed
     LEFT JOIN user_progress up
       ON up.chat_id = $1
      AND up.bot_key = $2
     LIMIT 1`,
    [chatId, botKey]
  );
  const row = rows[0] || {} as XpContextRow;

  return {
    xpTotal: finiteNumber(row.xp_total),
    streakCurrent: finiteNumber(row.streak_current),
    streakBest: finiteNumber(row.streak_best),
    level: finiteNumber(row.level, 1),
    xpIntoLevel: finiteNumber(row.xp_into_level),
    xpPerLevel: finiteNumber(row.xp_per_level, 200),
    xpToNext: finiteNumber(row.xp_to_next, 200),
    xpDailyToday: finiteNumber(row.xp_daily_today),
    xpDailyLimit: finiteNumber(row.xp_daily_limit, 250),
    xpDailyRemaining: finiteNumber(row.xp_daily_remaining, 250),
    streakMultiplier: finiteNumber(row.streak_multiplier, 1)
  };
}
