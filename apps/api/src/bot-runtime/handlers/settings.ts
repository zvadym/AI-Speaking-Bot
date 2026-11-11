import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { fetchKeyboardState } from '../context-loader.js';
import { runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler, type BotHandlerOutcome } from '../handler-registry.js';
import { buildPersistentReplyMarkup } from '../keyboard-state.js';
import { deliverTelegramText, classifyTelegramDeliveryError } from '../telegram-text-delivery.js';
import { accessibleSettingsCatalog, applySettingsAction, parseSettingsAction, SettingsInputError, settingsView, type SettingsAction } from '../settings-model.js';
import { renderSettingsRich, settingsLabels } from '../settings-views.js';
import type { TopicMenuHelpers, TopicTelegramClient } from './topic-menu.js';

// A session lock serializes settings cards for the same learner/bot, including
// rendering. It never holds a transaction open while calling Telegram.
export async function withSettingsLock<T>(pool: Pool, key: string, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let locked = false;
  let releaseError: Error | undefined;
  try {
    const result = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key]);
    if (!result.rows[0]?.locked) throw new BotRuntimeHandlerError('settings_busy', {retryable:true});
    locked = true;
    return await work();
  } finally {
    if (locked) try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]); }
    catch (error) { releaseError = error as Error; }
    client.release(releaseError);
  }
}
export function createSettingsHandlers({ pool, getBotLocale, telegramClient, helpers,
  effectRunner = runBotUpdateEffect, stateLoader = fetchKeyboardState,
  textDeliverer = deliverTelegramText, lock = withSettingsLock
}: { pool: Pool; getBotLocale(key: string): unknown; telegramClient: TopicTelegramClient; helpers: TopicMenuHelpers;
  effectRunner?: typeof runBotUpdateEffect; stateLoader?: typeof fetchKeyboardState;
  textDeliverer?: typeof deliverTelegramText; lock?: typeof withSettingsLock;
}): BotHandler[] {
  const execute = async (update: PreparedUpdate): Promise<BotHandlerOutcome> => {
    const chatId = update.input.chatId;
    const cb = update.input.callbackQuery;
    const widget = update.input.updateType === 'widget_query';
    if (!update.input.isPrivate || !chatId || !Number.isSafeInteger(chatId) || chatId <= 0 || update.input.sender.id !== chatId || (cb && (cb.userId !== chatId || !cb.messageId))) {
      throw new BotRuntimeHandlerError('invalid_settings_owner', {retryable:false});
    }
    const l = settingsLabels(getBotLocale(update.botKey));
    const api = (method: string, body: Record<string,unknown>) => telegramClient.callTelegramApi(update.botKey,method,body);
    const answer = async (error = false) => {
      if (!cb) return;
      try {
        if(widget) await api('answerWidgetQuery',{widget_query_id:cb.id,data:JSON.stringify({error:true})});
        else await telegramClient.answerTelegramCallbackQuery(cb.id,error?l.error:undefined,{botKey:update.botKey,showAlert:error});
      } catch { /* Query IDs expire; persisted state and message edits are durable. */ }
    };
    // Retired widgets may still have queued queries. Never apply their mutations.
    if (widget) { await answer(true); return {status:'noop'}; }
    let action: SettingsAction;
    try {
      action = update.route === 'command.settings'
        ? {variant:'r',kind:'open',value:''}
        : parseSettingsAction(cb?.data || '');
      // Buttons in previously sent choosers now open the remaining card.
      if (action.variant === 'w' && action.kind !== 'open') throw new SettingsInputError('invalid');
      action.variant = 'r';
    } catch { await answer(true);return {status:'noop'}; }
    return lock(pool, `settings:${update.botKey}:${chatId}`, async () => {
      try {
        const catalog = await accessibleSettingsCatalog(helpers,chatId,update.botKey);
        let inputError = false;
        if (['level','reply','topic'].includes(action.kind)) {
          try {
            const effect = await effectRunner(pool,{decisionId:update.decisionId,stepKey:'settings:mutation:v1',execute:client=>applySettingsAction(client,update,action,catalog)});
            if(effect.result.oldPin) await api('unpinChatMessage',{chat_id:chatId,message_id:effect.result.oldPin}).catch(()=>{});
          } catch(error) { if(error instanceof SettingsInputError) inputError=true; else throw error; }
        }
        const row = await stateLoader(pool,chatId,update.botKey);
        const view = settingsView(row,catalog,action,l.free);
        if(inputError) view.e='unavailable';
        if (action.kind === 'open') {
          const outcome = await textDeliverer({pool,update,stepKey:'settings:open:r:v1',text:l.title,telegramMethod:'sendRichMessage',
            telegramClient:{sendTelegramTextMessage:async()=>api('sendRichMessage',{
              chat_id:chatId,rich_message:renderSettingsRich(view,l),
              reply_markup:buildPersistentReplyMarkup(update.context.keyboard)
            }) as Promise<{message_id?:unknown}>}});
          await answer();return outcome;
        }
        try {
          await api('editMessageText',{chat_id:chatId,message_id:cb!.messageId,rich_message:renderSettingsRich(view,l)});
        } catch(error) { if(!String((error as Error).message).includes('message is not modified')) throw error; }
        await answer(inputError);
        return {status:'delivered',telegramMessageId:cb!.messageId};
      } catch(error) {
        await answer(true);
        if(error instanceof BotRuntimeHandlerError) throw error;
        const failure = classifyTelegramDeliveryError(error);
        // Editing an existing message is safe to retry, including ambiguous HTTP failures.
        throw new BotRuntimeHandlerError(failure.errorCode,{retryable:failure.kind!=='permanent',cause:error});
      }
    });
  };
  return ['command.settings','callback.settings'].map(route=>({route,version:1,execute})) as BotHandler[];
}
