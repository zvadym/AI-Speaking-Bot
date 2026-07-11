import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { loadEntitlementContext } from '../src/bot-runtime/entitlement-context.js';

function poolReturning(row: Record<string, unknown>, inspectSql?: (sql: string) => void): Pool {
  return {
    async query(sql: string, params: unknown[]) {
      inspectSql?.(sql);
      assert.deepEqual(params, [42]);
      return { rows: [row] };
    }
  } as unknown as Pool;
}

const validRow = {
  user_found: true,
  plan_found: true,
  tier: 'free',
  plan_expires_at: null,
  plan_autorenew: false,
  pending_plan_tier: null,
  pending_plan_effective_at: null,
  limit_period: 'lifetime',
  limit_seconds: 240,
  used_seconds: 241,
  remaining_seconds: 0,
  limit_reached: true
};

test('entitlement context calculates one global quota across every bot', async () => {
  const context = await loadEntitlementContext(
    poolReturning(validRow, (sql) => {
      assert.match(sql, /FROM usage_hourly uh/);
      assert.match(sql, /WHERE uh\.chat_id =/);
      assert.doesNotMatch(sql, /uh\.bot_key/);
      assert.match(sql, /date_trunc\('month', NOW\(\)\)/);
      assert.match(sql, /override_expires_at/);
      assert.match(sql, /plan_expires_at/);
    }),
    42
  );

  assert.deepEqual(context, {
    tier: 'free',
    planExpiresOn: null,
    planAutorenew: false,
    pendingPlanTier: null,
    pendingPlanEffectiveOn: null,
    limitPeriod: 'lifetime',
    limitSeconds: 240,
    usedSeconds: 241,
    remainingSeconds: 0,
    limitReached: true
  });
});

test('entitlement context preserves paid plan metadata and monthly quota', async () => {
  const context = await loadEntitlementContext(poolReturning({
    ...validRow,
    tier: 'pro',
    plan_expires_at: new Date('2026-08-10T12:00:00Z'),
    plan_autorenew: true,
    pending_plan_tier: 'free',
    pending_plan_effective_at: new Date('2026-08-11T00:00:00Z'),
    limit_period: 'month',
    limit_seconds: 72000,
    used_seconds: 120,
    remaining_seconds: 71880,
    limit_reached: false
  }), 42);

  assert.equal(context.tier, 'pro');
  assert.equal(context.planExpiresOn, '2026-08-10');
  assert.equal(context.planAutorenew, true);
  assert.equal(context.pendingPlanTier, 'free');
  assert.equal(context.pendingPlanEffectiveOn, '2026-08-11');
  assert.equal(context.limitPeriod, 'month');
  assert.equal(context.limitReached, false);
});

test('entitlement context fails closed for missing or invalid plan data', async () => {
  await assert.rejects(
    loadEntitlementContext(poolReturning({ ...validRow, plan_found: false }), 42),
    /entitlement_plan_missing/
  );
  await assert.rejects(
    loadEntitlementContext(poolReturning({ ...validRow, limit_seconds: 0 }), 42),
    /entitlement_limit_seconds_invalid/
  );
  await assert.rejects(
    loadEntitlementContext(poolReturning({ ...validRow, limit_period: 'week' }), 42),
    /entitlement_limit_period_invalid/
  );
});
