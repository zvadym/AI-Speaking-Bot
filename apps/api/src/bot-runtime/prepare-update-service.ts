import { normalizeBotKey } from '../shared/normalization.js';
import {
  BotRuntimeInputError,
  type KeyboardStateRow,
  type PrepareUpdateContext,
  type PreparedUpdate
} from './contracts.js';
import { fetchKeyboardState, fetchPendingFeedbackState } from './context-loader.js';
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
  let pendingFeedback = false;

  // Settings callbacks route only by their payload and load live state in the
  // handler. Neither keyboard snapshots nor pending feedback affect this route.
  const isSettingsCallback = parseCallbackData(input.callbackQuery)?.group === 'settings';
  if (!isSettingsCallback && input.chatId !== null && input.isPrivate && !input.sender.isBot) {
    [keyboardState, pendingFeedback] = await Promise.all([
      fetchKeyboardState(ctx.pool, input.chatId, botKey),
      fetchPendingFeedbackState(ctx.pool, input.chatId, botKey)
    ]);
  }

  return buildPreparedUpdate({
    botKey,
    input,
    keyboardState,
    locale,
    pendingFeedback
  });
}
