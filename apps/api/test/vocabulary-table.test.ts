import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import type {Pool} from 'pg';
import type {BotAiClient,VocabularyItem} from '../src/ai/client.js';
import {createSupportCallbackHandlers} from '../src/bot-runtime/handlers/support-callbacks.js';
import {formatVocabulary} from '../src/bot-runtime/support.js';
import {deliverTelegramText} from '../src/bot-runtime/delivery/telegram-text-delivery.js';
import {buildPreparedUpdate} from '../src/bot-runtime/update-router.js';
import {normalizeTelegramUpdate} from '../src/bot-runtime/telegram-update.js';
import {callbackUpdate} from './fixtures/telegram-updates.js';
const word=(extra:Partial<VocabularyItem>={}):VocabularyItem=>({surface:'Häuser',pos:'noun',article:'das',lemma:'Haus',infinitive:'',separable_prefix:'',translation_base:'будинок',transcription:'haʊ̯s',...extra});

test('vocabulary table keeps dictionary forms, IPA and literal markup in three complete columns',()=>{
 const items=[word(),word({pos:'verb',surface:'rief an',lemma:'anrufen',infinitive:'anrufen',transcription:''}),
   word({pos:'adjective',surface:'klaren',lemma:'klar',translation_base:'<ясний> & точний',transcription:'klaːɐ̯'})];
 const block=formatVocabulary(items,{}).blocks[0] as any;
 assert.equal(block.type,'table');assert.equal(block.is_compact,true);
 assert.deepEqual(block.cells[0].map((c:any)=>c.text),['Original','Translation','Transcription']);
 assert.ok(block.cells[0].every((c:any)=>c.is_header));
 assert.deepEqual(block.cells.slice(1).map((r:any[])=>r.map(c=>c.text)),[
   ['das Haus','будинок','[haʊ̯s]'],['anrufen','будинок','—'],['klar','<ясний> & точний','[klaːɐ̯]']]);
 assert.equal((formatVocabulary(Array(16).fill(word({translation_base:'а'.repeat(400)})),{}).blocks[0] as any).cells.length,16);
});

test('all production bots localize vocabulary columns and empty results',()=>{
 const dir=new URL('../../../deploy/bots/',import.meta.url);
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.json'))){
   const {locale}=JSON.parse(readFileSync(new URL(file,dir),'utf8'));
   assert.deepEqual((formatVocabulary([word()],locale).blocks[0] as any).cells[0].map((c:any)=>c.text),
     ['vocab_column_original','vocab_column_translation','vocab_column_transcription'].map(k=>{assert.ok(locale[k],file);return locale[k];}));
   assert.deepEqual(formatVocabulary([],locale),{blocks:[{type:'paragraph',text:locale.vocab_empty}]});
   assert.ok(locale.vocab_empty,file);
   for(const key of ['vocab_column_dictionary','vocab_add','vocab_learned','vocab_saved','vocab_unavailable'])assert.ok(locale[key],`${file}: ${key}`);
 }
});

test('vocabulary callback sends a native table once through the delivery ledger and leaves source content untouched',async()=>{
 const calls:Array<{botKey:string;method:string;body:Record<string,unknown>}>=[];let delivered=false;let marked=0;
 const update=buildPreparedUpdate({botKey:'uk-en',input:normalizeTelegramUpdate(callbackUpdate({data:'voc:123:000'}))});
 const snapshotId='00000000-0000-4000-8000-000000000001';
 const pool={query:async(sql:string)=>({rows:sql.includes('vocabulary_snapshot_rows')
   ? [{id:snapshotId,item:word(),progress:null}] : [{id:snapshotId}]})} as unknown as Pool;
 const handler=createSupportCallbackHandlers({pool,getBotLocale:()=>({}),ai:{} as BotAiClient,
   effectRunner:async(_pool,input)=>({result:input.stepKey.includes('snapshot')?{snapshotId}:{items:[word()]},duplicate:true}) as never,
   telegramClient:{async sendTelegramTextMessage(){throw new Error('unexpected plain-text message');},
     async callTelegramApi(botKey,method,body){calls.push({botKey,method,body});return {message_id:99};},
     async answerTelegramCallbackQuery(){},async editTelegramMessageText(){throw new Error('source voice/text must be preserved');},
     async editTelegramMessageReplyMarkup(){marked++;}},
   textDeliverer:args=>deliverTelegramText({...args,deliveryRepository:{
     begin:async(_p,input)=>{assert.equal(input.telegramMethod,'sendRichMessage');assert.equal(input.stepKey,'callback.vocab:message:v1');return delivered?{action:'delivered',deliveryId:'1',telegramMessageId:99}:{action:'send',deliveryId:'1',attempts:1};},
     markDelivered:async()=>{delivered=true;},markFailed:async()=>{throw new Error('unexpected failure');},markUnknown:async()=>{throw new Error('unexpected unknown');}
   }})
 }).find(h=>h.route==='callback.vocab')!;
 assert.equal((await handler.execute(update)).status,'delivered');
 assert.equal((await handler.execute(update)).status,'duplicate');
 assert.equal(calls.length,1);assert.equal(calls[0].method,'sendRichMessage');assert.equal(calls[0].botKey,'uk-en');assert.equal(calls[0].body.chat_id,42);
 assert.equal((calls[0].body.rich_message as any).blocks[0].type,'table');assert.equal(marked,2);
});

test('fourth column uses opaque callback buttons and shows saved progress without changing the first three columns',()=>{
 const items=[word(),word({lemma:'Bank'})];
 const rows=[{id:'00000000-0000-4000-8000-000000000001',item:items[0],progress:null},
   {id:'00000000-0000-4000-8000-000000000002',item:items[1],progress:5}];
 const table=formatVocabulary(items,{vocab_column_dictionary:'Мій словник',vocab_add:'Додати',vocab_learned:'Вивчене'},rows).blocks[0] as any;
 assert.equal(table.cells[0][3].text,'Мій словник');
 assert.deepEqual(table.cells[1][3].text,{type:'button',button:{text:'Додати',callback_data:`vadd:${rows[0].id}`}});
 assert.equal(table.cells[2][3].text.button.text,'✓ Вивчене');
 assert.ok(table.cells.slice(1).every((r:any[])=>Buffer.byteLength(r[3].text.button.callback_data)<=64));
 assert.deepEqual(table.cells.slice(1).map((r:any[])=>r.slice(0,3)),(formatVocabulary(items,{}).blocks[0] as any).cells.slice(1));
 for(const progress of [0,1,4])assert.equal((formatVocabulary([items[0]],{},[{...rows[0],progress}]).blocks[0] as any).cells[1][3].text.button.text,`✓ ${progress}/5`);
});

test('disabled Add route keeps the existing table without snapshot or sense requests',async()=>{
 let table:any;let effects=0;
 const update=buildPreparedUpdate({botKey:'uk-en',input:normalizeTelegramUpdate(callbackUpdate({data:'voc:123:000'}))});
 const handler=createSupportCallbackHandlers({pool:{} as Pool,ai:{} as BotAiClient,getBotLocale:()=>({}),vocabularyAddEnabled:()=>false,
  effectRunner:async(_pool,input)=>{effects++;assert.equal(input.stepKey,'callback.vocab:ai:v1');return {result:{items:[word()]},duplicate:false} as never;},
  telegramClient:{async answerTelegramCallbackQuery(){},async sendTelegramTextMessage(){return {};},async editTelegramMessageText(){},async editTelegramMessageReplyMarkup(){},
   async callTelegramApi(_bot,_method,body){table=body.rich_message;return {message_id:99};}},
  textDeliverer:async args=>{await args.telegramClient.sendTelegramTextMessage(42,'',{botKey:'uk-en'});return {status:'delivered',telegramMessageId:99};}
 }).find(h=>h.route==='callback.vocab')!;
 await handler.execute(update);assert.equal(effects,1);assert.equal(table.blocks[0].cells[0].length,3);
});
