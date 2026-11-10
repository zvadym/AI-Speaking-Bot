import type {
  KeyboardIntent,
  KeyboardStateRow,
  NormalizedTelegramUpdate,
  PersistentKeyboardState,
  ReplyMode
} from './contracts.js';

type UnknownRecord = Record<string, unknown>;

const BUTTON_MARKER = '·';
const TOPIC_ICON = '🧩';
const LEVEL_ICON = '📚';
const VOICE_ICON = '🎤';

function asObject(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function norm(value: unknown): string {
  return trimString(value).toLowerCase();
}

function parseJsonObject(value: unknown): UnknownRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as UnknownRecord
      : null;
  } catch {
    return null;
  }
}

function normalizeReplyMode(value: unknown): ReplyMode {
  return norm(value) === 'text' ? 'text' : 'voice';
}

export function buildPersistentKeyboardState(
  rowRaw: KeyboardStateRow = {},
  localeRaw: unknown = {},
  input: NormalizedTelegramUpdate
): PersistentKeyboardState {
  const locale = asObject(localeRaw);
  const pack = parseJsonObject(rowRaw.topic_pack_json);
  const topicEnabled = Boolean(rowRaw.topic_enabled);
  const topicTitle = topicEnabled ? trimString(pack?.title_base) : '';
  const topicNone = trimString(locale.keyboard_btn_topic_none) || 'Free chat';
  const voiceText = trimString(locale.keyboard_btn_voice_text) || 'Text';
  const voiceVoice = trimString(locale.keyboard_btn_voice_voice) || 'Voice';
  // Old Telegram reply keyboards can remain on clients after the rollout.
  const legacyXpPrefix = trimString(locale.keyboard_btn_xp_prefix) || 'XP';
  const levelValue = (trimString(rowRaw.level) || 'a1').toUpperCase();
  const replyMode = normalizeReplyMode(rowRaw.reply_mode);
  const voiceValue = replyMode === 'voice' ? voiceVoice : voiceText;
  const topicValue = topicTitle || topicNone;
  const settingsButtonText = `· ⚙️ ${trimString(asObject(locale.settings).title) || 'Settings'}`;
  const levelButtonText = `${BUTTON_MARKER} ${LEVEL_ICON} ${levelValue}`;
  const topicButtonText = `${BUTTON_MARKER} ${TOPIC_ICON} ${topicValue}`;
  const voiceButtonText = `${BUTTON_MARKER} ${VOICE_ICON} ${voiceValue}`;
  const normalizedMessage = norm(input.message.text);
  const enabled = input.isPrivate && Boolean(rowRaw.onboarding_complete_at);
  const levelPrefixNorm = norm(`${BUTTON_MARKER} ${LEVEL_ICON}`);
  const topicPrefixNorm = norm(`${BUTTON_MARKER} ${TOPIC_ICON}`);
  const voicePrefixNorm = norm(`${BUTTON_MARKER} ${VOICE_ICON}`);
  const legacyXpPrefixNorm = norm(`${BUTTON_MARKER} ${legacyXpPrefix}:`);
  let buttonIntent: KeyboardIntent | null = null;

  if (enabled && normalizedMessage) {
    if (normalizedMessage === norm(settingsButtonText) || normalizedMessage.startsWith(norm('· ⚙️'))) {
      buttonIntent = 'settings';
    } else if (normalizedMessage === norm(levelButtonText) || normalizedMessage.startsWith(levelPrefixNorm)) {
      buttonIntent = 'level';
    } else if (normalizedMessage === norm(topicButtonText) || normalizedMessage.startsWith(topicPrefixNorm)) {
      buttonIntent = 'topic';
    } else if (normalizedMessage === norm(voiceButtonText) || normalizedMessage.startsWith(voicePrefixNorm)) {
      buttonIntent = 'voice';
    } else if (normalizedMessage.startsWith(norm(`${BUTTON_MARKER} 📈`)) || normalizedMessage.startsWith(legacyXpPrefixNorm)) {
      buttonIntent = 'retired';
    }
  }

  return {
    enabled,
    buttonIntent,
    levelValue,
    topicValue,
    voiceValue,
    replyMode,
    settingsButtonText,
    levelButtonText,
    topicButtonText,
    voiceButtonText
  };
}

export function buildPersistentReplyMarkup(keyboard: PersistentKeyboardState) {
  return {
    keyboard: [[{ text: keyboard.settingsButtonText || '· ⚙️ Settings' }]],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}
