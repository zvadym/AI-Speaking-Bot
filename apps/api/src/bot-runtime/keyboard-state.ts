import type {
  KeyboardIntent,
  KeyboardStateRow,
  NormalizedTelegramUpdate,
  PersistentKeyboardState,
  ReplyMode
} from './contracts.js';

type UnknownRecord = Record<string, unknown>;

const BUTTON_MARKER = '·';
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

function normalizeReplyMode(value: unknown): ReplyMode {
  return norm(value) === 'text' ? 'text' : 'voice';
}

export function buildPersistentKeyboardState(
  rowRaw: KeyboardStateRow = {},
  localeRaw: unknown = {},
  input: NormalizedTelegramUpdate
): PersistentKeyboardState {
  const locale = asObject(localeRaw);
  const voiceText = trimString(locale.keyboard_btn_voice_text) || 'Text';
  const voiceVoice = trimString(locale.keyboard_btn_voice_voice) || 'Voice';
  // Old Telegram reply keyboards can remain on clients after the rollout.
  const legacyXpPrefix = trimString(locale.keyboard_btn_xp_prefix) || 'XP';
  const levelValue = (trimString(rowRaw.level) || 'a1').toUpperCase();
  const replyMode = normalizeReplyMode(rowRaw.reply_mode);
  const voiceValue = replyMode === 'voice' ? voiceVoice : voiceText;
  const settingsButtonText = `· ⚙️ ${trimString(asObject(locale.settings).title) || 'Settings'}`;
  const levelButtonText = `${BUTTON_MARKER} ${LEVEL_ICON} ${levelValue}`;
  const voiceButtonText = `${BUTTON_MARKER} ${VOICE_ICON} ${voiceValue}`;
  const normalizedMessage = norm(input.message.text);
  const enabled = input.isPrivate && Boolean(rowRaw.onboarding_complete_at);
  const levelPrefixNorm = norm(`${BUTTON_MARKER} ${LEVEL_ICON}`);
  const voicePrefixNorm = norm(`${BUTTON_MARKER} ${VOICE_ICON}`);
  const legacyXpPrefixNorm = norm(`${BUTTON_MARKER} ${legacyXpPrefix}:`);
  let buttonIntent: KeyboardIntent | null = null;

  // /settings can expose this button for legacy profiles without an onboarding
  // completion row. Recognize it just like the command, independently of that row.
  if (input.isPrivate && (normalizedMessage === norm(settingsButtonText) || normalizedMessage.startsWith(norm('· ⚙️')))) {
    buttonIntent = 'settings';
  } else if (enabled && normalizedMessage) {
    if (normalizedMessage === norm(levelButtonText) || normalizedMessage.startsWith(levelPrefixNorm)) {
      buttonIntent = 'level';
    } else if (normalizedMessage.startsWith(norm('· 🧩'))) {
      buttonIntent = 'retired';
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
    voiceValue,
    replyMode,
    settingsButtonText,
    levelButtonText,
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
