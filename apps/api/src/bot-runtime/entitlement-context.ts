import type { Pool } from 'pg';

interface EntitlementContextRow extends Record<string, unknown> {
  user_found: unknown;
  plan_found: unknown;
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

export interface EntitlementContext {
  tier: string;
  planExpiresOn: string | null;
  planAutorenew: boolean;
  pendingPlanTier: string | null;
  pendingPlanEffectiveOn: string | null;
  limitPeriod: 'lifetime' | 'month';
  limitSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  limitReached: boolean;
}

function finiteNonNegativeNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`entitlement_${field}_invalid`);
  }
  return parsed;
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error('entitlement_date_invalid');
  return date.toISOString().slice(0, 10);
}

export async function loadEntitlementContext(
  pool: Pool,
  chatId: number
): Promise<EntitlementContext> {
  if (!Number.isSafeInteger(chatId) || chatId <= 0) {
    throw new Error('entitlement_chat_id_invalid');
  }

  const { rows } = await pool.query<EntitlementContextRow>(
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
           (SELECT limit_period FROM p) <> 'month'
           OR uh.hour_start >= date_trunc('month', NOW())
         )
     )
     SELECT
       EXISTS(SELECT 1 FROM u) AS user_found,
       EXISTS(SELECT 1 FROM p) AS plan_found,
       (SELECT effective_tier FROM effective) AS tier,
       (SELECT plan_expires_at FROM effective) AS plan_expires_at,
       (SELECT plan_autorenew FROM effective) AS plan_autorenew,
       (SELECT pending_plan_tier FROM effective) AS pending_plan_tier,
       (SELECT pending_plan_effective_at FROM effective) AS pending_plan_effective_at,
       (SELECT limit_period FROM p) AS limit_period,
       (SELECT limit_seconds FROM p) AS limit_seconds,
       COALESCE((SELECT used_seconds FROM usage), 0) AS used_seconds,
       GREATEST(
         (SELECT limit_seconds FROM p) -
         COALESCE((SELECT used_seconds FROM usage), 0),
         0
       ) AS remaining_seconds,
       (
         COALESCE((SELECT used_seconds FROM usage), 0) >=
         (SELECT limit_seconds FROM p)
       ) AS limit_reached`,
    [chatId]
  );
  const row = rows[0];
  if (!row || row.user_found !== true) throw new Error('entitlement_user_missing');
  if (row.plan_found !== true) throw new Error('entitlement_plan_missing');

  const tier = String(row.tier || '').trim().toLowerCase();
  if (!tier) throw new Error('entitlement_tier_invalid');
  const period = String(row.limit_period || '').trim().toLowerCase();
  if (period !== 'lifetime' && period !== 'month') {
    throw new Error('entitlement_limit_period_invalid');
  }
  const limitSeconds = finiteNonNegativeNumber(row.limit_seconds, 'limit_seconds');
  if (limitSeconds <= 0) throw new Error('entitlement_limit_seconds_invalid');
  const usedSeconds = finiteNonNegativeNumber(row.used_seconds, 'used_seconds');
  const remainingSeconds = finiteNonNegativeNumber(row.remaining_seconds, 'remaining_seconds');

  return {
    tier,
    planExpiresOn: dateOnly(row.plan_expires_at),
    planAutorenew: row.plan_autorenew === true,
    pendingPlanTier: row.pending_plan_tier
      ? String(row.pending_plan_tier).trim().toLowerCase()
      : null,
    pendingPlanEffectiveOn: dateOnly(row.pending_plan_effective_at),
    limitPeriod: period,
    limitSeconds,
    usedSeconds,
    remainingSeconds,
    limitReached: row.limit_reached === true || usedSeconds >= limitSeconds
  };
}
