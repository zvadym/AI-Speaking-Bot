import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { KeyboardStateRow, NormalizedTelegramUpdate } from './contracts.js';
import { withSettingsLock } from './handlers/settings.js';
import { buildTopicPack, type TopicMenuHelpers } from './handlers/topic-menu.js';
import { accessibleSettingsCatalog, parseSettingsAction, SETTINGS_LEVELS, settingsView, topicToken, type SettingsAction } from './settings-model.js';
import { renderSettingsRich, settingsLabels } from './settings-views.js';
import { deleteSettingsMessage } from './settings-message.js';
import { classifyTelegramDeliveryError } from './telegram-text-delivery.js';
import { buildPreparedUpdate } from './update-router.js';
import { buildPersistentReplyMarkup } from './keyboard-state.js';
import { bootstrapTelegramUser } from './user-bootstrap.js';
import { sendReservedSettingsMessages, type ReservedSettingsDelivery, type SettingsDeliveryResult } from './direct-settings-open.js';

interface TelegramApi {
  callTelegramApi(botKey: string, method: string, body: Record<string, unknown>, options?: {signal?: AbortSignal}): Promise<unknown>;
}

// One autocommitted statement: preference changes and their idempotency record
// either both persist or neither does. No transaction spans a Telegram request.
// Reuse the worker's ledger/step key so pre-rollout queued deliveries remain safe.
export async function saveDirectSettings(pool: Pool, botKey: string, input: NormalizedTelegramUpdate,
  action: SettingsAction, catalog: Record<string, unknown>[], requestId: string, refreshKeyboard = false) {
  const topic = action.kind === 'topic' && action.value !== 'free'
    ? catalog.find(t => topicToken(t.topic_id) === action.value) : null;
  const inputError = action.kind === 'topic' && action.value !== 'free' && !topic;
  const packs = topic ? Object.fromEntries(SETTINGS_LEVELS.map(level => [level, {
    ...buildTopicPack(topic, level), turns_in_topic: 0, last_assistant_question: ''
  }])) : null;
  const result = await pool.query<{
    state: KeyboardStateRow; render: boolean; old_pin: number | null; deliveries: ReservedSettingsDelivery[];
  }>(`WITH current AS MATERIALIZED (
      SELECT * FROM user_bots WHERE chat_id=$1 AND bot_key=$2
    ), execution AS (
      INSERT INTO bot_update_executions
        (decision_id,bot_key,update_id,contract_version,route,handler_version,status,current_job_id,lease_expires_at)
      SELECT $3,$2,$4,1,$13,1,'running',$5::uuid,NOW()+INTERVAL '30 seconds' FROM current
      ON CONFLICT (decision_id) DO UPDATE SET
        status='running', attempts=bot_update_executions.attempts+1,
        current_job_id=EXCLUDED.current_job_id, updated_at=NOW(), lease_expires_at=EXCLUDED.lease_expires_at
      WHERE bot_update_executions.status NOT IN ('succeeded','permanent_failed')
        AND bot_update_executions.bot_key=EXCLUDED.bot_key AND bot_update_executions.update_id=EXCLUDED.update_id
        AND bot_update_executions.route=EXCLUDED.route AND bot_update_executions.handler_version=1
      RETURNING decision_id
    ), desired_delivery AS (
      SELECT 'settings:open:r:v1'::text AS step_key,'sendRichMessage'::text AS telegram_method WHERE $6='open'
      UNION ALL SELECT 'settings:keyboard:v1','sendMessage' WHERE $6='open' AND $14::boolean
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
        jsonb_build_object('oldPin',CASE WHEN $6='topic' THEN c.topic_pinned_message_id ELSE NULL END)
      FROM execution e CROSS JOIN current c WHERE $6 IN ('level','reply','topic') AND NOT $10::boolean
      ON CONFLICT (decision_id,step_key) DO NOTHING RETURNING result_json
    ), profile AS (
      UPDATE users SET username=$11,first_name=$12,inactive_reason=NULL,inactive_at=NULL,last_delivery_error=NULL,updated_at=NOW()
      WHERE chat_id=$1 AND EXISTS(SELECT 1 FROM execution) RETURNING chat_id
    ), changed AS (
      UPDATE user_bots ub SET
        level=CASE WHEN $6='level' AND EXISTS(SELECT 1 FROM effect) THEN $7 ELSE ub.level END,
        reply_mode=CASE WHEN $6='reply' AND EXISTS(SELECT 1 FROM effect) THEN $7 ELSE ub.reply_mode END,
        topic_enabled=CASE WHEN $6='topic' AND EXISTS(SELECT 1 FROM effect) THEN $8::text IS NOT NULL ELSE ub.topic_enabled END,
        topic_template_id=CASE WHEN $6='topic' AND EXISTS(SELECT 1 FROM effect) THEN $8 ELSE ub.topic_template_id END,
        topic_pack_json=CASE WHEN $6='topic' AND EXISTS(SELECT 1 FROM effect) THEN
          COALESCE($9::jsonb->ub.level,$9::jsonb->'a1') ELSE ub.topic_pack_json END,
        topic_pinned_message_id=CASE WHEN $6='topic' AND EXISTS(SELECT 1 FROM effect) THEN NULL ELSE ub.topic_pinned_message_id END,
        topic_updated_at=CASE WHEN $6='topic' AND EXISTS(SELECT 1 FROM effect) THEN NOW() ELSE ub.topic_updated_at END,
        last_seen_at=NOW(),is_active=true,updated_at=NOW()
      FROM profile WHERE ub.chat_id=profile.chat_id AND ub.bot_key=$2 RETURNING ub.*
    ), event AS (
      INSERT INTO action_events(chat_id,bot_key,action_type,source,properties,occurred_at)
      SELECT chat_id,bot_key,CASE WHEN $8::text IS NULL THEN 'topic_clear' ELSE 'topic_set' END,
        'bot_runtime',jsonb_build_object('topic_id',$8::text,'via','settings'),NOW()
      FROM changed WHERE $6='topic' AND EXISTS(SELECT 1 FROM effect)
    ) SELECT COALESCE((SELECT row_to_json(c) FROM changed c),row_to_json(current)) AS state,
      EXISTS(SELECT 1 FROM execution) AS render,
      COALESCE((SELECT (result_json->>'oldPin')::bigint FROM effect),
        (SELECT (result_json->>'oldPin')::bigint FROM bot_update_effects WHERE decision_id=$3 AND step_key='settings:mutation:v1')) AS old_pin
      , COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM (
        SELECT * FROM reserved_delivery
        UNION ALL
        SELECT d.id::text,d.step_key,d.telegram_method,d.status,d.telegram_message_id,false AS send
        FROM bot_update_deliveries d JOIN desired_delivery wanted USING(step_key)
        WHERE d.decision_id=$3 AND NOT EXISTS(SELECT 1 FROM reserved_delivery r WHERE r.id=d.id::text)
      ) d),'[]'::jsonb) AS deliveries
    FROM current`, [input.chatId,botKey,`v1:${botKey}:${input.updateId}`,input.updateId,requestId,
    action.kind,action.value,topic?.topic_id || null,packs ? JSON.stringify(packs) : null,Boolean(inputError),
    input.sender.username,input.sender.firstName,input.updateType==='message'?'command.settings':'callback.settings',refreshKeyboard]);
  return result.rows[0] ? {...result.rows[0],inputError:Boolean(inputError)} : null;
}

export function createDirectSettingsHandler({pool,telegramClient,getBotLocale,helpers,onboardingEnabledBotKeys}: {
  pool:Pool;telegramClient:TelegramApi;getBotLocale(key:string):unknown;helpers?:TopicMenuHelpers;onboardingEnabledBotKeys?:ReadonlySet<string>;
}) {
  const pending=new Map<string,Promise<boolean>>();
  return async (botKey:string,input:NormalizedTelegramUpdate):Promise<boolean> => {
    const started=performance.now();
    const cb=input.callbackQuery;
    const prepared=buildPreparedUpdate({botKey,input,locale:getBotLocale(botKey)});
    const command=prepared.route==='command.settings' && input.updateType==='message';
    if(!command&&(input.updateType!=='callback_query'||!cb?.data.startsWith('settings:')))return false;
    const labels=settingsLabels(getBotLocale(botKey));
    const api=(method:string,body:Record<string,unknown>)=>telegramClient.callTelegramApi(botKey,method,body,{signal:AbortSignal.timeout(method.startsWith('send')?10000:3000)});
    const answer=async(error=false)=>{if(!cb)return;await api('answerCallbackQuery',{
      callback_query_id:cb.id,...(error?{text:labels.error,show_alert:true}:{})
    }).catch(()=>{});};
    if(!input.isPrivate||input.sender.isBot||!input.chatId||!Number.isSafeInteger(input.chatId)||input.chatId<=0||input.sender.id!==input.chatId||(cb&&(cb.userId!==input.chatId||!cb.messageId))){
      await answer(true);return true;
    }
    let action:SettingsAction;
    try{action=command?{variant:'r',kind:'open',value:''}:parseSettingsAction(cb!.data);}catch{await answer(true);return true;}
    if(action.kind==='open')action.variant='r'; // Old chooser buttons open the remaining card.
    if(action.variant!=='r'){await answer(true);return true;}
    if((action.kind==='topic'||action.kind==='page')&&!helpers)return false;
    const key=`settings:${botKey}:${input.chatId}`;
    const run=async()=>withSettingsLock(pool,key,async()=>{
      const requestId=randomUUID(),decisionId=`v1:${botKey}:${input.updateId}`;
      const catalog=action.kind==='topic'||action.kind==='page'
        ? await accessibleSettingsCatalog(helpers!,input.chatId!,botKey):[];
      const refreshKeyboard=command && prepared.context.keyboard.buttonIntent!=='settings';
      let saved=await saveDirectSettings(pool,botKey,input,action,catalog,requestId,refreshKeyboard);
      if(!saved && action.kind==='open'){
        await bootstrapTelegramUser(pool,{botKey,input,onboardingEnabledBotKeys});
        saved=await saveDirectSettings(pool,botKey,input,action,catalog,requestId,refreshKeyboard);
        if(!saved)throw new Error('settings_profile_unavailable');
      }
      if(!saved)return false; // Compatibility fallback for a callback without a profile.
      if(!saved.render){await answer();return true;}
      const view=settingsView(saved.state,catalog,action,labels.free);
      if(saved.inputError)view.e='unavailable';
      let status='succeeded',errorCode:string|null=null;
      let deliveries:SettingsDeliveryResult[]=[];
      if(action.kind==='open'){
        const sent=await sendReservedSettingsMessages({deliveries:saved.deliveries,chatId:input.chatId!,
          richMessage:renderSettingsRich(view,labels),title:'⚙️ '+labels.title,
          replyMarkup:buildPersistentReplyMarkup(prepared.context.keyboard),api});
        status=sent.status;errorCode=sent.errorCode;deliveries=sent.deliveries;
      }else try{
        if(action.kind==='close')await deleteSettingsMessage(api,input.chatId!,cb!.messageId!);
        else await api('editMessageText',{chat_id:input.chatId,message_id:cb!.messageId,rich_message:renderSettingsRich(view,labels)});
      }catch(error){
        if(!String((error as Error).message).includes('message is not modified')){
          const failure=classifyTelegramDeliveryError(error);
          status=failure.kind==='permanent'?'permanent_failed':'retryable_failed';errorCode=failure.errorCode;
        }
      }
      const editedMs=Math.round(performance.now()-started);
      await Promise.all([
        pool.query(`WITH delivered AS (
          UPDATE bot_update_deliveries d SET status=r.status,telegram_message_id=r.message_id,
            error_code=r.error_code,error_detail=NULL,updated_at=NOW()
          FROM jsonb_to_recordset($5::jsonb) AS r(id bigint,status text,message_id bigint,error_code text)
          WHERE d.id=r.id AND d.decision_id=$1 AND d.status IN ('pending','unknown')
        ) UPDATE bot_update_executions SET status=$3,terminal_error_code=$4,
          completed_at=CASE WHEN $3='retryable_failed' THEN NULL ELSE NOW() END,updated_at=NOW(),lease_expires_at=NOW()
          WHERE decision_id=$1 AND current_job_id=$2::uuid`,[decisionId,requestId,status,errorCode,JSON.stringify(deliveries)]),
        answer(saved.inputError||status!=='succeeded'),
        saved.old_pin?api('unpinChatMessage',{chat_id:input.chatId,message_id:Number(saved.old_pin)}).catch(()=>{}):Promise.resolve()
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
