import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { BotAiClient, VocabularyItem } from '../ai/client.js';
import type { PreparedUpdate } from '../bot-runtime/contracts.js';
import { vocabularyKey, type VocabularyLanguage } from './types.js';
import { validateVocabularySenses, type ExistingVocabularySense } from './senses.js';

export interface VocabularySnapshotRow { id:string; item:VocabularyItem; progress:number|null }
export interface VocabularySnapshot { id:string; rows:VocabularySnapshotRow[] }
export class VocabularySnapshotError extends Error {}

export function vocabularyItemLemma(item:VocabularyItem):string {
  return String(item.pos==='verb' ? item.infinitive||item.lemma||item.surface : item.lemma||item.surface).normalize('NFC').trim();
}
export function snapshotItems(items:VocabularyItem[]):VocabularyItem[] {
  const seen=new Set<string>();
  return items.slice(0,15).filter(item=>{
    const lemma=vocabularyItemLemma(item);
    if(!lemma||lemma.length>160||!['noun','verb','adjective','adverb','other'].includes(item.pos)||
       !String(item.translation_base||'').trim())throw new Error('vocabulary_invalid_snapshot_item');
    const key=JSON.stringify([vocabularyKey(lemma),item.pos,vocabularyKey(item.translation_base)]);
    if(seen.has(key))return false;seen.add(key);return true;
  });
}

/** Inside the existing durable support effect transaction; no LLM is used when adding a row. */
export async function createVocabularySnapshot(client:PoolClient,update:PreparedUpdate,language:VocabularyLanguage,
  sourceMessageId:number,text:string,rawItems:VocabularyItem[],ai:BotAiClient):Promise<string> {
  const items=snapshotItems(rawItems);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`vocabulary-senses:${update.input.chatId}:${language}`]);
  const found=await client.query<{id:string}>('SELECT id::text FROM vocabulary_snapshots WHERE decision_id=$1 AND chat_id=$2 AND bot_key=$3',
    [update.decisionId,update.input.chatId,update.botKey]);
  if(found.rows[0])return found.rows[0].id;
  const keys=items.map(item=>vocabularyKey(vocabularyItemLemma(item)));
  const existing=await client.query<{lemma_key:string;pos:string;meaning_key:string;meaning:string}>(`SELECT DISTINCT lemma_key,pos,meaning_key,meaning FROM (
    SELECT r.lemma_key,r.pos,r.meaning_key,r.meaning FROM vocabulary_snapshot_rows r
      JOIN vocabulary_snapshots s ON s.id=r.snapshot_id WHERE s.chat_id=$1 AND s.target_language=$2 AND r.lemma_key=ANY($3::text[])
    UNION SELECT lemma_key,pos,meaning_key,meaning FROM vocabulary_words WHERE chat_id=$1 AND target_language=$2 AND lemma_key=ANY($3::text[])
  ) senses ORDER BY lemma_key,pos,meaning_key LIMIT 301`,[update.input.chatId,language,keys]);
  if(existing.rows.length>300)throw new Error('vocabulary_sense_limit');
  const candidates:ExistingVocabularySense[]=existing.rows.map(r=>({lemmaKey:r.lemma_key,pos:r.pos,meaningKey:r.meaning_key,meaning:r.meaning}));
  if(!ai.resolveVocabularySenses)throw new Error('vocabulary_sense_resolver_missing');
  const input={botKey:update.botKey,text,items,existing:candidates,trace:{decisionId:update.decisionId,
    chatId:update.input.chatId!,botKey:update.botKey,route:update.route}};
  const senses=validateVocabularySenses(await ai.resolveVocabularySenses(input),input);
  const id=randomUUID();
  const inserted=await client.query(`INSERT INTO vocabulary_snapshots(id,chat_id,bot_key,target_language,source_message_id,decision_id)
    SELECT $1,$2,$3,$4,m.id,$6 FROM messages m
    WHERE m.id=$5 AND m.chat_id=$2 AND m.bot_key=$3 AND m.role='assistant' AND m.content=$7
    RETURNING id`,[id,update.input.chatId,update.botKey,language,sourceMessageId,update.decisionId,text]);
  if(!inserted.rows.length)throw new VocabularySnapshotError('vocabulary_snapshot_unavailable');
  const created=new Map<string,string>();
  for(const sense of senses) {
    const item=items[sense.index];const lemma=vocabularyItemLemma(item);const key=vocabularyKey(lemma);
    const reused=sense.meaningKey===null ? null : candidates.find(c=>c.meaningKey===sense.meaningKey&&c.lemmaKey===key&&c.pos===item.pos);
    if(sense.meaningKey!==null&&!reused)throw new Error('vocabulary_unknown_sense');
    const definition=reused?.meaning||sense.meaning.trim();
    const withinBatch=JSON.stringify([key,item.pos,vocabularyKey(definition)]);
    const meaningKey=reused?.meaningKey||created.get(withinBatch)||randomUUID();created.set(withinBatch,meaningKey);
    await client.query(`INSERT INTO vocabulary_snapshot_rows(snapshot_id,row_index,item,lemma,lemma_key,pos,meaning_key,meaning)
      VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8)`,[id,sense.index,JSON.stringify(item),lemma,key,item.pos,meaningKey,definition]);
  }
  return id;
}

export async function loadVocabularySnapshot(client:Pick<PoolClient,'query'>,id:string,chatId:number,botKey:string):Promise<VocabularySnapshot> {
  const result=await client.query<{id:string;item:VocabularyItem;progress:number|null}>(`SELECT r.id::text,r.item,
    CASE WHEN w.archived_at IS NULL THEN w.progress ELSE NULL END AS progress
    FROM vocabulary_snapshots s JOIN vocabulary_snapshot_rows r ON r.snapshot_id=s.id
    LEFT JOIN vocabulary_words w ON w.chat_id=s.chat_id AND w.target_language=s.target_language
      AND w.lemma_key=r.lemma_key AND w.pos=r.pos AND w.meaning_key=r.meaning_key
    WHERE s.id=$1::uuid AND s.chat_id=$2 AND s.bot_key=$3 ORDER BY r.row_index`,[id,chatId,botKey]);
  if(!result.rows.length)throw new VocabularySnapshotError('vocabulary_snapshot_unavailable');
  return {id,rows:result.rows};
}

export async function bindVocabularySnapshot(pool:Pool,id:string,chatId:number,botKey:string,messageId:number):Promise<void> {
  const result=await pool.query(`UPDATE vocabulary_snapshots SET telegram_message_id=$4
    WHERE id=$1::uuid AND chat_id=$2 AND bot_key=$3 AND (telegram_message_id IS NULL OR telegram_message_id=$4) RETURNING id`,[id,chatId,botKey,messageId]);
  if(!result.rows.length)throw new VocabularySnapshotError('vocabulary_snapshot_unavailable');
}

export async function addVocabularySnapshotWord(pool:Pool,rowId:string,chatId:number,botKey:string,telegramMessageId:number):Promise<string> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const result=await client.query<{snapshot_id:string;telegram_message_id:string|null;target_language:string;lemma:string;lemma_key:string;pos:string;meaning_key:string;meaning:string}>(`SELECT r.*,s.telegram_message_id,s.target_language FROM vocabulary_snapshot_rows r
      JOIN vocabulary_snapshots s ON s.id=r.snapshot_id WHERE r.id=$1::uuid AND s.chat_id=$2 AND s.bot_key=$3`,[rowId,chatId,botKey]);
    const row=result.rows[0];
    if(!row)throw new VocabularySnapshotError('vocabulary_snapshot_unavailable');
    if(row.telegram_message_id===null)throw new VocabularySnapshotError('vocabulary_snapshot_pending');
    if(Number(row.telegram_message_id)!==telegramMessageId)throw new VocabularySnapshotError('vocabulary_snapshot_unavailable');
    await client.query(`WITH clock AS (SELECT clock_timestamp() AS at)
      INSERT INTO vocabulary_words(chat_id,target_language,lemma,lemma_key,pos,meaning_key,meaning,added_at,active_since)
      SELECT $1,$2,$3,$4,$5,$6,$7,at,at FROM clock
      ON CONFLICT(chat_id,target_language,lemma_key,pos,meaning_key) DO UPDATE SET
        active_since=CASE WHEN vocabulary_words.archived_at IS NOT NULL THEN clock_timestamp() ELSE vocabulary_words.active_since END,
        archived_at=NULL`,[chatId,row.target_language,row.lemma,row.lemma_key,row.pos,row.meaning_key,row.meaning]);
    await client.query('COMMIT');
    return row.snapshot_id;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Serialize refreshes so an earlier click cannot overwrite a later table state. */
export async function withVocabularyRenderLock<T>(pool:Pool,id:string,render:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();let locked=false;let discard=false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`vocabulary-render:${id}`]);locked=true;
    return await render(client);
  } finally {
    if(locked)try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`vocabulary-render:${id}`]);}catch{discard=true;}
    client.release(discard);
  }
}
