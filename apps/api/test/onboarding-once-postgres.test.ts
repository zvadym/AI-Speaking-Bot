import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { bootstrapTelegramUser } from '../src/bot-runtime/user-bootstrap.js';
import { createOnboardingStartHandler } from '../src/bot-runtime/handlers/onboarding.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { loadBotConfigs } from '../src/bot-configs.js';
import { messageUpdate } from './fixtures/telegram-updates.js';

const connectionString=process.env.BOT_RUNTIME_TEST_DATABASE_URL;
test('Postgres: start resumes onboarding once and preserves completed and legacy profiles',{
  skip:connectionString?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
  const pool=new pg.Pool({connectionString});
  const chatId=9900171,legacyChatId=9900172,botKey='uk-en';
  const start=(id:number,text='/start first_campaign',user=chatId)=>normalizeTelegramUpdate(messageUpdate({chatId:user,updateId:id,text}));
  const bootstrap=(id:number,text?:string,user=chatId)=>bootstrapTelegramUser(pool,{botKey,input:start(id,text,user),onboardingEnabledBotKeys:new Set([botKey])});
  const state=async()=>(await pool.query('SELECT * FROM bot_onboarding_sessions WHERE chat_id=$1 AND bot_key=$2',[chatId,botKey])).rows[0];
  try{
    await bootstrap(190001);
    assert.equal((await state()).state,'choose_scenario');
    await pool.query("UPDATE user_bots SET level='b2',reply_mode='text' WHERE chat_id=$1 AND bot_key=$2",[chatId,botKey]);
    await pool.query("INSERT INTO messages(chat_id,bot_key,role,content)VALUES($1,$2,'user','Preserve this history')",[chatId,botKey]);
    await pool.query("UPDATE bot_onboarding_sessions SET state='await_practice',scenario='daily_life',first_input_mode='text' WHERE chat_id=$1 AND bot_key=$2",[chatId,botKey]);
    const active=await state();
    await Promise.all([bootstrap(190002,'/start later_campaign'),bootstrap(190003,'/start')]);
    assert.deepEqual(await state(),active);
    await pool.query("UPDATE bot_onboarding_sessions SET state='completed',completed_at=NOW(),suggested_level='b2' WHERE chat_id=$1 AND bot_key=$2",[chatId,botKey]);
    const completed=await state();
    await bootstrap(190004);
    assert.deepEqual(await state(),completed);
    const profile=(await pool.query('SELECT level,reply_mode FROM user_bots WHERE chat_id=$1 AND bot_key=$2',[chatId,botKey])).rows[0];
    assert.deepEqual(profile,{level:'b2',reply_mode:'text'});
    assert.equal((await pool.query('SELECT acquisition_start_payload FROM users WHERE chat_id=$1',[chatId])).rows[0].acquisition_start_payload,'first_campaign');
    assert.equal((await pool.query('SELECT content FROM messages WHERE chat_id=$1',[chatId])).rows[0].content,'Preserve this history');
    const calls:Array<Record<string,unknown>>=[];
    const configs=loadBotConfigs() as Record<string,{locale:unknown}>;
    const handler=createOnboardingStartHandler({pool,getBotLocale:()=>configs[botKey].locale,
      telegramClient:{sendTelegramTextMessage:async()=>{throw new Error('test must not send');}},
      textDeliverer:async args=>{calls.push(args);return {status:'delivered',telegramMessageId:1};}});
    await handler.execute(buildPreparedUpdate({botKey,input:start(190005)}) as never);
    assert.match(JSON.stringify(calls[0].replyMarkup),/⚙️/);
    assert.doesNotMatch(JSON.stringify(calls[0].replyMarkup),/onb:scenario/);

    await pool.query('INSERT INTO users(chat_id)VALUES($1)',[legacyChatId]);
    await pool.query("INSERT INTO user_bots(chat_id,bot_key,level,reply_mode)VALUES($1,$2,'c1','voice')",[legacyChatId,botKey]);
    await pool.query("INSERT INTO scheduled_task_dispatches(chat_id,bot_key,task_type,schedule_key,status,sent_at)VALUES($1,$2,'onboarding_complete','once','sent',NOW())",[legacyChatId,botKey]);
    const feedbackReply=start(190006,'/start complaint',legacyChatId);feedbackReply.message.replyToMessageId=77;
    await bootstrapTelegramUser(pool,{botKey,input:feedbackReply,onboardingEnabledBotKeys:new Set([botKey])});
    assert.equal((await pool.query('SELECT acquisition_start_payload FROM users WHERE chat_id=$1',[legacyChatId])).rows[0].acquisition_start_payload,null);
    await bootstrap(190006,'/start',legacyChatId);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bot_onboarding_sessions WHERE chat_id=$1',[legacyChatId])).rows[0].n,0);
    await handler.execute(buildPreparedUpdate({botKey,input:start(190007,'/start',legacyChatId)}) as never);
    assert.equal(calls.at(-1)?.stepKey,'command.start:already-onboarded:v1');
    assert.match(JSON.stringify(calls.at(-1)?.replyMarkup),/⚙️/);
  }finally{
    for(const table of ['action_events','scheduled_task_dispatches','bot_onboarding_sessions','messages','user_bots','users']){
      await pool.query(`DELETE FROM ${table} WHERE chat_id=ANY($1::bigint[])`,[[chatId,legacyChatId]]);
    }
    await pool.end();
  }
});
