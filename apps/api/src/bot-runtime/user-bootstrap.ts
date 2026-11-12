import type { Pool, PoolClient } from 'pg';
import type { NormalizedTelegramUpdate } from './contracts.js';
import { parseStartPayload, parseCallbackData, parseCommand } from './telegram-update.js';

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
}

export async function bootstrapTelegramUser(
  pool: Pool,
  {
    botKey,
    input,
    onboardingEnabledBotKeys = new Set<string>()
  }: {
    botKey: string;
    input: NormalizedTelegramUpdate;
    onboardingEnabledBotKeys?: ReadonlySet<string>;
  }
): Promise<void> {
  const chatId = input.chatId;
  if (
    chatId === null ||
    !Number.isSafeInteger(chatId) ||
    chatId <= 0 ||
    !input.isPrivate ||
    input.sender.isBot
  ) {
    return;
  }
  // Existing settings users only need their activity/profile refreshed. One
  // atomic statement preserves those writes without five transaction roundtrips.
  // New users fall through to normal bootstrap, including onboarding creation.
  if (input.updateType === 'callback_query' && input.sender.id === chatId &&
      parseCallbackData(input.callbackQuery)?.group === 'settings') {
    const refreshed = await pool.query(
      `WITH touched_user AS (
         UPDATE users SET username = $3, first_name = $4,
           inactive_reason = NULL, inactive_at = NULL, last_delivery_error = NULL,
           updated_at = NOW()
         WHERE chat_id = $1 AND EXISTS (
           SELECT 1 FROM user_bots WHERE chat_id = $1 AND bot_key = $2
         ) RETURNING chat_id
       )
       UPDATE user_bots ub SET last_seen_at = NOW(), is_active = true, updated_at = NOW()
       FROM touched_user u WHERE ub.chat_id = u.chat_id AND ub.bot_key = $2
       RETURNING ub.chat_id`,
      [chatId, botKey, input.sender.username, input.sender.firstName]
    );
    if (refreshed.rowCount) return;
  }
  const startCommand = parseCommand(input.message.text);
  const isStart = !input.message.replyToMessageId && startCommand?.name === '/start' && (startCommand.args === '' || /^[A-Za-z0-9_-]{1,64}$/.test(startCommand.args));
  const startPayload = isStart ? parseStartPayload(input.message.text) : '';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (
         chat_id, username, first_name, acquisition_start_payload, acquisition_start_at
       ) VALUES ($1, $2, $3, $4, CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END)
       ON CONFLICT (chat_id) DO UPDATE SET
         username = EXCLUDED.username,
         first_name = EXCLUDED.first_name,
         acquisition_start_payload = COALESCE(users.acquisition_start_payload, EXCLUDED.acquisition_start_payload),
         acquisition_start_at = COALESCE(users.acquisition_start_at, EXCLUDED.acquisition_start_at),
         inactive_reason = NULL,
         inactive_at = NULL,
         last_delivery_error = NULL,
         updated_at = NOW()`,
      [
        chatId,
        input.sender.username,
        input.sender.firstName,
        startPayload || null
      ]
    );
    const insertedUserBot = await client.query(
      `INSERT INTO user_bots (
         chat_id, bot_key, level, reply_mode, tts_voice, first_seen_at,
         last_seen_at, is_active, updated_at
       ) VALUES ($1, $2, 'a1', 'voice', 'marin', NOW(), NOW(), true, NOW())
       ON CONFLICT (chat_id, bot_key) DO NOTHING
       RETURNING chat_id`,
      [chatId, botKey]
    );
    const createdUserBot = Boolean(insertedUserBot.rows[0]);
    if (!createdUserBot) {
      await client.query(
        `UPDATE user_bots
            SET last_seen_at = NOW(),
                is_active = true,
                updated_at = NOW()
          WHERE chat_id = $1
            AND bot_key = $2`,
        [chatId, botKey]
      );
    }
    if (onboardingEnabledBotKeys.has(botKey) && (createdUserBot || isStart)) {
      await client.query(
        `INSERT INTO bot_onboarding_sessions (
           chat_id, bot_key, version, state, last_start_update_id, started_at, updated_at
         ) SELECT $1, $2, 2, 'choose_scenario', $3, NOW(), NOW()
           WHERE NOT EXISTS (
             SELECT 1 FROM bot_onboarding_completion WHERE chat_id = $1 AND bot_key = $2
           )
         ON CONFLICT (chat_id, bot_key) DO NOTHING`,
        [chatId, botKey, isStart ? input.updateId : null]
      );
    }
    if (isStart) {
      await client.query(
        `INSERT INTO action_events (
           chat_id, bot_key, action_type, source, idempotency_key, properties, occurred_at
         ) VALUES ($1, $2, 'start', 'bot_runtime', $3, $4::jsonb, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          chatId,
          botKey,
          `start:${chatId}:${botKey}`,
          JSON.stringify({ start_payload: startPayload || null })
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}
