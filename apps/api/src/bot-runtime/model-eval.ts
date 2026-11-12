import type { ConversationAiResult } from './bot-ai.js';

export type EvalExpectedRoute = 'target' | 'base_mixed' | 'third';

export interface ConversationEvalCase {
  id: string;
  botKey: string;
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
  inputMode: 'text' | 'voice';
  text: string;
  expectedRoute: EvalExpectedRoute;
  expectedMistakes: boolean;
  profileSummary: string;
  shortSummary: string;
  history: Array<{ role: string; content: string }>;
  dimensions: string[];
}

export interface ConversationEvalFixture {
  version: number;
  description: string;
  cases: ConversationEvalCase[];
}

const REQUIRED_TARGET_LANGUAGES = ['de', 'en', 'es', 'it', 'pl'];
const REQUIRED_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const ALLOWED_TAGS = new Set(['b', 'i', 'code', 'pre', 'blockquote']);

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateTelegramHtml(value: string): string[] {
  const errors: string[] = [];
  const stack: string[] = [];
  const tokens = value.match(/<[^>]*>/gu) || [];
  const textWithoutTags = value.replace(/<\/?(?:b|i|code|pre|blockquote)>/gu, '');
  if (textWithoutTags.includes('<') || textWithoutTags.includes('>')) {
    errors.push('explanation contains malformed or attributed HTML');
  }
  for (const token of tokens) {
    const match = /^<(\/)?([a-z]+)>$/u.exec(token);
    if (!match || !ALLOWED_TAGS.has(match[2])) {
      errors.push(`explanation contains unsafe tag ${token}`);
      continue;
    }
    if (match[1]) {
      if (stack.pop() !== match[2]) errors.push(`explanation has unbalanced tag ${token}`);
    } else {
      stack.push(match[2]);
    }
  }
  if (stack.length) errors.push('explanation has unclosed HTML tags');
  return errors;
}

export function validateConversationEvalFixture(fixture: ConversationEvalFixture): string[] {
  const errors: string[] = [];
  if (fixture.version !== 1) errors.push('fixture version must be 1');
  if (!Array.isArray(fixture.cases) || fixture.cases.length < 15) {
    errors.push('fixture must contain at least 15 cases');
    return errors;
  }

  const ids = new Set<string>();
  const botKeys = new Set<string>();
  const levels = new Set<string>();
  const targetLanguages = new Set<string>();
  const dimensions = new Set<string>();
  const routes = new Set<string>();
  const inputModes = new Set<string>();

  for (const testCase of fixture.cases) {
    if (!nonEmptyString(testCase.id)) errors.push('case has no id');
    if (ids.has(testCase.id)) errors.push(`duplicate case id ${testCase.id}`);
    ids.add(testCase.id);
    botKeys.add(testCase.botKey);
    levels.add(testCase.level);
    targetLanguages.add(testCase.botKey.split('-')[1] || '');
    routes.add(testCase.expectedRoute);
    inputModes.add(testCase.inputMode);
    for (const dimension of testCase.dimensions || []) dimensions.add(dimension);
    if (!nonEmptyString(testCase.text)) errors.push(`${testCase.id}: missing text`);
    if (!Array.isArray(testCase.history)) errors.push(`${testCase.id}: history must be an array`);
  }

  if (botKeys.size !== 15) errors.push(`fixture must cover all 15 bot keys; found ${botKeys.size}`);
  for (const level of REQUIRED_LEVELS) {
    if (!levels.has(level)) errors.push(`fixture is missing level ${level}`);
  }
  for (const language of REQUIRED_TARGET_LANGUAGES) {
    if (!targetLanguages.has(language)) errors.push(`fixture is missing target language ${language}`);
  }
  for (const route of ['target', 'base_mixed', 'third']) {
    if (!routes.has(route)) errors.push(`fixture is missing route ${route}`);
  }
  for (const inputMode of ['text', 'voice']) {
    if (!inputModes.has(inputMode)) errors.push(`fixture is missing input mode ${inputMode}`);
  }
  for (const dimension of ['grammar', 'correct-input', 'mixed-language', 'conversation-context', 'imperfect-transcript']) {
    if (!dimensions.has(dimension)) errors.push(`fixture is missing dimension ${dimension}`);
  }
  return errors;
}

export function validateConversationEvalResult(
  testCase: ConversationEvalCase,
  result: ConversationAiResult
): string[] {
  const errors: string[] = [];
  const requiredTypes: Record<string, string> = {
    detected_language: 'string',
    is_target_language: 'boolean',
    has_mistakes: 'boolean',
    reply_text: 'string',
    explanation_html: 'string'
  };
  for (const [key, expectedType] of Object.entries(requiredTypes)) {
    if (typeof result[key] !== expectedType) errors.push(`${key} must be ${expectedType}`);
  }
  if (errors.length) return errors;

  const reply = result.reply_text.trim();
  const explanation = result.explanation_html.trim();
  const expectedTarget = testCase.expectedRoute !== 'third';
  if (result.is_target_language !== expectedTarget) {
    errors.push(`is_target_language expected ${expectedTarget}`);
  }
  if (result.has_mistakes !== testCase.expectedMistakes) {
    errors.push(`has_mistakes expected ${testCase.expectedMistakes}`);
  }
  if (reply.includes('<') || reply.includes('>')) errors.push('reply_text must be plain text');

  if (testCase.expectedRoute === 'third') {
    if (reply) errors.push('third-language reply_text must be empty');
    if (!explanation) errors.push('third-language explanation must be present');
  } else if (!reply) {
    errors.push('target/base-mixed reply_text must be present');
  }

  if (!testCase.expectedMistakes && testCase.expectedRoute === 'target' && explanation) {
    errors.push('correct target-language input must have an empty explanation');
  }
  if (testCase.expectedRoute === 'base_mixed') {
    if (!/^<b>[^<]+<\/b>\s*<blockquote>.*<code>[^<]+<\/code>.*<\/blockquote>$/su.test(explanation)) {
      errors.push('base/mixed explanation must use the exact hint structure');
    }
    if (/[❌✅🧠]/u.test(explanation)) errors.push('base/mixed hint must not contain correction markers');
  }
  if (testCase.expectedRoute === 'target' && testCase.expectedMistakes) {
    for (const marker of ['❌', '✅', '🧠', '[Rule:']) {
      if (!explanation.includes(marker)) errors.push(`correction explanation is missing ${marker}`);
    }
  }
  if (explanation) errors.push(...validateTelegramHtml(explanation));
  return [...new Set(errors)];
}

export function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}
