import type { VocabularyItem } from '../ai/client.js';
import type { LlmTraceContext } from '../ai/llm-telemetry.js';

export interface VocabularySense { index:number; meaningKey:string|null; meaning:string }
export interface ExistingVocabularySense { lemmaKey:string; pos:string; meaningKey:string; meaning:string }
export interface VocabularySenseInput {
  botKey:string; text:string; items:VocabularyItem[]; existing:ExistingVocabularySense[]; trace?:LlmTraceContext;
}
export function validateVocabularySenses(senses:unknown,input:VocabularySenseInput):VocabularySense[] {
  if(!Array.isArray(senses)||senses.length!==input.items.length)throw new Error('vocabulary_invalid_senses');
  const seen=new Set<number>();
  for(const s of senses) {
    if(!s||!Number.isInteger(s.index)||s.index<0||s.index>=input.items.length||seen.has(s.index)||
      (s.meaningKey!==null&&(typeof s.meaningKey!=='string'||s.meaningKey.length>200))||
      typeof s.meaning!=='string'||!s.meaning.trim()||s.meaning.length>1000)throw new Error('vocabulary_invalid_senses');
    seen.add(s.index);
  }
  return senses as VocabularySense[];
}
