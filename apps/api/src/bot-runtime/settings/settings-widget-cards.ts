import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';

export async function loadWidgetCard(pool:Pool,update:PreparedUpdate) {
  const result=await pool.query(`SELECT c.*,COALESCE(c.message_id,d.telegram_message_id) AS message_id
    FROM bot_settings_widget_cards c LEFT JOIN bot_update_deliveries d
      ON d.decision_id=c.decision_id AND d.telegram_method='sendWidget' AND d.status='delivered'
    WHERE c.chat_id=$1 AND c.bot_key=$2 AND COALESCE(c.message_id,d.telegram_message_id)=$3 LIMIT 1`,
    [update.input.chatId,update.botKey,update.input.callbackQuery?.messageId]);
  return result.rows[0]||null;
}

export async function saveWidgetScreen(pool:Pool,update:PreparedUpdate,screen:string) {
  await pool.query(`UPDATE bot_settings_widget_cards SET screen=$4,
    action_at=(SELECT created_at FROM bot_update_executions WHERE decision_id=$5)
    WHERE chat_id=$1 AND bot_key=$2 AND message_id=$3
      AND action_at<=(SELECT created_at FROM bot_update_executions WHERE decision_id=$5)`,
    [update.input.chatId,update.botKey,update.input.callbackQuery?.messageId,screen,update.decisionId]);
  return loadWidgetCard(pool,update);
}

