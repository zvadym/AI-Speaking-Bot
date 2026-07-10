import type { Pool } from 'pg';

interface StatsContextRow extends Record<string, unknown> {
  tier: unknown;
  plan_expires_at: unknown;
  plan_autorenew: unknown;
  pending_plan_tier: unknown;
  pending_plan_effective_at: unknown;
  limit_period: unknown;
  limit_seconds: unknown;
  used_seconds: unknown;
  remaining_seconds: unknown;
  limit_reached: unknown;
}

export interface StatsContext {
  tier: string;
  planExpiresOn: string | null;
  planAutorenew: boolean;
  pendingPlanTier: string | null;
  pendingPlanEffectiveOn: string | null;
  limitPeriod: string;
  limitSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  limitReached: boolean;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export async function loadStatsContext(pool: Pool, chatId: number): Promise<StatsContext> {
  const { rows } = await pool.query<StatsContextRow>(
    `WITH u AS (
       SELECT
         chat_id,
         COALESCE(plan_tier, 'free') AS plan_tier,
         plan_expires_at,
         COALESCE(plan_autorenew, false) AS plan_autorenew,
         pending_plan_tier,
         pending_plan_effective_at,
         override_plan_tier,
         override_expires_at
       FROM users
       WHERE chat_id = $1
       LIMIT 1
     ),
     effective AS (
       SELECT
         chat_id,
         plan_expires_at,
         plan_autorenew,
         pending_plan_tier,
         pending_plan_effective_at,
         CASE
           WHEN override_plan_tier IS NOT NULL
             AND override_expires_at IS NOT NULL
             AND NOW() < override_expires_at
             THEN override_plan_tier
           WHEN plan_expires_at IS NOT NULL AND NOW() < plan_expires_at
             THEN plan_tier
           ELSE 'free'
         END AS effective_tier
       FROM u
     ),
     p AS (
       SELECT
         voice_seconds_limit AS limit_seconds,
         voice_limit_period AS limit_period
       FROM plans
       WHERE tier = (SELECT effective_tier FROM effective)
       LIMIT 1
     ),
     usage AS (
       SELECT
         COALESCE(SUM(uh.in_voice_seconds + uh.out_voice_seconds), 0)::int AS used_seconds
       FROM usage_hourly uh
       WHERE uh.chat_id = (SELECT chat_id FROM effective)
         AND (
           COALESCE((SELECT limit_period FROM p), 'lifetime') <> 'month'
           OR uh.hour_start >= date_trunc('month', NOW())
         )
     )
     SELECT
       (SELECT effective_tier FROM effective) AS tier,
       (SELECT plan_expires_at FROM effective) AS plan_expires_at,
       (SELECT plan_autorenew FROM effective) AS plan_autorenew,
       (SELECT pending_plan_tier FROM effective) AS pending_plan_tier,
       (SELECT pending_plan_effective_at FROM effective) AS pending_plan_effective_at,
       COALESCE((SELECT limit_period FROM p), 'lifetime') AS limit_period,
       COALESCE((SELECT limit_seconds FROM p), 0) AS limit_seconds,
       COALESCE((SELECT used_seconds FROM usage), 0) AS used_seconds,
       GREATEST(
         COALESCE((SELECT limit_seconds FROM p), 0) -
         COALESCE((SELECT used_seconds FROM usage), 0),
         0
       ) AS remaining_seconds,
       (
         COALESCE((SELECT limit_seconds FROM p), 0) > 0 AND
         COALESCE((SELECT used_seconds FROM usage), 0) >=
         COALESCE((SELECT limit_seconds FROM p), 0)
       ) AS limit_reached`,
    [chatId]
  );
  const row = rows[0] || {} as StatsContextRow;

  return {
    tier: String(row.tier || 'free').trim().toLowerCase() || 'free',
    planExpiresOn: dateOnly(row.plan_expires_at),
    planAutorenew: row.plan_autorenew === true,
    pendingPlanTier: row.pending_plan_tier
      ? String(row.pending_plan_tier).trim().toLowerCase()
      : null,
    pendingPlanEffectiveOn: dateOnly(row.pending_plan_effective_at),
    limitPeriod: String(row.limit_period || 'lifetime').trim() || 'lifetime',
    limitSeconds: finiteNumber(row.limit_seconds),
    usedSeconds: finiteNumber(row.used_seconds),
    remainingSeconds: finiteNumber(row.remaining_seconds),
    limitReached: row.limit_reached === true
  };
}
