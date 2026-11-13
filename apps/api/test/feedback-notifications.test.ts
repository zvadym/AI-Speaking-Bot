import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { saveFeedback } from '../src/feedback/service.js';
import { MAX_FEEDBACK_AUDIO_BYTES, processFeedbackNotifications, type FeedbackNotificationDependencies } from '../src/feedback/notifications.js';
import { DiscordFeedbackDeliveryError, sendDiscordFeedbackNotification } from '../src/discord-events.js';

const databaseUrl=process.env.BOT_RUNTIME_TEST_DATABASE_URL;

test('Discord feedback uploads original audio and full long text without unsafe mentions or token URLs',async()=>{
  const text='A full feedback paragraph. '.repeat(120)+'@everyone';
  let posted: FormData | undefined;
  const result=await sendDiscordFeedbackNotification({webhookUrl:'https://discord.test/api/webhooks/id/secret',
    event:{feedback_id:12,feedback_text:text,source:'telegram',kind:'voice',bot_key:'uk-en',chat_id:42,created_at:'2026-11-12T12:00:00Z'},
    botMetaForKey:()=>({bot_name:'Sample tutor'}),
    attachments:[{name:'feedback.ogg',data:Buffer.from('OggS-original'),contentType:'audio/ogg'}],
    fetchImpl:async(url,request)=>{
      assert.equal(new URL(String(url)).searchParams.get('wait'),'true');
      posted=request!.body as FormData;
      return new Response(JSON.stringify({id:'123456789012345678'}),{status:200,headers:{'content-type':'application/json'}});
    }});
  assert.equal(result.messageId,'123456789012345678');
  const payload=JSON.parse(String(posted!.get('payload_json')));
  assert.deepEqual(payload.allowed_mentions,{parse:[]});
  assert.equal(payload.embeds[0].timestamp,'2026-11-12T12:00:00.000Z');
  assert.ok(payload.embeds[0].fields.some((field:{value:string})=>field.value.includes('Sample tutor')));
  assert.deepEqual(payload.attachments,[{id:0,filename:'feedback.ogg'},{id:1,filename:'feedback.txt'}]);
  assert.equal(await (posted!.get('files[0]') as Blob).text(),'OggS-original');
  assert.equal(await (posted!.get('files[1]') as Blob).text(),text);
  assert.ok(!JSON.stringify(payload).includes('api.telegram.org/file/bot'));
});

test('Discord send failures distinguish guaranteed rejection from ambiguous acceptance',async()=>{
  const base={webhookUrl:'https://discord.test/api/webhooks/id/secret',event:{feedback_text:'Hello'}};
  await assert.rejects(sendDiscordFeedbackNotification({...base,fetchImpl:async()=>{throw new Error('socket timeout secret URL');}}),
    error=>error instanceof DiscordFeedbackDeliveryError&&error.kind==='unknown'&&!error.message.includes('secret'));
  await assert.rejects(sendDiscordFeedbackNotification({...base,fetchImpl:async()=>new Response('{"retry_after":2}',{status:429})}),
    error=>error instanceof DiscordFeedbackDeliveryError&&error.kind==='retryable'&&error.retryAfterMs===2000);
  await assert.rejects(sendDiscordFeedbackNotification({...base,fetchImpl:async()=>new Response('{}',{status:503})}),
    error=>error instanceof DiscordFeedbackDeliveryError&&error.kind==='unknown');
  await assert.rejects(sendDiscordFeedbackNotification({...base,fetchImpl:async()=>new Response('{}',{status:400})}),
    error=>error instanceof DiscordFeedbackDeliveryError&&error.kind==='permanent');
  await assert.rejects(sendDiscordFeedbackNotification({...base,fetchImpl:async()=>new Response('{}',{status:200})}),
    error=>error instanceof DiscordFeedbackDeliveryError&&error.kind==='unknown');
});

test('Postgres: feedback and outbox are atomic, retries are fenced and voice errors preserve the original',{
  skip:databaseUrl?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async t=>{
  const name='feedback_outbox_'+randomUUID().replaceAll('-','');
  const admin=new pg.Client({connectionString:databaseUrl});
  const url=new URL(databaseUrl!);url.pathname='/'+name;
  const pool=new pg.Pool({connectionString:url.toString(),application_name:'feedback-outbox-tests'});
  await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);
  try{
    const dir=new URL('../../../db/migrations/',import.meta.url);
    for(const file of (await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort()){
      const sql=(await fs.readFile(new URL(file,dir),'utf8')).split('-- migrate:up')[1].split('-- migrate:down')[0];
      await pool.query(sql);
    }
    const input=(key:string,voice=false)=>({chatId:42,botKey:'uk-en',username:'sample',firstName:'Sample',
      kind:voice?'voice' as const:'text' as const,feedbackText:voice?null:'The full feedback',telegramFileId:voice?'stored-file':null,
      source:'telegram' as const,idempotencyKey:key});
    const clear=()=>pool.query('TRUNCATE feedback,feedback_threads CASCADE');
    let transcriptions=0;
    const calls: Array<Parameters<typeof sendDiscordFeedbackNotification>[0]>=[];
    const outsideTransaction=async()=>{
      const r=await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='feedback-outbox-tests' AND state='idle in transaction'");
      assert.equal(r.rows[0].n,0);
    };
    const deps:FeedbackNotificationDependencies={pool,webhookUrl:'https://discord.test/webhook',
      telegramClient:{callTelegramApi:async()=>({file_size:10}),downloadTelegramFile:async()=>{await outsideTransaction();return Buffer.from('OggS-test')}},
      ai:{transcribe:async(_bot,_audio,options)=>{transcriptions++;assert.equal(options?.baseLanguage,true);await outsideTransaction();return 'Точний відгук'}},
      sender:async args=>{await outsideTransaction();calls.push(args);return {messageId:'123456789012345678'}}};
    await t.test('one feedback/thread/outbox for concurrent duplicate updates; caller rollback removes all three',async()=>{
      await clear();
      const results=await Promise.all(Array.from({length:6},()=>saveFeedback(pool,input('duplicate'))));
      assert.equal(new Set(results.map(r=>r.id)).size,1);
      assert.equal(results.filter(r=>!r.duplicate).length,1);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM feedback_notifications')).rows[0].n,1);
      await assert.rejects(saveFeedback(pool,{...input('duplicate'),chatId:99}),/scope_mismatch/);
      const client=await pool.connect();
      try{await client.query('BEGIN');await saveFeedback(client,input('rolled-back'));await client.query('ROLLBACK')}finally{client.release()}
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM feedback WHERE idempotency_key='rolled-back'")).rows[0].n,0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM feedback_threads')).rows[0].n,1);
    });
    await t.test('overlapping outbox scans only reserve and post one notification',async()=>{
      await clear();await saveFeedback(pool,input('overlapping'));
      let release:()=>void=()=>{};let started:()=>void=()=>{};let sends=0;
      const reached=new Promise<void>(resolve=>{started=resolve});
      const gate=new Promise<void>(resolve=>{release=resolve});
      const sender=async()=>{sends++;started();await gate;return {messageId:'123456789012345678'}};
      const first=processFeedbackNotifications({...deps,sender});await reached;
      const other=await processFeedbackNotifications({...deps,sender});assert.equal(other.sent,0);
      release();assert.equal((await first).sent,1);assert.equal(sends,1);
    });
    await t.test('voice sends audio and cached base-language transcription; 429 retries do not transcribe twice',async()=>{
      await clear();calls.length=0;transcriptions=0;
      const saved=await saveFeedback(pool,input('voice-retry',true));let attempts=0;
      const sender=async(args:Parameters<typeof sendDiscordFeedbackNotification>[0])=>{attempts++;if(attempts===1)throw new DiscordFeedbackDeliveryError('retryable','rate_limited',1000);return deps.sender!(args)};
      const first=await processFeedbackNotifications({...deps,sender},{limit:1});assert.equal(first.retried,1);
      await pool.query('UPDATE feedback_notifications SET next_attempt_at=NOW() WHERE feedback_id=$1',[saved.id]);
      const second=await processFeedbackNotifications({...deps,sender});assert.equal(second.sent,1);
      assert.equal(transcriptions,1);assert.equal(calls.length,1);
      assert.equal(calls[0].event.feedback_text,'Точний відгук');
      assert.equal(Buffer.from(calls[0].attachments![0].data).toString(),'OggS-test');
      assert.equal((await pool.query('SELECT transcript FROM feedback WHERE id=$1',[saved.id])).rows[0].transcript,'Точний відгук');
      assert.equal((await pool.query('SELECT status,discord_message_id FROM feedback_notifications WHERE feedback_id=$1',[saved.id])).rows[0].status,'sent');
      await processFeedbackNotifications(deps);assert.equal(calls.length,1);
    });
    await t.test('STT failure still delivers original audio and a marked unavailable transcript',async()=>{
      await clear();calls.length=0;await saveFeedback(pool,input('no-stt',true));
      await processFeedbackNotifications({...deps,ai:{transcribe:async()=>{throw new Error('provider unavailable')}}});
      assert.equal(calls.length,1);assert.equal(calls[0].attachments!.length,1);
      assert.match(String(calls[0].event.feedback_text),/Transcript unavailable/);
      assert.equal((await pool.query('SELECT transcript_status FROM feedback_notifications')).rows[0].transcript_status,'unavailable');
    });
    await t.test('oversize audio is preserved by reference and reported without downloading or silently discarding it',async()=>{
      await clear();calls.length=0;await saveFeedback(pool,input('large',true));
      await processFeedbackNotifications({...deps,telegramClient:{callTelegramApi:async()=>({file_size:MAX_FEEDBACK_AUDIO_BYTES+1}),
        downloadTelegramFile:async()=>{throw new Error('must not download')}}});
      assert.match(String(calls[0].event.feedback_text),/exceeds the supported 20 MB/);
      assert.equal(calls[0].attachments!.length,0);
      assert.equal((await pool.query('SELECT attachment_error_code FROM feedback_notifications')).rows[0].attachment_error_code,'feedback_audio_too_large');
      assert.equal((await pool.query('SELECT telegram_file_id FROM feedback')).rows[0].telegram_file_id,'stored-file');
    });
    await t.test('ambiguous send and expired sending lease never automatically post again',async()=>{
      await clear();await saveFeedback(pool,input('unknown'));let sends=0;
      const sender=async()=>{sends++;throw new DiscordFeedbackDeliveryError('unknown','timeout')};
      assert.equal((await processFeedbackNotifications({...deps,sender})).unknown,1);
      await processFeedbackNotifications({...deps,sender});assert.equal(sends,1);
      await clear();const saved=await saveFeedback(pool,input('crash'));
      await pool.query("UPDATE feedback_notifications SET status='sending',lease_token=$2,lease_expires_at=NOW()-INTERVAL '1 minute' WHERE feedback_id=$1",[saved.id,randomUUID()]);
      await processFeedbackNotifications({...deps,sender});assert.equal(sends,1);
      assert.equal((await pool.query('SELECT status FROM feedback_notifications')).rows[0].status,'unknown');
    });
    await t.test('preparation crash recovers safely and rejected audio can retry as an explicitly partial delivery',async()=>{
      await clear();calls.length=0;const saved=await saveFeedback(pool,input('prepare-crash'));
      await pool.query("UPDATE feedback_notifications SET status='preparing',lease_token=$2,lease_expires_at=NOW()-INTERVAL '1 minute' WHERE feedback_id=$1",[saved.id,randomUUID()]);
      assert.equal((await processFeedbackNotifications(deps)).sent,1);
      await clear();calls.length=0;const voice=await saveFeedback(pool,input('reject-attachment',true));let attempts=0;
      const sender=async(args:Parameters<typeof sendDiscordFeedbackNotification>[0])=>{if(++attempts===1)throw new DiscordFeedbackDeliveryError('permanent','discord_feedback_http_413');return deps.sender!(args)};
      await processFeedbackNotifications({...deps,sender},{limit:1});
      await pool.query('UPDATE feedback_notifications SET next_attempt_at=NOW() WHERE feedback_id=$1',[voice.id]);
      await processFeedbackNotifications({...deps,sender});assert.equal(calls.length,1);assert.equal(calls[0].attachments!.length,0);
      assert.match(String(calls[0].event.feedback_text),/Original audio could not be attached/);
    });
  } finally{
    await pool.end();
    for(let attempt=0;attempt<20;attempt++){
      const active=await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1',[name]);
      if(!active.rows[0].n)break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    await admin.query(`DROP DATABASE "${name}"`);await admin.end();
  }
});
