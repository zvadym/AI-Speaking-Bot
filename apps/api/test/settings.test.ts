import test from 'node:test';
import { deleteSettingsMessage } from '../src/bot-runtime/settings-message.js';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import { parseSettingsAction, settingsView, applySettingsAction } from '../src/bot-runtime/settings-model.js';
import { renderSettingsRich, settingsLabels } from '../src/bot-runtime/settings-views.js';
import { createSettingsHandlers, withSettingsLock } from '../src/bot-runtime/handlers/settings.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { parsePreparedUpdateContract } from '../src/bot-runtime/contract-validation.js';
import { callbackUpdate, messageUpdate } from './fixtures/telegram-updates.js';

const rawWidget = (data: string) => ({update_id:901,widget_query:{id:'w1',from:{id:42,is_bot:false},chat:{id:42,type:'private'},message_id:80,type:{type:'data'},data}});
function prepared(data: string, widget=false) {return buildPreparedUpdate({botKey:'uk-en',input:normalizeTelegramUpdate(widget?rawWidget(data):callbackUpdate({data})),keyboardState:{onboarding_complete_at:'2026-01-01'}})}
const labels = settingsLabels({});

test('widget envelopes preserve transport and route only settings data; old queued contracts still parse',()=>{
  const update = prepared('settings:w:level:b2',true);
  assert.equal(update.route,'callback.settings');assert.equal(update.input.chatId,42);assert.equal(update.input.callbackQuery?.messageId,80);
  assert.equal(parsePreparedUpdateContract(update).input.updateType,'widget_query');
  assert.equal(prepared('level:b2',true).route,'ignore');
  const unsupported=rawWidget('settings:w:home');unsupported.widget_query.type.type='sent_transaction';
  assert.equal(buildPreparedUpdate({botKey:'uk-en',input:normalizeTelegramUpdate(unsupported)}).route,'ignore');
  assert.equal(parsePreparedUpdateContract(prepared('level:a2')).route,'callback.level');
  const command=buildPreparedUpdate({botKey:'uk-en',input:normalizeTelegramUpdate(messageUpdate({text:'/settings'}))});assert.equal(command.route,'command.settings');
});
test('reject invalid and retired controls; cards expose only level and reply settings',()=>{
  for(const data of ['settings:w:level:c2','settings:r:reply:audio','settings:w:page:-1','settings:r:page:0','settings:w:home:extra','settings:r:topic:free','settings:r:topic:0123456789abcdef','settings:x:home']) assert.throws(()=>parseSettingsAction(data));
  const view=settingsView({level:'b1',reply_mode:'text'});
  assert.equal(view.l,'b1');assert.equal(view.r,'text');
  const controls=(renderSettingsRich(view,labels).blocks as Array<{buttons?:Array<{callback_data:string}>}>).flatMap(block=>block.buttons||[]);
  assert.deepEqual(controls.map(b=>b.callback_data),[
    'settings:r:level:a1','settings:r:level:a2','settings:r:level:b1','settings:r:level:b2','settings:r:level:c1',
    'settings:r:reply:voice','settings:r:reply:text','settings:r:close'
  ]);
  for(const b of controls)assert.ok(Buffer.byteLength(b.callback_data)<=64);
});
test('all production cards separate the closing action and explain autosave',()=>{
  const dir=new URL('../../../deploy/bots/',import.meta.url);
  for(const file of readdirSync(dir)){
    if(!file.endsWith('.json'))continue;
    const bot=JSON.parse(readFileSync(new URL(file,dir),'utf8'));
    const l=settingsLabels(bot.locale);
    const view=settingsView({});
    const blocks=renderSettingsRich(view,l).blocks;
    assert.deepEqual(blocks.slice(-3),[
      {type:'divider'},{type:'footer',text:l.autosave},
      {type:'buttons',buttons:[{text:l.done,callback_data:'settings:r:close'}]}
    ]);
    assert.ok(bot.locale.settings.autosave,file);
    assert.equal(bot.locale.settings.refresh,undefined,file);
    assert.equal(bot.locale.settings.widget,undefined,file);
    assert.equal(bot.locale.settings.topic,undefined,file);
    assert.equal(bot.locale.settings.free,undefined,file);
  }
});
function harness() {
  const calls:Array<{method:string;body:Record<string,unknown>}>=[];
  const sql:Array<{sql:string;params:unknown[]}>=[];
  const deliveries:Array<{stepKey:string;replyMarkup?:unknown}>=[];
  const state:Record<string,unknown>={level:'a1',reply_mode:'voice'};
  let mutations=0;let failEdit=false;
  const client={query:async(q:string,p:unknown[]=[])=>{sql.push({sql:q,params:p});if(q.includes('SET level ='))state.level=p[2];if(q.includes('SET reply_mode ='))state.reply_mode=p[2];return {rows:[],rowCount:1}}} as unknown as PoolClient;
  const cache=new Map<string,unknown>();
  const handlers=createSettingsHandlers({pool:{} as Pool,getBotLocale:()=>({}),
    telegramClient:{sendTelegramTextMessage:async()=>({message_id:90}),answerTelegramCallbackQuery:async()=>{},callTelegramApi:async(_bot,method,body)=>{calls.push({method,body});if(failEdit&&method.startsWith('edit')){failEdit=false;throw new Error('timeout')}return {message_id:90}}},
    stateLoader:async()=>state,lock:async(_p,_k,work)=>work(),
    effectRunner:async(_p,input)=>{let result=cache.get(input.decisionId);if(!result){result=await input.execute(client);cache.set(input.decisionId,result);mutations++}return {result} as never},
    textDeliverer:async(args)=>{deliveries.push(args);if(args.telegramMethod)await args.telegramClient.sendTelegramTextMessage(42,args.text,{botKey:'uk-en'});return {status:'delivered',telegramMessageId:90}}
  });
  return {calls,sql,deliveries,state,client,handlers,mutations:()=>mutations,fail:()=>{failEdit=true},run:(data:string,widget=false)=>handlers.find(x=>x.route==='callback.settings')!.execute(prepared(data,widget))};
}
test('card edits in place and persists once across failed render/retry',async()=>{
  const h=harness(),data='settings:r:level:b2';
  h.fail();await assert.rejects(h.run(data));await h.run(data);
  assert.equal(h.state.level,'b2');assert.equal(h.mutations(),1);
  assert.ok(h.calls.some(c=>c.method==='editMessageText'));
  assert.ok(!h.calls.some(c=>c.method.startsWith('send')));
});
test('retired topic and paging controls cannot read or mutate settings',async()=>{
  for(const data of ['settings:r:topic:free','settings:r:topic:0123456789abcdef','settings:r:page:0']){
    const h=harness();const result=await h.run(data);
    assert.equal(result.status,'noop');assert.equal(h.mutations(),0);
    assert.equal(h.sql.length,0);assert.equal(h.calls.length,0);
    assert.deepEqual(h.state,{level:'a1',reply_mode:'voice'});
  }
});
test('commands and reply keyboard open one card directly; old chooser buttons redirect to it',async()=>{
  for(const text of ['/settings','· ⚙️ Налаштування'])for(const keyboardState of [{},{onboarding_complete_at:'2026-01-01'}]){
    const h=harness();
    const u=buildPreparedUpdate({botKey:'uk-en',input:normalizeTelegramUpdate(messageUpdate({text})),keyboardState});
    assert.equal(u.route,'command.settings');
    await h.handlers.find(x=>x.route===u.route)!.execute(u);
    assert.equal(h.calls.length,1);
    assert.equal(h.calls[0].method,'sendRichMessage');
    assert.ok(h.calls[0].body.rich_message);
    assert.equal(h.calls[0].body.reply_markup,undefined); // Keep the card editable in Telegram.
    assert.equal(h.deliveries.length,text==='/settings'?2:1);
    if(text==='/settings')assert.deepEqual(h.deliveries[0].replyMarkup,{keyboard:[[{text:u.context.keyboard.settingsButtonText}]],resize_keyboard:true,one_time_keyboard:false});
    assert.ok(!JSON.stringify(h.calls).includes('settings:w:'));
  }
  for(const variant of ['r','w']){
    const h=harness();await h.run(`settings:${variant}:open`);
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'sendRichMessage');
  }
  const h=harness(),bad=prepared('settings:r:level:b2');bad.input.sender.id=7;
  await assert.rejects(h.handlers.find(x=>x.route==='callback.settings')!.execute(bad),/invalid_settings_owner/);assert.equal(h.mutations(),0);
});
test('retired widget queries never change preferences or send a widget',async()=>{
  for(const action of ['level:b2','reply:text','topic:free','open']){
    const h=harness();const result=await h.run('settings:w:'+action,true);
    assert.equal(result.status,'noop');assert.equal(h.mutations(),0);
    assert.deepEqual(h.calls.map(c=>c.method),['answerWidgetQuery']);
    assert.deepEqual(h.state,{level:'a1',reply_mode:'voice'});
  }
});
test('done deletes the card for every production bot; historical back buttons still read current settings',async()=>{
  const dir=new URL('../../../deploy/bots/',import.meta.url);
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.json'))){
    const bot=JSON.parse(readFileSync(new URL(file,dir),'utf8'));
    const h=harness(), update=prepared('settings:r:close');update.botKey=bot.bot_key;
    await h.handlers.find(x=>x.route==='callback.settings')!.execute(update);
    assert.deepEqual(h.calls,[{method:'deleteMessage',body:{chat_id:42,message_id:2200}}],bot.bot_key);
    assert.equal(h.mutations(),0);assert.deepEqual(h.state,{level:'a1',reply_mode:'voice'});
  }
  const h=harness();
  h.state.level='b2';await h.run('settings:r:home');
  assert.ok(JSON.stringify(h.calls.at(-1)!.body.rich_message).includes('✓ B2'));
  assert.equal(h.mutations(),0);
});
test('contended settings locks release the connection immediately instead of starving the pool',async()=>{
  let released=false,executed=false;
  const pool={connect:async()=>({query:async()=>({rows:[{locked:false}]}),release:()=>{released=true}})} as unknown as Pool;
  await assert.rejects(withSettingsLock(pool,'key',async()=>{executed=true}),/settings_busy/);
  assert.equal(released,true);assert.equal(executed,false);
});
test('Postgres: real settings effects and delivery records survive retries for direct cards and legacy redirects', {
  skip: process.env.BOT_RUNTIME_TEST_DATABASE_URL ? false : 'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
}, async()=>{
  const {default:pg}=await import('pg');
  const {claimBotUpdateExecution}=await import('../src/bot-runtime/execution-repository.js');
  const pool=new pg.Pool({connectionString:process.env.BOT_RUNTIME_TEST_DATABASE_URL,application_name:'settings-card-test'});
  const chatId=9900088,botKey='uk-en';let id=9800000;const decisions:string[]=[];const sent:string[]=[];
  let failEdit=false;
  const handlers=createSettingsHandlers({pool,getBotLocale:()=>({}),telegramClient:{sendTelegramTextMessage:async()=>({message_id:90}),answerTelegramCallbackQuery:async()=>{},callTelegramApi:async(_key,method)=>{
    const tx=await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='settings-card-test' AND state='idle in transaction'");assert.equal(tx.rows[0].n,0);
    sent.push(method);if(failEdit&&method.startsWith('edit')){failEdit=false;throw new Error('timeout')};return {message_id:90};
  }}});
  const make=async(data:string,widget=false)=>{
    const raw=widget?rawWidget(data):callbackUpdate({data,chatId});raw.update_id=++id;
    const anyRaw=raw as Record<string,any>;if(widget){anyRaw.widget_query.chat.id=chatId;anyRaw.widget_query.from.id=chatId}else anyRaw.callback_query.from.id=chatId;
    const u=buildPreparedUpdate({botKey,input:normalizeTelegramUpdate(raw)});decisions.push(u.decisionId);
    await claimBotUpdateExecution(pool,{contract:u,handlerVersion:1,jobId:'00000000-0000-4000-8000-000000000088'});return u;
  };
  const run=(u:ReturnType<typeof prepared>)=>handlers.find(h=>h.route===u.route)!.execute(u);
  try{
    await pool.query('INSERT INTO users(chat_id) VALUES($1)',[chatId]);
    await pool.query('INSERT INTO user_bots(chat_id,bot_key,level,reply_mode) VALUES($1,$2,$3,$4)',[chatId,botKey,'a1','voice']);
    for(const v of ['r','w']){const u=await make(`settings:${v}:open`);await run(u);await run(u)}
    assert.equal(sent.filter(x=>x==='sendRichMessage').length,2);assert.equal(sent.filter(x=>x==='sendWidget').length,0);
    await run(await make('settings:r:level:b2'));
    await run(await make('settings:r:reply:text'));
    const change=await make('settings:r:level:c1');
    failEdit=true;await assert.rejects(run(change));await run(change);
    const saved=await pool.query('SELECT * FROM user_bots WHERE chat_id=$1 AND bot_key=$2',[chatId,botKey]);
    assert.equal(saved.rows[0].level,'c1');assert.equal(saved.rows[0].reply_mode,'text');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM bot_update_effects WHERE decision_id=$1",[change.decisionId])).rows[0].n,1);
    const deliveries=await pool.query('SELECT telegram_method FROM bot_update_deliveries WHERE decision_id=ANY($1::text[]) ORDER BY telegram_method',[decisions]);
    assert.deepEqual(deliveries.rows.map(x=>x.telegram_method),['sendRichMessage','sendRichMessage']);
  }finally{
    await pool.query('DELETE FROM bot_update_executions WHERE decision_id=ANY($1::text[])',[decisions]);
    await pool.query('DELETE FROM action_events WHERE chat_id=$1',[chatId]);
    await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();
  }
});

test('simple controls do not read entitlement or catalogs',async()=>{
  for(const action of ['home','close','level:b2','reply:text']){
    const h=harness();await h.run('settings:r:'+action);
    assert.ok(h.sql.every(q=>q.sql.startsWith('UPDATE user_bots')));
    if(action==='level:b2')assert.equal(h.state.level,'b2');
    if(action==='reply:text')assert.equal(h.state.reply_mode,'text');
  }
});

test('a missing preference row cannot be reported as a successful save',async()=>{
  const client={query:async()=>({rows:[],rowCount:0})} as unknown as PoolClient;
  await assert.rejects(applySettingsAction(client,prepared('settings:r:level:b2'),parseSettingsAction('settings:r:level:b2')),/missing/);
});

test('deletion acknowledges missing cards but preserves other Telegram failures',async()=>{
  for(const error of [new Error('Bad Request: message to delete not found'),{telegramDescription:'Bad Request: message to delete not found'}]){
    await deleteSettingsMessage(async()=>{throw error},42,80);
  }
  for(const error of [new Error('timeout'),{telegramStatus:429,telegramDescription:'Too Many Requests'},
    {telegramStatus:400,telegramDescription: "Bad Request: message can't be deleted"}]){
    await assert.rejects(deleteSettingsMessage(async()=>{throw error},42,80),e=>e===error);
  }
});
