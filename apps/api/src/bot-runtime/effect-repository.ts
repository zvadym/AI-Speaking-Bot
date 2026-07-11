import type { Pool, PoolClient } from 'pg';

type EffectResult = Record<string, unknown>;

interface EffectRow extends Record<string, unknown> {
  id: string;
  status: string;
  result_json: unknown;
}

export interface BotUpdateEffectResult<T extends EffectResult> {
  duplicate: boolean;
  result: T;
}

function normalizeStepKey(value: unknown): string {
  const stepKey = String(value || '').trim();
  if (!stepKey || stepKey.length > 96) throw new Error('invalid_effect_step_key');
  return stepKey;
}

function normalizeResult<T extends EffectResult>(value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_effect_result');
  }
  return value as T;
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction failure.
  }
}

export async function runBotUpdateEffect<T extends EffectResult>(
  pool: Pool,
  {
    decisionId,
    stepKey: rawStepKey,
    execute
  }: {
    decisionId: string;
    stepKey: string;
    execute(client: PoolClient): Promise<T>;
  }
): Promise<BotUpdateEffectResult<T>> {
  const stepKey = normalizeStepKey(rawStepKey);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bot_update_effects (decision_id, step_key, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (decision_id, step_key) DO NOTHING
       RETURNING id::text`,
      [decisionId, stepKey]
    );
    const selected = await client.query<EffectRow>(
      `SELECT id::text, status, result_json
       FROM bot_update_effects
       WHERE decision_id = $1
         AND step_key = $2
       FOR UPDATE`,
      [decisionId, stepKey]
    );
    const row = selected.rows[0];
    if (!row) throw new Error('effect_conflict_without_row');

    if (!inserted.rows[0] && row.status === 'completed') {
      const result = normalizeResult<T>(row.result_json);
      await client.query('COMMIT');
      return { duplicate: true, result };
    }
    if (row.status !== 'pending') throw new Error('invalid_effect_status');

    const result = normalizeResult<T>(await execute(client));
    const completed = await client.query(
      `UPDATE bot_update_effects
       SET status = 'completed',
           result_json = $2::jsonb,
           updated_at = NOW()
       WHERE id = $1::bigint
         AND status = 'pending'`,
      [row.id, JSON.stringify(result)]
    );
    if (completed.rowCount !== 1) throw new Error('effect_state_conflict');
    await client.query('COMMIT');
    return { duplicate: false, result };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}
