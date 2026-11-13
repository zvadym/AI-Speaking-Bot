import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { prepareBotUpdate } from '../src/bot-runtime/prepare-update-service.js';
import { bootstrapTelegramUser } from '../src/bot-runtime/user-bootstrap.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { ingestBotUpdate } from '../src/bot-runtime/execution/ingestion-service.js';
import { registerBotRuntimeWorker } from '../src/bot-runtime/register-worker.js';
import { parseBotRuntimeRouteFlags } from '../src/bot-runtime/route-flags.js';
import { callbackUpdate, messageUpdate } from './fixtures/telegram-updates.js';

test('settings callbacks route without stale keyboard or feedback reads, retaining guards', async () => {
  const ctx = {
    pool: { query: async () => { throw new Error('unexpected context read'); } } as unknown as Pool,
    publicBotMetaForKey: () => ({ bot_key: 'uk-en' }),
    getBotLocale: () => ({})
  };
  for (const [chatType, senderIsBot, route] of [
    ['private', false, 'callback.settings'], ['group', false, 'guard.private_only'],
    ['private', true, 'guard.bot_sender']
  ] as const) {
    const result = await prepareBotUpdate(ctx, {botKey:'uk-en', telegramUpdate:callbackUpdate({data:'settings:r:level:b2',chatType,senderIsBot})});
    assert.equal(result.route,route);
  }
});

test('settings ingestion and workers use an independent durable queue while other updates retain theirs', async () => {
  const sent:string[]=[];
  const workers:Array<{name:string;options:Record<string,unknown>}>=[];
  const boss={
    send:async(name:string)=>{sent.push(name);return 'job';},
    work:async(name:string,options:Record<string,unknown>)=>{workers.push({name,options});}
  };
  const pool={query:async()=>({rows:[]})} as unknown as Pool;
  const ctx={pool,publicBotMetaForKey:()=>({bot_key:'uk-en'}),getBotLocale:()=>({})};
  const env={botRuntimeRouteFlags:parseBotRuntimeRouteFlags('{"uk-en":["settings.open","callback.settings","command.unknown"]}',['uk-en'])};
  for(const telegramUpdate of [messageUpdate({text:'· ⚙️ Settings'}),callbackUpdate({data:'settings:r:home'}),messageUpdate({text:'/stats'})]){
    const update=await prepareBotUpdate(ctx,{botKey:'uk-en',telegramUpdate});
    await ingestBotUpdate({...ctx,apiBoss:boss,env},update);
  }
  assert.deepEqual(sent,['bot-settings-process','bot-settings-process','bot-update-process']);
  await registerBotRuntimeWorker(boss,{
    pool,getBotLocale:()=>({}),telegramClient:{} as never,webappUrl:'https://example.test',
    progressEnabledBotKeys:new Set(),
    sendIdiomMore:async()=>({}),ai:{} as never
  });
  assert.deepEqual(workers.map(w=>w.name),['bot-update-process','bot-settings-process']);
  assert.equal(workers[1].options.pollingIntervalSeconds,0.5);
  assert.equal(workers[1].options.batchSize,1);
});

test('Postgres: fast settings bootstrap reactivates existing users without resetting preferences and bootstraps new users',{
  skip:process.env.BOT_RUNTIME_TEST_DATABASE_URL?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString:process.env.BOT_RUNTIME_TEST_DATABASE_URL});
  const chatId=9900089,botKey='uk-en';
  const raw=callbackUpdate({data:'settings:r:level:b2',chatId}) as Record<string,any>;
  raw.callback_query.from.id=chatId;
  const input=normalizeTelegramUpdate(raw);
  try{
    // No existing user: normal bootstrap must still create onboarding state.
    await bootstrapTelegramUser(pool,{botKey,input,onboardingEnabledBotKeys:new Set([botKey])});
    assert.equal((await pool.query('SELECT state FROM bot_onboarding_sessions WHERE chat_id=$1 AND bot_key=$2',[chatId,botKey])).rows[0].state,'choose_scenario');
    await pool.query("UPDATE users SET inactive_reason='blocked',inactive_at=NOW(),last_delivery_error='test',acquisition_start_payload='source' WHERE chat_id=$1",[chatId]);
    await pool.query("UPDATE user_bots SET level='b2',reply_mode='text',is_active=false,last_seen_at='2020-01-01' WHERE chat_id=$1 AND bot_key=$2",[chatId,botKey]);
    let queries=0;
    const fastPool={query:async(q:string,p:unknown[])=>{queries++;return pool.query(q,p);},connect:async()=>{throw new Error('existing user must not start another transaction');}} as unknown as Pool;
    await bootstrapTelegramUser(fastPool,{botKey,input,onboardingEnabledBotKeys:new Set([botKey])});
    assert.equal(queries,1);
    const row=(await pool.query('SELECT u.username,u.inactive_reason,u.last_delivery_error,u.acquisition_start_payload,ub.level,ub.reply_mode,ub.is_active,ub.last_seen_at FROM users u JOIN user_bots ub USING(chat_id) WHERE u.chat_id=$1 AND ub.bot_key=$2',[chatId,botKey])).rows[0];
    assert.equal(row.username,'alice');assert.equal(row.inactive_reason,null);assert.equal(row.last_delivery_error,null);
    assert.equal(row.acquisition_start_payload,'source');assert.equal(row.level,'b2');assert.equal(row.reply_mode,'text');
    assert.equal(row.is_active,true);assert.ok(Date.now()-row.last_seen_at.getTime()<10000);
  }finally{await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();}
});
