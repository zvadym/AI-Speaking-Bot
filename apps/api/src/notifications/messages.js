import { createLlmCallRecorder, observeLlmCall } from '../ai/llm-telemetry.js';
import { pool } from '../db.js';
import { createHash } from 'crypto';
import { normalizeLanguageCode, normalizeBotKey } from '../shared/normalization.js';
import { getBotLocale, publicBotMetaForKey } from './bot-context.js';
import { env } from '../env.js';
import { requestStructuredResponse } from '../ai/models/structured-response.js';
import { sanitizeErrorText } from '../shared/telegram-delivery.js';
import { createAppError } from '../core/errors.js';

const recordLlmCall = createLlmCallRecorder(pool);

const WINBACK_REPLY_MODE_TEXT = 'text';

export const WINBACK_REPLY_MODE_VOICE = 'voice';

const LANGUAGE_LABELS = {
  ar: 'Arabic',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  hi: 'Hindi',
  it: 'Italian',
  pl: 'Polish',
  tr: 'Turkish',
  uk: 'Ukrainian'
};

export function normalizeReplyMode(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  return value === WINBACK_REPLY_MODE_VOICE ? WINBACK_REPLY_MODE_VOICE : WINBACK_REPLY_MODE_TEXT;
}

export function stableVariantIndex(seed, size) {
  if (!Number.isInteger(size) || size <= 0) return 0;
  const digest = createHash('sha256').update(String(seed ?? '')).digest();
  return digest.readUInt32BE(0) % size;
}

export function applyTemplateSlots(template, slots = {}) {
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = slots[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function normalizeConversationText(raw, maxLen = 280) {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.slice(0, maxLen);
}

export function countSentences(text) {
  return String(text ?? '')
    .split(/[.!?]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

export function countEmoji(text) {
  const matches = String(text ?? '').match(/\p{Extended_Pictographic}/gu);
  return Array.isArray(matches) ? matches.length : 0;
}

export function containsHtmlLikeTags(text) {
  return /<[^>]+>/.test(String(text ?? ''));
}

export function languageLabelForCode(codeRaw) {
  const code = normalizeLanguageCode(codeRaw);
  if (!code) return 'Unknown';
  return LANGUAGE_LABELS[code] || code.toUpperCase();
}

export function resolveTargetLanguageLabel(botKeyRaw, locale = getBotLocale(botKeyRaw)) {
  const botMeta = publicBotMetaForKey(botKeyRaw);
  const learningLanguage = botMeta?.learning_language || botMeta?.target_lang || normalizeBotKey(botKeyRaw)?.split('-')?.[1] || '';
  const localeLabelKey = learningLanguage ? `lang_label_${learningLanguage}` : '';
  const localeValue = localeLabelKey ? String(locale?.[localeLabelKey] || '').trim() : '';
  return localeValue || languageLabelForCode(learningLanguage);
}

export function resolveReplyCtaLabel(replyMode, winbackLocale) {
  return normalizeReplyMode(replyMode) === WINBACK_REPLY_MODE_VOICE
    ? winbackLocale.reply_cta_voice
    : winbackLocale.reply_cta_text;
}

export async function requestReminderResponse({ context, operation, system, user, name, schema }) {
  return observeLlmCall({
    trace: {
      chatId: context.chatId,
      botKey: context.botKey,
      route: operation
    },
    operation,
    model: env.reminderLlmModel,
    reasoningEffort: env.reminderLlmReasoningEffort,
    record: recordLlmCall,
    call: async () => {
      try {
        return await requestStructuredResponse({
          apiKey: env.openaiApiKey,
          model: env.reminderLlmModel,
          reasoningEffort: env.reminderLlmReasoningEffort,
          system, user, name, schema,
          strict: true,
          maxRetries: 0
        });
      } catch (error) {
        if (typeof error?.status === 'number') {
          const detail = sanitizeErrorText(error?.error?.message || `openai_http_${error.status}`)
            || `openai_http_${error.status}`;
          throw createAppError('openai_request_failed', 502, detail, { retryable: error.status >= 500 });
        }
        if (error instanceof SyntaxError || error?.message === 'openai_invalid_structured_output') {
          throw createAppError('openai_invalid_json', 502, 'openai_invalid_json', { retryable: false });
        }
        throw error;
      }
    }
  });
}
