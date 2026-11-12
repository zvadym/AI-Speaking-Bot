import { normalizeBotKey } from '../shared/normalization.js';
import {
  BotRuntimeInputError,
  type KeyboardStateRow,
  type PrepareUpdateContext,
  type PreparedUpdate
} from './contracts.js';
import { fetchKeyboardState, fetchFeedbackReplyState } from './context-loader.js';
import { normalizeTelegramUpdate, parseCallbackData } from './telegram-update.js';
import { buildPreparedUpdate } from './update-router.js';

export async function prepareBotUpdate(
  ctx: PrepareUpdateContext,
  { botKey: rawBotKey, telegramUpdate }: { botKey: unknown; telegramUpdate: unknown }
): Promise<PreparedUpdate> {
  const botMeta = ctx.publicBotMetaForKey(rawBotKey);
  const botKey = normalizeBotKey(botMeta?.bot_key);
  if (!botKey) throw new BotRuntimeInputError('unknown_bot');

  const input = normalizeTelegramUpdate(telegramUpdate);
  const locale = ctx.getBotLocale(botKey);
  let keyboardState: KeyboardStateRow = {};
  let feedbackReplyState: Awaited<ReturnType<typeof fetchFeedbackReplyState>> = null;

  // Settings callbacks route only by their payload and load live state in the
  // handler. Neither keyboard snapshots nor pending feedback affect this route.
  const isSettingsCallback = parseCallbackData(input.callbackQuery)?.group === 'settings';
  if (!isSettingsCallback && input.chatId !== null && input.isPrivate && !input.sender.isBot) {
    [keyboardState, feedbackReplyState] = await Promise.all([
      fetchKeyboardState(ctx.pool, input.chatId, botKey),
      fetchFeedbackReplyState(ctx.pool, input.chatId, botKey, input.message.replyToMessageId)
    ]);
  }

  // An ambiguous send may have reached Telegram without returning its message
  // ID. A reply to this bot's exact feedback prompt must never enter tutor AI.
  const botUrl=String((botMeta as Record<string,unknown>)?.telegram_url||'');
  const botUsername=botUrl.split('/').pop()?.split('?')[0].toLowerCase();
  const prompt=String((locale as Record<string,unknown>)?.msg_feedback_prompt||'Please reply to this message with text or a voice note.').trim();
  if(feedbackReplyState===null && input.message.replyToMessageId && botUsername &&
    input.message.replyToMessageBotUsername?.toLowerCase()===botUsername && input.message.replyToMessageText===prompt)
    feedbackReplyState='expired';

  return buildPreparedUpdate({
    botKey,
    input,
    keyboardState,
    locale,
    pendingFeedback: feedbackReplyState === 'pending',
    feedbackExpired: feedbackReplyState === 'expired'
  });
}
