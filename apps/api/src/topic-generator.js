import OpenAI from 'openai';
import { defaultEmojiForTopicId, normalizeTopicPayload, slugifyTopicId } from './topic-catalog.js';
import { renderLlmPrompt } from './llm-prompts/index.js';
import { observeLlmCall } from './bot-runtime/llm-telemetry.js';

const SUBAREA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label_base', 'keywords_target', 'keywords_base'],
  properties: {
    id: { type: 'string' },
    label_base: { type: 'string' },
    keywords_target: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: { type: 'string' }
    },
    keywords_base: {
      type: 'array',
      minItems: 0,
      maxItems: 12,
      items: { type: 'string' }
    }
  }
};

const TOPIC_GENERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'topic_id',
    'access_tier',
    'emoji',
    'title_base',
    'goal_base',
    'allowed_base',
    'subareas_json',
    'avoid_base',
    'starter_questions_target',
    'recovery_questions_target',
    'topic_mode',
    'speech_acts_base',
    'lexical_anchors_target',
    'grammar_targets_json',
    'starter_questions_by_level_target',
    'recovery_questions_by_level_target',
    'bridge_patterns_target',
    'hard_block_base',
    'soft_redirect_base',
    'opening_prompt_target'
  ],
  properties: {
    topic_id: { type: 'string' },
    access_tier: { type: 'string', enum: ['all', 'free', 'pro'] },
    emoji: { type: 'string' },
    title_base: { type: 'string' },
    goal_base: { type: 'string' },
    allowed_base: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      items: { type: 'string' }
    },
    subareas_json: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      items: SUBAREA_SCHEMA
    },
    avoid_base: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      items: { type: 'string' }
    },
    starter_questions_target: {
      type: 'array',
      minItems: 6,
      maxItems: 10,
      items: { type: 'string' }
    },
    recovery_questions_target: {
      type: 'array',
      minItems: 6,
      maxItems: 10,
      items: { type: 'string' }
    },
    topic_mode: { type: 'string', enum: ['open_chat', 'roleplay', 'rehearsal'] },
    speech_acts_base: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: { type: 'string' }
    },
    lexical_anchors_target: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: { type: 'string' }
    },
    grammar_targets_json: {
      type: 'object',
      additionalProperties: true
    },
    starter_questions_by_level_target: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: { type: 'string' }
      }
    },
    recovery_questions_by_level_target: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: { type: 'string' }
      }
    },
    bridge_patterns_target: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: { type: 'string' }
    },
    hard_block_base: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: { type: 'string' }
    },
    soft_redirect_base: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: { type: 'string' }
    },
    opening_prompt_target: { type: 'string' }
  }
};

function buildBaseTemplateBlock(baseTemplate) {
  if (!baseTemplate) return 'Invent the full topic rules from the topic name.';
  return [
    'Preserve the base-language topic meaning closely.',
    `existing_topic_id: ${String(baseTemplate.topic_id || '').trim().toLowerCase()}`,
    `existing_title_base: ${String(baseTemplate.title_base || '').trim()}`,
    `existing_goal_base: ${String(baseTemplate.goal_base || '').trim()}`,
    `existing_allowed_base: ${JSON.stringify(baseTemplate.allowed_base || [])}`,
    `existing_subareas_json: ${JSON.stringify(baseTemplate.subareas_json || [])}`,
    `existing_avoid_base: ${JSON.stringify(baseTemplate.avoid_base || [])}`,
    `existing_topic_mode: ${String(baseTemplate.topic_mode || '').trim()}`,
    `existing_lexical_anchors_target: ${JSON.stringify(baseTemplate.lexical_anchors_target || [])}`,
    `existing_bridge_patterns_target: ${JSON.stringify(baseTemplate.bridge_patterns_target || [])}`,
    `existing_grammar_targets_json: ${JSON.stringify(baseTemplate.grammar_targets_json || {})}`,
    `existing_starter_questions_by_level_target: ${JSON.stringify(baseTemplate.starter_questions_by_level_target || {})}`,
    `existing_recovery_questions_by_level_target: ${JSON.stringify(baseTemplate.recovery_questions_by_level_target || {})}`
  ].join('\n');
}

function getClient(apiKey) {
  return new OpenAI({ apiKey });
}

function buildUserPrompt({ topicName, baseLanguage, targetLanguage, baseTemplate }) {
  return renderLlmPrompt('topic-generator-user', {
    topic_name: String(topicName || '').trim(),
    base_language_code: String(baseLanguage || '').trim().toLowerCase(),
    target_language_code: String(targetLanguage || '').trim().toLowerCase(),
    suggested_topic_id: slugifyTopicId(topicName || baseTemplate?.topic_id || 'topic'),
    suggested_emoji: defaultEmojiForTopicId(baseTemplate?.topic_id || topicName),
    required_access_tier: String(baseTemplate?.access_tier || 'all').trim().toLowerCase() || 'all',
    base_template_block: buildBaseTemplateBlock(baseTemplate)
  });
}

function buildAssistPrompt({
  instruction,
  baseLanguage,
  targetLanguage,
  currentDraft
}) {
  const currentDraftBlock = currentDraft
    ? [
        'Current draft JSON:',
        JSON.stringify(currentDraft, null, 2),
        'Update the current draft in place unless the instruction clearly asks to rename, expand, or restructure it.',
        'Preserve existing subareas_json IDs unless the instruction explicitly changes topic structure.'
      ].join('\n')
    : 'There is no current draft yet. Create the full topic pack from the instruction.';

  return renderLlmPrompt('topic-generator-assist', {
    base_language_code: String(baseLanguage || '').trim().toLowerCase(),
    target_language_code: String(targetLanguage || '').trim().toLowerCase(),
    instruction: String(instruction || '').trim(),
    current_draft_block: currentDraftBlock
  });
}

function buildClonePrompt({
  sourceBaseLanguage,
  sourceTargetLanguage,
  targetBaseLanguage,
  targetTargetLanguage,
  currentDraft,
  instruction
}) {
  const extraInstruction = String(instruction || '').trim();
  return renderLlmPrompt('topic-generator-clone', {
    source_base_language_code: String(sourceBaseLanguage || '').trim().toLowerCase(),
    source_target_language_code: String(sourceTargetLanguage || '').trim().toLowerCase(),
    target_base_language_code: String(targetBaseLanguage || '').trim().toLowerCase(),
    target_target_language_code: String(targetTargetLanguage || '').trim().toLowerCase(),
    current_draft_json: JSON.stringify(currentDraft || {}, null, 2),
    extra_instruction_block: extraInstruction ? `extra_instruction: ${extraInstruction}` : ''
  });
}

function parseResponseOutput(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const item = Array.isArray(response?.output) ? response.output.find((entry) => entry?.type === 'message') : null;
  const textPart = item && Array.isArray(item.content)
    ? item.content.find((entry) => entry?.type === 'output_text' && typeof entry.text === 'string')
    : null;
  if (textPart?.text?.trim()) return textPart.text.trim();
  throw new Error('OpenAI topic generation returned no text output');
}

async function requestTopicResponse({ apiKey, model, reasoningEffort, input, recordLlmCall, trace, operation }) {
  const client = getClient(apiKey);
  return observeLlmCall({
    trace: trace || { botKey: 'topic-catalog', route: 'admin.topic' },
    operation,
    model,
    reasoningEffort,
    record: recordLlmCall,
    call: () => client.responses.create({
      model,
      reasoning: { effort: reasoningEffort },
      input,
      text: {
        format: {
          type: 'json_schema',
          name: 'topic_pack_schema',
          schema: TOPIC_GENERATION_SCHEMA,
          verbosity: 'low'
        }
      }
    })
  });
}

export async function generateTopicDraft({
  apiKey,
  model,
  reasoningEffort = 'low',
  topicName,
  baseLanguage,
  targetLanguage,
  baseTemplate = null,
  sortOrder = 0,
  accessTier = 'all',
  recordLlmCall,
  trace
}) {
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  const response = await requestTopicResponse({
    apiKey,
    model,
    reasoningEffort,
    recordLlmCall,
    trace,
    operation: 'topic.generate',
    input: [
      { role: 'system', content: renderLlmPrompt('topic-generator-system') },
      { role: 'user', content: buildUserPrompt({ topicName, baseLanguage, targetLanguage, baseTemplate }) }
    ]
  });

  const rawText = parseResponseOutput(response);
  const parsed = JSON.parse(rawText);
  const normalized = normalizeTopicPayload({ ...parsed, sort_order: sortOrder, access_tier: accessTier });
  return {
    ...normalized,
    access_tier: accessTier,
    topic_id: baseTemplate?.topic_id || normalized.topic_id
  };
}

export async function assistTopicDraft({
  apiKey,
  model,
  reasoningEffort = 'low',
  instruction,
  baseLanguage,
  targetLanguage,
  currentDraft = null,
  recordLlmCall,
  trace
}) {
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  if (!String(instruction || '').trim()) throw new Error('Missing topic assistant instruction');
  const response = await requestTopicResponse({
    apiKey,
    model,
    reasoningEffort,
    recordLlmCall,
    trace,
    operation: 'topic.assist',
    input: [
      { role: 'system', content: renderLlmPrompt('topic-generator-system') },
      { role: 'user', content: buildAssistPrompt({ instruction, baseLanguage, targetLanguage, currentDraft }) }
    ]
  });

  const rawText = parseResponseOutput(response);
  const parsed = JSON.parse(rawText);
  return normalizeTopicPayload({
    ...parsed,
    sort_order: currentDraft?.sort_order ?? 0,
    access_tier: parsed?.access_tier ?? currentDraft?.access_tier ?? 'all'
  });
}

export async function cloneTopicDraftToBot({
  apiKey,
  model,
  reasoningEffort = 'low',
  sourceBaseLanguage,
  sourceTargetLanguage,
  targetBaseLanguage,
  targetTargetLanguage,
  currentDraft,
  instruction = '',
  recordLlmCall,
  trace
}) {
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  if (!currentDraft || typeof currentDraft !== 'object' || Array.isArray(currentDraft)) {
    throw new Error('Missing current draft for clone');
  }
  const response = await requestTopicResponse({
    apiKey,
    model,
    reasoningEffort,
    recordLlmCall,
    trace,
    operation: 'topic.clone',
    input: [
      { role: 'system', content: renderLlmPrompt('topic-generator-system') },
      { role: 'user', content: buildClonePrompt({
        sourceBaseLanguage,
        sourceTargetLanguage,
        targetBaseLanguage,
        targetTargetLanguage,
        currentDraft,
        instruction
      }) }
    ]
  });

  const rawText = parseResponseOutput(response);
  const parsed = JSON.parse(rawText);
  return normalizeTopicPayload({
    ...parsed,
    topic_id: parsed?.topic_id || currentDraft?.topic_id,
    sort_order: currentDraft?.sort_order ?? 0,
    access_tier: parsed?.access_tier ?? currentDraft?.access_tier ?? 'all'
  });
}
