import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { KeyboardStateRow, NormalizedTelegramUpdate } from './contracts.js';
import { withSettingsLock } from './handlers/settings.js';
import { buildTopicPack, type TopicMenuHelpers } from './handlers/topic-menu.js';
import { accessibleSettingsCatalog, parseSettingsAction, SETTINGS_LEVELS, settingsView, topicToken, type SettingsAction } from './settings-model.js';
import { renderSettingsRich, settingsLabels } from './settings-views.js';
import { classifyTelegramDeliveryError } from './telegram-text-delivery.js';

interface TelegramApi {
  callTelegramApi(botKey: string, method: string, body: Record<string, unknown>, options?: {signal?: AbortSignal}): Promise<unknown>;
}

// One autocommitted statement: preference changes and their idempotency record
// either both persist or neither does. No transaction spans a Telegram request.
// Reuse the worker's ledger/step key so pre-rollout queued deliveries remain safe.
export async function saveDirectSettings(pool: Pool, botKey: string, input: NormalizedTelegramUpdate,
  action: SettingsAction, catalog: Record<string, unknown>[], requestId: string) {
  const topic = action.kind === 'topic' && action.value !== 'free'
    ? catalog.find(t => topicToken(t.topic_id) === action.value) : null;
  const inputError = action.kind === 'topic' && action.value !== 'free' && !topic;
  const packs = topic ? Object.fromEntries(SETTINGS_LEVELS.map(level => [level, {
    ...buildTopicPack(topic, level), turns_in_topic: 0, last_assistant_question: ''
  }])) : null;
  const result = await pool.query<{
    state: KeyboardStateRow; render: boolean; old_pin: number | null;
  }>(`WITH current AS MATERIALIZED (
      SELECT * FROM user_bots WHERE chat_id=$1 AND bot_key=$2
    ), execution AS (
      INSERT INTO bot_update_executions
        (decision_id,bot_key,update_id,contract_version,route,handler_version,status,current_job_id,lease_expires_at)
      SELECT $3,$2,$4,1,'callback.settings',1,'running',$5::uuid,NOW()+INTERVAL '30 seconds' FROM current
      ON CONFLICT (decision_id) DO UPDATE SET
        status='running', attempts=bot_update_executions.attempts+1,
        current_job_id=EXCLUDED.current_job_id, updated_at=NOW(), lease_expires_at=EXCLUDED.lease_expires_at
      WHERE bot_update_executions.status NOT IN ('succeeded','permanent_failed')
        AND bot_update_executions.bot_key=EXCLUDED.bot_key AND bot_update_executions.update_id=EXCLUDED.update_id
        AND bot_update_executions.route=EXCLUDED.route AND bot_update_executions.handler_version=1
      RETURNING decision_id
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
    FROM current`, [input.chatId,botKey,`v1:${botKey}:${input.updateId}`,input.updateId,requestId,
    action.kind,action.value,topic?.topic_id || null,packs ? JSON.stringify(packs) : null,Boolean(inputError),
    input.sender.username,input.sender.firstName]);
  return result.rows[0] ? {...result.rows[0],inputError:Boolean(inputError)} : null;
}

export function createDirectSettingsHandler({pool,telegramClient,getBotLocale,helpers}: {
  pool:Pool;telegramClient:TelegramApi;getBotLocale(key:string):unknown;helpers?:TopicMenuHelpers;
}) {
  const pending=new Map<string,Promise<boolean>>();
  return async (botKey:string,input:NormalizedTelegramUpdate):Promise<boolean> => {
    const started=performance.now();
    const cb=input.callbackQuery;
    if(input.updateType!=='callback_query'||!cb?.data.startsWith('settings:'))return false;
    const labels=settingsLabels(getBotLocale(botKey));
    const api=(method:string,body:Record<string,unknown>)=>telegramClient.callTelegramApi(botKey,method,body,{signal:AbortSignal.timeout(3000)});
    const answer=async(error=false)=>{await api('answerCallbackQuery',{
      callback_query_id:cb.id,...(error?{text:labels.error,show_alert:true}:{})
    }).catch(()=>{});};
    if(!input.isPrivate||input.sender.isBot||!input.chatId||!Number.isSafeInteger(input.chatId)||input.chatId<=0||input.sender.id!==input.chatId||cb.userId!==input.chatId||!cb.messageId){
      await answer(true);return true;
    }
    let action:SettingsAction;
    try{action=parseSettingsAction(cb.data);}catch{await answer(true);return true;}
    // Opening creates a new message and retains the worker's durable send path.
    if(action.kind==='open')return false;
    if(action.variant!=='r'){await answer(true);return true;}
    if((action.kind==='topic'||action.kind==='page')&&!helpers)return false;
    const key=`settings:${botKey}:${input.chatId}`;
    const run=async()=>withSettingsLock(pool,key,async()=>{
      const requestId=randomUUID(),decisionId=`v1:${botKey}:${input.updateId}`;
      const catalog=action.kind==='topic'||action.kind==='page'
        ? await accessibleSettingsCatalog(helpers!,input.chatId!,botKey):[];
      const saved=await saveDirectSettings(pool,botKey,input,action,catalog,requestId);
      if(!saved)return false; // Normal bootstrap handles missing/new profiles.
      if(!saved.render){await answer();return true;}
      const view=settingsView(saved.state,catalog,action,labels.free);
      if(saved.inputError)view.e='unavailable';
      let status='succeeded',errorCode:string|null=null;
      try{
        await api('editMessageText',{chat_id:input.chatId,message_id:cb.messageId,rich_message:renderSettingsRich(view,labels)});
      }catch(error){
        if(!String((error as Error).message).includes('message is not modified')){
          const failure=classifyTelegramDeliveryError(error);
          status=failure.kind==='permanent'?'permanent_failed':'retryable_failed';errorCode=failure.errorCode;
        }
      }
      const editedMs=Math.round(performance.now()-started);
      await Promise.all([
        pool.query(`UPDATE bot_update_executions SET status=$3,terminal_error_code=$4,
          completed_at=CASE WHEN $3='retryable_failed' THEN NULL ELSE NOW() END,updated_at=NOW(),lease_expires_at=NOW()
          WHERE decision_id=$1 AND current_job_id=$2::uuid`,[decisionId,requestId,status,errorCode]),
        answer(saved.inputError||status!=='succeeded'),
        saved.old_pin?api('unpinChatMessage',{chat_id:input.chatId,message_id:Number(saved.old_pin)}).catch(()=>{}):Promise.resolve()
      ]);
      console.info('settings-direct:processed',{botKey,updateId:input.updateId,action:action.kind,status,editedMs});
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
