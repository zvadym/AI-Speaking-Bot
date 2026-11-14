import test from 'node:test';
import assert from 'node:assert/strict';
import { createVocabularyAi } from '../src/vocabulary/ai.js';
import { evidenceRanges, isCopiedVocabularyReply, vocabularyCandidateKeys, vocabularyKey } from '../src/vocabulary/types.js';
import { structuredResponseFetch } from './fixtures/openai-http.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { messageUpdate } from './fixtures/telegram-updates.js';

const trace={chatId:123,botKey:'uk-de',route:'vocabulary.analysis'};
const source='Ich rufe dich morgen an.';
const candidate={id:'42',lemma:'anrufen',pos:'verb',meaning:'to call someone by phone'};

test('vocabulary transport stays compact, deduplicates headwords and records both operations',async()=>{
  const requests:Record<string,any>[]=[];const operations:string[]=[];
  const ai=createVocabularyAi({apiKey:'test',recordLlmCall:async event=>{operations.push(event.operation);},
    fetchImpl:structuredResponseFetch(body=>{
      requests.push(body);
      return {output_text:JSON.stringify(body.text.format.name==='vocabulary_extract'
        ? {items:['Anrufen',' anrufen ','sich freuen']}
        : {verdicts:[{wordId:'42',verdict:'correct',evidence:['rufe','an.']}]}),
        usage:{input_tokens:100,output_tokens:20,total_tokens:120}};
    })});
  assert.deepEqual(await ai.extract({language:'de',text:source,trace}),['anrufen','sich freuen']);
  const judgments=await ai.grade({language:'de',text:source,context:'What will you do tomorrow?',candidates:[candidate],trace});
  assert.equal(judgments[0].verdict,'correct');
  assert.deepEqual(operations,['vocabulary.extract','vocabulary.grade']);
  assert.ok(requests.every(r=>r.model==='gpt-6-luna' && r.reasoning.effort==='none' && r.text.format.strict && r.max_output_tokens===4000));
  assert.doesNotMatch(requests[0].input[1].content,/to call someone|42/);
  assert.match(requests[1].input[1].content,/to call someone by phone/);
});

test('grader rejects unknown/duplicate IDs, missing verdicts and fabricated source evidence',async()=>{
  for(const verdicts of [
    [{wordId:'other',verdict:'correct',evidence:[source]}],
    [],
    [{wordId:'42',verdict:'correct',evidence:[]}],
    [{wordId:'42',verdict:'correct',evidence:['Ich werde anrufen.']}],
    [{wordId:'42',verdict:'correct',evidence:['an.','rufe']}],
    [{wordId:'42',verdict:'certain',evidence:[source]}],
  ]) {
    const ai=createVocabularyAi({apiKey:'test',fetchImpl:structuredResponseFetch(()=>({output_text:JSON.stringify({verdicts})}))});
    await assert.rejects(ai.grade({language:'de',text:source,context:'Ich werde anrufen.',candidates:[candidate],trace}));
  }
  const duplicate=createVocabularyAi({apiKey:'test',fetchImpl:structuredResponseFetch(()=>({output_text:JSON.stringify({verdicts:[
    {wordId:'42',verdict:'uncertain',evidence:[]},{wordId:'42',verdict:'incorrect',evidence:[]}
  ]})}))});
  await assert.rejects(duplicate.grade({language:'de',text:source,context:'',candidates:[candidate,{...candidate,id:'43'}],trace}));
});

test('source ranges preserve Unicode and reject ambiguous or empty fragments',()=>{
  assert.deepEqual(evidenceRanges('🙂 Dámelo.', ['Dámelo.']),[{start:3,end:10,quote:'Dámelo.'}]);
  assert.throws(()=>evidenceRanges('go then go',['go']));
  assert.throws(()=>evidenceRanges(source,['']));
  assert.equal(vocabularyKey('  SICH   FREUEN '),'sich freuen');
  assert.equal(vocabularyKey('cafe\u0301'),'café');
});

test('an incomplete provider response cannot produce a vocabulary judgment even with valid JSON',async()=>{
  const ai=createVocabularyAi({apiKey:'test',fetchImpl:structuredResponseFetch(()=>({
    status:'incomplete',incomplete_details:{reason:'max_output_tokens'},
    output_text:JSON.stringify({verdicts:[{wordId:'42',verdict:'correct',evidence:[source]}]})
  }))});
  await assert.rejects(ai.grade({language:'de',text:source,context:'',candidates:[candidate],trace}),/incomplete/);
});

test('Telegram source time is preserved, with missing/invalid dates left unknown',()=>{
  const raw=messageUpdate({text:source});
  const message=raw.message as Record<string,unknown>;
  assert.equal(normalizeTelegramUpdate({...raw,message:{...message,date:1794600000}}).message.sentAtUnix,1794600000);
  for(const date of [undefined,null,-1,1.2,'1794600000',Infinity]) {
    assert.equal(normalizeTelegramUpdate({...raw,message:{...message,date}}).message.sentAtUnix,null);
  }
});

test('literal copying is rejected locally without any provider call',async()=>{
 const ai=createVocabularyAi({apiKey:'test',fetchImpl:async()=>{throw Error('provider must not run for a copied sentence');}});
 const candidates=[{id:'1',lemma:'pick up',pos:'verb',meaning:'collect someone by car'}];
 assert.deepEqual(await ai.grade({language:'en',text:'Yesterday I picked my friend up.',context:'Try this answer:\nYesterday I picked my friend up.',candidates,trace}),
  [{wordId:'1',verdict:'incorrect',evidence:[]}]);
});

test('copy guard compares complete replies/sentences, not shared words or partial clauses',()=>{
 assert.equal(isCopiedVocabularyReply('I bought a book.','I bought a book. What did you buy?','en'),true);
 assert.equal(isCopiedVocabularyReply('i bought a book','I bought a book.','en'),true);
 assert.equal(isCopiedVocabularyReply('I bought a red book.','I bought a book.','en'),false);
 assert.equal(isCopiedVocabularyReply('I bought a book.','Yesterday I bought a book for my sister.','en'),false);
 assert.equal(isCopiedVocabularyReply('Me levanto temprano.','Me levanto temprano. ¿Y tú?','es'),true);
 assert.equal(isCopiedVocabularyReply('Ich rufe dich an.','Ich rufe dich an. Wie geht es dir?','de'),true);
});

test('reflexive variants are candidates only and do not manufacture unrelated noun aliases',()=>{
 assert.deepEqual(vocabularyCandidateKeys('es',['llevar','sentarse','clase']),['llevar','sentarse','clase','llevarse','sentar']);
 assert.deepEqual(vocabularyCandidateKeys('de',['freuen','sich erinnern','Haus']),['freuen','sich erinnern','haus','sich freuen','erinnern']);
 assert.deepEqual(vocabularyCandidateKeys('en',['pick up']),['pick up']);
});

test('separated-prefix output becomes a candidate without turning it into a credit',()=>{
 assert.ok(vocabularyCandidateKeys('de',['stehen auf']).includes('aufstehen'));
 assert.ok(vocabularyCandidateKeys('de',['holen ... ab']).includes('abholen'));
 assert.ok(vocabularyCandidateKeys('de',['nehmen … teil']).includes('teilnehmen'));
 assert.ok(vocabularyCandidateKeys('de',['sich stellen vor']).includes('sich vorstellen'));
 // This deliberately broad candidate must still pass the semantic grader.
 assert.ok(vocabularyCandidateKeys('de',['warten auf']).includes('aufwarten'));
});
