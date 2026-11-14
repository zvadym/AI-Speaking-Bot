import test from 'node:test';
import assert from 'node:assert/strict';
import {loadVocabularyPage} from '../src/vocabulary/list.js';
import {parseSettingsAction} from '../src/bot-runtime/settings/settings-model.js';
import {renderSettingsRich,settingsLabels} from '../src/bot-runtime/settings/settings-views.js';
import {createDirectSettingsHandler} from '../src/bot-runtime/settings/direct-settings.js';
import {normalizeTelegramUpdate} from '../src/bot-runtime/telegram-update.js';
import {callbackUpdate} from './fixtures/telegram-updates.js';
import {createSettingsHandlers} from '../src/bot-runtime/handlers/settings.js';
import {buildPreparedUpdate} from '../src/bot-runtime/update-router.js';
import {claimBotUpdateExecution} from '../src/bot-runtime/execution/execution-repository.js';
import type {Pool} from 'pg';

test('vocabulary pages only accept bounded native callbacks',()=>{
  assert.equal(parseSettingsAction('settings:r:vocabulary:0').value,'0');
  for(const value of ['', '-1','01','1.2','1000000','NaN','0:extra'])assert.throws(()=>parseSettingsAction('settings:r:vocabulary:'+value));
  for(const variant of ['h','w'])assert.throws(()=>parseSettingsAction(`settings:${variant}:vocabulary:0`));
});

test('invalid dictionary scope and unsupported settings targets never query the database',async()=>{
  const pool={query:async()=>assert.fail('must not query'),connect:async()=>assert.fail('must not connect')} as unknown as Pool;
  for(const [chat,bot,page] of [[0,'uk-en',0],[42,'en-it',0],[42,'uk-en',-1],[42,'uk-en',1000000]] as const)
    await assert.rejects(loadVocabularyPage(pool,chat,bot,page),/invalid_vocabulary_page/);
  let answered=false;
  const handler=createDirectSettingsHandler({pool,getBotLocale:()=>({}),telegramClient:{callTelegramApi:async(_bot,method)=>{assert.equal(method,'answerCallbackQuery');answered=true;}}});
  await handler('en-it',normalizeTelegramUpdate(callbackUpdate({data:'settings:r:vocabulary:0'})));
  assert.equal(answered,true);
});

test('vocabulary renders empty and learned states with safe text and bounded navigation',()=>{
  const labels=settingsLabels({});
  const empty=JSON.stringify(renderSettingsRich({v:1,l:'a2',r:'voice',screen:'vocabulary',vocabulary:{total:0,page:0,items:[]}},labels));
  assert.ok(empty.includes(labels.vocabulary_empty));assert.ok(empty.includes('settings:r:home'));assert.ok(!empty.includes('settings:r:vocabulary:1'));
  const rendered=JSON.stringify(renderSettingsRich({v:1,l:'a2',r:'voice',screen:'vocabulary',vocabulary:{total:21,page:1,items:[
    {id:'1',lemma:'<button>',meaning:'meaning',translation:'bank',progress:5},
    {id:'2',lemma:'bank',meaning:'x'.repeat(1000),translation:null,progress:2}
  ]}},labels));
  assert.ok(rendered.includes('✓ Learned'));assert.ok(rendered.includes('2/5'));assert.ok(rendered.includes('settings:r:vocabulary:0'));assert.ok(rendered.includes('settings:r:vocabulary:2'));
  assert.ok(rendered.includes('"text":"<button>"'));assert.ok(!rendered.includes('x'.repeat(161)));
});

test('Postgres: own dictionary is paginated, sense/base-language scoped and edited in the same settings card',{
  skip:!process.env.BOT_RUNTIME_TEST_DATABASE_URL
},async()=>{
  const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:process.env.BOT_RUNTIME_TEST_DATABASE_URL});
  const chat=9900190,other=9900191;const decisions:string[]=[];
  try{
    await pool.query('INSERT INTO users(chat_id) VALUES($1),($2)',[chat,other]);
    await pool.query("INSERT INTO user_bots(chat_id,bot_key,level,reply_mode) VALUES($1,'uk-en','a2','voice')",[chat]);
    assert.deepEqual(await loadVocabularyPage(pool,chat,'uk-en',9),{total:0,page:0,items:[]});
    await pool.query(`INSERT INTO vocabulary_words(chat_id,target_language,lemma,lemma_key,pos,meaning_key,meaning,progress,learned_at)
      SELECT $1,'en',CASE WHEN i<=2 THEN 'bank' ELSE 'word'||i END,CASE WHEN i<=2 THEN 'bank' ELSE 'word'||i END,
      'noun','sense'||i,'meaning'||i,CASE WHEN i=12 THEN 5 ELSE 0 END,CASE WHEN i=12 THEN NOW() ELSE NULL END
      FROM generate_series(1,12) i ORDER BY i`,[chat]);
    await pool.query(`INSERT INTO vocabulary_words(chat_id,target_language,lemma,lemma_key,pos,meaning_key,meaning,archived_at)
      VALUES($1,'en','archived','archived','noun','archived','archived',NOW()),
      ($1,'es','casa','casa','noun','casa','house',NULL),($2,'en','private','private','noun','private','private',NULL)`,[chat,other]);
    for(const [owner,bot,translation,date] of [[chat,'uk-en','старий','2000-01-01'],[chat,'uk-en','новий','2001-01-01'],[chat,'de-en','falsch','2002-01-01'],[other,'uk-en','чужий','2003-01-01']] as const){
      const snapshot=(await pool.query(`INSERT INTO vocabulary_snapshots(chat_id,bot_key,target_language,decision_id,created_at)
        VALUES($1,$2,'en',$3,$4) RETURNING id`,[owner,bot,`list-${owner}-${bot}-${date}`,date])).rows[0];
      await pool.query(`INSERT INTO vocabulary_snapshot_rows(snapshot_id,row_index,item,lemma,lemma_key,pos,meaning_key,meaning)
        VALUES($1,0,$2,'word12','word12','noun','sense12','meaning12')`,[snapshot.id,JSON.stringify({translation_base:translation})]);
    }
    let page=await loadVocabularyPage(pool,chat,'uk-en',0);
    assert.equal(page.total,12);assert.equal(page.items.length,10);assert.equal(page.items[0].translation,'новий');assert.equal(page.items[0].progress,5);
    assert.equal((await loadVocabularyPage(pool,chat,'de-en',0)).items[0].translation,'falsch');
    const last=await loadVocabularyPage(pool,chat,'uk-en',999999);assert.equal(last.page,1);assert.deepEqual(last.items.map(w=>w.lemma),['bank','bank']);assert.notEqual(last.items[0].meaning,last.items[1].meaning);
    assert.equal((await loadVocabularyPage(pool,chat,'uk-es',0)).items[0].lemma,'casa');
    const wordsBefore=(await pool.query('SELECT * FROM vocabulary_words WHERE chat_id=$1 ORDER BY id',[chat])).rows;
    const prefsBefore=(await pool.query('SELECT level,reply_mode,tts_voice FROM user_bots WHERE chat_id=$1',[chat])).rows;
    const calls:Array<{method:string;body:Record<string,unknown>}>=[];
    const handle=createDirectSettingsHandler({pool,getBotLocale:()=>({}),telegramClient:{callTelegramApi:async(_bot,method,body)=>{calls.push({method,body});return {};}}});
    let updateId=990019000;
    const make=(data:string)=>{const raw=callbackUpdate({data,chatId:chat,updateId:++updateId}) as Record<string,any>;raw.callback_query.from.id=chat;raw.callback_query.message.message_id=2200;decisions.push(`v1:uk-en:${updateId}`);return normalizeTelegramUpdate(raw);};
    const run=async(data:string)=>handle('uk-en',make(data));
    await run('settings:r:vocabulary:0');await run('settings:r:vocabulary:1');await run('settings:r:home');
    const edits=calls.filter(c=>c.method==='editMessageText');assert.equal(edits.length,3);
    assert.ok(edits.every(c=>c.body.message_id===edits[0].body.message_id));assert.ok(!calls.some(c=>c.method.startsWith('send')));
    assert.ok(JSON.stringify(edits[0].body).includes('✓ Learned'));assert.ok(JSON.stringify(edits[1].body).includes('settings:r:vocabulary:0'));assert.ok(JSON.stringify(edits[2].body).includes('settings:r:level:a2'));
    const queued=buildPreparedUpdate({botKey:'uk-en',input:make('settings:r:vocabulary:1')});
    await claimBotUpdateExecution(pool,{contract:queued,handlerVersion:1,jobId:'00000000-0000-4000-8000-000000000190'});
    const handlers=createSettingsHandlers({pool,getBotLocale:()=>({}),telegramClient:{
      callTelegramApi:async(_bot,method,body)=>{calls.push({method,body});return {};},
      answerTelegramCallbackQuery:async()=>{},sendTelegramTextMessage:async()=>{assert.fail('must edit existing card');}
    }});
    await handlers.find(h=>h.route==='callback.settings')!.execute(queued);
    assert.equal(calls.at(-1)?.body.message_id,2200);assert.ok(JSON.stringify(calls.at(-1)?.body).includes('settings:r:vocabulary:0'));
    assert.deepEqual((await pool.query('SELECT * FROM vocabulary_words WHERE chat_id=$1 ORDER BY id',[chat])).rows,wordsBefore);
    assert.deepEqual((await pool.query('SELECT level,reply_mode,tts_voice FROM user_bots WHERE chat_id=$1',[chat])).rows,prefsBefore);
    await pool.query('UPDATE vocabulary_words SET progress=4,learned_at=NULL WHERE id=$1',[page.items[0].id]);
    page=await loadVocabularyPage(pool,chat,'uk-en',0);assert.equal(page.items[0].progress,4);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM llm_call_events WHERE decision_id=ANY($1::text[])',[decisions])).rows[0].n,0);
    await pool.query(`INSERT INTO vocabulary_words(chat_id,target_language,lemma,lemma_key,pos,meaning_key,meaning)
      SELECT $1,'en','word'||i,'word'||i,'noun','sense'||i,'meaning'||i FROM generate_series(13,1000) i`,[chat]);
    const large=await loadVocabularyPage(pool,chat,'uk-en',999999);
    assert.equal(large.total,1000);assert.equal(large.page,99);assert.equal(large.items.length,10);
  }finally{
    await pool.query('DELETE FROM bot_update_executions WHERE decision_id=ANY($1::text[])',[decisions]);
    await pool.query('DELETE FROM vocabulary_snapshots WHERE chat_id=ANY($1::bigint[])',[[chat,other]]);
    await pool.query('DELETE FROM vocabulary_words WHERE chat_id=ANY($1::bigint[])',[[chat,other]]);
    await pool.query('DELETE FROM users WHERE chat_id=ANY($1::bigint[])',[[chat,other]]);await pool.end();
  }
});
