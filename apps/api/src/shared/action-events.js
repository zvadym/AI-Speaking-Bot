import { normalizeBotKey } from './normalization.js';

function safeActionProperties(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const safeKey = (key ?? '').toString().trim().slice(0, 64);
    if (!safeKey) continue;
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      out[safeKey] = value;
    }
  }
  return out;
}

export function createActionEventService({ pool }) {
  async function recordActionEvent({
    chatId,
    botKey = null,
    actionType,
    source = 'api',
    idempotencyKey = null,
    properties = {},
    occurredAt = null
  }) {
    const numericChatId = Number(chatId);
    if (!Number.isFinite(numericChatId) || !actionType) return;

    await pool.query(
      `INSERT INTO action_events (
         chat_id,
         bot_key,
         action_type,
         source,
         idempotency_key,
         properties,
         occurred_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, NOW()))
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        numericChatId,
        normalizeBotKey(botKey),
        actionType,
        (source || 'api').toString().slice(0, 64),
        idempotencyKey ? idempotencyKey.toString().slice(0, 200) : null,
        JSON.stringify(safeActionProperties(properties)),
        occurredAt
      ]
    );
  }

  async function recordActionEventSafe(payload) {
    try {
      await recordActionEvent(payload);
    } catch (err) {
      console.warn('action_events insert failed', {
        actionType: payload?.actionType || null,
        chatId: payload?.chatId || null,
        botKey: payload?.botKey || null,
        err: err?.message || String(err)
      });
    }
  }

  return {
    recordActionEvent,
    recordActionEventSafe
  };
}
