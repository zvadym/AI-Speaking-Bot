import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { executeConversation } from '../src/bot-runtime/conversation/conversation.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { messageUpdate } from './fixtures/telegram-updates.js';
import type { BotAiClient } from '../src/ai/client.js';
import { enqueueVocabularyAnalysis, claimVocabularyAnalysis, finishVocabularyAnalysis } from '../src/vocabulary/repository.js';
import { processVocabularyAnalyses } from '../src/vocabulary/worker.js';
import type { VocabularyAi, VocabularyLanguage } from '../src/vocabulary/types.js';

const databaseUrl=process.env.BOT_RUNTIME_TEST_DATABASE_URL||'';
test('vocabulary outbox, retries, UTC credits and five-day cap survive concurrent workers',{
  skip:databaseUrl?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const chatId=8_100_000_000+Math.floor(Math.random()*100000);
  const language:VocabularyLanguage='de';let sequence=0;let extracts=0;let grades=0;let failGrade=false;
  const ai:VocabularyAi={
    extract:async()=>{extracts++;return ['anrufen'];},
    grade:async input=>{grades++;if(failGrade)throw new Error('temporary');return input.candidates.map(c=>({wordId:c.id,verdict:'correct',evidence:[input.text]}));}
  };
  async function enqueue(day:string,botKey='uk-de',text='Ich rufe dich an.') {
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const m=await client.query(`INSERT INTO messages(chat_id,bot_key,role,content) VALUES($1,$2,'user',$3) RETURNING id::text`,[chatId,botKey,text]);
      const source={messageId:m.rows[0].id,chatId,botKey,decisionId:`vocab-test:${chatId}:${++sequence}`,language,text,context:'',sourceAt:new Date(day),inputMode:'text' as const};
      await enqueueVocabularyAnalysis(client,source);
      await enqueueVocabularyAnalysis(client,source);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  try{
    await pool.query('INSERT INTO users(chat_id) VALUES($1)',[chatId]);
    await enqueue('2026-01-02T12:00:00Z');
    assert.equal((await pool.query('SELECT id FROM vocabulary_analyses WHERE chat_id=$1',[chatId])).rowCount,0);
    await processVocabularyAnalyses({pool,ai});assert.equal(extracts,0);
    const word=await pool.query(`INSERT INTO vocabulary_words(chat_id,target_language,lemma,lemma_key,pos,meaning_key,meaning,added_at,active_since)
      VALUES($1,'de','anrufen','anrufen','verb','phone','to call by phone','2026-01-01','2026-01-01') RETURNING id::text`,[chatId]);
    const id=word.rows[0].id;
    await enqueue('2025-12-31T23:59:59Z');
    assert.equal((await pool.query('SELECT id FROM vocabulary_analyses WHERE chat_id=$1',[chatId])).rowCount,0);
    await enqueue('2026-01-02T23:59:00Z');await enqueue('2026-01-02T23:59:30Z','en-de');
    // Independent jobs, same word/day: shared word locks and unique daily key.
    await Promise.all([processVocabularyAnalyses({pool,ai},1),processVocabularyAnalyses({pool,ai},1)]);
    assert.equal((await pool.query('SELECT progress FROM vocabulary_words WHERE id=$1',[id])).rows[0].progress,1);
    assert.equal((await pool.query('SELECT * FROM vocabulary_daily_credits WHERE word_id=$1',[id])).rowCount,1);
    await enqueue('2026-01-03T00:01:00Z');failGrade=true;
    await processVocabularyAnalyses({pool,ai},1);
    const extractionCount=extracts;const gradeCount=grades;
    await pool.query("UPDATE vocabulary_analyses SET next_attempt_at=NOW() WHERE chat_id=$1 AND status='pending'",[chatId]);
    failGrade=false;await processVocabularyAnalyses({pool,ai},1);
    assert.equal(extracts,extractionCount);assert.equal(grades,gradeCount+1);
    for(const day of [4,7,10,11]) {await enqueue(`2026-01-${String(day).padStart(2,'0')}T10:00:00Z`);await processVocabularyAnalyses({pool,ai},1);}
    const learned=(await pool.query('SELECT progress,learned_at FROM vocabulary_words WHERE id=$1',[id])).rows[0];
    assert.equal(learned.progress,5);assert.ok(learned.learned_at);
    const days=await pool.query("SELECT to_char(utc_day,'YYYY-MM-DD') AS utc_date FROM vocabulary_daily_credits WHERE word_id=$1 ORDER BY utc_day",[id]);
    assert.deepEqual(days.rows.map(r=>r.utc_date),['2026-01-02','2026-01-03','2026-01-04','2026-01-07','2026-01-10']);
    const costBefore=extracts;await enqueue('2026-01-12T10:00:00Z');await processVocabularyAnalyses({pool,ai});assert.equal(extracts,costBefore);
    // Separate sense with same lemma, archived after enqueue: must not get a late credit.
    const other=await pool.query(`INSERT INTO vocabulary_words(chat_id,target_language,lemma,lemma_key,pos,meaning_key,meaning,added_at,active_since)
      VALUES($1,'de','anrufen','anrufen','verb','second','another sense','2026-01-01','2026-01-01') RETURNING id::text`,[chatId]);
    await enqueue('2026-01-13T10:00:00Z');
    await pool.query('UPDATE vocabulary_words SET archived_at=NOW() WHERE id=$1',[other.rows[0].id]);
    const token=randomUUID();const analysis=await claimVocabularyAnalysis(pool,token);assert.ok(analysis);
    analysis.judgments=[{wordId:other.rows[0].id,verdict:'correct',evidence:[analysis.source_text]}];
    assert.equal(await finishVocabularyAnalysis(pool,analysis,randomUUID()),false);
    assert.equal(await finishVocabularyAnalysis(pool,analysis,token),true);
    assert.equal((await pool.query('SELECT progress FROM vocabulary_words WHERE id=$1',[other.rows[0].id])).rows[0].progress,0);
    // A retained credit does not disappear when conversation history is pruned.
    await pool.query('DELETE FROM messages WHERE chat_id=$1',[chatId]);
    assert.equal((await pool.query('SELECT * FROM vocabulary_daily_credits WHERE word_id=$1',[id])).rowCount,5);
  }finally{await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();}
});

test('nonpositive verdicts keep the same UTC day available; stale leases cannot overwrite results',{
  skip:databaseUrl?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
  const pool=new pg.Pool({connectionString:databaseUrl});const chatId=8_200_000_000+Math.floor(Math.random()*100000);
  try{
    await pool.query('INSERT INTO users(chat_id) VALUES($1)',[chatId]);
    const w=await pool.query(`INSERT INTO vocabulary_words(chat_id,target_language,lemma,lemma_key,pos,meaning_key,meaning,added_at,active_since)
      VALUES($1,'en','go','go','verb','move','to move somewhere','2026-01-01','2026-01-01') RETURNING id::text`,[chatId]);
    const wordId=w.rows[0].id;
    for(const [index,verdict] of ['uncertain','incorrect','correct'].entries()){
      const m=await pool.query("INSERT INTO messages(chat_id,bot_key,role,content) VALUES($1,'uk-en','user','I go home.') RETURNING id::text",[chatId]);
      await enqueueVocabularyAnalysis(pool,{messageId:m.rows[0].id,chatId,botKey:'uk-en',decisionId:`vocab-negative:${chatId}:${index}`,
        language:'en',text:'I go home.',context:'',sourceAt:new Date('2026-01-02T12:00:00Z'),inputMode:'text'});
      const token=randomUUID();const analysis=await claimVocabularyAnalysis(pool,token);assert.ok(analysis);
      analysis.judgments=[{wordId,verdict:verdict as 'correct'|'incorrect'|'uncertain',evidence:verdict==='correct'?['I go home.']:[]}];
      if(index===0){
        await pool.query("UPDATE vocabulary_analyses SET lease_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[analysis.id]);
        const replacementToken=randomUUID();const reclaimed=await claimVocabularyAnalysis(pool,replacementToken);assert.equal(reclaimed?.id,analysis.id);
        assert.equal(await finishVocabularyAnalysis(pool,analysis,token),false);
        assert.equal(await finishVocabularyAnalysis(pool,analysis,replacementToken),true);
      }else assert.equal(await finishVocabularyAnalysis(pool,analysis,token),true);
      assert.equal((await pool.query('SELECT progress FROM vocabulary_words WHERE id=$1',[wordId])).rows[0].progress,verdict==='correct'?1:0);
    }
    assert.equal((await pool.query('SELECT * FROM vocabulary_usages WHERE word_id=$1',[wordId])).rowCount,3);
  }finally{await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();}
});

test('conversation atomically records original text/voice sources and skips legacy contracts',{
  skip:databaseUrl?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
  const pool=new pg.Pool({connectionString:databaseUrl});const chatId=8_300_000_000+Math.floor(Math.random()*100000);
  const ai={respond:async()=>({detected_language:'en',is_target_language:true,has_mistakes:true,
    reply_text:'What happened next?',explanation_html:'I went home.'})} as unknown as BotAiClient;
  try{
    await pool.query('INSERT INTO users(chat_id) VALUES($1)',[chatId]);
    await pool.query("INSERT INTO user_bots(chat_id,bot_key) VALUES($1,'uk-en')",[chatId]);
    await pool.query(`INSERT INTO vocabulary_words(chat_id,target_language,lemma,lemma_key,pos,meaning_key,meaning,added_at,active_since)
      VALUES($1,'en','go','go','verb','move','to move somewhere','2026-01-01','2026-01-01')`,[chatId]);
    for(let index=0;index<4;index++){
      const input=normalizeTelegramUpdate(messageUpdate({chatId,text:'Yesterday I go home.',updateId:chatId+index}));
      input.message.sentAtUnix=index===2?undefined:1767441600;
      const update=buildPreparedUpdate({botKey:'uk-en',input});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await executeConversation(client,update,ai,input.message.text,index===1?'voice':'text');
        await client.query(index===3?'ROLLBACK':'COMMIT');
      }finally{client.release();}
    }
    const analyses=await pool.query('SELECT source_text,input_mode,source_at FROM vocabulary_analyses WHERE chat_id=$1 ORDER BY id',[chatId]);
    assert.equal(analyses.rows.length,2);
    assert.ok(analyses.rows.every(r=>r.source_text==='Yesterday I go home.' && r.source_at.getTime()===1767441600*1000));
    assert.deepEqual(analyses.rows.map(r=>r.input_mode),['text','voice']);
    assert.equal((await pool.query("SELECT * FROM messages WHERE chat_id=$1 AND role='user'",[chatId])).rowCount,3);
  }finally{await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();}
});

test('copied replies cost no LLM calls; pronominal aliases still require a grade before credit',{
 skip:databaseUrl?false:'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
},async()=>{
 const pool=new pg.Pool({connectionString:databaseUrl});const chatId=8_600_000_000+Math.floor(Math.random()*100000);
 let calls=0;
 const ai:VocabularyAi={extract:async()=>{calls++;return ['llevar'];},grade:async input=>{
  calls++;assert.equal(input.candidates[0].lemma,'llevarse');return [{wordId:input.candidates[0].id,verdict:'correct',evidence:[input.text]}];
 }};
 try{
  await pool.query('INSERT INTO users(chat_id) VALUES($1)',[chatId]);
  await pool.query(`INSERT INTO vocabulary_words(chat_id,target_language,lemma,lemma_key,pos,meaning_key,meaning,added_at,active_since)
   VALUES($1,'es','llevarse','llevarse','verb','carry','transportar algo consigo','2026-01-01','2026-01-01')`,[chatId]);
  for(const copied of [true,false]){
   const text=copied?'Me llevo el libro a casa.':'Llévatelo a casa.';
   const source=await pool.query("INSERT INTO messages(chat_id,bot_key,role,content) VALUES($1,'uk-es','user',$2) RETURNING id::text",[chatId,text]);
   await enqueueVocabularyAnalysis(pool,{messageId:source.rows[0].id,chatId,botKey:'uk-es',decisionId:`copy-alias:${chatId}:${copied}`,
    language:'es',text,context:copied?text:'',sourceAt:new Date('2026-01-02T10:00:00Z'),inputMode:'text'});
   await processVocabularyAnalyses({pool,ai},1);
   assert.equal(calls,copied?0:2);
   assert.equal((await pool.query('SELECT progress FROM vocabulary_words WHERE chat_id=$1',[chatId])).rows[0].progress,copied?0:1);
  }
 }finally{await pool.query('DELETE FROM users WHERE chat_id=$1',[chatId]);await pool.end();}
});
