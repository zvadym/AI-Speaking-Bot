import type {
  KeyboardIntent,
  KeyboardStateRow,
  NormalizedTelegramUpdate,
  PersistentKeyboardState
} from './contracts.js';

type UnknownRecord = Record<string, unknown>;


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

export function buildPersistentKeyboardState(
  rowRaw: KeyboardStateRow = {},
  localeRaw: unknown = {},
  input: NormalizedTelegramUpdate
): PersistentKeyboardState {
  const locale = asObject(localeRaw);
  const settingsButtonText = `· ⚙️ ${trimString(asObject(locale.settings).title) || 'Settings'}`;
  const normalizedMessage = norm(input.message.text);
  const enabled = input.isPrivate && Boolean(rowRaw.onboarding_complete_at);
  let buttonIntent: KeyboardIntent | null = null;

  // Recognize old keyboards even when a legacy profile has no completion row.
  if (input.isPrivate && (normalizedMessage === norm(settingsButtonText) || normalizedMessage.startsWith(norm('· ⚙️')))) {
    buttonIntent = 'settings';
  } else if (input.isPrivate && /^·\s*(?:📚|🎤|🧩|📈|xp\s*:)/u.test(normalizedMessage)) {
    buttonIntent = 'retired';
  }

  return { enabled, buttonIntent, settingsButtonText };
}

export function buildPersistentReplyMarkup(keyboard: PersistentKeyboardState) {
  return {
    keyboard: [[{ text: keyboard.settingsButtonText || '· ⚙️ Settings' }]],
    is_persistent: true,
    resize_keyboard: true,
    one_time_keyboard: false
  };
}
