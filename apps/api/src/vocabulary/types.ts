import type { LlmTraceContext } from '../ai/llm-telemetry.js';

export type VocabularyLanguage = 'de' | 'en' | 'es';
export interface VocabularyCandidate { id: string; lemma: string; pos: string; meaning: string }
export interface VocabularyJudgment {
  wordId: string;
  verdict: 'correct' | 'incorrect' | 'uncertain';
  evidence: string[];
}
export interface VocabularyAi {
  extract(input: { language: VocabularyLanguage; text: string; trace: LlmTraceContext }): Promise<string[]>;
  grade(input: { language: VocabularyLanguage; text: string; context: string; candidates: VocabularyCandidate[]; trace: LlmTraceContext }): Promise<VocabularyJudgment[]>;
}
export function vocabularyKey(value: string): string {
  return value.normalize('NFC').toLowerCase().trim().replace(/\s+/gu, ' ');
}
export function vocabularyLanguage(value: string): VocabularyLanguage | null {
  return value === 'de' || value === 'en' || value === 'es' ? value : null;
}

/** Candidate aliases only: the grader still has to confirm the exact pronominal meaning. */
export function vocabularyCandidateKeys(language:VocabularyLanguage,headwords:string[]):string[] {
  const keys=new Set(headwords.map(vocabularyKey));
  for(const key of [...keys]) {
    if(language==='es') {
      if(/(?:ar|er|ir)se$/u.test(key))keys.add(key.slice(0,-2));
      else if(/(?:ar|er|ir)$/u.test(key))keys.add(`${key}se`);
    }
    if(language==='de') {
      if(key.startsWith('sich '))keys.add(key.slice(5));
      else if(/(?:en|ern|eln)$/u.test(key))keys.add(`sich ${key}`);
      const split=key.match(/^(sich )?([\p{L}]+(?:en|ern|eln))\s+(?:(?:\.{3}|…)\s+)?(ab|an|auf|aus|ein|mit|nach|vor|zu|zurück|zusammen|weg|weiter|teil)$/u);
      if(split)keys.add(`${split[1]||''}${split[3]}${split[2]}`);
    }
  }
  return [...keys];
}

/** Block a copied whole reply/example/sentence without relying on a model verdict. */
export function isCopiedVocabularyReply(text:string,context:string,language:VocabularyLanguage):boolean {
  const key=(s:string)=>(s.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).join(' ');
  const actual=key(text);
  if(!actual||!context.trim())return false;
  const fragments=[context,...context.split(/\r?\n/u),
    ...Array.from(new Intl.Segmenter(language,{granularity:'sentence'}).segment(context),s=>s.segment)];
  return fragments.some(fragment=>key(fragment)===actual);
}
/** Exact, unambiguous original fragments; offsets are server-derived UTF-16 ranges. */
export function evidenceRanges(text: string, fragments: string[]): Array<{start: number; end: number; quote: string}> {
  let previousEnd = 0;
  return fragments.map(quote => {
    const start = text.indexOf(quote);
    if (!quote.trim() || start < previousEnd || text.indexOf(quote, start + 1) !== -1) {
      throw new Error('vocabulary_invalid_evidence');
    }
    previousEnd = start + quote.length;
    return { start, end: previousEnd, quote };
  });
}
