import { normalizeBotKey } from '../shared/normalization.js';

const BUTTON_MARKER = '·';
const TOPIC_ICON = '🧩';
const LEVEL_ICON = '📚';
const VOICE_ICON = '🎤';

const CALLBACK_ROUTES = {
  busy: 'callback.busy',
  idiom_more: 'callback.idiom_more',
  trv: 'callback.transcript_translate',
  tr: 'callback.translate',
  hint: 'callback.hints',
  voc: 'callback.vocab',
  lang: 'callback.lang',
  level: 'callback.level',
  reply: 'callback.reply',
  topic: 'callback.topic',
  onb: 'callback.onboarding'
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return String(value ?? '').trim();
}

function norm(value) {
  return trimString(value).toLowerCase();
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeReplyMode(value) {
  return norm(value) === 'text' ? 'text' : 'voice';
}

export function normalizeTelegramUpdate(rawUpdate) {
  const update = asObject(rawUpdate);
  const message = asObject(update.message);
  const callbackQuery = asObject(update.callback_query);
  const callbackMessage = asObject(callbackQuery.message);
  const callbackData = trimString(callbackQuery.data);
  const hasCallback = Boolean(callbackData);
  const effectiveMessage = hasCallback ? callbackMessage : message;
  const chat = asObject(effectiveMessage.chat);
  const sender = asObject(hasCallback ? callbackQuery.from : message.from);
  const text = trimString(message.text);
  const voice = asObject(message.voice);
  const hasVoice = Boolean(message.voice && typeof message.voice === 'object');
  const chatIdRaw = chat.id ?? null;
  const chatId = Number(chatIdRaw);
  const chatType = trimString(chat.type);
  const messageIdRaw = effectiveMessage.message_id ?? message.message_id ?? null;
  const messageId = Number(messageIdRaw);

  return {
    update,
    update_type: hasCallback ? 'callback_query' : (Object.keys(message).length ? 'message' : 'unknown'),
    chat_id: Number.isFinite(chatId) ? chatId : null,
    chat_type: chatType,
    is_private: chatType === 'private',
    is_group: chatType === 'group' || chatType === 'supergroup',
    sender: {
      id: Number.isFinite(Number(sender.id)) ? Number(sender.id) : null,
      is_bot: Boolean(sender.is_bot),
      username: trimString(sender.username) || null,
      first_name: trimString(sender.first_name) || null,
      last_name: trimString(sender.last_name) || null,
      language_code: trimString(sender.language_code) || null
    },
    message: {
      id: Number.isFinite(messageId) ? messageId : null,
      text,
      has_text: Boolean(text),
      has_voice: hasVoice,
      voice_file_id: hasVoice ? trimString(voice.file_id) || null : null,
      voice_duration: hasVoice && Number.isFinite(Number(voice.duration)) ? Number(voice.duration) : null,
      is_pinned_service_update: Boolean(message.pinned_message && !message.text && !message.voice && !hasCallback)
    },
    callback_query: hasCallback ? callbackQuery : null
  };
}

export function parseCallbackData(callbackQuery) {
  const data = trimString(callbackQuery?.data);
  if (!data) return null;
  const parts = data.split(':');
  return {
    callback_id: trimString(callbackQuery?.id),
    data,
    group: trimString(parts[0]),
    value: trimString(parts[1]),
    payload: parts.slice(1).join(':'),
    tier: trimString(parts[2]),
    user_id: Number.isFinite(Number(callbackQuery?.from?.id)) ? Number(callbackQuery.from.id) : null
  };
}

export function parseStartPayload(text) {
  const match = trimString(text).match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/);
  return match?.[1] || '';
}

export function normalizeCommand(text) {
  const value = trimString(text);
  if (!value.startsWith('/')) return '';
  const token = value.split(/\s+/)[0] || '';
  return token.replace(/@[\w_]+$/u, '').toLowerCase();
}

export function buildPersistentKeyboardState(rowRaw = {}, localeRaw = {}, updateInfoRaw = {}) {
  const row = asObject(rowRaw);
  const locale = asObject(localeRaw);
  const updateInfo = asObject(updateInfoRaw);
  const pack = parseJsonObject(row.topic_pack_json);
  const topicEnabled = Boolean(row.topic_enabled);
  const topicTitle = topicEnabled ? trimString(pack?.title_base) : '';
  const topicNone = trimString(locale.keyboard_btn_topic_none) || 'Free chat';
  const voiceText = trimString(locale.keyboard_btn_voice_text) || 'Text';
  const voiceVoice = trimString(locale.keyboard_btn_voice_voice) || 'Voice';
  const xpPrefix = trimString(locale.keyboard_btn_xp_prefix) || 'XP';
  const levelValue = (trimString(row.level) || 'a1').toUpperCase();
  const replyMode = normalizeReplyMode(row.reply_mode);
  const voiceValue = replyMode === 'voice' ? voiceVoice : voiceText;
  const xpTotal = Number.isFinite(Number(row.xp_total)) ? Number(row.xp_total) : 0;
  const xpLevel = Number.isFinite(Number(row.xp_level)) && Number(row.xp_level) > 0
    ? Number(row.xp_level)
    : 1;
  const topicValue = topicTitle || topicNone;
  const levelButtonText = `${BUTTON_MARKER} ${LEVEL_ICON} ${levelValue}`;
  const topicButtonText = `${BUTTON_MARKER} ${TOPIC_ICON} ${topicValue}`;
  const voiceButtonText = `${BUTTON_MARKER} ${VOICE_ICON} ${voiceValue}`;
  const xpButtonText = `${BUTTON_MARKER} ${xpPrefix}: ${xpTotal} • L${xpLevel}`;
  const messageText = trimString(updateInfo.message?.text);
  const chatType = trimString(updateInfo.chat_type);
  const enabled = chatType === 'private' && Boolean(row.onboarding_complete_at);
  const normalizedMessage = norm(messageText);
  const levelPrefixNorm = norm(`${BUTTON_MARKER} ${LEVEL_ICON}`);
  const topicPrefixNorm = norm(`${BUTTON_MARKER} ${TOPIC_ICON}`);
  const voicePrefixNorm = norm(`${BUTTON_MARKER} ${VOICE_ICON}`);
  const xpPrefixNorm = norm(`${BUTTON_MARKER} ${xpPrefix}:`);
  let buttonIntent = '';

  if (enabled && normalizedMessage) {
    if (normalizedMessage === norm(levelButtonText) || normalizedMessage.startsWith(levelPrefixNorm)) {
      buttonIntent = 'level';
    } else if (normalizedMessage === norm(topicButtonText) || normalizedMessage.startsWith(topicPrefixNorm)) {
      buttonIntent = 'topic';
    } else if (normalizedMessage === norm(voiceButtonText) || normalizedMessage.startsWith(voicePrefixNorm)) {
      buttonIntent = 'voice';
    } else if (normalizedMessage === norm(xpButtonText) || normalizedMessage.startsWith(xpPrefixNorm)) {
      buttonIntent = 'xp';
    }
  }

  return {
    enabled,
    button_intent: buttonIntent,
    level_value: levelValue,
    topic_value: topicValue,
    voice_value: voiceValue,
    reply_mode: replyMode,
    xp_total: xpTotal,
    xp_level: xpLevel,
    level_button_text: levelButtonText,
    topic_button_text: topicButtonText,
    voice_button_text: voiceButtonText,
    xp_button_text: xpButtonText
  };
}

export function resolvePreparedRoute({ updateInfo, callback, keyboard, pendingFeedback = false } = {}) {
  if (updateInfo?.message?.is_pinned_service_update) return 'ignore';
  if (updateInfo?.is_group) return 'guard.private_only';
  if (updateInfo?.sender?.is_bot) return 'guard.bot_sender';

  if (callback) {
    return CALLBACK_ROUTES[callback.group] || 'callback.unknown';
  }

  const command = normalizeCommand(updateInfo?.message?.text);
  if (command === '/start') return 'command.start';
  if (keyboard?.button_intent === 'voice') return 'reply_keyboard.voice_toggle';
  if (command === '/voice') return 'command.voice';
  if (command === '/lang') return 'command.lang';
  if (command === '/level' || keyboard?.button_intent === 'level') return 'command.level';
  if (command === '/stats') return 'command.stats';
  if (command === '/xp' || keyboard?.button_intent === 'xp') return 'command.xp';
  if (command === '/topic' || keyboard?.button_intent === 'topic') return 'command.topic';
  if (command === '/feedback') return 'command.feedback';
  if (command) return 'command.unknown';
  if (pendingFeedback && updateInfo?.message?.has_voice) return 'pending_feedback.voice';
  if (pendingFeedback && updateInfo?.message?.has_text) return 'pending_feedback.text';
  if (pendingFeedback) return 'pending_feedback.unsupported';
  if (updateInfo?.message?.has_voice) return 'message.voice';
  if (updateInfo?.message?.has_text) return 'message.text';
  return 'message.unsupported';
}

export function buildPreparedUpdate({
  botKey,
  telegramUpdate,
  keyboardState = {},
  locale = {},
  pendingFeedback = false
} = {}) {
  const normalizedBotKey = normalizeBotKey(botKey);
  const updateInfo = normalizeTelegramUpdate(telegramUpdate);
  const callback = parseCallbackData(updateInfo.callback_query);
  const keyboard = buildPersistentKeyboardState(keyboardState, locale, updateInfo);
  const command = normalizeCommand(updateInfo.message.text);
  const route = resolvePreparedRoute({
    updateInfo,
    callback,
    keyboard,
    pendingFeedback
  });

  return {
    ok: true,
    bot_key: normalizedBotKey,
    route,
    intent: {
      type: route,
      source: callback ? 'callback_query' : (keyboard.button_intent ? 'reply_keyboard' : (command ? 'command' : 'message'))
    },
    chat_id: updateInfo.chat_id,
    chat_type: updateInfo.chat_type,
    update_type: updateInfo.update_type,
    sender: updateInfo.sender,
    message: {
      ...updateInfo.message,
      command,
      start_payload: parseStartPayload(updateInfo.message.text)
    },
    callback,
    guards: {
      ignore_update: route === 'ignore',
      is_private: updateInfo.is_private,
      is_group: updateInfo.is_group,
      is_bot: updateInfo.sender.is_bot,
      has_callback: Boolean(callback),
      has_text: updateInfo.message.has_text,
      has_voice: updateInfo.message.has_voice,
      pending_feedback: Boolean(pendingFeedback)
    },
    keyboard
  };
}
