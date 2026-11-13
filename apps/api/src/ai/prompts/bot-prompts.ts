import { renderLlmPrompt } from './index.js';
import type { ConversationAiInput } from '../../bot-runtime/bot-ai.js';

type UnknownRecord = Record<string, unknown>;

const LANGUAGE_LABELS: Record<string, string> = {
  ar: 'Arabic', de: 'German', en: 'English', es: 'Spanish', fr: 'French',
  hi: 'Hindi', it: 'Italian', pl: 'Polish', ru: 'Russian', tr: 'Turkish', uk: 'Ukrainian'
};

const EXPLANATION_TITLES: Record<string, string> = {
  ar: 'شرح', de: 'Erklärung', en: 'Explanation', hi: 'व्याख्या',
  it: 'Spiegazione', ru: 'Пояснение', tr: 'Açıklama', uk: 'Пояснення'
};

export function promptContext(botKey: string, config: UnknownRecord): Record<string, string> {
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
      : ''
  };
}

export function conversationUserPrompt(input: ConversationAiInput, config: UnknownRecord): string {
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
  return [
    ...onboarding,
    `Target language: ${context.target_language_label}`,
    `Base language: ${context.base_language_code}`,
    `User level: ${input.level || 'A1'}`,
    `Input mode: ${input.inputMode}`,
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
  ].join('\n');
}

export function translationUserPrompt(botKey: string, config: UnknownRecord, text: string): string {
  const context = promptContext(botKey, config);
  return `Base language code: ${context.base_language_code}\nText to translate:\n${text}`;
}

export function hintsUserPrompt(input: { botKey: string; level: string; userMessage: string; assistantReply: string }, config: UnknownRecord): string {
  const context = promptContext(input.botKey, config);
  return [
    `Target language: ${context.target_language_label}`,
    `User level: ${input.level}`,
    '',
    `user_message:\n${input.userMessage}`,
    '',
    `assistant_reply:\n${input.assistantReply}`
  ].join('\n');
}

export function vocabularyUserPrompt(botKey: string, config: UnknownRecord, assistantReply: string): string {
  const context = promptContext(botKey, config);
  return [
    `Base language code: ${context.base_language_code}`,
    `Target language code: ${context.target_language_code}`,
    '',
    `assistant_reply:\n${assistantReply}`
  ].join('\n');
}

export function renderBotPrompt(name: string, botKey: string, config: UnknownRecord): string {
  return renderLlmPrompt(name, promptContext(botKey, config), { botTemplate: true });
}
