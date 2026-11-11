export const PREPARED_UPDATE_CONTRACT_VERSION = 1 as const;
export const BOT_UPDATE_QUEUE_NAME = 'bot-update-process' as const;
export const BOT_SETTINGS_QUEUE_NAME = 'bot-settings-process' as const;

export const ROUTES = [
  'ignore',
  'guard.private_only',
  'guard.bot_sender',
  'callback.busy',
  'callback.idiom_more',
  'callback.transcript_translate',
  'callback.translate',
  'callback.hints',
  'callback.vocab',
  'callback.lang',
  'callback.level',
  'callback.reply',
  'callback.topic',
  'callback.onboarding',
  'callback.settings',
  'callback.unknown',
  'command.settings',
  'command.start',
  'command.voice',
  'command.lang',
  'command.level',
  'command.stats',
  'command.xp', // Legacy queued updates only.
  'command.progress', // Legacy queued updates only.
  'command.topic',
  'command.feedback',
  'command.unknown',
  'reply_keyboard.voice_toggle',
  'pending_feedback.voice',
  'pending_feedback.text',
  'pending_feedback.unsupported',
  'message.voice',
  'message.text',
  'message.unsupported'
] as const;

export type Route = (typeof ROUTES)[number];
export type UpdateType = 'widget_query' | 'callback_query' | 'message' | 'unknown';
export type KeyboardIntent = 'settings' | 'level' | 'topic' | 'voice' | 'retired';
export type ReplyMode = 'text' | 'voice';
export type GuardReason = 'ignore' | 'private_only' | 'bot_sender';
export type IntentSource = 'callback_query' | 'reply_keyboard' | 'command' | 'message';
export type BotRuntimeInputErrorCode = 'invalid_update' | 'unknown_bot';

export class BotRuntimeInputError extends Error {
  readonly code: BotRuntimeInputErrorCode;

  constructor(code: BotRuntimeInputErrorCode) {
    super(code);
    this.name = 'BotRuntimeInputError';
    this.code = code;
  }
}

export interface NormalizedSender {
  id: number | null;
  isBot: boolean;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
}

export interface NormalizedMessage {
  id: number | null;
  text: string;
  hasText: boolean;
  hasVoice: boolean;
  voiceFileId: string | null;
  voiceDuration: number | null;
  isPinnedServiceUpdate: boolean;
}

export interface NormalizedCallbackQuery {
  id: string;
  data: string;
  userId: number | null;
  messageId: number | null;
  messageText: string;
}

export interface NormalizedTelegramUpdate {
  updateId: number;
  updateType: UpdateType;
  chatId: number | null;
  chatType: string;
  isPrivate: boolean;
  isGroup: boolean;
  sender: NormalizedSender;
  message: NormalizedMessage;
  callbackQuery: NormalizedCallbackQuery | null;
}

export interface ParsedCallbackData {
  callbackId: string;
  data: string;
  group: string;
  value: string;
  payload: string;
  tier: string;
  userId: number | null;
}

export interface ParsedCommand {
  name: string;
  args: string;
  botUsername: string | null;
}

export interface PersistentKeyboardState {
  enabled: boolean;
  buttonIntent: KeyboardIntent | null;
  levelValue: string;
  topicValue: string;
  voiceValue: string;
  replyMode: ReplyMode;
  settingsButtonText?: string;
  levelButtonText: string;
  topicButtonText: string;
  voiceButtonText: string;
}

export interface RoutingFacts {
  command: ParsedCommand | null;
  startPayload: string;
  callback: ParsedCallbackData | null;
  keyboardIntent: KeyboardIntent | null;
  pendingFeedback: boolean;
  guard: GuardReason | null;
  intentSource: IntentSource;
}

export interface RouteTimeContext {
  keyboard: PersistentKeyboardState;
}

export interface PreparedUpdate {
  contractVersion: typeof PREPARED_UPDATE_CONTRACT_VERSION;
  decisionId: string;
  botKey: string;
  updateId: number;
  route: Route;
  input: NormalizedTelegramUpdate;
  routingFacts: RoutingFacts;
  context: RouteTimeContext;
}

export interface KeyboardStateRow extends Record<string, unknown> {
  level?: unknown;
  reply_mode?: unknown;
  onboarding_complete_at?: unknown;
  topic_enabled?: unknown;
  topic_template_id?: unknown;
  topic_pack_json?: unknown;
  topic_pinned_message_id?: unknown;
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    source: string,
    params?: unknown[]
  ): Promise<{ rows: Row[] }>;
}

export interface BotCatalogMeta {
  bot_key?: unknown;
}

export interface PrepareUpdateContext {
  pool: Queryable;
  getBotLocale(botKey: string): unknown;
  publicBotMetaForKey(botKey: unknown): BotCatalogMeta | null;
}
