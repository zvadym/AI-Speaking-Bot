import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { fetchKeyboardState } from '../context-loader.js';
import { runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler, type BotHandlerOutcome } from '../handler-registry.js';
import { buildPersistentReplyMarkup } from '../keyboard-state.js';
import { deliverTelegramText, classifyTelegramDeliveryError } from '../telegram-text-delivery.js';
import { applySettingsAction, parseSettingsAction, SettingsInputError, settingsView, type SettingsAction } from '../settings-model.js';
import { renderSettingsRich, settingsLabels } from '../settings-views.js';
import { deleteSettingsMessage } from '../settings-message.js';
import type { TelegramTextClient } from '../telegram-text-delivery.js';

export interface SettingsTelegramClient extends TelegramTextClient {
  answerTelegramCallbackQuery(id: string, text?: string, options?: {botKey?: string | null; showAlert?: boolean}): Promise<unknown>;
  callTelegramApi(botKey: string, method: string, body: Record<string, unknown>): Promise<unknown>;
}

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
export function createSettingsHandlers({ pool, getBotLocale, telegramClient,
  effectRunner = runBotUpdateEffect, stateLoader = fetchKeyboardState,
  textDeliverer = deliverTelegramText, lock = withSettingsLock
}: { pool: Pool; getBotLocale(key: string): unknown; telegramClient: SettingsTelegramClient;
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
    if (update.route === 'command.settings' && update.context.keyboard.buttonIntent !== 'settings') {
      // Telegram cannot edit a message carrying a reply keyboard. Refresh legacy
      // keyboards separately on /settings; the reply button itself needs one card.
      await textDeliverer({pool,update,telegramClient,stepKey:'settings:keyboard:v1',text:'⚙️ '+l.title,
        replyMarkup:buildPersistentReplyMarkup(update.context.keyboard)});
    }
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
        let inputError = false;
        if (['level','reply'].includes(action.kind)) {
          try {
            await effectRunner(pool,{decisionId:update.decisionId,stepKey:'settings:mutation:v1',execute:client=>applySettingsAction(client,update,action)});
          } catch(error) { if(error instanceof SettingsInputError) inputError=true; else throw error; }
        }
        const row = await stateLoader(pool,chatId,update.botKey);
        const view = settingsView(row);
        if(inputError) view.e='unavailable';
        if (action.kind === 'open') {
          const outcome = await textDeliverer({pool,update,stepKey:'settings:open:r:v1',text:l.title,telegramMethod:'sendRichMessage',
            telegramClient:{sendTelegramTextMessage:async()=>api('sendRichMessage',{
              chat_id:chatId,rich_message:renderSettingsRich(view,l)
            }) as Promise<{message_id?:unknown}>}});
          await answer();return outcome;
        }
        try {
          if(action.kind==='close')await deleteSettingsMessage(api,chatId,cb!.messageId!);
          else await api('editMessageText',{chat_id:chatId,message_id:cb!.messageId,rich_message:renderSettingsRich(view,l)});
        } catch(error) { if(!String((error as Error).message).includes('message is not modified')) throw error; }
        await answer(inputError);
        return {status:'delivered',telegramMessageId:cb!.messageId};
      } catch(error) {
        await answer(true);
        if(error instanceof BotRuntimeHandlerError) throw error;
        const failure = classifyTelegramDeliveryError(error);
        // Editing or deleting an existing message is safe to retry after ambiguous failures.
        throw new BotRuntimeHandlerError(failure.errorCode,{retryable:failure.kind!=='permanent',cause:error});
      }
    });
  };
  return ['command.settings','callback.settings'].map(route=>({route,version:1,execute})) as BotHandler[];
}
