import { normalizeBotKey } from './normalization.js';

export const TELEGRAM_HTML_ALLOWED_TAGS = new Set([
  'b',
  'i',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  'strong',
  'em',
  'strike',
  'del'
]);

export const TELEGRAM_HTML_ALIAS_TAGS = { strong: 'b', em: 'i', strike: 's', del: 's' };

export function sanitizeErrorText(value) {
  const raw = (value ?? '').toString().trim();
  if (!raw) return null;
  return raw.slice(0, 500);
}

export function escapeTelegramHtmlText(value) {
  return String(value ?? '')
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[a-fA-F0-9]+);)/g, '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function normalizeBrokenTelegramTags(input) {
  return String(input ?? '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\s*[»›]/g, '<$1$2>')
    .replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\s*[”"']\s*>/g, '<$1$2>')
    .replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\s*>/g, '<$1$2>');
}

export function sanitizeTelegramHtml(value) {
  const normalized = normalizeBrokenTelegramTags(value).replace(/\r\n/g, '\n');
  const parts = normalized.split(/(<[^>]+>)/g);
  const stack = [];
  const out = [];

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('<') && part.endsWith('>')) {
      const match = part.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)(?:\s+[^>]*)?>$/);
      if (!match) {
        out.push(escapeTelegramHtmlText(part));
        continue;
      }

      const isClose = match[1] === '/';
      const rawTag = match[2].toLowerCase();
      const tag = TELEGRAM_HTML_ALIAS_TAGS[rawTag] || rawTag;

      if (!TELEGRAM_HTML_ALLOWED_TAGS.has(rawTag) && !TELEGRAM_HTML_ALLOWED_TAGS.has(tag)) {
        out.push(escapeTelegramHtmlText(part));
        continue;
      }

      if (isClose) {
        const idx = stack.lastIndexOf(tag);
        if (idx === -1) continue;
        while (stack.length > idx) {
          out.push(`</${stack.pop()}>`);
        }
        continue;
      }

      out.push(`<${tag}>`);
      stack.push(tag);
      continue;
    }

    out.push(escapeTelegramHtmlText(part));
  }

  while (stack.length) {
    out.push(`</${stack.pop()}>`);
  }

  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeTelegramParseMode(value) {
  const mode = String(value ?? '').trim().toUpperCase();
  if (mode === 'HTML') return 'HTML';
  if (mode === 'MARKDOWNV2' || mode === 'MARKDOWN_V2') return 'MarkdownV2';
  return null;
}

export function classifyPermanentTelegramFailure(err) {
  const status = Number(err?.telegramStatus);
  const description = (err?.telegramDescription || err?.message || '').toString().toLowerCase();

  if (description.includes('bot was blocked by the user')) return 'blocked';
  if (description.includes('user is deactivated')) return 'deactivated';
  if (description.includes('chat not found')) return 'chat_not_found';
  if (description.includes("bot can't initiate conversation with a user")) return 'chat_not_found';
  if (status === 403) return 'forbidden';
  return null;
}

export function createTelegramClient({ env, fetchImpl = fetch }) {
  function resolveTelegramBotToken(botKeyRaw) {
    const requested = normalizeBotKey(botKeyRaw);
    if (requested && env.telegramBotTokensByBotKey[requested]) {
      return env.telegramBotTokensByBotKey[requested];
    }
    const fallback = normalizeBotKey(env.defaultBotKey) || 'uk-de';
    if (env.telegramBotTokensByBotKey[fallback]) {
      return env.telegramBotTokensByBotKey[fallback];
    }
    const first = Object.values(env.telegramBotTokensByBotKey)[0];
    return typeof first === 'string' && first.trim() ? first.trim() : null;
  }

  async function callTelegramApi(botKey, method, body) {
    const token = resolveTelegramBotToken(botKey);
    if (!token) {
      const err = new Error('missing_telegram_bot_token');
      err.code = 'missing_telegram_bot_token';
      throw err;
    }

    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      const description = payload?.description || `telegram_http_${response.status}`;
      const err = new Error(description);
      err.telegramStatus = response.status;
      err.telegramDescription = payload?.description || null;
      throw err;
    }

    return payload.result || null;
  }

  async function sendTelegramTextMessage(chatId, text, { botKey = null, replyToMessageId = null, parseMode = null, replyMarkup = null } = {}) {
    const body = {
      chat_id: Number(chatId),
      text,
      disable_web_page_preview: true
    };
    if (replyToMessageId) body.reply_to_message_id = Number(replyToMessageId);
    const normalizedParseMode = normalizeTelegramParseMode(parseMode);
    if (normalizedParseMode) body.parse_mode = normalizedParseMode;
    if (replyMarkup && typeof replyMarkup === 'object' && !Array.isArray(replyMarkup)) {
      body.reply_markup = replyMarkup;
    }
    return callTelegramApi(botKey, 'sendMessage', body);
  }

  async function sendTelegramPhotoMessage(chatId, photo, caption, { botKey = null, parseMode = null, replyMarkup = null } = {}) {
    const body = {
      chat_id: Number(chatId),
      photo: (photo ?? '').toString()
    };
    const safeCaption = (caption ?? '').toString().trim();
    if (safeCaption) body.caption = safeCaption;
    const normalizedParseMode = normalizeTelegramParseMode(parseMode);
    if (safeCaption && normalizedParseMode) body.parse_mode = normalizedParseMode;
    if (replyMarkup && typeof replyMarkup === 'object' && !Array.isArray(replyMarkup)) {
      body.reply_markup = replyMarkup;
    }
    return callTelegramApi(botKey, 'sendPhoto', body);
  }

  async function sendTelegramVideoMessage(chatId, video, caption, { botKey = null, parseMode = null, replyMarkup = null } = {}) {
    const body = {
      chat_id: Number(chatId),
      video: (video ?? '').toString(),
      supports_streaming: true
    };
    const safeCaption = (caption ?? '').toString().trim();
    if (safeCaption) body.caption = safeCaption;
    const normalizedParseMode = normalizeTelegramParseMode(parseMode);
    if (safeCaption && normalizedParseMode) body.parse_mode = normalizedParseMode;
    if (replyMarkup && typeof replyMarkup === 'object' && !Array.isArray(replyMarkup)) {
      body.reply_markup = replyMarkup;
    }
    return callTelegramApi(botKey, 'sendVideo', body);
  }

  async function uploadTelegramMediaToChat({ chatId, messageKind, buffer, filename, mimeType, botKey = null }) {
    const token = resolveTelegramBotToken(botKey);
    if (!token) {
      const err = new Error('missing_telegram_bot_token');
      err.code = 'missing_telegram_bot_token';
      throw err;
    }

    const formData = new FormData();
    formData.set('chat_id', String(Number(chatId)));
    formData.set(messageKind, new Blob([buffer], { type: mimeType || 'application/octet-stream' }), filename || `${messageKind}.bin`);

    const method = messageKind === 'photo' ? 'sendPhoto' : 'sendVideo';
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      body: formData
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      const description = payload?.description || `telegram_http_${response.status}`;
      const err = new Error(description);
      err.telegramStatus = response.status;
      err.telegramDescription = payload?.description || null;
      throw err;
    }

    const result = payload.result || null;
    const fileId = messageKind === 'photo'
      ? result?.photo?.[result.photo.length - 1]?.file_id || null
      : result?.video?.file_id || null;

    if (!fileId) {
      const err = new Error('telegram_missing_file_id');
      err.code = 'telegram_missing_file_id';
      throw err;
    }

    return { messageId: result?.message_id ?? null, fileId };
  }

  async function editTelegramMessageText(chatId, messageId, text, { botKey = null } = {}) {
    return callTelegramApi(botKey, 'editMessageText', {
      chat_id: Number(chatId),
      message_id: Number(messageId),
      text
    });
  }

  async function deleteTelegramMessage(chatId, messageId, { botKey = null } = {}) {
    return callTelegramApi(botKey, 'deleteMessage', {
      chat_id: Number(chatId),
      message_id: Number(messageId)
    });
  }

  return {
    resolveTelegramBotToken,
    callTelegramApi,
    sendTelegramTextMessage,
    sendTelegramPhotoMessage,
    sendTelegramVideoMessage,
    uploadTelegramMediaToChat,
    editTelegramMessageText,
    deleteTelegramMessage
  };
}

export function createTelegramDeliveryState({ pool }) {
  return {
    async updateUserDeliveryState(chatId, { status, lastError, inactiveReason, botKey = null }) {
      const normalizedBotKey = normalizeBotKey(botKey);

      if (status === 'sent') {
        if (normalizedBotKey) {
          await pool.query(
            `UPDATE user_bots
                SET is_active = true,
                    updated_at = NOW()
              WHERE chat_id = $1
                AND bot_key = $2`,
            [chatId, normalizedBotKey]
          );
        }

        await pool.query(
          `UPDATE users
              SET inactive_reason = NULL,
                  inactive_at = NULL,
                  last_delivery_error = NULL,
                  updated_at = NOW()
            WHERE chat_id = $1`,
          [chatId]
        );
        return;
      }

      if (inactiveReason) {
        if (normalizedBotKey) {
          await pool.query(
            `UPDATE user_bots
                SET is_active = false,
                    updated_at = NOW()
              WHERE chat_id = $1
                AND bot_key = $2`,
            [chatId, normalizedBotKey]
          );
        }

        await pool.query(
          `WITH active_bots AS (
             SELECT EXISTS (
               SELECT 1
               FROM user_bots
               WHERE chat_id = $1
                 AND COALESCE(is_active, true) = true
             ) AS has_active_bot
           )
           UPDATE users u
              SET inactive_reason = CASE
                    WHEN a.has_active_bot THEN NULL
                    ELSE $2
                  END,
                  inactive_at = CASE
                    WHEN a.has_active_bot THEN NULL
                    WHEN u.inactive_at IS NULL THEN NOW()
                    ELSE u.inactive_at
                  END,
                  last_delivery_error = $3,
                  updated_at = NOW()
             FROM active_bots a
            WHERE u.chat_id = $1`,
          [chatId, inactiveReason, lastError]
        );
        return;
      }

      if (lastError) {
        await pool.query(
          `UPDATE users
              SET last_delivery_error = $2,
                  updated_at = NOW()
            WHERE chat_id = $1
              AND EXISTS (
                SELECT 1
                FROM user_bots ub
                WHERE ub.chat_id = users.chat_id
                  AND COALESCE(ub.is_active, true) = true
              )`,
          [chatId, lastError]
        );
      }
    }
  };
}
