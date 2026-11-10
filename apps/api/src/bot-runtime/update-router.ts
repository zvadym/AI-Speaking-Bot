import {
  PREPARED_UPDATE_CONTRACT_VERSION,
  type GuardReason,
  type IntentSource,
  type KeyboardStateRow,
  type NormalizedTelegramUpdate,
  type ParsedCallbackData,
  type ParsedCommand,
  type PersistentKeyboardState,
  type PreparedUpdate,
  type Route
} from './contracts.js';
import { buildPersistentKeyboardState } from './keyboard-state.js';
import { parseCallbackData, parseCommand, parseStartPayload } from './telegram-update.js';

const CALLBACK_ROUTES: Readonly<Record<string, Route>> = {
  settings: 'callback.settings',
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

function isStartCommand(command: ParsedCommand): boolean {
  return command.name === '/start' && (
    command.args === '' || /^[A-Za-z0-9_-]{1,64}$/.test(command.args)
  );
}

function hasNoArgs(command: ParsedCommand, name: string): boolean {
  return command.name === name && command.args === '';
}

function resolveGuard(route: Route): GuardReason | null {
  if (route === 'ignore') return 'ignore';
  if (route === 'guard.private_only') return 'private_only';
  if (route === 'guard.bot_sender') return 'bot_sender';
  return null;
}

function resolveIntentSource(
  input: NormalizedTelegramUpdate,
  callback: ParsedCallbackData | null,
  command: ParsedCommand | null,
  keyboard: PersistentKeyboardState
): IntentSource {
  if (input.callbackQuery || callback) return 'callback_query';
  if (keyboard.buttonIntent) return 'reply_keyboard';
  if (command) return 'command';
  return 'message';
}

export function resolvePreparedRoute({
  input,
  callback,
  command,
  keyboard,
  pendingFeedback = false
}: {
  input: NormalizedTelegramUpdate;
  callback: ParsedCallbackData | null;
  command: ParsedCommand | null;
  keyboard: PersistentKeyboardState;
  pendingFeedback?: boolean;
}): Route {
  if (input.message.isPinnedServiceUpdate) return 'ignore';
  if (!input.isPrivate && input.chatType) return 'guard.private_only';
  if (input.sender.isBot) return 'guard.bot_sender';

  if (input.updateType === 'widget_query') {
    return callback?.group === 'settings' && callback.value === 'w' ? 'callback.settings' : 'ignore';
  }
  if (input.callbackQuery) {
    return callback ? CALLBACK_ROUTES[callback.group] || 'callback.unknown' : 'callback.unknown';
  }

  if ((command && hasNoArgs(command, '/settings')) || keyboard.buttonIntent === 'settings') return 'command.settings';
  if (command && isStartCommand(command)) return 'command.start';
  if (keyboard.buttonIntent === 'voice') return 'reply_keyboard.voice_toggle';
  if (command && hasNoArgs(command, '/voice')) return 'command.voice';
  if (command && hasNoArgs(command, '/lang')) return 'command.lang';
  if ((command && hasNoArgs(command, '/level')) || keyboard.buttonIntent === 'level') return 'command.level';
  if (command && hasNoArgs(command, '/stats')) return 'command.stats';
  if (keyboard.buttonIntent === 'retired') return 'command.unknown';
  if ((command && hasNoArgs(command, '/topic')) || keyboard.buttonIntent === 'topic') return 'command.topic';
  if (command?.name === '/feedback') return 'command.feedback';
  if (command) return 'command.unknown';
  if (pendingFeedback && input.message.hasVoice) return 'pending_feedback.voice';
  if (pendingFeedback && input.message.hasText) return 'pending_feedback.text';
  if (pendingFeedback) return 'pending_feedback.unsupported';
  if (input.message.hasVoice) return 'message.voice';
  if (input.message.hasText) return 'message.text';
  return 'message.unsupported';
}

export function buildPreparedUpdate({
  botKey,
  input,
  keyboardState = {},
  locale = {},
  pendingFeedback = false
}: {
  botKey: string;
  input: NormalizedTelegramUpdate;
  keyboardState?: KeyboardStateRow;
  locale?: unknown;
  pendingFeedback?: boolean;
}): PreparedUpdate {
  const callback = parseCallbackData(input.callbackQuery);
  const command = parseCommand(input.message.text);
  const keyboard = buildPersistentKeyboardState(keyboardState, locale, input);
  const route = resolvePreparedRoute({ input, callback, command, keyboard, pendingFeedback });

  return {
    contractVersion: PREPARED_UPDATE_CONTRACT_VERSION,
    decisionId: `v${PREPARED_UPDATE_CONTRACT_VERSION}:${botKey}:${input.updateId}`,
    botKey,
    updateId: input.updateId,
    route,
    input,
    routingFacts: {
      command,
      startPayload: parseStartPayload(input.message.text),
      callback,
      keyboardIntent: keyboard.buttonIntent,
      pendingFeedback: Boolean(pendingFeedback),
      guard: resolveGuard(route),
      intentSource: resolveIntentSource(input, callback, command, keyboard)
    },
    context: { keyboard }
  };
}
