import OpenAI from 'openai';
import type { ResponseCreateParamsStreaming } from 'openai/resources/responses/responses.js';
import {
  observeLlmCall,
  type LlmCallRecorder,
  type LlmTraceContext
} from './llm-telemetry.js';
import type { BotModelPolicyOverride } from './model-policy.js';
import { createBotSpeech } from '../infrastructure/speech/bot-speech.js';
import {
  renderBotPrompt,
  conversationUserPrompt,
  translationUserPrompt,
  hintsUserPrompt,
  vocabularyUserPrompt
} from '../ai/prompts/bot-prompts.js';
import {
  RESPONSE_SCHEMA,
  ONBOARDING_RESPONSE_SCHEMA,
  TRANSLATION_SCHEMA,
  HINTS_SCHEMA,
  VOCAB_SCHEMA
} from '../ai/schemas/bot-responses.js';
import { partialConversationReply } from './conversation-stream.js';

type UnknownRecord = Record<string, unknown>;

export interface ConversationAiInput {
  botKey: string;
  level: string;
  inputMode: 'text' | 'voice';
  text: string;
  profileSummary: string;
  shortSummary: string;
  history: Array<{ role: string; content: string }>;
  onboarding?: {
    scenario: string;
    prompt: string;
    example: string;
  } | null;
  trace?: LlmTraceContext;
  onReplyText?: (text: string) => void;
}

export interface ConversationAiResult extends UnknownRecord {
  detected_language: string;
  is_target_language: boolean;
  has_mistakes: boolean;
  reply_text: string;
  explanation_html: string;
  suggested_level?: 'a1' | 'a2' | 'b1' | 'b2' | 'c1' | null;
  suggested_level_confidence?: 'low' | 'medium' | 'high' | null;
}

export interface FollowUpHints extends UnknownRecord {
  question: string;
  question_base: string;
  simple_variant: string;
  simple_variant_base: string;
  conversational_variant: string;
  conversational_variant_base: string;
  advanced_variant: string;
  advanced_variant_base: string;
  useful_phrases: Array<{ text: string; translation_base: string }>;
}

export interface VocabularyItem extends UnknownRecord {
  surface: string;
  pos: 'noun' | 'verb' | 'adjective' | 'adverb' | 'other';
  article: string;
  lemma: string;
  infinitive: string;
  separable_prefix: string;
  translation_base: string;
  transcription: string;
}

export interface BotAiClient {
  respond(input: ConversationAiInput): Promise<ConversationAiResult>;
  translate(botKey: string, text: string, trace?: LlmTraceContext): Promise<string>;
  hints(input: {
    botKey: string;
    level: string;
    userMessage: string;
    assistantReply: string;
    trace?: LlmTraceContext;
  }): Promise<FollowUpHints>;
  vocabulary(
    botKey: string,
    assistantReply: string,
    trace?: LlmTraceContext
  ): Promise<VocabularyItem[]>;
  transcribe(
    botKey: string,
    audio: Buffer,
    options?: { baseLanguage?: boolean; trace?: LlmTraceContext }
  ): Promise<string>;
  speech(botKey: string, text: string, trace?: LlmTraceContext): Promise<Buffer>;
}

function responseText(response: unknown): string {
  const payload = response as UnknownRecord;
  const direct = String(payload.output_text || '').trim();
  if (direct) return direct;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const itemRaw of output) {
    const item = itemRaw as UnknownRecord;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const partRaw of content) {
      const part = partRaw as UnknownRecord;
      const text = String(part.text || '').trim();
      if (text) return text;
    }
  }
  throw new Error('openai_empty_output');
}

function normalizeConversationHtml(value: unknown): string {
  return String(value || '')
    .replace(/<\s*br\s*\/?\s*>/giu, '\n')
    .replace(/\r\n/gu, '\n');
}

function normalizeConversationResult(value: UnknownRecord): ConversationAiResult {
  return {
    ...value,
    explanation_html: normalizeConversationHtml(value.explanation_html)
  } as ConversationAiResult;
}

export function createBotAiClient({
  apiKey,
  elevenlabsApiKey = '',
  model,
  supportModel = model,
  conversationReasoningEffort,
  supportReasoningEffort,
  transcriptionModel = 'scribe_v2',
  ttsModel = 'tts-1-hd',
  recordLlmCall,
  getModelPolicy,
  getBotConfig,
  createClient = (key: string) => new OpenAI({ apiKey: key }),
  fetchImpl = fetch
}: {
  apiKey: string;
  elevenlabsApiKey?: string;
  model: string;
  supportModel?: string;
  conversationReasoningEffort?: string;
  supportReasoningEffort?: string;
  transcriptionModel?: string;
  ttsModel?: string;
  recordLlmCall?: LlmCallRecorder;
  getModelPolicy?(botKey: string): BotModelPolicyOverride | undefined;
  getBotConfig(botKey: string): UnknownRecord | null;
  createClient?: (apiKey: string) => Pick<OpenAI, 'responses' | 'audio'>;
  fetchImpl?: typeof fetch;
}): BotAiClient {
  let client: Pick<OpenAI, 'responses' | 'audio'> | null = null;
  const openai = () => {
    if (!apiKey) throw new Error('missing_openai_api_key');
    client ||= createClient(apiKey);
    return client;
  };

  const speech = createBotSpeech({
    openai, elevenlabsApiKey, transcriptionModel, ttsModel, recordLlmCall, getBotConfig, fetchImpl
  });

  async function structured(
    selectedModel: string,
    reasoningEffort: string | undefined,
    operation: string,
    trace: LlmTraceContext,
    system: string,
    user: string,
    name: string,
    schema: UnknownRecord,
    onReplyText?: (text: string) => void
  ): Promise<UnknownRecord> {
    const observed = await observeLlmCall({
      trace,
      operation,
      model: selectedModel,
      reasoningEffort,
      record: recordLlmCall,
      call: async () => {
        const request = {
          model: selectedModel,
          ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
          input: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          text: {
            format: {
              type: 'json_schema',
              name,
              schema,
              verbosity: 'low'
            }
          }
        };
        let response;
        if (onReplyText) {
          const stream = await openai().responses.create({ ...request, stream: true } as ResponseCreateParamsStreaming);
          let source = '';
          let preview = '';
          for await (const event of stream) {
            if (event.type === 'response.output_text.delta') {
              source += event.delta;
              const next = partialConversationReply(source);
              if (next && next !== preview) {
                preview = next;
                try { onReplyText(next); } catch { /* Preview must not fail inference. */ }
              }
            } else if (event.type === 'response.completed') {
              response = event.response;
            } else if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
              throw new Error('openai_stream_failed');
            }
          }
          if (!response) throw new Error('openai_stream_incomplete');
        } else {
          response = await openai().responses.create(request as never);
        }
        const parsed = JSON.parse(responseText(response));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('openai_invalid_structured_output');
        }
        return { value: parsed as UnknownRecord, usage: response.usage };
      }
    });
    return observed.value;
  }

  const configFor = (botKey: string) => getBotConfig(botKey) || {};
  const policyFor = (botKey: string) => ({
    conversationModel: model,
    conversationReasoningEffort,
    supportModel,
    supportReasoningEffort,
    ...(getModelPolicy?.(botKey) || {})
  });

  return {
    async respond(input) {
      const config = configFor(input.botKey);
      const policy = policyFor(input.botKey);
      const result = await structured(
        policy.conversationModel,
        policy.conversationReasoningEffort,
        'conversation.respond',
        input.trace || { botKey: input.botKey },
        renderBotPrompt('conversation/model_system_prompt', input.botKey, config),
        conversationUserPrompt(input, config),
        input.onboarding ? 'response_onboarding' : 'response_core',
        (input.onboarding ? ONBOARDING_RESPONSE_SCHEMA : RESPONSE_SCHEMA) as unknown as UnknownRecord,
        input.onReplyText
      );
      return normalizeConversationResult(result);
    },

    async translate(botKey, text, trace = { botKey }) {
      const config = configFor(botKey);
      const policy = policyFor(botKey);
      const result = await structured(
        policy.supportModel,
        policy.supportReasoningEffort,
        'support.translate',
        trace,
        renderBotPrompt('support/model_support_prompt', botKey, config),
        translationUserPrompt(botKey, config, text),
        'translation_schema',
        TRANSLATION_SCHEMA as unknown as UnknownRecord
      );
      return String(result.translation_base || '').trim();
    },

    async hints(input) {
      const config = configFor(input.botKey);
      const policy = policyFor(input.botKey);
      return await structured(
        policy.supportModel,
        policy.supportReasoningEffort,
        'support.hints',
        input.trace || { botKey: input.botKey },
        renderBotPrompt('support/model_hints_prompt', input.botKey, config),
        hintsUserPrompt(input, config),
        'follow_up_hints_schema',
        HINTS_SCHEMA as unknown as UnknownRecord
      ) as FollowUpHints;
    },

    async vocabulary(botKey, assistantReply, trace = { botKey }) {
      const config = configFor(botKey);
      const policy = policyFor(botKey);
      const result = await structured(
        policy.supportModel,
        policy.supportReasoningEffort,
        'support.vocabulary',
        trace,
        renderBotPrompt('support/model_vocab_prompt', botKey, config),
        vocabularyUserPrompt(botKey, config, assistantReply),
        'vocab_schema',
        VOCAB_SCHEMA as unknown as UnknownRecord
      );
      return Array.isArray(result.items) ? result.items as VocabularyItem[] : [];
    },

    ...speech
  };
}
