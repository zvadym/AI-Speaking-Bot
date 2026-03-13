import OpenAI from 'openai';
import { defaultEmojiForTopicId, normalizeTopicPayload, slugifyTopicId } from './topic-catalog.js';
import { renderLlmPrompt } from './llm-prompts/index.js';

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
    'avoid_base',
    'starter_questions_target',
    'recovery_questions_target'
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
    }
  }
};

function getClient(apiKey) {
  return new OpenAI({ apiKey });
}

function buildUserPrompt({ topicName, baseLanguage, targetLanguage, baseTemplate }) {
  const baseTemplateBlock = baseTemplate
    ? [
        'Preserve the base-language topic meaning closely.',
        `existing_topic_id: ${String(baseTemplate.topic_id || '').trim().toLowerCase()}`,
        `existing_title_base: ${String(baseTemplate.title_base || '').trim()}`,
        `existing_goal_base: ${String(baseTemplate.goal_base || '').trim()}`,
        `existing_allowed_base: ${JSON.stringify(baseTemplate.allowed_base || [])}`,
        `existing_avoid_base: ${JSON.stringify(baseTemplate.avoid_base || [])}`
      ].join('\n')
    : 'Invent the full topic rules from the topic name.';

  return renderLlmPrompt('topic-generator-user', {
    topic_name: String(topicName || '').trim(),
    base_language_code: String(baseLanguage || '').trim().toLowerCase(),
    target_language_code: String(targetLanguage || '').trim().toLowerCase(),
    suggested_topic_id: slugifyTopicId(topicName || baseTemplate?.topic_id || 'topic'),
    suggested_emoji: defaultEmojiForTopicId(baseTemplate?.topic_id || topicName),
    required_access_tier: String(baseTemplate?.access_tier || 'all').trim().toLowerCase() || 'all',
    base_template_block: baseTemplateBlock
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
        'Update the current draft in place unless the instruction clearly asks to rename, expand, or restructure it.'
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

export async function generateTopicDraft({
  apiKey,
  model,
  topicName,
  baseLanguage,
  targetLanguage,
  baseTemplate = null,
  sortOrder = 0,
  accessTier = 'all'
}) {
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  const client = getClient(apiKey);
  const response = await client.responses.create({
    model,
    input: [
      { role: 'system', content: renderLlmPrompt('topic-generator-system') },
      { role: 'user', content: buildUserPrompt({ topicName, baseLanguage, targetLanguage, baseTemplate }) }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'topic_pack_schema',
        schema: TOPIC_GENERATION_SCHEMA,
        verbosity: 'low'
      }
    }
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
  instruction,
  baseLanguage,
  targetLanguage,
  currentDraft = null
}) {
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  if (!String(instruction || '').trim()) throw new Error('Missing topic assistant instruction');
  const client = getClient(apiKey);
  const response = await client.responses.create({
    model,
    input: [
      { role: 'system', content: renderLlmPrompt('topic-generator-system') },
      { role: 'user', content: buildAssistPrompt({ instruction, baseLanguage, targetLanguage, currentDraft }) }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'topic_pack_schema',
        schema: TOPIC_GENERATION_SCHEMA,
        verbosity: 'low'
      }
    }
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
  sourceBaseLanguage,
  sourceTargetLanguage,
  targetBaseLanguage,
  targetTargetLanguage,
  currentDraft,
  instruction = ''
}) {
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  if (!currentDraft || typeof currentDraft !== 'object' || Array.isArray(currentDraft)) {
    throw new Error('Missing current draft for clone');
  }
  const client = getClient(apiKey);
  const response = await client.responses.create({
    model,
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
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'topic_pack_schema',
        schema: TOPIC_GENERATION_SCHEMA,
        verbosity: 'low'
      }
    }
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
