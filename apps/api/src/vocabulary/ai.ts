import { requestStructuredResponse } from '../ai/models/structured-response.js';
import { observeLlmCall, type LlmCallRecorder } from '../ai/llm-telemetry.js';
import { loadLlmPrompt } from '../ai/prompts/index.js';
import { evidenceRanges, isCopiedVocabularyReply, vocabularyKey, type VocabularyAi, type VocabularyJudgment } from './types.js';

const extractionSchema = { type: 'object', additionalProperties: false, required: ['items'], properties: {
  items: { type: 'array', items: { type: 'string' } }
}};
const gradeSchema = { type: 'object', additionalProperties: false, required: ['verdicts'], properties: {
  verdicts: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['wordId','verdict','evidence'], properties: {
      wordId: { type: 'string' }, verdict: { type: 'string', enum: ['correct','incorrect','uncertain'] },
      evidence: { type: 'array', items: { type: 'string' } }
    }
  }}
}};

export function createVocabularyAi({ apiKey, recordLlmCall, model = 'gpt-6-luna', fetchImpl = fetch }: {
  apiKey: string; recordLlmCall?: LlmCallRecorder; model?: string; fetchImpl?: typeof fetch;
}): VocabularyAi {
  async function call<T>(operation: string, prompt: string, input: { trace: Parameters<VocabularyAi['extract']>[0]['trace'] }, data: unknown, schema: Record<string,unknown>): Promise<T> {
    return (await observeLlmCall({ operation, model, reasoningEffort: 'none', trace: input.trace,
      record: recordLlmCall, call: () => requestStructuredResponse<T>({
        apiKey, model, reasoningEffort: 'none', verbosity: 'low', maxRetries: 0,
        timeoutMs: 60_000, maxOutputTokens: 4000,
        system: loadLlmPrompt(prompt), user: JSON.stringify(data), name: operation.replaceAll('.','_'),
        schema, strict: true, fetchImpl
      })
    })).value;
  }
  return {
    async extract(input) {
      const result = await call<{items: unknown}>('vocabulary.extract','vocabulary/extract',input,
        {language: input.language, learner_text: input.text},extractionSchema);
      if (!Array.isArray(result.items) || result.items.length > 2000 || result.items.some(x => typeof x !== 'string' || !x.trim() || x.length > 160)) {
        throw new Error('vocabulary_invalid_extraction');
      }
      return [...new Set((result.items as string[]).map(vocabularyKey))];
    },
    async grade(input) {
      if (!input.candidates.length) return [];
      if(isCopiedVocabularyReply(input.text,input.context,input.language))return input.candidates.map(c=>({wordId:c.id,verdict:'incorrect',evidence:[]}));
      const result = await call<{verdicts: VocabularyJudgment[]}>('vocabulary.grade','vocabulary/grade',input,
        {language: input.language, learner_text: input.text, context: input.context, candidates: input.candidates},gradeSchema);
      if (!Array.isArray(result.verdicts) || result.verdicts.length !== input.candidates.length) throw new Error('vocabulary_invalid_judgments');
      const remaining = new Set(input.candidates.map(c => c.id));
      for (const item of result.verdicts) {
        if (!item || !remaining.delete(item.wordId) || !['correct','incorrect','uncertain'].includes(item.verdict) ||
            !Array.isArray(item.evidence) || item.evidence.length > 8 || item.evidence.some(x => typeof x !== 'string') ||
            (item.verdict === 'correct' && !item.evidence.length)) throw new Error('vocabulary_invalid_judgments');
        evidenceRanges(input.text,item.evidence);
      }
      return result.verdicts;
    }
  };
}
