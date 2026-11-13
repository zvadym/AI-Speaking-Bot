import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { runBotUpdateEffect } from '../execution/effect-repository.js';
import { startFeedbackRequest,cancelFeedbackRequests,loadFeedbackRequest,feedbackExitReplyMarkup } from '../../feedback/session.js';
import { settingsLabels } from './settings-views.js';
import { deliverTelegramText } from '../delivery/telegram-text-delivery.js';
import { loadStatsContext } from './stats-context.js';
import type { SettingsAction, SettingsView } from './settings-model.js';

type Api = (method:string,body:Record<string,unknown>)=>Promise<unknown>;

// Called while holding the shared settings lock. Transactions only own DB work;
// durable Telegram delivery prevents replay from duplicating ForceReply prompts.
export async function prepareSettingsScreen({pool,update,action,view,locale,api}: {
  pool:Pool;update:PreparedUpdate;action:SettingsAction;view:SettingsView;locale:unknown;api:Api;
}):Promise<void> {
  if(action.kind==='feedback'){
    const effect=await runBotUpdateEffect(pool,{decisionId:update.decisionId,stepKey:'settings:feedback-request:v1',
      execute:client=>startFeedbackRequest(client,update)});
    await deletePrompts(api,update.input.chatId!,effect.result.cancelledPromptIds);
    const request=await loadFeedbackRequest(pool,effect.result.sessionId);
    if(!request||request.status!=='awaiting'||new Date(request.expires_at).getTime()<=Date.now()){
      await keepActiveFeedbackView(pool,update,view);return;
    }
    const l=locale as Record<string,unknown>;
    const prompt=String(l.msg_feedback_prompt||'Please reply to this message with text or a voice note.');
    const delivered=await deliverTelegramText({pool,update,stepKey:'settings:feedback-prompt:v1',text:prompt,
      replyMarkup:{force_reply:true,input_field_placeholder:String(l.msg_feedback_placeholder||'Your feedback').slice(0,64)},
      telegramClient:{sendTelegramTextMessage:async(chatId,text,options)=>api('sendMessage',{
        chat_id:chatId,text,reply_markup:options.replyMarkup
      }) as Promise<{message_id?:unknown}>}});
    if(!delivered.telegramMessageId)throw new Error('feedback_prompt_id_missing');
    await pool.query(`UPDATE pending_feedback SET prompt_message_id=$2
      WHERE session_id=$1 AND status='awaiting' AND prompt_message_id IS NULL`,[effect.result.sessionId,delivered.telegramMessageId]);
    view.screen='feedback';
    return;
  }
  // Any explicit navigation away from feedback ends the active request.
  const effect=await runBotUpdateEffect(pool,{decisionId:update.decisionId,stepKey:'settings:feedback-cancel:v1',
    execute:client=>cancelFeedbackRequests(client,update)});
  await deletePrompts(api,update.input.chatId!,effect.result.cancelledPromptIds);
  if(await keepActiveFeedbackView(pool,update,view))return;
  if(effect.result.cancelledCount||effect.result.cancelledPromptIds.length){
    const replyMarkup=await feedbackExitReplyMarkup(pool,update);
    if(replyMarkup)await deliverTelegramText({pool,update,stepKey:'settings:feedback-keyboard:v1',
      text:settingsLabels(locale).title,replyMarkup,
      telegramClient:{sendTelegramTextMessage:async(chatId,text,options)=>api('sendMessage',{
        chat_id:chatId,text,reply_markup:options.replyMarkup
      }) as Promise<{message_id?:unknown}>}});
  }
  if(action.kind==='stats'){
    view.screen='stats';
    view.stats=await loadStatsContext(pool,update.input.chatId!);
  }
}

export async function deletePrompts(api:Api,chatId:number,ids:number[]){
  for(const id of ids)await api('deleteMessage',{chat_id:chatId,message_id:id}).catch(()=>{});
}

async function keepActiveFeedbackView(pool:Pool,update:PreparedUpdate,view:SettingsView){
  const result=await pool.query(`SELECT 1 FROM pending_feedback WHERE chat_id=$1 AND bot_key=$2
    AND card_message_id=$3 AND status='awaiting' AND expires_at>NOW() LIMIT 1`,
    [update.input.chatId,update.botKey,update.input.callbackQuery?.messageId||null]);
  if(result.rows.length){view.screen='feedback';return true;}return false;
}
