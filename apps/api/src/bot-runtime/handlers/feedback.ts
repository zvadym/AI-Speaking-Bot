import type { Pool } from 'pg';
import { saveFeedback } from '../../feedback-service.js';
import type { PreparedUpdate } from '../contracts.js';
import { runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import { deliverTelegramText, type TelegramTextClient } from '../telegram-text-delivery.js';
import { lockFeedbackReply,feedbackExitReplyMarkup } from '../feedback-session.js';
import { withSettingsLock } from './settings.js';
import { fetchKeyboardState } from '../context-loader.js';
import { settingsView } from '../settings-model.js';
import { renderSettingsRich,settingsLabels } from '../settings-views.js';

type FeedbackRoute='pending_feedback.text'|'pending_feedback.voice'|'pending_feedback.unsupported'|'feedback.expired';
interface FeedbackClient extends TelegramTextClient {
  callTelegramApi(botKey:string,method:string,body:Record<string,unknown>):Promise<unknown>;
}
interface Dependencies {
  pool:Pool;getBotLocale(botKey:string):unknown;telegramClient:FeedbackClient;
  wakeNotifications?:()=>Promise<unknown>;
  effectRunner?:typeof runBotUpdateEffect;textDeliverer?:typeof deliverTelegramText;
  lock?:typeof withSettingsLock;
}
function text(locale:unknown,key:string,fallback:string){return String((locale as Record<string,unknown>)?.[key]||fallback);}

export function createFeedbackMessageHandler(route:FeedbackRoute,{
  pool,getBotLocale,telegramClient,wakeNotifications,
  effectRunner=runBotUpdateEffect,textDeliverer=deliverTelegramText,lock=withSettingsLock
}:Dependencies):BotHandler<typeof route>{
  return {route,version:BOT_RUNTIME_HANDLER_VERSIONS[route],async execute(update){
    const chatId=update.input.chatId;
    if(!chatId||!update.input.isPrivate||update.input.sender.id!==chatId)
      throw new BotRuntimeHandlerError('invalid_feedback_owner',{retryable:false});
    const locale=getBotLocale(update.botKey);
    if(route==='feedback.expired'||route==='pending_feedback.unsupported'){
      const key=route==='feedback.expired'?'msg_feedback_expired':'msg_feedback_unsupported';
      return lock(pool,`settings:${update.botKey}:${chatId}`,async()=>textDeliverer({pool,update,telegramClient,stepKey:`${route}:notice:v1`,
        replyMarkup:route==='feedback.expired'?await feedbackExitReplyMarkup(pool,update):null,
        text:text(locale,key,route==='feedback.expired'?'This feedback request has ended. Open Settings to send a new one.':'Please reply with text or a voice note.')}));
    }
    return lock(pool,`settings:${update.botKey}:${chatId}`,async()=>{
      const effect=await effectRunner(pool,{decisionId:update.decisionId,stepKey:`${route}:state:v2`,execute:async client=>{
        const request=await lockFeedbackReply(client,update);
        if(!request)return {outcome:'expired',cardMessageId:null};
        const voice=route==='pending_feedback.voice';
        const fileId=String(update.input.message.voiceFileId||'').trim();
        const message=String(update.input.message.text||'').trim();
        if((voice&&!fileId)||(!voice&&!message))throw new BotRuntimeHandlerError('invalid_feedback_content',{retryable:false});
        const saved=await saveFeedback(client,{chatId,botKey:update.botKey,username:update.input.sender.username,
          firstName:update.input.sender.firstName,messageId:update.input.message.id,kind:voice?'voice':'text',
          feedbackText:voice?null:message,telegramFileId:voice?fileId:null,source:'telegram',idempotencyKey:update.decisionId});
        await client.query(`UPDATE pending_feedback SET status='completed',completed_feedback_id=$2 WHERE session_id=$1`,[request.session_id,saved.id]);
        return {outcome:'saved',cardMessageId:Number(request.card_message_id),feedbackId:saved.id};
      }});
      if(effect.result.outcome==='saved'){
        await wakeNotifications?.().catch(()=>{}); // The durable scanner recovers a missed wake.
        const cardId=Number(effect.result.cardMessageId);
        if(cardId){
          const active=await pool.query(`SELECT 1 FROM pending_feedback WHERE chat_id=$1 AND bot_key=$2 AND card_message_id=$3 AND status='awaiting' AND expires_at>NOW() LIMIT 1`,[chatId,update.botKey,cardId]);
          if(!active.rows.length){
            const view=settingsView(await fetchKeyboardState(pool,chatId,update.botKey));
            await telegramClient.callTelegramApi(update.botKey,'editMessageText',{chat_id:chatId,message_id:cardId,
              rich_message:renderSettingsRich(view,settingsLabels(locale))}).catch(()=>{});
          }
        }
      }
      return textDeliverer({pool,update,telegramClient,stepKey:`${route}:${effect.result.outcome}:v2`,
        replyMarkup:await feedbackExitReplyMarkup(pool,update),
        text:effect.result.outcome==='saved'?text(locale,'msg_feedback_thanks','Thanks, your feedback was received.')
          :text(locale,'msg_feedback_expired','This feedback request has ended. Open Settings to send a new one.')});
    });
  }};
}

export function createFeedbackHandlers(deps:Dependencies):BotHandler[]{
  return (['pending_feedback.text','pending_feedback.unsupported','feedback.expired'] as const)
    .map(route=>createFeedbackMessageHandler(route,deps));
}
