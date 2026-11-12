import {
  BotRuntimeInputError,
  type NormalizedCallbackQuery,
  type NormalizedSender,
  type NormalizedTelegramUpdate,
  type ParsedCallbackData,
  type ParsedCommand
} from './contracts.js';

type UnknownRecord = Record<string, unknown>;

function asObject(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asOptionalObject(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSender(value: unknown): NormalizedSender {
  const sender = asObject(value);
  return {
    id: finiteNumber(sender.id),
    isBot: Boolean(sender.is_bot),
    username: trimString(sender.username) || null,
    firstName: trimString(sender.first_name) || null,
    lastName: trimString(sender.last_name) || null,
    languageCode: trimString(sender.language_code) || null
  };
}

export function normalizeTelegramUpdate(rawUpdate: unknown): NormalizedTelegramUpdate {
  const update = asOptionalObject(rawUpdate);
  if (!update) throw new BotRuntimeInputError('invalid_update');

  const updateId = update.update_id;
  if (typeof updateId !== 'number' || !Number.isSafeInteger(updateId) || updateId < 0) {
    throw new BotRuntimeInputError('invalid_update');
  }

  const rawMessage = asOptionalObject(update.message);
  const widget = asOptionalObject(update.widget_query);
  // Normalize the common interaction envelope; updateType retains the transport
  // so widget queries are never answered with answerCallbackQuery.
  const rawCallbackQuery = widget ? {
    id: widget.id, from: widget.from,
    data: asObject(widget.type).type === 'data' ? widget.data : '',
    message: { chat: widget.chat, message_id: widget.message_id }
  } : asOptionalObject(update.callback_query);
  const rawCallbackMessage = asOptionalObject(rawCallbackQuery?.message);
  const hasCallback = Boolean(rawCallbackQuery);
  const effectiveMessage = hasCallback ? rawCallbackMessage : rawMessage;
  const chat = asObject(effectiveMessage?.chat);
  const sender = normalizeSender(hasCallback ? rawCallbackQuery?.from : rawMessage?.from);
  const rawVoice = asOptionalObject(rawMessage?.voice);
  const text = trimString(rawMessage?.text);
  const chatType = trimString(chat.type);
  const callbackMessageId = finiteNumber(rawCallbackMessage?.message_id);
  const messageId = finiteNumber(rawMessage?.message_id);
  const effectiveMessageId = hasCallback ? callbackMessageId : messageId;
  const callbackQuery: NormalizedCallbackQuery | null = rawCallbackQuery
    ? {
        id: trimString(rawCallbackQuery.id),
        data: trimString(rawCallbackQuery.data),
        userId: finiteNumber(asObject(rawCallbackQuery.from).id),
        messageId: callbackMessageId,
        messageText: trimString(rawCallbackMessage?.text)
      }
    : null;

  return {
    updateId,
    updateType: widget ? 'widget_query' : hasCallback ? 'callback_query' : (rawMessage ? 'message' : 'unknown'),
    chatId: finiteNumber(chat.id),
    chatType,
    isPrivate: chatType === 'private',
    isGroup: chatType === 'group' || chatType === 'supergroup',
    sender,
    message: {
      id: effectiveMessageId,
      replyToMessageId: finiteNumber(asObject(rawMessage?.reply_to_message).message_id),
      replyToMessageBotUsername: asObject(asObject(rawMessage?.reply_to_message).from).is_bot
        ? trimString(asObject(asObject(rawMessage?.reply_to_message).from).username).slice(0,64)||null : null,
      replyToMessageText: trimString(asObject(rawMessage?.reply_to_message).text).slice(0,4096)||null,
      text,
      hasText: Boolean(text),
      hasVoice: Boolean(rawVoice),
      voiceFileId: rawVoice ? trimString(rawVoice.file_id) || null : null,
      voiceDuration: rawVoice ? finiteNumber(rawVoice.duration) : null,
      isPinnedServiceUpdate: Boolean(
        rawMessage?.pinned_message && !rawMessage.text && !rawMessage.voice && !hasCallback
      )
    },
    callbackQuery
  };
}

export function parseCallbackData(callbackQuery: NormalizedCallbackQuery | null): ParsedCallbackData | null {
  const data = trimString(callbackQuery?.data);
  if (!data) return null;
  const parts = data.split(':');
  return {
    callbackId: trimString(callbackQuery?.id),
    data,
    group: trimString(parts[0]),
    value: trimString(parts[1]),
    payload: parts.slice(1).join(':'),
    tier: trimString(parts[2]),
    userId: callbackQuery?.userId ?? null
  };
}

export function parseCommand(text: unknown): ParsedCommand | null {
  const value = trimString(text);
  if (!value.startsWith('/')) return null;
  const match = value.match(/^(\/[A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/u);
  if (!match) {
    return { name: value.toLowerCase(), args: '', botUsername: null };
  }
  return {
    name: match[1].toLowerCase(),
    botUsername: match[2] || null,
    args: trimString(match[3])
  };
}

export function normalizeCommand(text: unknown): string {
  return parseCommand(text)?.name || '';
}

export function parseStartPayload(text: unknown): string {
  const command = parseCommand(text);
  if (command?.name !== '/start') return '';
  return /^[A-Za-z0-9_-]{1,64}$/.test(command.args) ? command.args : '';
}
