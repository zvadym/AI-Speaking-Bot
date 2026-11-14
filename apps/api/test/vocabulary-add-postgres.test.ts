import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createSupportCallbackHandlers} from '../src/bot-runtime/handlers/support-callbacks.js';
import {buildPreparedUpdate} from '../src/bot-runtime/update-router.js';
import {normalizeTelegramUpdate} from '../src/bot-runtime/telegram-update.js';
import {callbackUpdate} from './fixtures/telegram-updates.js';
import {claimBotUpdateExecution} from '../src/bot-runtime/execution/execution-repository.js';
import type {BotAiClient,VocabularyItem} from '../src/ai/client.js';
import type {PreparedUpdate} from '../src/bot-runtime/contracts.js';
import {enqueueVocabularyAnalysis} from '../src/vocabulary/repository.js';
import {processVocabularyAnalyses} from '../src/vocabulary/worker.js';
import {createVocabularySnapshot,bindVocabularySnapshot,loadVocabularySnapshot,addVocabularySnapshotWord} from '../src/vocabulary/snapshots.js';

const databaseUrl=process.env.BOT_RUNTIME_TEST_DATABASE_URL||'';
const word=(translation='банк'):VocabularyItem=>({surface:'bank',lemma:'bank',pos:'noun',article:'',infinitive:'',separable_prefix:'',translation_base:translation,transcription:'bæŋk'});

test('Vocabulary sends saved row buttons; repeated clicks, cross-language senses and background progress stay scoped',{
 skip:databaseUrl?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
 const pool=new pg.Pool({connectionString:databaseUrl});const chatId=8_400_000_000+Math.floor(Math.random()*100000);
 let nextUpdate=chatId;let nextMessage=100;let vocabCalls=0;let senseCalls=0;const contracts:PreparedUpdate[]=[];
 const rich:Array<{id:number;body:any}>=[];const edits:any[]=[];
 const ai={
  async vocabulary(botKey:string,text:string){vocabCalls++;return [word(text==='river'?'берег':botKey==='de-en'?'Bank':'банк')];},
  async resolveVocabularySenses(input){
   senseCalls++;const meaning=input.text==='river'?'the land beside a river':'a financial institution';
   return input.items.map((_item,index)=>({index,meaningKey:input.existing.find(s=>s.meaning===meaning)?.meaningKey||null,meaning}));
  }
 } as Pick<BotAiClient,'vocabulary'|'resolveVocabularySenses'> as BotAiClient;
 const handlers=createSupportCallbackHandlers({pool,ai,getBotLocale:()=>({}),telegramClient:{
  async answerTelegramCallbackQuery(){},async editTelegramMessageText(){throw Error('original voice/text must remain unchanged');},
  async editTelegramMessageReplyMarkup(){},async sendTelegramTextMessage(){throw Error('expected rich table');},
  async callTelegramApi(_bot,method,body){
   if(method==='sendRichMessage'){const id=++nextMessage;rich.push({id,body});return {message_id:id};}
   assert.equal(method,'editMessageText');assert.ok(body.rich_message);assert.ok(!('text' in body));edits.push(body);return {};
  }
 }});
 async function prepare(data:string,botKey='uk-en',cardId=77,owner=chatId){
  const raw=callbackUpdate({chatId:owner,data,updateId:++nextUpdate});const cb=raw.callback_query as any;cb.from.id=owner;cb.message.message_id=cardId;
  const update=buildPreparedUpdate({botKey,input:normalizeTelegramUpdate(raw)});contracts.push(update);
  await claimBotUpdateExecution(pool,{contract:update,handlerVersion:1,jobId:randomUUID()});return update;
 }
 const execute=(u:PreparedUpdate)=>handlers.find(h=>h.route===u.route)!.execute(u);
 async function table(text='financial',botKey='uk-en'){
  const m=await pool.query("INSERT INTO messages(chat_id,bot_key,role,content) VALUES($1,$2,'assistant',$3) RETURNING id::text",[chatId,botKey,text]);
  const u=await prepare(`voc:${m.rows[0].id}:000`,botKey);await execute(u);await execute(u);
  const card=rich.at(-1)!;const cells=card.body.rich_message.blocks[0].cells;
  assert.equal(cells[0].length,4);assert.equal(cells[1][3].text.type,'button');
  return {cardId:card.id,data:cells[1][3].text.button.callback_data as string};
 }
 try{
  await pool.query('INSERT INTO users(chat_id) VALUES($1),($2)',[chatId,chatId+1]);
  await pool.query("INSERT INTO user_bots(chat_id,bot_key) VALUES($1,'uk-en'),($1,'de-en')",[chatId]);
  const first=await table();assert.equal(vocabCalls,1);assert.equal(senseCalls,1);assert.equal(rich.length,1);
  assert.equal((await pool.query('SELECT * FROM vocabulary_words WHERE chat_id=$1',[chatId])).rowCount,0);
  const buttons=await Promise.all([prepare(first.data,'uk-en',first.cardId),prepare(first.data,'uk-en',first.cardId)]);
  await Promise.all(buttons.map(execute));await execute(buttons[0]);
  assert.equal(vocabCalls,1);assert.equal(senseCalls,1);
  let words=await pool.query('SELECT * FROM vocabulary_words WHERE chat_id=$1',[chatId]);assert.equal(words.rowCount,1);
  const id=words.rows[0].id;const originalActive=words.rows[0].active_since;
  assert.equal(words.rows[0].progress,0);assert.equal(edits.at(-1).rich_message.blocks[0].cells[1][3].text.button.text,'✓ 0/5');
  for(const u of [await prepare(first.data,'uk-en',first.cardId,chatId+1),await prepare(first.data,'de-en',first.cardId),await prepare(first.data,'uk-en',first.cardId+100)])await execute(u);
  assert.equal((await pool.query('SELECT * FROM vocabulary_words WHERE chat_id=$1',[chatId+1])).rowCount,0);
  assert.equal((await pool.query('SELECT * FROM vocabulary_words WHERE chat_id=$1',[chatId])).rowCount,1);
  await pool.query('UPDATE vocabulary_words SET progress=2 WHERE id=$1',[id]);await execute(await prepare(first.data,'uk-en',first.cardId));
  assert.equal(edits.at(-1).rich_message.blocks[0].cells[1][3].text.button.text,'✓ 2/5');
  assert.equal((await pool.query('SELECT active_since FROM vocabulary_words WHERE id=$1',[id])).rows[0].active_since.getTime(),originalActive.getTime());
  const second=await table('financial','de-en');await execute(await prepare(second.data,'de-en',second.cardId));
  assert.equal((await pool.query('SELECT * FROM vocabulary_words WHERE chat_id=$1',[chatId])).rowCount,1);
  const river=await table('river');await execute(await prepare(river.data,'uk-en',river.cardId));
  assert.equal((await pool.query('SELECT * FROM vocabulary_words WHERE chat_id=$1',[chatId])).rowCount,2);
  await pool.query('UPDATE vocabulary_words SET archived_at=NOW() WHERE id=$1',[id]);
  await execute(await prepare(first.data,'uk-en',first.cardId));
  words=await pool.query('SELECT * FROM vocabulary_words WHERE id=$1',[id]);assert.equal(words.rows[0].progress,2);assert.equal(words.rows[0].archived_at,null);
  assert.ok(words.rows[0].active_since>=originalActive);
  const text='I deposited money in the bank.';
  const source=await pool.query("INSERT INTO messages(chat_id,bot_key,role,content) VALUES($1,'uk-en','user',$2) RETURNING id::text",[chatId,text]);
  await enqueueVocabularyAnalysis(pool,{messageId:source.rows[0].id,chatId,botKey:'uk-en',decisionId:`add-analysis:${chatId}`,language:'en',text,
    context:'',sourceAt:new Date(Date.now()+2000),inputMode:'voice'});
  await processVocabularyAnalyses({pool,ai:{extract:async()=>['bank'],grade:async input=>input.candidates.map(c=>({wordId:c.id,
    verdict:c.meaning==='a financial institution'?'correct':'uncertain',evidence:c.meaning==='a financial institution'?[text]:[]}))}});
  await execute(await prepare(first.data,'uk-en',first.cardId));assert.equal(edits.at(-1).rich_message.blocks[0].cells[1][3].text.button.text,'✓ 3/5');
  await pool.query('UPDATE vocabulary_words SET progress=5,learned_at=NOW() WHERE id=$1',[id]);await execute(await prepare(first.data,'uk-en',first.cardId));
  assert.equal(edits.at(-1).rich_message.blocks[0].cells[1][3].text.button.text,'✓ Learned');
 }finally{
  await pool.query('DELETE FROM bot_update_executions WHERE decision_id=ANY($1::text[])',[contracts.map(c=>c.decisionId)]);
  await pool.query('DELETE FROM users WHERE chat_id=ANY($1::bigint[])',[[chatId,chatId+1]]);await pool.end();
 }
});

test('snapshot generation is atomic, rejects forged sense IDs and does not allow adding an unbound row',{
 skip:databaseUrl?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
 const pool=new pg.Pool({connectionString:databaseUrl});const chatId=8_500_000_000+Math.floor(Math.random()*100000);const client=await pool.connect();
 const update=buildPreparedUpdate({botKey:'uk-en',input:normalizeTelegramUpdate(callbackUpdate({chatId,data:'voc:1:000',updateId:chatId}))});
 try{
  await pool.query('INSERT INTO users(chat_id) VALUES($1)',[chatId]);
  const message=await pool.query("INSERT INTO messages(chat_id,bot_key,role,content) VALUES($1,'uk-en','assistant','bank') RETURNING id",[chatId]);
  await client.query('BEGIN');
  await assert.rejects(createVocabularySnapshot(client,update,'en',message.rows[0].id,'bank',[word()],{
   resolveVocabularySenses:async()=>[{index:0,meaningKey:'invented',meaning:'a bank'}]
  } as unknown as BotAiClient),/unknown_sense/);await client.query('ROLLBACK');
  assert.equal((await pool.query('SELECT * FROM vocabulary_snapshots WHERE chat_id=$1',[chatId])).rowCount,0);
  await client.query('BEGIN');
  const id=await createVocabularySnapshot(client,update,'en',message.rows[0].id,'bank',[word()],{
   resolveVocabularySenses:async()=>[{index:0,meaningKey:null,meaning:'a bank'}]
  } as unknown as BotAiClient);await client.query('COMMIT');
  const snapshot=await loadVocabularySnapshot(pool,id,chatId,'uk-en');
  await assert.rejects(addVocabularySnapshotWord(pool,snapshot.rows[0].id,chatId,'uk-en',100),/pending/);
  await bindVocabularySnapshot(pool,id,chatId,'uk-en',100);
  await assert.rejects(bindVocabularySnapshot(pool,id,chatId,'uk-en',101),/unavailable/);
  assert.equal((await pool.query('SELECT * FROM vocabulary_words WHERE chat_id=$1',[chatId])).rowCount,0);
  const foreign={...update,botKey:'de-en',decisionId:`v1:de-en:${chatId}`};
  await client.query('BEGIN');
  await assert.rejects(createVocabularySnapshot(client,foreign,'en',message.rows[0].id,'bank',[word()],{
   resolveVocabularySenses:async()=>[{index:0,meaningKey:null,meaning:'a bank'}]
  } as unknown as BotAiClient),/unavailable/);await client.query('ROLLBACK');
  assert.equal((await pool.query('SELECT * FROM vocabulary_snapshots WHERE chat_id=$1',[chatId])).rowCount,1);
 }finally{client.release();await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();}
});
