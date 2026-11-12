import type { Pool, PoolClient } from 'pg';
import type { PreparedUpdate } from './contracts.js';

export interface FeedbackRequest extends Record<string, unknown> {
  session_id: string;
  prompt_message_id: number | null;
  card_message_id: number;
  status: string;
  expires_at: Date | string;
}

export async function startFeedbackRequest(client: PoolClient, update: PreparedUpdate) {
  const cardId = update.input.callbackQuery?.messageId;
  if (!cardId) throw new Error('feedback_card_missing');
  const newer=await client.query(`SELECT 1 FROM pending_feedback WHERE chat_id=$1 AND bot_key=$2
    AND created_at>(SELECT created_at FROM bot_update_executions WHERE decision_id=$3) LIMIT 1`,[update.input.chatId,update.botKey,update.decisionId]);
  if(newer.rows.length)return {sessionId:update.decisionId,cancelledPromptIds:[] as number[]};
  const cancelled = await client.query<{prompt_message_id: string | null}>(
    `UPDATE pending_feedback SET status='cancelled'
     WHERE chat_id=$1 AND bot_key=$2 AND status='awaiting'
     RETURNING prompt_message_id::text`, [update.input.chatId,update.botKey]);
  await client.query(`INSERT INTO pending_feedback
    (session_id,chat_id,bot_key,card_message_id,expires_at,status)
    VALUES ($1,$2,$3,$4,NOW()+INTERVAL '10 minutes','awaiting')`,
    [update.decisionId,update.input.chatId,update.botKey,cardId]);
  return {sessionId:update.decisionId,cancelledPromptIds:cancelled.rows.map(r=>Number(r.prompt_message_id)).filter(Boolean)};
}

export async function cancelFeedbackRequests(client: PoolClient, update: PreparedUpdate) {
  const result=await client.query<{prompt_message_id:string|null}>(
    `UPDATE pending_feedback SET status='cancelled'
     WHERE chat_id=$1 AND bot_key=$2 AND status='awaiting'
       AND ($3::bigint IS NULL OR card_message_id=$3) AND created_at<=(SELECT created_at FROM bot_update_executions WHERE decision_id=$4)
     RETURNING prompt_message_id::text`,
    [update.input.chatId,update.botKey,update.route==='settings.open'?null:update.input.callbackQuery?.messageId||null,update.decisionId]);
  return {cancelledPromptIds:result.rows.map(r=>Number(r.prompt_message_id)).filter(Boolean)};
}

export async function loadFeedbackRequest(pool: Pool, sessionId: string) {
  const result=await pool.query<FeedbackRequest>('SELECT * FROM pending_feedback WHERE session_id=$1',[sessionId]);
  return result.rows[0] || null;
}

export async function lockFeedbackReply(client: PoolClient, update: PreparedUpdate): Promise<FeedbackRequest|null> {
  const replyId=update.input.message.replyToMessageId;
  if (!replyId || update.input.sender.id!==update.input.chatId || !update.input.isPrivate) return null;
  const result=await client.query<FeedbackRequest>(
    `SELECT pf.*, COALESCE(pf.prompt_message_id,d.telegram_message_id) AS prompt_message_id FROM pending_feedback pf
     LEFT JOIN bot_update_deliveries d ON d.decision_id=pf.session_id
       AND d.step_key='settings:feedback-prompt:v1' AND d.status='delivered'
     WHERE pf.chat_id=$1 AND pf.bot_key=$2 AND COALESCE(pf.prompt_message_id,d.telegram_message_id)=$3
       AND pf.status='awaiting' AND pf.expires_at>NOW() FOR UPDATE OF pf`,
    [update.input.chatId,update.botKey,replyId]);
  return result.rows[0] || null;
}
