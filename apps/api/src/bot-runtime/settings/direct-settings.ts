import { prepareSettingsScreen } from './settings-screens.js';
import { BotRuntimeHandlerError } from '../handler-registry.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { KeyboardStateRow, NormalizedTelegramUpdate } from '../contracts.js';
import { withSettingsLock } from '../handlers/settings.js';
import { parseSettingsAction, settingsView, type SettingsAction } from './settings-model.js';
import { renderSettingsRich, settingsLabels } from './settings-views.js';
import { deleteSettingsMessage } from './settings-message.js';
import { classifyTelegramDeliveryError } from '../delivery/telegram-text-delivery.js';
import { buildPreparedUpdate } from '../update-router.js';
import { bootstrapTelegramUser } from '../user-bootstrap.js';
import { sendReservedSettingsMessages, type ReservedSettingsDelivery, type SettingsDeliveryResult } from './direct-settings-open.js';
import { renderSettingsWidget,encodeWidgetSettings } from './settings-widget.js';
import { loadWidgetCard,saveWidgetScreen } from './settings-widget-cards.js';
import { editSettingsCard } from './settings-card-update.js';
import { vocabularyLanguage } from '../../vocabulary/types.js';
import { loadStatsContext } from './stats-context.js';

interface TelegramApi {
  callTelegramApi(botKey: string, method: string, body: Record<string, unknown>, options?: {signal?: AbortSignal}): Promise<unknown>;
}

// One autocommitted statement: preference changes and their idempotency record
// either both persist or neither does. No transaction spans a Telegram request.
// Reuse the worker's ledger/step key so pre-rollout queued deliveries remain safe.
export async function saveDirectSettings(pool: Pool, botKey: string, input: NormalizedTelegramUpdate,
  action: SettingsAction, requestId: string) {
  const result = await pool.query<{
    state: KeyboardStateRow; render: boolean; feedback_active?: boolean; deliveries: ReservedSettingsDelivery[];
  }>(`WITH current AS MATERIALIZED (
      SELECT * FROM user_bots WHERE chat_id=$1 AND bot_key=$2
    ), execution AS (
      INSERT INTO bot_update_executions
        (decision_id,bot_key,update_id,contract_version,route,handler_version,status,current_job_id,lease_expires_at)
      SELECT $3,$2,$4,1,$10,1,'running',$5::uuid,NOW()+INTERVAL '30 seconds' FROM current
      ON CONFLICT (decision_id) DO UPDATE SET
        status='running', attempts=bot_update_executions.attempts+1,
        current_job_id=EXCLUDED.current_job_id, updated_at=NOW(), lease_expires_at=EXCLUDED.lease_expires_at
      WHERE bot_update_executions.status NOT IN ('succeeded','permanent_failed')
        AND bot_update_executions.bot_key=EXCLUDED.bot_key AND bot_update_executions.update_id=EXCLUDED.update_id
        AND bot_update_executions.route=EXCLUDED.route AND bot_update_executions.handler_version=1
      RETURNING decision_id,created_at
    ), desired_delivery AS (
      SELECT step_key,telegram_method FROM bot_update_deliveries WHERE decision_id=$3
        AND step_key IN ('settings:open:r:v1','settings:open:h:v1') AND $6='open'
      UNION ALL
      SELECT 'settings:open:r:v1'::text,'sendRichMessage'::text WHERE $6='open'
        AND NOT EXISTS(SELECT 1 FROM bot_update_deliveries WHERE decision_id=$3 AND step_key IN ('settings:open:r:v1','settings:open:h:v1'))
    ), widget_card AS (
      INSERT INTO bot_settings_widget_cards(decision_id,chat_id,bot_key,action_at)
      SELECT e.decision_id,$1,$2,e.created_at
      FROM execution e,desired_delivery d WHERE d.telegram_method='sendWidget'
      ON CONFLICT(decision_id) DO NOTHING
    ), reserved_delivery AS (
      INSERT INTO bot_update_deliveries(decision_id,step_key,telegram_method,status,attempts)
      SELECT e.decision_id,d.step_key,d.telegram_method,'pending',1 FROM execution e CROSS JOIN desired_delivery d
      ON CONFLICT (decision_id,step_key) DO UPDATE SET status='pending',
        attempts=bot_update_deliveries.attempts+1,telegram_message_id=NULL,error_code=NULL,error_detail=NULL,updated_at=NOW()
      WHERE bot_update_deliveries.telegram_method=EXCLUDED.telegram_method
        AND (bot_update_deliveries.status='failed' OR
          (bot_update_deliveries.status='pending' AND bot_update_deliveries.attempts=0))
      RETURNING id::text,step_key,telegram_method,status,telegram_message_id,true AS send
    ), effect AS (
      INSERT INTO bot_update_effects(decision_id,step_key,status,result_json)
      SELECT e.decision_id,'settings:mutation:v1','completed',
        '{}'::jsonb
      FROM execution e WHERE $6 IN ('level','reply')
      ON CONFLICT (decision_id,step_key) DO NOTHING RETURNING result_json
    ), profile AS (
      UPDATE users SET username=$8,first_name=$9,inactive_reason=NULL,inactive_at=NULL,last_delivery_error=NULL,updated_at=NOW()
      WHERE chat_id=$1 AND EXISTS(SELECT 1 FROM execution) RETURNING chat_id
    ), changed AS (
      UPDATE user_bots ub SET
        level=CASE WHEN $6='level' AND EXISTS(SELECT 1 FROM effect) THEN $7 ELSE ub.level END,
        reply_mode=CASE WHEN $6='reply' AND EXISTS(SELECT 1 FROM effect) THEN $7 ELSE ub.reply_mode END,
        last_seen_at=NOW(),is_active=true,updated_at=NOW()
      FROM profile WHERE ub.chat_id=profile.chat_id AND ub.bot_key=$2 RETURNING ub.*
    ) SELECT COALESCE((SELECT row_to_json(c) FROM changed c),row_to_json(current)) AS state,
      EXISTS(SELECT 1 FROM execution) AS render,
      EXISTS(SELECT 1 FROM pending_feedback WHERE chat_id=$1 AND bot_key=$2 AND status='awaiting') AS feedback_active,
      COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM (
        SELECT * FROM reserved_delivery
        UNION ALL
        SELECT d.id::text,d.step_key,d.telegram_method,d.status,d.telegram_message_id,false AS send
        FROM bot_update_deliveries d JOIN desired_delivery wanted USING(step_key)
        WHERE d.decision_id=$3 AND NOT EXISTS(SELECT 1 FROM reserved_delivery r WHERE r.id=d.id::text)
      ) d),'[]'::jsonb) AS deliveries
    FROM current`, [input.chatId,botKey,`v1:${botKey}:${input.updateId}`,input.updateId,requestId,
    action.kind,action.value,input.sender.username,input.sender.firstName,input.updateType==='message'?'settings.open':'callback.settings']);
  return result.rows[0] || null;
}

export function createDirectSettingsHandler({pool,telegramClient,getBotLocale,onboardingEnabledBotKeys,webappUrl}: {
  pool:Pool;telegramClient:TelegramApi;getBotLocale(key:string):unknown;webappUrl?:string;onboardingEnabledBotKeys?:ReadonlySet<string>;
}) {
  const pending=new Map<string,Promise<boolean>>();
  return async (botKey:string,input:NormalizedTelegramUpdate):Promise<boolean> => {
    const started=performance.now();
    const cb=input.callbackQuery;
    const widget=input.updateType==='widget_query';
    const prepared=buildPreparedUpdate({botKey,input,locale:getBotLocale(botKey)});
    const command=prepared.route==='settings.open' && input.updateType==='message';
    if(!command&&(!['callback_query','widget_query'].includes(input.updateType)||!cb?.data.startsWith('settings:')))return false;
    const labels=settingsLabels(getBotLocale(botKey));
    const api=(method:string,body:Record<string,unknown>)=>telegramClient.callTelegramApi(botKey,method,body,{signal:AbortSignal.timeout(method.startsWith('send')?10000:3000)});
    let answerData:string|undefined;
    const answer=async(error=false)=>{if(!cb)return;await api(widget?'answerWidgetQuery':'answerCallbackQuery',widget?
      {widget_query_id:cb.id,data:error?JSON.stringify({error:true}):answerData||JSON.stringify({ok:true})}:
      {callback_query_id:cb.id,...(error?{text:labels.error,show_alert:true}:{})}).catch(()=>{});};
    if(!input.isPrivate||input.sender.isBot||!input.chatId||!Number.isSafeInteger(input.chatId)||input.chatId<=0||input.sender.id!==input.chatId||(cb&&(cb.userId!==input.chatId||!cb.messageId))){
      await answer(true);return true;
    }
    let action:SettingsAction;
    try{action=command?{variant:'r',kind:'open',value:''}:parseSettingsAction(cb!.data);}catch{await answer(true);return true;}
    if(action.kind==='vocabulary'&&!vocabularyLanguage(botKey.split('-')[1])){await answer(true);return true;}
    if(widget?(action.variant!=='h'||action.kind==='open'):!command&&action.variant==='h'){await answer(true);return true;}
    if(action.kind==='open')action.variant='r'; // Old chooser buttons open the current card.
    if(!widget&&action.variant==='w'){await answer(true);return true;}
    const key=`settings:${botKey}:${input.chatId}`;
    const run=async()=>withSettingsLock(pool,key,async()=>{
      const card=widget?await loadWidgetCard(pool,prepared):null;
      if(widget&&(!card||(card.screen==='closed'&&action.kind!=='close'))){await answer(true);return true;}
      const requestId=randomUUID(),decisionId=`v1:${botKey}:${input.updateId}`;
      let saved=await saveDirectSettings(pool,botKey,input,action,requestId);
      if(!saved && action.kind==='open'){
        await bootstrapTelegramUser(pool,{botKey,input,onboardingEnabledBotKeys});
        saved=await saveDirectSettings(pool,botKey,input,action,requestId);
        if(!saved)throw new Error('settings_profile_unavailable');
      }
      if(!saved)return false; // Compatibility fallback for a callback without a profile.
      if(!saved.render){await answer();return true;}
      const view=settingsView(saved.state);view.botKey=botKey;view.webappUrl=webappUrl;
      let status='succeeded',errorCode:string|null=null;
      let deliveries:SettingsDeliveryResult[]=[];
      try {
      if(action.kind==='refresh'&&card){
        view.screen=card.screen;
        if(view.screen==='stats')view.stats=await loadStatsContext(pool,input.chatId!);
      }else if(['stats','feedback','cancel','vocabulary'].includes(action.kind)||saved.feedback_active)
        await prepareSettingsScreen({pool,update:prepared,action,view,locale:getBotLocale(botKey),api});
      if(widget){
        const screen=action.kind==='close'&&view.screen!=='feedback'?'closed':view.screen||'home';
        const current=await saveWidgetScreen(pool,prepared,screen);
        view.screen=current?.screen||screen;
        if(view.screen==='stats'&&!view.stats)view.stats=await loadStatsContext(pool,input.chatId!);
        answerData=encodeWidgetSettings(view);
      }
      if(action.kind==='open'){
        const sent=await sendReservedSettingsMessages({deliveries:saved.deliveries,chatId:input.chatId!,
          richMessage:renderSettingsRich(view,labels),widget:{html:renderSettingsWidget(labels),chat_data:encodeWidgetSettings(view),allow_queries:true},api,
          reserveRichFallback:async delivery=>{
            // Persist the transport before sending, so crash/replay cannot
            // resend an ambiguous fallback or bind a rich card as a widget.
            const reserved=await pool.query(`UPDATE bot_update_deliveries SET telegram_method='sendRichMessage',updated_at=NOW()
              WHERE id=$1 AND decision_id=$2 AND telegram_method='sendWidget' AND status='pending' RETURNING id`,[delivery.id,decisionId]);
            if(reserved.rowCount!==1)throw new Error('settings_fallback_reservation_lost');
          }});
        status=sent.status;errorCode=sent.errorCode;deliveries=sent.deliveries;
      }else {
        if(action.kind==='close'&&view.screen!=='feedback')await deleteSettingsMessage(api,input.chatId!,cb!.messageId!);
        else await editSettingsCard({chatId:input.chatId!,messageId:cb!.messageId!,view,locale:getBotLocale(botKey),widget,api});
      }
      }catch(error){
        if(!String((error as Error).message).includes('message is not modified')){
          if(error instanceof BotRuntimeHandlerError){status=error.retryable?'retryable_failed':'permanent_failed';errorCode=error.code;}
          else { const failure=classifyTelegramDeliveryError(error);
          status=failure.kind==='permanent'?'permanent_failed':'retryable_failed';errorCode=failure.errorCode; }
        }
      }
      const editedMs=Math.round(performance.now()-started);
      await Promise.all([
        pool.query(`WITH delivered AS (
          UPDATE bot_update_deliveries d SET status=r.status,telegram_message_id=r.message_id,
            error_code=r.error_code,error_detail=NULL,updated_at=NOW()
          FROM jsonb_to_recordset($5::jsonb) AS r(id bigint,status text,message_id bigint,error_code text)
          WHERE d.id=r.id AND d.decision_id=$1 AND d.status IN ('pending','unknown')
          RETURNING d.decision_id,d.telegram_method,d.telegram_message_id
        ), bound AS (
          UPDATE bot_settings_widget_cards c SET message_id=r.message_id
          FROM jsonb_to_recordset($5::jsonb) AS r(id bigint,status text,message_id bigint,error_code text),bot_update_deliveries d
          WHERE d.id=r.id AND c.decision_id=d.decision_id AND d.telegram_method='sendWidget' AND r.status='delivered' AND r.message_id IS NOT NULL
        ) UPDATE bot_update_executions SET status=$3,terminal_error_code=$4,
          completed_at=CASE WHEN $3='retryable_failed' THEN NULL ELSE NOW() END,updated_at=NOW(),lease_expires_at=NOW()
          WHERE decision_id=$1 AND current_job_id=$2::uuid`,[decisionId,requestId,status,errorCode,JSON.stringify(deliveries)]),
        answer(status!=='succeeded')
      ]);
      console.info('settings-direct:processed',{botKey,updateId:input.updateId,action:action.kind,status,...(action.kind==='open'?{sentMs:editedMs}:action.kind==='close'?{deletedMs:editedMs}:{editedMs})});
      if(status==='retryable_failed')throw new Error(errorCode!);
      return true;
    });
    // FIFO within one API process; the shared advisory lock also covers old
    // queued jobs and other API processes. Always release a rejected tail.
    const task=(pending.get(key)||Promise.resolve(false)).catch(()=>false).then(run);
    pending.set(key,task);
    try{return await task;}finally{if(pending.get(key)===task)pending.delete(key);}
  };
}
