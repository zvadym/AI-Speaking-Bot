import type { Pool } from 'pg';
import { vocabularyLanguage } from './types.js';

export const VOCABULARY_PAGE_SIZE = 10;
export interface VocabularyListItem { id:string; lemma:string; meaning:string; translation:string|null; progress:number }
export interface VocabularyPage { total:number; page:number; items:VocabularyListItem[] }

/** Read only: one statement keeps the count and page on the same DB snapshot. */
export async function loadVocabularyPage(pool:Pick<Pool,'query'>,chatId:number,botKey:string,page:number):Promise<VocabularyPage> {
  const [base, target]=botKey.split('-');
  if(!Number.isSafeInteger(chatId)||chatId<=0||!vocabularyLanguage(target)||!Number.isSafeInteger(page)||page<0||page>999999)
    throw new Error('invalid_vocabulary_page');
  const result=await pool.query<VocabularyPage>(`WITH words AS MATERIALIZED (
      SELECT id,lemma,lemma_key,pos,meaning_key,meaning,progress FROM vocabulary_words
      WHERE chat_id=$1 AND target_language=$2 AND archived_at IS NULL
    ), bounds AS (
      SELECT COUNT(*)::int AS total,LEAST($4::int,GREATEST(0,(COUNT(*)::int-1)/$5::int)) AS page FROM words
    ), selected AS (
      SELECT * FROM words ORDER BY id DESC LIMIT $5 OFFSET (SELECT page*$5 FROM bounds)
    ) SELECT total,page,COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',w.id::text,'lemma',w.lemma,'meaning',w.meaning,'progress',w.progress,'translation',t.translation
      ) ORDER BY w.id DESC) FROM selected w LEFT JOIN LATERAL (
        SELECT NULLIF(BTRIM(r.item->>'translation_base'),'') AS translation
        FROM vocabulary_snapshot_rows r JOIN vocabulary_snapshots s ON s.id=r.snapshot_id
        WHERE s.chat_id=$1 AND s.target_language=$2 AND split_part(s.bot_key,'-',1)=$3
          AND r.lemma_key=w.lemma_key AND r.pos=w.pos AND r.meaning_key=w.meaning_key
          AND NULLIF(BTRIM(r.item->>'translation_base'),'') IS NOT NULL
        ORDER BY s.created_at DESC,r.id DESC LIMIT 1
      ) t ON true),'[]'::jsonb) AS items FROM bounds`,[chatId,target,base,page,VOCABULARY_PAGE_SIZE]);
  return result.rows[0];
}
