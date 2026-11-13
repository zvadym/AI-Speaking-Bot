export const RESPONSE_SCHEMA = {
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

export const ONBOARDING_RESPONSE_SCHEMA = {
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

export const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translation_base'],
  properties: { translation_base: { type: 'string' } }
} as const;

export const HINTS_SCHEMA = {
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

export const VOCAB_SCHEMA = {
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
