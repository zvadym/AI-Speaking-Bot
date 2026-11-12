import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeedbackReplyState } from '../src/bot-runtime/context-loader.js';
import { prepareBotUpdate } from '../src/bot-runtime/prepare-update-service.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { parsePreparedUpdateContract } from '../src/bot-runtime/contract-validation.js';
import { messageUpdate, voice } from './fixtures/telegram-updates.js';

test('feedback never queries a wildcard request when the reply ID is missing or invalid', async()=>{
  const pool={query:async()=>{throw new Error('No reply must mean no feedback query');}};
  for(const id of [undefined,null,0,-1,1.5])assert.equal(await fetchFeedbackReplyState(pool,42,'uk-en',id),null);
});

test('normalization carries the replied-to prompt and old queued contracts remain valid',()=>{
  const input=normalizeTelegramUpdate(messageUpdate({text:'Feedback',extraMessage:{reply_to_message:{message_id:77}}}));
  assert.equal(input.message.replyToMessageId,77);
  const update=buildPreparedUpdate({botKey:'uk-en',input});
  assert.equal(parsePreparedUpdateContract(update).input.message.replyToMessageId,77);
  delete update.input.message.replyToMessageId;
  assert.equal(parsePreparedUpdateContract(update).input.message.replyToMessageId,undefined);
});

test('exact feedback replies are scoped to the prompt, user and bot and retain raw command-looking text',async()=>{
  const queries:Array<{sql:string;params:unknown[]}>=[];
  let pending=true;
  const pool={query:async<T extends Record<string,unknown>>(sql:string,params:unknown[]=[])=>{
    queries.push({sql,params});
    if(sql.includes('FROM pending_feedback')){
      return {rows:params[0]===42&&params[1]==='uk-en'&&params[2]===77?[{pending} as unknown as T]:[]};
    }
    return {rows:[] as T[]};
  }};
  const ctx={pool,getBotLocale:()=>({}),publicBotMetaForKey:(key:unknown)=>typeof key==='string'?{bot_key:key}:null};
  const prepare=(text:string,replyId?:number,botKey='uk-en')=>prepareBotUpdate(ctx,{botKey,telegramUpdate:messageUpdate({text,extraMessage:replyId?{reply_to_message:{message_id:replyId}}:{}})});
  assert.equal((await prepare('A normal conversation')).route,'message.text');
  assert.equal(queries.some(q=>q.sql.includes('FROM pending_feedback')),false);
  assert.equal((await prepare('/start is broken',77)).route,'pending_feedback.text');
  assert.equal((await prepare('/level',77)).route,'pending_feedback.text');
  assert.equal((await prepare('Feedback for another bot',77,'uk-de')).route,'message.text');
  assert.equal((await prepare('Reply to another message',88)).route,'message.text');
  const voiceUpdate=messageUpdate({voice,extraMessage:{reply_to_message:{message_id:77}}});
  assert.equal((await prepareBotUpdate(ctx,{botKey:'uk-en',telegramUpdate:voiceUpdate})).route,'pending_feedback.voice');
  pending=false;
  assert.equal((await prepare('A cancelled or expired request',77)).route,'feedback.expired');
  assert.equal((await prepare('· ⚙️ Settings',77)).route,'settings.open');
});


test('a reply to an ambiguously delivered feedback prompt never reaches tutor AI',async()=>{
 const ctx={pool:{query:async()=>({rows:[]})},getBotLocale:()=>({msg_feedback_prompt:'Please send feedback'}),
  publicBotMetaForKey:()=>({bot_key:'uk-en',telegram_url:'https://t.me/example_tutor_bot'})};
 const make=(username:string,isBot=true)=>prepareBotUpdate(ctx,{botKey:'uk-en',telegramUpdate:messageUpdate({text:'My feedback',
  extraMessage:{reply_to_message:{message_id:987,text:'Please send feedback',from:{username,is_bot:isBot}}}})});
 assert.equal((await make('example_tutor_bot')).route,'feedback.expired');
 assert.equal((await make('other_bot')).route,'message.text');
 assert.equal((await make('example_tutor_bot',false)).route,'message.text');
});
