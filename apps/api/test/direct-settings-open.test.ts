import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createDirectSettingsHandler, saveDirectSettings } from '../src/bot-runtime/direct-settings.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { messageUpdate, callbackUpdate } from './fixtures/telegram-updates.js';
import { createTelegramWebhookRouter } from '../src/routes/telegram-webhook.js';
import { parseBotRuntimeRouteFlags } from '../src/bot-runtime/route-flags.js';
import { deriveTelegramWebhookSecret } from '../src/bot-runtime/webhook-secret.js';

test('Postgres: direct opening is durable without a queue, including duplicates, rejected and ambiguous sends',{
  skip:process.env.BOT_RUNTIME_TEST_DATABASE_URL?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString:process.env.BOT_RUNTIME_TEST_DATABASE_URL,application_name:'settings-open-test'});
  const chatId=9900092,botKey='uk-en';let id=9860000,messageId=100,failMethod='',failure:unknown;
  const ids:string[]=[],calls:Array<{method:string;body:Record<string,unknown>}>=[];
  const raw=(text='· ⚙️ Settings',callback=false)=>{
    id++;ids.push(`v1:${botKey}:${id}`);
    const u=(callback?callbackUpdate({data:text,chatId,updateId:id}):messageUpdate({text,chatId,updateId:id})) as Record<string,any>;
    (callback?u.callback_query:u.message).from.id=chatId;return u;
  };
  const telegramClient={callTelegramApi:async(_b:string,method:string,body:Record<string,unknown>)=>{
    calls.push({method,body});
    if(method.startsWith('send')){
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='settings-open-test' AND state='idle in transaction'")).rows[0].n,0);
      if(method===failMethod){failMethod='';throw failure;}
      return {message_id:++messageId};
    }
    return {};
  }};
  const handle=createDirectSettingsHandler({pool,telegramClient,getBotLocale:()=>({}),onboardingEnabledBotKeys:new Set([botKey])});
  const records=async(updateId:number)=>(await pool.query('SELECT * FROM bot_update_deliveries WHERE decision_id=$1 ORDER BY step_key',[`v1:${botKey}:${updateId}`])).rows;
  const run=async(u:Record<string,unknown>)=>handle(botKey,normalizeTelegramUpdate(u));
  const count=(method:string)=>calls.filter(c=>c.method===method).length;
  try{
    // A first-time user also opens directly, with normal onboarding bootstrap.
    const first=raw();await run(first);
    assert.equal(count('sendRichMessage'),1);assert.equal(count('sendMessage'),0);
    assert.equal((await pool.query('SELECT state FROM bot_onboarding_sessions WHERE chat_id=$1 AND bot_key=$2',[chatId,botKey])).rows[0].state,'choose_scenario');
    assert.equal((await records(Number(first.update_id)))[0].status,'delivered');
    assert.equal(calls.find(c=>c.method==='sendRichMessage')!.body.reply_markup,undefined);
    await Promise.all([run(first),run(first)]);assert.equal(count('sendRichMessage'),1);
    // Independent taps are distinct requests and may each open a new card.
    await run(raw());assert.equal(count('sendRichMessage'),2);
    const slash=raw('/settings');assert.equal(await run(slash),false);assert.equal(await run(slash),false);
    assert.equal(count('sendRichMessage'),2);assert.equal(count('sendMessage'),0);
    assert.deepEqual(await records(Number(slash.update_id)),[]);
    await run(raw('settings:w:open',true));assert.equal(count('sendRichMessage'),3);

    // A definite Telegram rejection can retry the reserved card; no keyboard header is sent.
    const limited=raw();failure=Object.assign(new Error('retry later'),{telegramStatus:429});failMethod='sendRichMessage';
    await assert.rejects(run(limited));const cards=count('sendRichMessage');
    await run(limited);assert.equal(count('sendRichMessage'),cards+1);assert.equal(count('sendMessage'),0);
    assert.equal((await records(Number(limited.update_id)))[0].attempts,2);
    assert.equal((await records(Number(limited.update_id)))[0].status,'delivered');
    const rejected=raw();failure=Object.assign(new Error('unavailable'),{telegramStatus:503});failMethod='sendRichMessage';
    await assert.rejects(run(rejected));await run(rejected);
    assert.equal((await records(Number(rejected.update_id)))[0].attempts,2);

    // A timed-out send may have reached Telegram: never issue it twice.
    const ambiguous=raw();failure=new Error('timeout');failMethod='sendRichMessage';
    await run(ambiguous);const afterTimeout=count('sendRichMessage');await run(ambiguous);
    assert.equal(count('sendRichMessage'),afterTimeout);
    assert.equal((await records(Number(ambiguous.update_id)))[0].status,'unknown');

    // Simulate process loss after durable reservation, before acknowledgement.
    const interrupted=raw();
    await saveDirectSettings(pool,botKey,normalizeTelegramUpdate(interrupted),{variant:'r',kind:'open',value:''},randomUUID());
    const beforeResume=count('sendRichMessage');await run(interrupted);
    assert.equal(count('sendRichMessage'),beforeResume);
    assert.equal((await records(Number(interrupted.update_id)))[0].status,'unknown');

    // A legacy worker already delivered the card but did not finish its execution.
    const legacy=raw();
    await saveDirectSettings(pool,botKey,normalizeTelegramUpdate(legacy),{variant:'r',kind:'open',value:''},randomUUID());
    await pool.query("UPDATE bot_update_deliveries SET status='delivered',telegram_message_id=999 WHERE decision_id=$1",[`v1:${botKey}:${legacy.update_id}`]);
    await run(legacy);assert.equal(count('sendRichMessage'),beforeResume);

    // HTTP ingress checks settings.open independently of callback.settings.
    let enqueued=0;
    const botToken='token',signingSecret='secret';
    const ctx={pool,telegramClient,getBotLocale:()=>({}),publicBotMetaForKey:()=>({bot_key:botKey}),
      apiBoss:{send:async()=>{enqueued++;throw new Error('must not enqueue settings');}},
      env:{telegramBotTokensByBotKey:{[botKey]:botToken},internalApiSecret:signingSecret,jwtSecret:'unused',
        botImmediateAckEnabledBotKeys:new Set<string>(),botRuntimeRouteFlags:parseBotRuntimeRouteFlags('{"uk-en":["callback.settings"]}',[botKey])}};
    const app=express();app.use(express.json());app.use(createTelegramWebhookRouter(ctx));
    const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const button=raw(),secret=deriveTelegramWebhookSecret({botKey,botToken,signingSecret});
      const post=(token:string)=>fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/telegram/webhook/uk-en`,{
        method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':token},body:JSON.stringify(button)});
      const sentBefore=count('sendRichMessage');
      assert.equal((await post('wrong')).status,401);assert.equal(count('sendRichMessage'),sentBefore);
      assert.equal((await post(secret)).status,503);assert.equal(count('sendRichMessage'),sentBefore);
      ctx.env.botRuntimeRouteFlags=parseBotRuntimeRouteFlags('{"uk-en":["settings.open"]}',[botKey]);
      assert.equal((await post(secret)).status,200);assert.equal((await post(secret)).status,200);
      assert.equal(count('sendRichMessage'),sentBefore+1);assert.equal(enqueued,0);
    }finally{server.close();await once(server,'close');}
  }finally{
    await pool.query('DELETE FROM bot_update_executions WHERE decision_id=ANY($1::text[])',[ids]);
    await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();
  }
});
