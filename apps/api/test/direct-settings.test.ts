import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createDirectSettingsHandler, saveDirectSettings } from '../src/bot-runtime/direct-settings.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { callbackUpdate } from './fixtures/telegram-updates.js';
import { topicToken } from '../src/bot-runtime/settings-model.js';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createTelegramWebhookRouter } from '../src/routes/telegram-webhook.js';
import { parseBotRuntimeRouteFlags } from '../src/bot-runtime/route-flags.js';
import { deriveTelegramWebhookSecret } from '../src/bot-runtime/webhook-secret.js';

test('direct settings rejects invalid owners/values before DB access',async()=>{
  const calls:string[]=[];
  const handle=createDirectSettingsHandler({pool:{connect:()=>{throw new Error('must not access DB')}} as unknown as Pool,
    getBotLocale:()=>({}),telegramClient:{callTelegramApi:async(_b,m)=>{calls.push(m);}}});
  for(const raw of [callbackUpdate({data:'settings:r:level:c2'}),callbackUpdate({data:'settings:r:home',chatType:'group'}),
    callbackUpdate({data:'settings:r:home',chatId:77}),callbackUpdate({data:'settings:r:home',senderIsBot:true}),callbackUpdate({data:'settings:w:level:b2'})]){
    assert.equal(await handle('uk-en',normalizeTelegramUpdate(raw)),true);
  }
  assert.deepEqual(calls,Array(5).fill('answerCallbackQuery'));
  assert.equal(await handle('uk-en',normalizeTelegramUpdate(callbackUpdate({data:'reply:text'}))),false);
});

test('Postgres: direct settings atomically persist, survive edit failures, serialize taps, and retain topic access checks',{
  skip:process.env.BOT_RUNTIME_TEST_DATABASE_URL?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString:process.env.BOT_RUNTIME_TEST_DATABASE_URL,application_name:'direct-settings-test'});
  const chatId=9900091,botKey='uk-en';let id=9850000,fail=false,releaseEdit:(()=>void)|undefined;
  let deleteFailure:unknown;
  let editGate:Promise<void>|undefined,editStarted:(()=>void)|undefined;
  const calls:Array<{method:string;body:Record<string,unknown>}>=[];const ids:string[]=[];
  const catalog=[{topic_id:'direct-test-topic',title_base:'Test topic',access_tier:'all',starter_questions_by_level_target:{a1:['A1?'],b2:['B2?']}},
    {topic_id:'pro-test-topic',title_base:'Pro',access_tier:'pro'}];
  const make=(data:string)=>{
    const raw=callbackUpdate({data,chatId,updateId:++id}) as Record<string,any>;raw.callback_query.from.id=chatId;
    ids.push(`v1:${botKey}:${id}`);return normalizeTelegramUpdate(raw);
  };
  const handle=createDirectSettingsHandler({pool,getBotLocale:()=>({}),helpers:{fetchEffectiveTierForChat:async()=> 'free',fetchTopicCatalogRows:async()=>catalog} as never,
    telegramClient:{callTelegramApi:async(_b,method,body)=>{
      calls.push({method,body});
      if(method==='deleteMessage' && deleteFailure){const error=deleteFailure;deleteFailure=undefined;throw error;}
      if(method==='editMessageText'){
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='direct-settings-test' AND state='idle in transaction'")).rows[0].n,0);
        if(fail){fail=false;throw new Error('timeout');}
        if(editGate){editStarted?.();await editGate;}
      }
      return {};
    }}});
  const state=async()=>(await pool.query('SELECT * FROM user_bots WHERE chat_id=$1 AND bot_key=$2',[chatId,botKey])).rows[0];
  try{
    assert.equal(await handle(botKey,make('settings:r:home')),false);
    await pool.query('INSERT INTO users(chat_id) VALUES($1)',[chatId]);
    await pool.query("INSERT INTO user_bots(chat_id,bot_key,level,reply_mode) VALUES($1,$2,'a1','voice')",[chatId,botKey]);
    const failed=make('settings:r:level:b2');fail=true;
    await assert.rejects(handle(botKey,failed));assert.equal((await state()).level,'b2');
    await handle(botKey,make('settings:r:level:c1'));
    // Retrying the old failed render must not restore its old saved preference.
    await handle(botKey,failed);assert.equal((await state()).level,'c1');
    const completedCalls=calls.length;await handle(botKey,failed);
    assert.equal(calls.slice(completedCalls).filter(c=>c.method==='editMessageText').length,0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM bot_update_effects WHERE decision_id=$1",[`v1:${botKey}:${failed.updateId}`])).rows[0].n,1);

    // Two overlapping taps remain FIFO, including the network edit.
    const reachedEdit=new Promise<void>(resolve=>{editStarted=resolve;});
    editGate=new Promise<void>(resolve=>{releaseEdit=resolve;});
    const a=handle(botKey,make('settings:r:level:a2'));
    await reachedEdit;
    const b=handle(botKey,make('settings:r:level:b2'));
    const release=releaseEdit!;editGate=undefined;editStarted=undefined;releaseEdit=undefined;release();await Promise.all([a,b]);
    assert.equal((await state()).level,'b2');
    await handle(botKey,make('settings:r:reply:text'));assert.equal((await state()).reply_mode,'text');
    const denied=make('settings:r:topic:'+topicToken('pro-test-topic'));
    await handle(botKey,denied);assert.equal((await state()).topic_enabled,false);
    assert.ok(calls.some(c=>c.method==='answerCallbackQuery'&&c.body.show_alert===true));
    await pool.query('UPDATE user_bots SET topic_pinned_message_id=88 WHERE chat_id=$1 AND bot_key=$2',[chatId,botKey]);
    const topic=make('settings:r:topic:'+topicToken('direct-test-topic'));
    await handle(botKey,topic);await handle(botKey,topic);
    assert.equal((await state()).topic_template_id,'direct-test-topic');
    assert.equal((await state()).topic_pack_json.turns_in_topic,0);
    assert.equal((await state()).topic_pinned_message_id,null);
    assert.ok(calls.some(c=>c.method==='unpinChatMessage'&&c.body.message_id===88));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM action_events WHERE chat_id=$1 AND action_type='topic_set'",[chatId])).rows[0].n,1);
    await handle(botKey,make('settings:r:page:0'));
    const close=make('settings:r:close');
    const beforeClose=await state(), beforeCloseCalls=calls.length;
    deleteFailure=new Error('timeout');await assert.rejects(handle(botKey,close));
    deleteFailure={telegramStatus:400,telegramDescription:'Bad Request: message to delete not found'};
    await handle(botKey,close);await handle(botKey,close);
    const closeCalls=calls.slice(beforeCloseCalls).filter(c=>c.method!=='answerCallbackQuery');
    assert.deepEqual(closeCalls,Array(2).fill({method:'deleteMessage',body:{chat_id:chatId,message_id:close.callbackQuery!.messageId}}));
    assert.equal((await pool.query('SELECT status FROM bot_update_executions WHERE decision_id=$1',[`v1:${botKey}:${close.updateId}`])).rows[0].status,'succeeded');
    const afterClose=await state();
    for(const field of ['level','reply_mode','topic_pack_json','topic_template_id','topic_enabled'])assert.deepEqual(afterClose[field],beforeClose[field]);
    await handle(botKey,make('settings:r:home'));
    await handle(botKey,make('settings:r:topic:free'));
    assert.equal((await state()).topic_pack_json,null);
    assert.equal((await state()).topic_enabled,false);

    // A database failure cannot commit a preference without its effect record.
    const invalid=make('settings:r:level:b1');
    await assert.rejects(saveDirectSettings(pool,botKey,invalid,{variant:'r',kind:'level',value:'b1'},[],'invalid-uuid'));
    assert.equal((await state()).level,'b2');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bot_update_executions WHERE decision_id=$1',[`v1:${botKey}:${invalid.updateId}`])).rows[0].n,0);

    const botToken='test-token',signingSecret='test-secret';let queueCalls=0,edits=0;
    const ctx={pool,getBotLocale:()=>({}),publicBotMetaForKey:()=>({bot_key:botKey}),
      apiBoss:{send:async()=>{queueCalls++;throw new Error('settings must not enqueue');}},
      telegramClient:{callTelegramApi:async(_b:string,method:string)=>{if(method==='editMessageText')edits++;return {};}},
      env:{telegramBotTokensByBotKey:{[botKey]:botToken},internalApiSecret:signingSecret,jwtSecret:'unused',
        botImmediateAckEnabledBotKeys:new Set<string>(),botRuntimeRouteFlags:parseBotRuntimeRouteFlags('{"uk-en":["callback.settings"]}',[botKey])}};
    const app=express();app.use(express.json());app.use(createTelegramWebhookRouter(ctx));
    const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const update=make('settings:r:level:b1');
      const raw=callbackUpdate({data:'settings:r:level:b1',chatId,updateId:update.updateId}) as Record<string,any>;
      raw.callback_query.from.id=chatId;
      const post=(secret:string)=>fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/telegram/webhook/uk-en`,{
        method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(raw)});
      const secret=deriveTelegramWebhookSecret({botKey,botToken,signingSecret});
      assert.equal((await post('wrong')).status,401);assert.equal(edits,0);
      ctx.env.botRuntimeRouteFlags=new Map();
      assert.equal((await post(secret)).status,503);assert.equal(edits,0);
      ctx.env.botRuntimeRouteFlags=parseBotRuntimeRouteFlags('{"uk-en":["callback.settings"]}',[botKey]);
      assert.equal((await post(secret)).status,200);assert.equal(edits,1);assert.equal(queueCalls,0);
      assert.equal((await state()).level,'b1');
    }finally{server.close();await once(server,'close');}
  }finally{
    releaseEdit?.();
    await pool.query('DELETE FROM bot_update_executions WHERE decision_id=ANY($1::text[])',[ids]);
    await pool.query('DELETE FROM action_events WHERE chat_id=$1',[chatId]);
    await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();
  }
});
