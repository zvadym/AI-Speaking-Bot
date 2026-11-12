import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import type {Pool} from 'pg';
import type {BotAiClient,VocabularyItem} from '../src/bot-runtime/bot-ai.js';
import {formatVocabulary,createSupportCallbackHandlers} from '../src/bot-runtime/handlers/support-callbacks.js';
import {deliverTelegramText} from '../src/bot-runtime/telegram-text-delivery.js';
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
 }
});

test('vocabulary callback sends a native table once through the delivery ledger and leaves source content untouched',async()=>{
 const calls:Array<{botKey:string;method:string;body:Record<string,unknown>}>=[];let delivered=false;let marked=0;
 const update=buildPreparedUpdate({botKey:'uk-en',input:normalizeTelegramUpdate(callbackUpdate({data:'voc:123:000'}))});
 const handler=createSupportCallbackHandlers({pool:{} as Pool,getBotLocale:()=>({}),ai:{} as BotAiClient,
   effectRunner:async()=>({result:{items:[word()]},duplicate:true}) as never,
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
