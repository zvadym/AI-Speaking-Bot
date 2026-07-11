import type { Pool, PoolClient } from 'pg';
import type { PreparedUpdate } from './contracts.js';

export type ExecutionClaimResult =
  | { outcome: 'claimed'; attempts: number }
  | { outcome: 'succeeded' }
  | { outcome: 'in_progress' }
  | { outcome: 'permanent_failed' }
  | { outcome: 'conflict' };

export interface ExecutionClaimInput {
  contract: PreparedUpdate;
  handlerVersion: number;
  jobId: string;
  leaseSeconds?: number;
}

interface ExecutionRow extends Record<string, unknown> {
  decision_id: string;
  bot_key: string;
  update_id: string | number;
  contract_version: number;
  route: string;
  handler_version: number;
  status: string;
  attempts: number;
  current_job_id: string;
  lease_expired: boolean;
}

function normalizeLeaseSeconds(value: unknown): number {
  const parsed = Number(value ?? 180);
  if (!Number.isInteger(parsed) || parsed < 30 || parsed > 3600) {
    throw new Error('invalid_execution_lease_seconds');
  }
  return parsed;
}

function boundedErrorCode(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .slice(0, 128);
  return normalized || 'unknown_error';
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The original transaction error is more useful than a rollback failure.
  }
}

export async function claimBotUpdateExecution(
  pool: Pool,
  { contract, handlerVersion, jobId, leaseSeconds = 180 }: ExecutionClaimInput
): Promise<ExecutionClaimResult> {
  const lease = normalizeLeaseSeconds(leaseSeconds);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ attempts: number }>(
      `INSERT INTO bot_update_executions (
         decision_id,
         bot_key,
         update_id,
         contract_version,
         route,
         handler_version,
         status,
         attempts,
         current_job_id,
         lease_expires_at,
         started_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'running', 1, $7::uuid, NOW() + make_interval(secs => $8), NOW())
       ON CONFLICT DO NOTHING
       RETURNING attempts`,
      [
        contract.decisionId,
        contract.botKey,
        contract.updateId,
        contract.contractVersion,
        contract.route,
        handlerVersion,
        jobId,
        lease
      ]
    );

    if (inserted.rows[0]) {
      await client.query('COMMIT');
      return { outcome: 'claimed', attempts: Number(inserted.rows[0].attempts) };
    }

    const existing = await client.query<ExecutionRow>(
      `SELECT
         decision_id,
         bot_key,
         update_id,
         contract_version,
         route,
         handler_version,
         status,
         attempts,
         current_job_id::text,
         lease_expires_at <= NOW() AS lease_expired
       FROM bot_update_executions
       WHERE decision_id = $1
          OR (bot_key = $2 AND update_id = $3)
       ORDER BY (decision_id = $1) DESC
       LIMIT 1
       FOR UPDATE`,
      [contract.decisionId, contract.botKey, contract.updateId]
    );
    const row = existing.rows[0];
    if (!row) throw new Error('execution_conflict_without_row');

    const identityMatches =
      row.bot_key === contract.botKey &&
      Number(row.update_id) === contract.updateId &&
      Number(row.contract_version) === contract.contractVersion &&
      row.route === contract.route &&
      Number(row.handler_version) === handlerVersion;
    if (!identityMatches) {
      await client.query('COMMIT');
      return { outcome: 'conflict' };
    }

    if (row.status === 'succeeded') {
      await client.query('COMMIT');
      return { outcome: 'succeeded' };
    }
    if (row.status === 'permanent_failed') {
      await client.query('COMMIT');
      return { outcome: 'permanent_failed' };
    }
    if (
      row.status === 'running' &&
      row.current_job_id !== jobId &&
      row.lease_expired !== true
    ) {
      await client.query('COMMIT');
      return { outcome: 'in_progress' };
    }

    const reclaimed = await client.query<{ attempts: number }>(
      `UPDATE bot_update_executions
       SET status = 'running',
           attempts = attempts + 1,
           current_job_id = $2::uuid,
           lease_expires_at = NOW() + make_interval(secs => $3),
           terminal_error_code = NULL,
           completed_at = NULL,
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW()
       WHERE decision_id = $1
       RETURNING attempts`,
      [contract.decisionId, jobId, lease]
    );
    await client.query('COMMIT');
    return { outcome: 'claimed', attempts: Number(reclaimed.rows[0].attempts) };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function markBotUpdateExecutionSucceeded(
  pool: Pool,
  decisionId: string,
  jobId: string
): Promise<void> {
  const result = await pool.query(
    `UPDATE bot_update_executions
     SET status = 'succeeded',
         terminal_error_code = NULL,
         lease_expires_at = NOW(),
         completed_at = NOW(),
         updated_at = NOW()
     WHERE decision_id = $1
       AND current_job_id = $2::uuid
       AND status = 'running'`,
    [decisionId, jobId]
  );
  if (result.rowCount !== 1) throw new Error('execution_lease_lost');
}

export async function markBotUpdateExecutionFailed(
  pool: Pool,
  decisionId: string,
  jobId: string,
  { retryable, errorCode }: { retryable: boolean; errorCode: string }
): Promise<void> {
  const status = retryable ? 'retryable_failed' : 'permanent_failed';
  const result = await pool.query(
    `UPDATE bot_update_executions
     SET status = $3,
         terminal_error_code = $4,
         lease_expires_at = NOW(),
         completed_at = CASE WHEN $3 = 'permanent_failed' THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE decision_id = $1
       AND current_job_id = $2::uuid
       AND status = 'running'`,
    [decisionId, jobId, status, boundedErrorCode(errorCode)]
  );
  if (result.rowCount !== 1) throw new Error('execution_lease_lost');
}
