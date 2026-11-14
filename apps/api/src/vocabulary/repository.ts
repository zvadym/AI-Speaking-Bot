import type { Pool, PoolClient } from 'pg';
import { evidenceRanges, type VocabularyCandidate, type VocabularyJudgment, type VocabularyLanguage } from './types.js';

export interface VocabularySource {
  messageId: string; chatId: number; botKey: string; decisionId: string; language: VocabularyLanguage;
  text: string; context: string; sourceAt: Date; inputMode: 'text' | 'voice';
}
export interface VocabularyAnalysis extends Record<string,unknown> {
  id: string; chat_id: string; bot_key: string; decision_id: string; target_language: VocabularyLanguage;
  source_text: string; context_text: string; source_at: Date; eligible_word_ids: string[];
  extracted: string[] | null; judgments: VocabularyJudgment[]; attempts: number;
}

/** Called inside the conversation effect transaction: saving source + outbox is atomic. */
export async function enqueueVocabularyAnalysis(client: Pick<PoolClient,'query'>, source: VocabularySource): Promise<void> {
  if (!Number.isFinite(source.sourceAt.getTime()) || !source.text.trim() || source.text.length > 20000) return;
  await client.query(`INSERT INTO vocabulary_analyses
    (source_message_id,chat_id,bot_key,decision_id,target_language,source_text,context_text,source_at,input_mode,eligible_word_ids)
    SELECT m.id,m.chat_id,m.bot_key,$4,$5,m.content,$6,$7,$8,array_agg(w.id ORDER BY w.id)
    FROM messages m JOIN vocabulary_words w ON w.chat_id=m.chat_id AND w.target_language=$5
      AND w.archived_at IS NULL AND w.progress<5 AND w.active_since<=$7
      AND NOT EXISTS (SELECT 1 FROM vocabulary_daily_credits d WHERE d.word_id=w.id AND d.utc_day=($7::timestamptz AT TIME ZONE 'UTC')::date)
    WHERE m.id=$1 AND m.chat_id=$2 AND m.bot_key=$3 AND m.role='user' AND m.content=$9
    GROUP BY m.id ON CONFLICT DO NOTHING`,[
    source.messageId,source.chatId,source.botKey,source.decisionId,source.language,
    source.context.slice(0,6000),source.sourceAt,source.inputMode,source.text
  ]);
}

export async function claimVocabularyAnalysis(pool: Pool, token: string): Promise<VocabularyAnalysis | null> {
  // Reclaim expired jobs; the token fences results from workers that outlive their lease.
  await pool.query(`UPDATE vocabulary_analyses SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
    lease_token=NULL,lease_expires_at=NULL,last_error_code='lease_expired'
    WHERE status='processing' AND lease_expires_at<NOW()`);
  const result = await pool.query<VocabularyAnalysis>(`WITH picked AS (
    SELECT id FROM vocabulary_analyses WHERE status='pending' AND next_attempt_at<=NOW() AND attempts<5
    ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE vocabulary_analyses a SET status='processing',attempts=attempts+1,
    lease_token=$1::uuid,lease_expires_at=NOW()+INTERVAL '5 minutes'
    FROM picked p WHERE a.id=p.id RETURNING a.*,a.id::text,a.chat_id::text`,[token]);
  return result.rows[0] || null;
}

export async function eligibleVocabularyCandidates(client: Pick<PoolClient,'query'>, analysis: VocabularyAnalysis, keys?: string[]): Promise<VocabularyCandidate[]> {
  const result = await client.query<{id:string;lemma:string;pos:string;meaning:string}>(`SELECT id::text,lemma,pos,meaning
    FROM vocabulary_words w WHERE id=ANY($1::bigint[]) AND chat_id=$2 AND target_language=$3
      AND archived_at IS NULL AND active_since<=$4 AND progress<5
      AND ($5::text[] IS NULL OR lemma_key=ANY($5::text[]))
      AND NOT EXISTS (SELECT 1 FROM vocabulary_daily_credits d WHERE d.word_id=w.id
        AND d.utc_day=($4::timestamptz AT TIME ZONE 'UTC')::date)
    ORDER BY id`,[analysis.eligible_word_ids,analysis.chat_id,analysis.target_language,analysis.source_at,keys??null]);
  return result.rows;
}

export async function checkpointVocabularyAnalysis(pool: Pool, analysis: VocabularyAnalysis, token: string): Promise<boolean> {
  const result = await pool.query(`UPDATE vocabulary_analyses SET extracted=$3::jsonb,judgments=$4::jsonb,
    lease_expires_at=NOW()+INTERVAL '5 minutes'
    WHERE id=$1 AND lease_token=$2::uuid AND status='processing' AND lease_expires_at>NOW()`,
  [analysis.id,token,JSON.stringify(analysis.extracted),JSON.stringify(analysis.judgments)]);
  return result.rowCount === 1;
}

export async function finishVocabularyAnalysis(pool: Pool, analysis: VocabularyAnalysis, token: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query(`SELECT id FROM vocabulary_analyses WHERE id=$1 AND lease_token=$2::uuid
      AND status='processing' AND lease_expires_at>NOW() FOR UPDATE`,[analysis.id,token]);
    if (!owned.rows.length) { await client.query('ROLLBACK'); return false; }
    // A consistent lock order prevents deadlocks when jobs share several words.
    await client.query(`SELECT id FROM vocabulary_words WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE`,[analysis.eligible_word_ids]);
    const eligible = new Set((await eligibleVocabularyCandidates(client,analysis)).map(w=>w.id));
    for (const judgment of analysis.judgments) {
      if (!eligible.has(judgment.wordId)) continue;
      const ranges = evidenceRanges(analysis.source_text,judgment.evidence);
      if (judgment.verdict === 'correct' && !ranges.length) throw new Error('vocabulary_invalid_evidence');
      const usage = await client.query<{id:string}>(`INSERT INTO vocabulary_usages(word_id,analysis_id,verdict,evidence)
        VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(word_id,analysis_id) DO NOTHING RETURNING id::text`,
      [judgment.wordId,analysis.id,judgment.verdict,JSON.stringify(ranges)]);
      if (judgment.verdict !== 'correct' || !usage.rows.length) continue;
      const credit = await client.query(`INSERT INTO vocabulary_daily_credits(word_id,utc_day,usage_id)
        VALUES($1,($2::timestamptz AT TIME ZONE 'UTC')::date,$3)
        ON CONFLICT(word_id,utc_day) DO NOTHING RETURNING word_id`,[judgment.wordId,analysis.source_at,usage.rows[0].id]);
      if (credit.rows.length) await client.query(`UPDATE vocabulary_words SET progress=progress+1,
        learned_at=CASE WHEN progress=4 THEN NOW() ELSE NULL END WHERE id=$1 AND progress<5`,[judgment.wordId]);
    }
    await client.query(`UPDATE vocabulary_analyses SET status='completed',completed_at=NOW(),
      lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL WHERE id=$1`,[analysis.id]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
