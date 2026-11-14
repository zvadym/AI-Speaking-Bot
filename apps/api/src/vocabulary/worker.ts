import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { isCopiedVocabularyReply, vocabularyCandidateKeys, type VocabularyAi } from './types.js';
import { claimVocabularyAnalysis, eligibleVocabularyCandidates, checkpointVocabularyAnalysis, finishVocabularyAnalysis } from './repository.js';

export const VOCABULARY_ANALYSIS_QUEUE = 'vocabulary-analysis-scan';
interface VocabularyBoss {
  createQueue(name:string,options:object):Promise<unknown>;
  work(name:string,options:object,handler:(jobs:unknown[])=>Promise<void>):Promise<unknown>;
  schedule(name:string,cron:string,data:object,options:object):Promise<unknown>;
  send(name:string,data:object):Promise<unknown>;
}

export async function processVocabularyAnalyses({pool,ai}:{pool:Pool;ai:VocabularyAi},limit=5):Promise<number> {
  let completed=0;
  for(let i=0;i<Math.min(50,Math.max(0,limit));i++) {
    const token=randomUUID();
    const analysis=await claimVocabularyAnalysis(pool,token);
    if(!analysis) break;
    try {
      if(isCopiedVocabularyReply(analysis.source_text,analysis.context_text,analysis.target_language)) {
        analysis.extracted=[];analysis.judgments=[];
        if(await checkpointVocabularyAnalysis(pool,analysis,token) && await finishVocabularyAnalysis(pool,analysis,token))completed++;
        continue;
      }
      const trace={decisionId:analysis.decision_id,chatId:Number(analysis.chat_id),botKey:analysis.bot_key,route:'vocabulary.analysis'};
      const eligible=await eligibleVocabularyCandidates(pool,analysis);
      if(eligible.length && analysis.extracted===null) {
        analysis.extracted=await ai.extract({language:analysis.target_language,text:analysis.source_text,trace});
        if(!await checkpointVocabularyAnalysis(pool,analysis,token)) continue;
      }
      const candidates=analysis.extracted?.length ? await eligibleVocabularyCandidates(pool,analysis,vocabularyCandidateKeys(analysis.target_language,analysis.extracted)) : [];
      const judged=new Set(analysis.judgments.map(j=>j.wordId));
      const remaining=candidates.filter(c=>!judged.has(c.id));
      for(let offset=0;offset<remaining.length;offset+=40) {
        const judgments=await ai.grade({language:analysis.target_language,text:analysis.source_text,
          context:analysis.context_text,candidates:remaining.slice(offset,offset+40),trace});
        analysis.judgments.push(...judgments);
        if(!await checkpointVocabularyAnalysis(pool,analysis,token)) break;
      }
      if(await finishVocabularyAnalysis(pool,analysis,token)) completed++;
    } catch {
      // Never persist provider error messages: they can contain learner text or credentials.
      await pool.query(`UPDATE vocabulary_analyses SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
        next_attempt_at=NOW()+INTERVAL '30 seconds',last_error_code='analysis_failed',lease_token=NULL,lease_expires_at=NULL
        WHERE id=$1 AND lease_token=$2::uuid AND status='processing'`,[analysis.id,token]);
    }
  }
  return completed;
}

export async function registerVocabularyAnalysis(boss:VocabularyBoss,deps:{pool:Pool;ai:VocabularyAi}):Promise<void> {
  await boss.createQueue(VOCABULARY_ANALYSIS_QUEUE,{retryLimit:0,expireInSeconds:1800,policy:'singleton'});
  await boss.work(VOCABULARY_ANALYSIS_QUEUE,{batchSize:1,pollingIntervalSeconds:1},async()=>{await processVocabularyAnalyses(deps);});
  await boss.schedule(VOCABULARY_ANALYSIS_QUEUE,'* * * * *',{}, {key:'default'});
  await boss.send(VOCABULARY_ANALYSIS_QUEUE,{});
}
