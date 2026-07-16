import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI, { toFile } from 'openai';
import {
  observeLlmCall,
  type LlmCallRecorder,
  type LlmTraceContext
} from './llm-telemetry.js';
import type { BotModelPolicyOverride } from './model-policy.js';

type UnknownRecord = Record<string, unknown>;

export interface ConversationAiInput {
  botKey: string;
  level: string;
  inputMode: 'text' | 'voice';
  text: string;
  profileSummary: string;
  shortSummary: string;
  history: Array<{ role: string; content: string }>;
  topic: UnknownRecord | null;
  onboarding?: {
    scenario: string;
    prompt: string;
    example: string;
  } | null;
  trace?: LlmTraceContext;
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
    topic: UnknownRecord | null;
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

const LANGUAGE_LABELS: Record<string, string> = {
  ar: 'Arabic', de: 'German', en: 'English', es: 'Spanish', fr: 'French',
  hi: 'Hindi', it: 'Italian', pl: 'Polish', ru: 'Russian', tr: 'Turkish', uk: 'Ukrainian'
};

const EXPLANATION_TITLES: Record<string, string> = {
  ar: 'شرح', de: 'Erklärung', en: 'Explanation', hi: 'व्याख्या',
  it: 'Spiegazione', ru: 'Пояснение', tr: 'Açıklama', uk: 'Пояснення'
};

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'detected_language',
    'is_target_language',
    'has_mistakes',
    'reply_text',
    'explanation_html'
  ],
  properties: {
    detected_language: { type: 'string' },
    is_target_language: { type: 'boolean' },
    has_mistakes: { type: 'boolean' },
    reply_text: { type: 'string' },
    explanation_html: { type: 'string' }
  }
} as const;

const ONBOARDING_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...RESPONSE_SCHEMA.required,
    'suggested_level',
    'suggested_level_confidence'
  ],
  properties: {
    ...RESPONSE_SCHEMA.properties,
    suggested_level: {
      anyOf: [
        { type: 'string', enum: ['a1', 'a2', 'b1', 'b2', 'c1'] },
        { type: 'null' }
      ]
    },
    suggested_level_confidence: {
      anyOf: [
        { type: 'string', enum: ['low', 'medium', 'high'] },
        { type: 'null' }
      ]
    }
  }
} as const;

const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translation_base'],
  properties: { translation_base: { type: 'string' } }
} as const;

const HINTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'question', 'question_base', 'simple_variant', 'simple_variant_base',
    'conversational_variant', 'conversational_variant_base',
    'advanced_variant', 'advanced_variant_base', 'useful_phrases'
  ],
  properties: {
    question: { type: 'string' },
    question_base: { type: 'string' },
    simple_variant: { type: 'string' },
    simple_variant_base: { type: 'string' },
    conversational_variant: { type: 'string' },
    conversational_variant_base: { type: 'string' },
    advanced_variant: { type: 'string' },
    advanced_variant_base: { type: 'string' },
    useful_phrases: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'translation_base'],
        properties: {
          text: { type: 'string' },
          translation_base: { type: 'string' }
        }
      }
    }
  }
} as const;

const VOCAB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      maxItems: 15,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'surface', 'pos', 'article', 'lemma', 'infinitive',
          'separable_prefix', 'translation_base', 'transcription'
        ],
        properties: {
          surface: { type: 'string' },
          pos: { type: 'string', enum: ['noun', 'verb', 'adjective', 'adverb', 'other'] },
          article: { type: 'string' },
          lemma: { type: 'string' },
          infinitive: { type: 'string' },
          separable_prefix: { type: 'string' },
          translation_base: { type: 'string' },
          transcription: { type: 'string' }
        }
      }
    }
  }
} as const;

const promptCache = new Map<string, string>();

function existingPath(candidates: string[]): string {
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`bot_runtime_prompt_path_missing:${candidates[0]}`);
  return found;
}

function promptDirectory(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return existingPath([
    String(process.env.BOT_RUNTIME_PROMPTS_DIR || '').trim(),
    '/deploy/prompts',
    path.resolve(currentDir, '../../../../deploy/prompts')
  ].filter(Boolean));
}

function promptFile(name: string): string {
  return path.join(promptDirectory(), `${name}.md`);
}

function sharedToneFile(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return existingPath([
    '/shared/llm-prompts/user-facing-tone.md',
    path.resolve(currentDir, '../../../../shared/llm-prompts/user-facing-tone.md')
  ]);
}

function readCached(filename: string): string {
  const cached = promptCache.get(filename);
  if (cached !== undefined) return cached;
  const value = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n').trim();
  promptCache.set(filename, value);
  return value;
}

function transcriptionPrompt(language: string): string {
  const normalizedLanguage = language.trim().toLowerCase().split('-')[0];
  const languageCode = /^[a-z]{2,3}$/.test(normalizedLanguage) ? normalizedLanguage : 'en';
  const directory = path.join(promptDirectory(), 'transcription');
  const localizedFilename = path.join(directory, `${languageCode}.md`);
  const fallbackFilename = path.join(directory, 'en.md');
  const filename = fs.existsSync(localizedFilename) ? localizedFilename : fallbackFilename;

  let prompt: string;
  try {
    prompt = readCached(filename);
  } catch (error) {
    throw new Error(`bot_runtime_transcription_prompt_unreadable:${filename}`, { cause: error });
  }
  if (!prompt) throw new Error(`bot_runtime_transcription_prompt_empty:${filename}`);
  return prompt;
}

function promptContext(botKey: string, config: UnknownRecord): Record<string, string> {
  const baseCode = String(config.base_language || botKey.split('-')[0] || '').toLowerCase();
  const targetCode = String(config.learning_language || botKey.split('-')[1] || '').toLowerCase();
  const botName = String(config.bot_name || 'AI tutor').trim();
  const hintByBase: Record<string, [string, string]> = {
    ar: ['تلميح', 'يمكنك قولها هكذا:'],
    de: ['Tipp', 'Du kannst das so sagen:'],
    en: ['Hint', 'You can say it like this:'],
    hi: ['संकेत', 'आप इसे इस तरह कह सकते हैं:'],
    it: ['Suggerimento', 'Puoi dirlo così:'],
    ru: ['Подсказка', 'Ты можешь сказать это так:'],
    tr: ['İpucu', 'Bunu şöyle söyleyebilirsin:'],
    uk: ['Підказка', 'Ти можеш сказати це наступним чином:']
  };
  const [hintTitle, hintLeadIn] = hintByBase[baseCode] || ['Hint', 'You can say it like this:'];
  return {
    bot_key: botKey,
    bot_name: botName,
    base_language_code: baseCode,
    target_language_code: targetCode,
    base_language_label: LANGUAGE_LABELS[baseCode] || baseCode,
    target_language_label: LANGUAGE_LABELS[targetCode] || targetCode,
    explanation_title: EXPLANATION_TITLES[baseCode] || 'Explanation',
    hint_title: hintTitle,
    hint_lead_in: hintLeadIn,
    english_style_rule: targetCode === 'en'
      ? '- Keep a light British English tone while staying clear for learners.'
      : '',
    user_facing_tone_rules: readCached(sharedToneFile())
  };
}

function renderPrompt(name: string, botKey: string, config: UnknownRecord): string {
  const variables = promptContext(botKey, config);
  return readCached(promptFile(name)).replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_match, key: string) => variables[key] || ''
  );
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

function topicPrompt(topic: UnknownRecord | null): string {
  if (!topic) return 'Status: unpinned';
  return [
    'Status: pinned',
    `Topic ID: ${String(topic.topic_id || '')}`,
    `PINNED TOPIC (base language): ${String(topic.title_base || '')}`,
    `TOPIC GOAL (base language): ${String(topic.goal_base || '')}`,
    `ALLOWED SUB-AREAS: ${Array.isArray(topic.allowed_base) ? topic.allowed_base.join('; ') : ''}`,
    `AVOID AREAS: ${Array.isArray(topic.avoid_base) ? topic.avoid_base.join('; ') : ''}`,
    `LAST ASSISTANT QUESTION: ${String(topic.last_assistant_question || '')}`
  ].join('\n');
}

export function createBotAiClient({
  apiKey,
  model,
  supportModel = model,
  conversationReasoningEffort,
  supportReasoningEffort,
  transcriptionModel = 'whisper-1',
  ttsModel = 'tts-1-hd',
  recordLlmCall,
  getModelPolicy,
  getBotConfig,
  createClient = (key: string) => new OpenAI({ apiKey: key })
}: {
  apiKey: string;
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
}): BotAiClient {
  let client: Pick<OpenAI, 'responses' | 'audio'> | null = null;
  const openai = () => {
    if (!apiKey) throw new Error('missing_openai_api_key');
    client ||= createClient(apiKey);
    return client;
  };

  async function structured(
    selectedModel: string,
    reasoningEffort: string | undefined,
    operation: string,
    trace: LlmTraceContext,
    system: string,
    user: string,
    name: string,
    schema: UnknownRecord
  ): Promise<UnknownRecord> {
    const observed = await observeLlmCall({
      trace,
      operation,
      model: selectedModel,
      reasoningEffort,
      record: recordLlmCall,
      call: async () => {
        const response = await openai().responses.create({
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
        } as never);
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
      const context = promptContext(input.botKey, config);
      const history = input.history
        .slice(-20)
        .map((item) => `${item.role}: ${item.content}`)
        .join('\n');
      const onboarding = input.onboarding
        ? [
            'ONBOARDING FIRST RESPONSE:',
            `Scenario: ${input.onboarding.scenario}`,
            `Scenario prompt: ${input.onboarding.prompt}`,
            `Example the learner could repeat: ${input.onboarding.example}`,
            '- Keep explanation_html compact and correct no more than two important issues.',
            '- Estimate CEFR only from demonstrated language. Use null when evidence is insufficient.',
            '- Use low confidence for a very short or copied response.',
            '- Keep reply_text encouraging and ask one simple next question in the target language.',
            ''
          ]
        : [];
      const result = await structured(
        policy.conversationModel,
        policy.conversationReasoningEffort,
        'conversation.respond',
        input.trace || { botKey: input.botKey },
        renderPrompt('model_system_prompt', input.botKey, config),
        [
          ...onboarding,
          `Target language: ${context.target_language_label}`,
          `Base language: ${context.base_language_code}`,
          `User level: ${input.level || 'A1'}`,
          `Input mode: ${input.inputMode}`,
          '',
          'TOPIC STATE:',
          topicPrompt(input.topic),
          '',
          'LONG-TERM USER PROFILE (base language):',
          input.profileSummary || 'no data',
          '',
          'SHORT-TERM CONTEXT (base language):',
          input.shortSummary || 'no data',
          '',
          'RECENT CONVERSATION:',
          history || 'no recent conversation',
          '',
          'NEW USER MESSAGE (transcript):',
          input.text
        ].join('\n'),
        input.onboarding ? 'response_onboarding' : 'response_core',
        (input.onboarding ? ONBOARDING_RESPONSE_SCHEMA : RESPONSE_SCHEMA) as unknown as UnknownRecord
      );
      return normalizeConversationResult(result);
    },

    async translate(botKey, text, trace = { botKey }) {
      const config = configFor(botKey);
      const policy = policyFor(botKey);
      const context = promptContext(botKey, config);
      const result = await structured(
        policy.supportModel,
        policy.supportReasoningEffort,
        'support.translate',
        trace,
        renderPrompt('model_support_prompt', botKey, config),
        `Base language code: ${context.base_language_code}\nText to translate:\n${text}`,
        'translation_schema',
        TRANSLATION_SCHEMA as unknown as UnknownRecord
      );
      return String(result.translation_base || '').trim();
    },

    async hints(input) {
      const config = configFor(input.botKey);
      const policy = policyFor(input.botKey);
      const context = promptContext(input.botKey, config);
      return await structured(
        policy.supportModel,
        policy.supportReasoningEffort,
        'support.hints',
        input.trace || { botKey: input.botKey },
        renderPrompt('model_hints_prompt', input.botKey, config),
        [
          `Target language: ${context.target_language_label}`,
          `User level: ${input.level}`,
          '',
          input.topic ? `PINNED TOPIC:\n${topicPrompt(input.topic)}\n` : '',
          `user_message:\n${input.userMessage}`,
          '',
          `assistant_reply:\n${input.assistantReply}`
        ].join('\n'),
        'follow_up_hints_schema',
        HINTS_SCHEMA as unknown as UnknownRecord
      ) as FollowUpHints;
    },

    async vocabulary(botKey, assistantReply, trace = { botKey }) {
      const config = configFor(botKey);
      const policy = policyFor(botKey);
      const context = promptContext(botKey, config);
      const result = await structured(
        policy.supportModel,
        policy.supportReasoningEffort,
        'support.vocabulary',
        trace,
        renderPrompt('model_vocab_prompt', botKey, config),
        [
          `Base language code: ${context.base_language_code}`,
          `Target language code: ${context.target_language_code}`,
          '',
          `assistant_reply:\n${assistantReply}`
        ].join('\n'),
        'vocab_schema',
        VOCAB_SCHEMA as unknown as UnknownRecord
      );
      return Array.isArray(result.items) ? result.items as VocabularyItem[] : [];
    },

    async transcribe(botKey, audio, options = {}) {
      const config = configFor(botKey);
      const context = promptContext(botKey, config);
      const language = options.baseLanguage
        ? context.base_language_code
        : context.target_language_code;
      const result = await observeLlmCall({
        trace: options.trace || { botKey },
        operation: options.baseLanguage ? 'feedback.transcribe' : 'conversation.transcribe',
        model: transcriptionModel,
        record: recordLlmCall,
        call: async () => openai().audio.transcriptions.create({
          file: await toFile(audio, 'voice.ogg', { type: 'audio/ogg' }),
          model: transcriptionModel,
          language,
          response_format: 'json',
          prompt: transcriptionPrompt(language)
        })
      });
      return String(result.text || '').trim();
    },

    async speech(botKey, text, trace = { botKey }) {
      const config = configFor(botKey);
      const voice = String(config.bot_voice || 'marin').trim().toLowerCase();
      const result = await observeLlmCall({
        trace,
        operation: 'conversation.speech',
        model: ttsModel,
        record: recordLlmCall,
        call: () => openai().audio.speech.create({
          model: ttsModel,
          voice: voice as never,
          input: text,
          response_format: 'opus'
        })
      });
      return Buffer.from(await result.arrayBuffer());
    }
  };
}
