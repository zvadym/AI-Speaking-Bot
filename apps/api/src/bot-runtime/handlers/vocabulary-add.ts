import type { Pool } from 'pg';
import { addVocabularySnapshotWord, loadVocabularySnapshot, VocabularySnapshotError, withVocabularyRenderLock } from '../../vocabulary/snapshots.js';
import { formatVocabulary, localeRecord, localeText, type SupportTelegramClient } from '../support.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { classifyTelegramDeliveryError } from '../delivery/telegram-text-delivery.js';

export function createVocabularyAddHandler({pool,getBotLocale,telegramClient}:{pool:Pool;getBotLocale(botKey:string):unknown;telegramClient:SupportTelegramClient}):BotHandler<'callback.vocab_add'> {
  return {route:'callback.vocab_add',version:1,async execute(update){
    const locale=localeRecord(getBotLocale(update.botKey));const callback=update.input.callbackQuery;
    const chatId=update.input.chatId;const rowId=update.routingFacts.callback?.value||'';
    const acknowledge=async(text:string)=>{if(callback)try{await telegramClient.answerTelegramCallbackQuery(callback.id,text,{botKey:update.botKey});}catch{}};
    if(!callback||!chatId||!Number.isSafeInteger(chatId)||chatId<=0||!update.input.isPrivate||update.input.sender.id!==chatId||callback.userId!==chatId||
      !callback.messageId||!Number.isSafeInteger(callback.messageId)||callback.messageId<=0||callback.data!==`vadd:${rowId}`||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(rowId)){
      await acknowledge(localeText(locale,'vocab_unavailable','This vocabulary table is unavailable.'));return {status:'noop'};
    }
    let snapshotId:string;
    try{snapshotId=await addVocabularySnapshotWord(pool,rowId,chatId,update.botKey,callback.messageId);}
    catch(error){
      if(!(error instanceof VocabularySnapshotError))throw error;
      if(error.message==='vocabulary_snapshot_pending')throw new BotRuntimeHandlerError(error.message,{retryable:true});
      await acknowledge(localeText(locale,'vocab_unavailable','This vocabulary table is unavailable.'));return {status:'noop'};
    }
    await acknowledge(localeText(locale,'vocab_saved','Saved to your vocabulary.'));
    await withVocabularyRenderLock(pool,snapshotId,async client=>{
      const snapshot=await loadVocabularySnapshot(client,snapshotId,chatId,update.botKey);
      try{
        await telegramClient.callTelegramApi(update.botKey,'editMessageText',{chat_id:chatId,message_id:callback.messageId,
          rich_message:formatVocabulary(snapshot.rows.map(r=>r.item),locale,snapshot.rows)});
      }catch(error){
        if(String((error as Error).message).toLowerCase().includes('message is not modified'))return;
        const classified=classifyTelegramDeliveryError(error);
        // Editing a known message is idempotent, including an ambiguous network outcome.
        throw new BotRuntimeHandlerError(classified.errorCode,{retryable:classified.kind!=='permanent',cause:error});
      }
    });
    return {status:'noop'};
  }};
}
