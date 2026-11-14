import test from 'node:test';
import assert from 'node:assert/strict';
import {createBotAiClient,type VocabularyItem} from '../src/ai/client.js';
import {validateVocabularySenses} from '../src/vocabulary/senses.js';
import {structuredResponseFetch} from './fixtures/openai-http.js';
const item:VocabularyItem={surface:'bank',lemma:'bank',pos:'noun',article:'',infinitive:'',separable_prefix:'',translation_base:'банк',transcription:'bæŋk'};
const input={botKey:'uk-en',text:'I put money in the bank.',items:[item],existing:[{lemmaKey:'bank',pos:'noun',meaningKey:'sense-1',meaning:'a financial institution'}]};

test('sense resolver keeps translations and existing identity in a structured Luna request',async()=>{
 const requests:any[]=[];const operations:string[]=[];
 const ai=createBotAiClient({apiKey:'test',model:'tutor-model',getBotConfig:()=>({base_language:'uk',learning_language:'en'}),
  recordLlmCall:async event=>{operations.push(event.operation);},fetchImpl:structuredResponseFetch(body=>{
   requests.push(body);return {output_text:JSON.stringify({senses:[{index:0,meaningKey:'sense-1',meaning:'a financial institution'}]})};
  })});
 assert.equal((await ai.resolveVocabularySenses!(input))[0].meaningKey,'sense-1');
 assert.deepEqual(operations,['vocabulary.senses']);assert.equal(requests[0].model,'gpt-6-luna');assert.equal(requests[0].reasoning.effort,'none');
 assert.equal(requests[0].text.format.strict,true);const data=JSON.parse(requests[0].input[1].content);
 assert.equal(data.base_language,'uk');assert.deepEqual(data.existing,input.existing);assert.equal(data.items[0].translation_base,'банк');
});

test('sense response validation rejects missing/duplicate/out-of-range rows and malformed meaning data',()=>{
 for(const senses of [[],[{index:1,meaningKey:null,meaning:'x'}],[{index:0,meaningKey:4,meaning:'x'}],
  [{index:0,meaningKey:null,meaning:''}],null])assert.throws(()=>validateVocabularySenses(senses,input));
 assert.throws(()=>validateVocabularySenses([{index:0,meaningKey:null,meaning:'x'},{index:0,meaningKey:null,meaning:'x'}],{...input,items:[item,item]}));
});
