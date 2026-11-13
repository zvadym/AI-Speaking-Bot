import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { bootstrapTelegramUser } from '../src/bot-runtime/user-bootstrap.js';
import { createOnboardingStartHandler } from '../src/bot-runtime/handlers/onboarding.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { loadBotConfigs } from '../src/bot-configs.js';
import { messageUpdate, voice } from './fixtures/telegram-updates.js';
import { createTextConversationHandler } from '../src/bot-runtime/handlers/conversation.js';
import { createVoiceConversationHandler } from '../src/bot-runtime/handlers/voice.js';
import { claimBotUpdateExecution } from '../src/bot-runtime/execution/execution-repository.js';
import { getOnboardingLocale } from '../src/bot-runtime/onboarding/onboarding.js';
import type { BotAiClient } from '../src/ai/client.js';
import type { EntitlementContext } from '../src/bot-runtime/entitlement-context.js';

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

for (const mode of ['text', 'voice'] as const) {
  test(`Postgres: ${mode} graph retries after onboarding completion without repeating history, usage or delivered messages`, {
    skip: connectionString ? false : 'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
  }, async () => {
    const pool = new pg.Pool({ connectionString });
    const chatId = mode === 'text' ? 9900181 : 9900182;
    const botKey = 'uk-en';
    const locale = (loadBotConfigs() as Record<string, { locale: unknown }>)[botKey].locale;
    const onboardingLocale = getOnboardingLocale(locale)!;
    const input = normalizeTelegramUpdate(messageUpdate({
      chatId, updateId: chatId,
      ...(mode === 'text' ? { text: 'I went home.' } : { voice })
    }));
    const update = buildPreparedUpdate({ botKey, input });
    let generations = 0;
    let transcriptions = 0;
    let failSuccess = true;
    const delivered: string[] = [];
    const ai: BotAiClient = {
      async respond(input) {
        generations++;
        assert.equal(input.onboarding?.scenario, 'freeform');
        return {
          detected_language: 'en', is_target_language: true, has_mistakes: true,
          reply_text: 'Where did you go?', explanation_html: '<b>Correction</b>',
          suggested_level: 'a2', suggested_level_confidence: 'high'
        };
      },
      async transcribe() { transcriptions++; return 'I went home.'; },
      async speech() { throw new Error('onboarding must stay text-only'); },
      async translate() { throw new Error('unexpected translation'); },
      async hints() { throw new Error('unexpected hints'); },
      async vocabulary() { throw new Error('unexpected vocabulary'); }
    };
    const dependencies = {
      pool, ai, getBotLocale: () => locale, webappUrl: 'https://example.test/app',
      quotaGuard: async () => ({ allowed: true as const, context: {} as EntitlementContext }),
      telegramClient: {
        async sendTelegramTextMessage(_chat: number, text: string) {
          if (text === onboardingLocale.success && failSuccess) {
            failSuccess = false;
            throw Object.assign(new Error('known server failure'), { telegramStatus: 500 });
          }
          delivered.push(text);
          return { message_id: delivered.length + 100 };
        },
        async sendTelegramVoiceMessage() { throw new Error('unexpected voice delivery'); },
        async downloadTelegramFile() { return Buffer.from('voice'); },
        async callTelegramApi() { return {}; }
      }
    };
    const handler = mode === 'text'
      ? createTextConversationHandler(dependencies)
      : createVoiceConversationHandler(dependencies);
    try {
      await bootstrapTelegramUser(pool, {
        botKey, onboardingEnabledBotKeys: new Set([botKey]),
        input: normalizeTelegramUpdate(messageUpdate({ chatId, updateId: chatId - 1, text: '/start' }))
      });
      await pool.query("UPDATE user_bots SET reply_mode='voice' WHERE chat_id=$1 AND bot_key=$2", [chatId, botKey]);
      await claimBotUpdateExecution(pool, {
        contract: update, handlerVersion: handler.version, jobId: '00000000-0000-4000-8000-000000000041'
      });
      await assert.rejects(handler.execute(update as never), /telegram_server_error/);
      const completed = (await pool.query('SELECT * FROM bot_onboarding_sessions WHERE chat_id=$1 AND bot_key=$2', [chatId, botKey])).rows[0];
      assert.equal(completed.state, 'completed');
      assert.equal(completed.completion_decision_id, update.decisionId);
      await handler.execute(update as never);
      await handler.execute(update as never);
      assert.equal(generations, 1);
      assert.equal(transcriptions, mode === 'voice' ? 1 : 0);
      assert.equal(delivered.length, 4);
      assert.equal(delivered[0], `${mode === 'text' ? onboardingLocale.text_input_header : onboardingLocale.voice_input_header}\nI went home.`);
      assert.equal(delivered[1], '<b>Correction</b>');
      assert.ok(delivered[2].startsWith('Where did you go?'));
      assert.equal(delivered[3], onboardingLocale.success);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE chat_id=$1 AND bot_key=$2', [chatId, botKey])).rows[0].n, 2);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM action_events WHERE chat_id=$1 AND action_type='onboarding_completed'", [chatId])).rows[0].n, 1);
      const usage = (await pool.query('SELECT direction FROM voice_usage_events WHERE chat_id=$1', [chatId])).rows;
      assert.deepEqual(usage.map((row) => row.direction), mode === 'voice' ? ['in'] : []);
      const afterRetry = (await pool.query('SELECT * FROM bot_onboarding_sessions WHERE chat_id=$1 AND bot_key=$2', [chatId, botKey])).rows[0];
      assert.deepEqual(afterRetry, completed);
    } finally {
      await pool.query('DELETE FROM bot_update_executions WHERE decision_id=$1', [update.decisionId]);
      for (const table of ['action_events', 'voice_usage_events', 'usage_hourly', 'bot_onboarding_sessions', 'messages', 'user_bots', 'users']) {
        await pool.query(`DELETE FROM ${table} WHERE chat_id=$1`, [chatId]);
      }
      await pool.end();
    }
  });
}
