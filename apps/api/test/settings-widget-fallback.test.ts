import test from 'node:test';
import assert from 'node:assert/strict';
import {sendReservedSettingsMessages} from '../src/bot-runtime/settings/direct-settings-open.js';

const delivery={id:'1',step_key:'settings:open:h:v1',telegram_method:'sendWidget',status:'pending',telegram_message_id:null,send:true};
const rejection=()=>Object.assign(new Error('Bad Request: INPUT_MEDIA_WIDGET_NOT_ALLOWED'),{telegramStatus:400});

test('widget rejection reserves rich transport before sending the fallback',async()=>{
  const calls:string[]=[];
  const result=await sendReservedSettingsMessages({deliveries:[delivery],chatId:1,richMessage:{blocks:[]},widget:{html:'html',chat_data:'{}',allow_queries:true},
    reserveRichFallback:async()=>{calls.push('reserve');},api:async method=>{calls.push(method);if(method==='sendWidget')throw rejection();return {message_id:42};}});
  assert.deepEqual(calls,['sendWidget','reserve','sendRichMessage']);
  assert.equal(result.status,'succeeded');assert.equal(result.deliveries[0].message_id,42);
});

test('ambiguous and unrelated widget failures never send a fallback',async()=>{
  for(const error of [new Error('timeout'),Object.assign(new Error('other bad request'),{telegramStatus:400}),Object.assign(rejection(),{telegramStatus:503})]){
    let calls=0;
    await sendReservedSettingsMessages({deliveries:[delivery],chatId:1,richMessage:{},widget:{html:'',chat_data:'{}',allow_queries:true},
      reserveRichFallback:async()=>assert.fail('unexpected reservation'),api:async()=>{calls++;throw error;}});
    assert.equal(calls,1);
  }
});

test('ambiguous rich fallback is unknown and a replay cannot resend it',async()=>{
  let calls=0;
  const input={chatId:1,richMessage:{},widget:{html:'',chat_data:'{}',allow_queries:true},reserveRichFallback:async()=>{},
    api:async(method:string)=>{calls++;throw method==='sendWidget'?rejection():new Error('timeout');}};
  const result=await sendReservedSettingsMessages({...input,deliveries:[delivery]});
  assert.equal(result.deliveries[0].status,'unknown');assert.equal(calls,2);
  await sendReservedSettingsMessages({...input,deliveries:[{...delivery,telegram_method:'sendRichMessage',status:'unknown',send:false}]});
  assert.equal(calls,2);
});

test('failed fallback reservation prevents sending a rich card',async()=>{
  let calls=0;
  await sendReservedSettingsMessages({deliveries:[delivery],chatId:1,richMessage:{},widget:{html:'',chat_data:'{}',allow_queries:true},
    reserveRichFallback:async()=>{throw new Error('reservation lost');},api:async()=>{calls++;throw rejection();}});
  assert.equal(calls,1);
});
