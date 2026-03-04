import scenarioConfig from './chat-demo-scenarios.json';

const SUPPORTED_LOCALES = ['en', 'de', 'es', 'pt', 'uk', 'it', 'tr', 'hi', 'ar', 'id'];
const FALLBACK_SCENARIO_ID = 'jobInterview';
const FALLBACK_LOCALE = 'en';

const REQUIRED_TOP_LEVEL_KEYS = ['userTranscript', 'botTranscript', 'followUp'];
const REQUIRED_FOLLOWUP_KEYS = ['question', 'simple', 'conversational', 'advanced', 'phrases'];
const REQUIRED_AUDIO_KEYS = ['duration', 'sentAt'];

function normalizeLocale(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (raw === 'uk' || raw === 'uk-ua' || raw === 'ua' || raw === 'ua-ua') return 'uk';
  if (raw === 'de' || raw.startsWith('de-')) return 'de';
  if (raw === 'es' || raw.startsWith('es-')) return 'es';
  if (raw === 'pt' || raw === 'pt-br' || raw === 'pt-pt' || raw.startsWith('pt-')) return 'pt';
  if (raw === 'it' || raw.startsWith('it-')) return 'it';
  if (raw === 'tr' || raw === 'tr-tr' || raw.startsWith('tr-')) return 'tr';
  if (raw === 'hi' || raw === 'hi-in' || raw.startsWith('hi-')) return 'hi';
  if (raw === 'ar' || raw === 'ar-ar' || raw.startsWith('ar-')) return 'ar';
  if (raw === 'id' || raw === 'id-id' || raw.startsWith('id-')) return 'id';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return FALLBACK_LOCALE;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidPhraseList(value) {
  if (!Array.isArray(value) || value.length < 3) return false;
  return value.slice(0, 3).every((item) => hasText(item));
}

function isValidTextBlock(value) {
  const block = asObject(value);
  const followUp = asObject(block.followUp);

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (key === 'followUp') continue;
    if (!hasText(block[key])) return false;
  }

  for (const key of REQUIRED_FOLLOWUP_KEYS) {
    if (key === 'phrases') continue;
    if (!hasText(followUp[key])) return false;
  }

  if (!isValidPhraseList(followUp.phrases)) return false;
  return true;
}

function isValidAudioBlock(value) {
  const audio = asObject(value);
  const user = asObject(audio.user);
  const bot = asObject(audio.bot);

  for (const key of REQUIRED_AUDIO_KEYS) {
    if (!hasText(user[key])) return false;
    if (!hasText(bot[key])) return false;
  }

  return true;
}

function resolveLocaleBlock(map, preferredLocale) {
  const source = asObject(map);
  const preferred = source[preferredLocale];
  if (isValidTextBlock(preferred)) return preferred;

  const english = source[FALLBACK_LOCALE];
  if (isValidTextBlock(english)) return english;

  for (const candidate of Object.values(source)) {
    if (isValidTextBlock(candidate)) return candidate;
  }

  return null;
}

function resolveAudioBlock(audio, fallbackAudio) {
  if (isValidAudioBlock(audio)) return audio;
  if (isValidAudioBlock(fallbackAudio)) return fallbackAudio;
  return {
    user: { duration: '0:10', sentAt: '00:00' },
    bot: { duration: '0:12', sentAt: '00:01' }
  };
}

function normalizeTargetMap(baseMap, overrideMap) {
  const merged = {
    ...asObject(baseMap),
    ...asObject(overrideMap)
  };

  const result = {};
  for (const locale of SUPPORTED_LOCALES) {
    const normalizedTarget = normalizeLocale(merged[locale]);
    result[locale] = normalizedTarget || FALLBACK_LOCALE;
  }
  return result;
}

function warnInvalid(message, details = {}) {
  if (!import.meta.env?.DEV) return;
  console.warn(`[chat-demo] ${message}`, details);
}

function resolveScenarioRecord(scenariosInput, scenarioId) {
  const builtInScenarios = asObject(scenarioConfig?.scenarios);
  const extraScenarios = asObject(scenariosInput);
  const allScenarios = { ...builtInScenarios, ...extraScenarios };

  const preferred = asObject(allScenarios[scenarioId]);
  if (Object.keys(preferred).length > 0) return { scenarioId, record: preferred, allScenarios };

  const fallback = asObject(allScenarios[FALLBACK_SCENARIO_ID]);
  if (Object.keys(fallback).length > 0) {
    warnInvalid('Unknown scenarioId, using fallback.', { requested: scenarioId, fallback: FALLBACK_SCENARIO_ID });
    return { scenarioId: FALLBACK_SCENARIO_ID, record: fallback, allScenarios };
  }

  const firstEntry = Object.entries(allScenarios)[0];
  if (firstEntry) {
    const [firstId, firstRecord] = firstEntry;
    warnInvalid('Fallback scenario missing, using first available scenario.', { fallback: firstId });
    return { scenarioId: firstId, record: asObject(firstRecord), allScenarios };
  }

  warnInvalid('No scenarios available, using built-in fallback structure.');
  return {
    scenarioId: FALLBACK_SCENARIO_ID,
    record: asObject(scenarioConfig?.scenarios?.[FALLBACK_SCENARIO_ID]),
    allScenarios
  };
}

function sanitizeFollowUp(value) {
  const block = asObject(value);
  const phrases = Array.isArray(block.phrases) ? block.phrases.slice(0, 3) : [];
  while (phrases.length < 3) phrases.push('');

  return {
    question: String(block.question || ''),
    simple: String(block.simple || ''),
    conversational: String(block.conversational || ''),
    advanced: String(block.advanced || ''),
    phrases: phrases.map((item) => String(item || ''))
  };
}

function sanitizeTextBlock(value) {
  const block = asObject(value);
  return {
    userTranscript: String(block.userTranscript || ''),
    botTranscript: String(block.botTranscript || ''),
    followUp: sanitizeFollowUp(block.followUp)
  };
}

/**
 * Usage contract:
 * - Available built-in scenarios: `jobInterview`.
 * - Example: resolveScenario({ scenarioId: 'jobInterview', baseLocale: 'de' })
 * - Override mapping per page: resolveScenario({ targetByBaseLocale: { de: 'es' } })
 * - Inject/override scenarios: resolveScenario({ scenarios: { customScenario: {...} } })
 */
export function resolveScenario({ scenarioId = FALLBACK_SCENARIO_ID, baseLocale = FALLBACK_LOCALE, targetByBaseLocale = {}, scenarios = {} } = {}) {
  const normalizedBaseLocale = normalizeLocale(baseLocale);
  const configuredTargetMap = normalizeTargetMap(
    scenarioConfig?.defaults?.targetByBaseLocale,
    targetByBaseLocale
  );
  const activeTargetLocale = configuredTargetMap[normalizedBaseLocale] || FALLBACK_LOCALE;

  const requestedScenarioId = String(scenarioId || FALLBACK_SCENARIO_ID).trim() || FALLBACK_SCENARIO_ID;
  const { scenarioId: resolvedScenarioId, record, allScenarios } = resolveScenarioRecord(scenarios, requestedScenarioId);

  const fallbackRecord = asObject(allScenarios[FALLBACK_SCENARIO_ID]);
  const targetContentRaw = resolveLocaleBlock(record.target, activeTargetLocale)
    || resolveLocaleBlock(fallbackRecord.target, activeTargetLocale)
    || resolveLocaleBlock(record.base, normalizedBaseLocale)
    || resolveLocaleBlock(fallbackRecord.base, FALLBACK_LOCALE);
  const baseContentRaw = resolveLocaleBlock(record.base, normalizedBaseLocale)
    || resolveLocaleBlock(fallbackRecord.base, normalizedBaseLocale)
    || resolveLocaleBlock(record.base, FALLBACK_LOCALE)
    || resolveLocaleBlock(fallbackRecord.base, FALLBACK_LOCALE)
    || targetContentRaw;
  const audio = resolveAudioBlock(record.audio, fallbackRecord.audio);

  if (!targetContentRaw || !baseContentRaw) {
    warnInvalid('Scenario text is invalid, using emergency fallback.', {
      scenarioId: resolvedScenarioId,
      baseLocale: normalizedBaseLocale,
      targetLocale: activeTargetLocale
    });
  }

  return {
    scenarioId: resolvedScenarioId,
    baseLocale: normalizedBaseLocale,
    targetLocale: activeTargetLocale,
    targetByBaseLocale: configuredTargetMap,
    targetContent: sanitizeTextBlock(targetContentRaw),
    baseContent: sanitizeTextBlock(baseContentRaw),
    audio: {
      user: {
        duration: String(audio?.user?.duration || ''),
        sentAt: String(audio?.user?.sentAt || '')
      },
      bot: {
        duration: String(audio?.bot?.duration || ''),
        sentAt: String(audio?.bot?.sentAt || '')
      }
    }
  };
}

export const CHAT_DEMO_SUPPORTED_LOCALES = SUPPORTED_LOCALES;
export const CHAT_DEMO_FALLBACK_SCENARIO = FALLBACK_SCENARIO_ID;
