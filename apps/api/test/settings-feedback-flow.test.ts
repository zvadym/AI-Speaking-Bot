import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createDirectSettingsHandler } from '../src/bot-runtime/direct-settings.js';
import { createFeedbackHandlers } from '../src/bot-runtime/handlers/feedback.js';
import { createVoiceFeedbackHandler } from '../src/bot-runtime/handlers/voice.js';
import { prepareBotUpdate } from '../src/bot-runtime/prepare-update-service.js';
import { claimBotUpdateExecution } from '../src/bot-runtime/execution-repository.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { callbackUpdate,messageUpdate } from './fixtures/telegram-updates.js';

test('Postgres: settings Stats and prompt-bound text/voice feedback, cancellation, expiry and replay',{
 skip:!process.env.BOT_RUNTIME_TEST_DATABASE_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.BOT_RUNTIME_TEST_DATABASE_URL,application_name:'settings-feedback-flow'});
 const chatId=9900117,botKey='uk-en';let id=9881000,messageId=7000,wakes=0,failEdit=false,failDelete=false;
 const ids:string[]=[];
 const calls:Array<{method:string;body:Record<string,any>}>=[];
 const telegramClient={
  callTelegramApi:async(_bot:string,method:string,body:Record<string,any>)=>{
   const tx=await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='settings-feedback-flow' AND state='idle in transaction'");
   assert.equal(tx.rows[0].n,0,'network calls must not hold a DB transaction');
   calls.push({method,body});
   if(method==='deleteMessage'&&failDelete){failDelete=false;throw new Error('timeout');}
   if(method==='editMessageText'&&failEdit){failEdit=false;throw new Error('timeout');}
   return {message_id:++messageId};
  },
  sendTelegramTextMessage:async(_chat:number,text:string,options:object)=>{calls.push({method:'sendMessage',body:{text,...options}});return {message_id:++messageId};}
 };
 const locale={settings:{title:'Налаштування'},msg_feedback_prompt:'Reply with text or voice',msg_feedback_expired:'Expired',msg_feedback_thanks:'Received'};
 const ctx={pool,getBotLocale:()=>locale,publicBotMetaForKey:()=>({bot_key:botKey})};
 const direct=createDirectSettingsHandler({pool,telegramClient,getBotLocale:ctx.getBotLocale,webappUrl:'https://example.test'});
 const callback=(data:string)=>{
  const raw=callbackUpdate({data,chatId,updateId:++id}) as Record<string,any>;raw.callback_query.from.id=chatId;raw.callback_query.message.message_id=777;
  ids.push(`v1:${botKey}:${id}`);return normalizeTelegramUpdate(raw);
 };
 const button=()=>{
  const raw=messageUpdate({text:'· ⚙️ Налаштування',chatId,updateId:++id}) as Record<string,any>;raw.message.from.id=chatId;
  ids.push(`v1:${botKey}:${id}`);return normalizeTelegramUpdate(raw);
 };
 const message=async(text:string,replyId?:number,voice=false)=>{
  const raw=messageUpdate({text:voice?undefined:text,chatId,updateId:++id,
   ...(voice?{voice:{file_id:'original-voice-id',duration:5}}:{}),
   extraMessage:replyId?{reply_to_message:{message_id:replyId}}:{}}) as Record<string,any>;
  raw.message.from.id=chatId;ids.push(`v1:${botKey}:${id}`);
  return prepareBotUpdate(ctx,{botKey,telegramUpdate:raw});
 };
 const handlers=[...createFeedbackHandlers({pool,getBotLocale:ctx.getBotLocale,telegramClient,wakeNotifications:async()=>{wakes++;}}),
  createVoiceFeedbackHandler({pool,getBotLocale:ctx.getBotLocale,telegramClient,wakeNotifications:async()=>{wakes++;}})];
 const run=async(update:Awaited<ReturnType<typeof message>>)=>{
  await claimBotUpdateExecution(pool,{contract:update,handlerVersion:1,jobId:'00000000-0000-4000-8000-000000000117'});
  return handlers.find(h=>h.route===update.route)!.execute(update);
 };
 const active=async()=>(await pool.query("SELECT * FROM pending_feedback WHERE chat_id=$1 AND bot_key=$2 AND status='awaiting' ORDER BY created_at DESC LIMIT 1",[chatId,botKey])).rows[0];
 const feedbackCount=async()=>(await pool.query('SELECT count(*)::int AS n FROM feedback WHERE chat_id=$1',[chatId])).rows[0].n;
 try{
  await pool.query('INSERT INTO users(chat_id) VALUES($1)',[chatId]);
  await pool.query("INSERT INTO user_bots(chat_id,bot_key,level,reply_mode) VALUES($1,$2,'b1','voice')",[chatId,botKey]);
  await direct(botKey,button());
  assert.equal(calls.filter(c=>c.method==='sendRichMessage').length,1);
  const home=JSON.stringify(calls.at(-1)!.body.rich_message);
  assert.ok(home.includes('settings:r:stats')&&home.includes('settings:r:feedback'));
  await direct(botKey,callback('settings:r:stats'));
  const stats=JSON.stringify(calls.at(-2)?.body.rich_message||calls.at(-1)!.body.rich_message);
  assert.ok(stats.includes('settings:r:home'));assert.ok(stats.includes('/subscription?bot-key=uk-en'));
  await direct(botKey,callback('settings:r:home'));
  const first=callback('settings:r:feedback');await direct(botKey,first);await direct(botKey,first);
  assert.equal(calls.filter(c=>c.method==='sendMessage'&&c.body.reply_markup?.force_reply).length,1);
  const request=await active();assert.ok(request.prompt_message_id);
  assert.equal((await message('Normal chat')).route,'message.text');
  assert.equal((await message('Wrong reply',Number(request.prompt_message_id)+100)).route,'message.text');
  const reply=await message('/start is broken',Number(request.prompt_message_id));assert.equal(reply.route,'pending_feedback.text');
  await run(reply);await run(reply);
  assert.equal(await feedbackCount(),1);assert.equal(wakes,2); // Replays may wake an already durable scanner safely.
  const saved=(await pool.query('SELECT * FROM feedback WHERE chat_id=$1',[chatId])).rows[0];
  assert.equal(saved.feedback_text,'/start is broken');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM feedback_notifications WHERE feedback_id=$1',[saved.id])).rows[0].n,1);
  assert.equal((await message('Late second response',Number(request.prompt_message_id))).route,'feedback.expired');

  // Recover a crash after the prompt delivery ledger committed but before binding.
  await direct(botKey,callback('settings:r:feedback'));
  const gap=await active();await pool.query('UPDATE pending_feedback SET prompt_message_id=NULL WHERE session_id=$1',[gap.session_id]);
  const voice=await message('',Number(gap.prompt_message_id),true);assert.equal(voice.route,'pending_feedback.voice');
  await run(voice);assert.equal(await feedbackCount(),2);
  const audio=(await pool.query("SELECT * FROM feedback WHERE chat_id=$1 AND kind='voice'",[chatId])).rows[0];
  assert.equal(audio.telegram_file_id,'original-voice-id');assert.equal(audio.transcript,null);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM voice_usage_events WHERE chat_id=$1',[chatId])).rows[0].n,0);

  // A failed old Close cannot delete the Cancel UI of a newer request.
  const close=callback('settings:r:close');failDelete=true;await assert.rejects(direct(botKey,close));
  await direct(botKey,callback('settings:r:feedback'));const protectedRequest=await active();
  const deletesBefore=calls.filter(c=>c.method==='deleteMessage').length;
  await direct(botKey,close);
  assert.equal((await active()).session_id,protectedRequest.session_id);
  assert.equal(calls.filter(c=>c.method==='deleteMessage').length,deletesBefore);
  await direct(botKey,callback('settings:r:cancel'));

  // Old failed preference rendering must neither cancel nor hide a newer request.
  const old=callback('settings:r:level:b2');failEdit=true;await assert.rejects(direct(botKey,old));
  const olderFeedback=callback('settings:r:feedback');await direct(botKey,olderFeedback);
  const oldPrompt=await active();
  await direct(botKey,callback('settings:r:feedback'));const newer=await active();
  await direct(botKey,old);
  assert.equal((await active()).session_id,newer.session_id);
  await pool.query("UPDATE bot_update_executions SET status='retryable_failed' WHERE decision_id=$1",[`v1:${botKey}:${olderFeedback.updateId}`]);
  await direct(botKey,olderFeedback);assert.equal((await active()).session_id,newer.session_id);
  const edits=calls.filter(c=>c.method==='editMessageText');
  assert.ok(JSON.stringify(edits.at(-1)!.body.rich_message).includes('settings:r:cancel'));
  assert.equal((await message('Old request',Number(oldPrompt.prompt_message_id))).route,'feedback.expired');
  await direct(botKey,callback('settings:r:cancel'));assert.equal(await active(),undefined);
  assert.equal((await message('Cancelled',Number(newer.prompt_message_id))).route,'feedback.expired');

  await direct(botKey,callback('settings:r:feedback'));const expired=await active();
  await pool.query("UPDATE pending_feedback SET expires_at=NOW()-INTERVAL '1 second' WHERE session_id=$1",[expired.session_id]);
  const late=await message('Expired reply',Number(expired.prompt_message_id));assert.equal(late.route,'feedback.expired');await run(late);
  assert.equal(await feedbackCount(),2);
  // Opening settings explicitly exits a pending feedback request.
  await direct(botKey,callback('settings:r:feedback'));await direct(botKey,button());assert.equal(await active(),undefined);
 }finally{
  await pool.query('DELETE FROM pending_feedback WHERE chat_id=$1',[chatId]);
  await pool.query('DELETE FROM feedback WHERE chat_id=$1',[chatId]);
  await pool.query('DELETE FROM feedback_threads WHERE chat_id=$1',[chatId]);
  await pool.query('DELETE FROM bot_update_executions WHERE decision_id=ANY($1::text[])',[ids]);
  await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();
 }
});
