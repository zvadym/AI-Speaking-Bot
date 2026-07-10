import type { Pool, PoolClient } from 'pg';

export type DeliveryAttemptResult =
  | { action: 'send'; deliveryId: string; attempts: number }
  | { action: 'delivered'; deliveryId: string; telegramMessageId: number | null }
  | { action: 'unknown'; deliveryId: string; errorCode: string | null };

interface DeliveryRow extends Record<string, unknown> {
  id: string;
  telegram_method: string;
  telegram_message_id: string | number | null;
  status: string;
  attempts: number;
  error_code: string | null;
}

function boundedErrorCode(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .slice(0, 128);
  return normalized || 'unknown_error';
}

function boundedErrorDetail(value: unknown): string | null {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  return normalized || null;
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction error.
  }
}

export async function beginBotUpdateDelivery(
  pool: Pool,
  {
    decisionId,
    stepKey,
    telegramMethod
  }: { decisionId: string; stepKey: string; telegramMethod: string }
): Promise<DeliveryAttemptResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO bot_update_deliveries (
         decision_id,
         step_key,
         telegram_method,
         status,
         attempts
       )
       VALUES ($1, $2, $3, 'pending', 0)
       ON CONFLICT (decision_id, step_key) DO NOTHING`,
      [decisionId, stepKey, telegramMethod]
    );

    const selected = await client.query<DeliveryRow>(
      `SELECT
         id::text,
         telegram_method,
         telegram_message_id,
         status,
         attempts,
         error_code
       FROM bot_update_deliveries
       WHERE decision_id = $1
         AND step_key = $2
       FOR UPDATE`,
      [decisionId, stepKey]
    );
    const row = selected.rows[0];
    if (!row) throw new Error('delivery_conflict_without_row');
    if (row.telegram_method !== telegramMethod) throw new Error('delivery_identity_mismatch');

    if (row.status === 'delivered') {
      await client.query('COMMIT');
      return {
        action: 'delivered',
        deliveryId: row.id,
        telegramMessageId: row.telegram_message_id === null
          ? null
          : Number(row.telegram_message_id)
      };
    }
    if (row.status === 'unknown') {
      await client.query('COMMIT');
      return { action: 'unknown', deliveryId: row.id, errorCode: row.error_code };
    }
    if (row.status === 'pending' && Number(row.attempts) > 0) {
      await client.query(
        `UPDATE bot_update_deliveries
         SET status = 'unknown',
             error_code = 'previous_attempt_incomplete',
             error_detail = NULL,
             updated_at = NOW()
         WHERE id = $1::bigint`,
        [row.id]
      );
      await client.query('COMMIT');
      return {
        action: 'unknown',
        deliveryId: row.id,
        errorCode: 'previous_attempt_incomplete'
      };
    }

    const updated = await client.query<{ attempts: number }>(
      `UPDATE bot_update_deliveries
       SET status = 'pending',
           attempts = attempts + 1,
           telegram_message_id = NULL,
           error_code = NULL,
           error_detail = NULL,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING attempts`,
      [row.id]
    );
    await client.query('COMMIT');
    return {
      action: 'send',
      deliveryId: row.id,
      attempts: Number(updated.rows[0].attempts)
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function markBotUpdateDeliveryDelivered(
  pool: Pool,
  deliveryId: string,
  telegramMessageId: number | null
): Promise<void> {
  const result = await pool.query(
    `UPDATE bot_update_deliveries
     SET status = 'delivered',
         telegram_message_id = $2,
         error_code = NULL,
         error_detail = NULL,
         updated_at = NOW()
     WHERE id = $1::bigint
       AND status = 'pending'`,
    [deliveryId, telegramMessageId]
  );
  if (result.rowCount !== 1) throw new Error('delivery_state_conflict');
}

export async function markBotUpdateDeliveryFailed(
  pool: Pool,
  deliveryId: string,
  { errorCode, errorDetail }: { errorCode: string; errorDetail?: unknown }
): Promise<void> {
  const result = await pool.query(
    `UPDATE bot_update_deliveries
     SET status = 'failed',
         error_code = $2,
         error_detail = $3,
         updated_at = NOW()
     WHERE id = $1::bigint
       AND status = 'pending'`,
    [deliveryId, boundedErrorCode(errorCode), boundedErrorDetail(errorDetail)]
  );
  if (result.rowCount !== 1) throw new Error('delivery_state_conflict');
}

export async function markBotUpdateDeliveryUnknown(
  pool: Pool,
  deliveryId: string,
  { errorCode, errorDetail }: { errorCode: string; errorDetail?: unknown }
): Promise<void> {
  const result = await pool.query(
    `UPDATE bot_update_deliveries
     SET status = 'unknown',
         error_code = $2,
         error_detail = $3,
         updated_at = NOW()
     WHERE id = $1::bigint
       AND status = 'pending'`,
    [deliveryId, boundedErrorCode(errorCode), boundedErrorDetail(errorDetail)]
  );
  if (result.rowCount !== 1) throw new Error('delivery_state_conflict');
}
