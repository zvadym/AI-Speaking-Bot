const TOPIC_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOPIC_LEVEL_KEYS = new Set(['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'default']);
const TOPIC_MODE_FALLBACKS = {
  coffee: 'roleplay',
  apartment: 'roleplay',
  interview: 'rehearsal',
  office: 'rehearsal'
};
const QUESTION_MARK_RE = /[?¿？؟]$/;

export const TOPIC_DEFAULT_EMOJI = '🧩';
export const TOPIC_ALLOWED_LIMITS = { minItems: 2, maxItems: 6, maxItemLen: 80 };
export const TOPIC_AVOID_LIMITS = { minItems: 2, maxItems: 6, maxItemLen: 80 };
export const TOPIC_STARTER_LIMITS = { minItems: 6, maxItems: 10, maxItemLen: 220 };
export const TOPIC_RECOVERY_LIMITS = { minItems: 6, maxItems: 10, maxItemLen: 220 };
export const TOPIC_LEVEL_QUESTION_LIMITS = { minItems: 1, maxItems: 10, maxItemLen: 220 };
export const TOPIC_OPTIONAL_LIST_LIMITS = { minItems: 0, maxItems: 10, maxItemLen: 120 };
export const TOPIC_ACCESS_TIERS = new Set(['all', 'free', 'pro']);
export const TOPIC_MODES = new Set(['open_chat', 'roleplay', 'rehearsal']);

const LEGACY_TOPIC_EMOJIS = {
  routine: '🌅',
  food: '🍽️',
  travel: '✈️',
  coffee: '☕',
  apartment: '🏠',
  interview: '💼',
  office: '🧑‍💻',
  movies: '🎬'
};

const STARTER_BANNED_PATTERNS = [
  /\bbot\b/i,
  /бот/i,
  /\bai\b/i,
  /штучн/i,
  /\bblink\b/i,
  /морг/i,
  /\bhello\b/i,
  /\bhi\b/i,
  /\bhey\b/i,
  /привіт/i,
  /\bhallo\b/i,
  /\bciao\b/i,
  /\bsend\b/i,
  /\brecord\b/i,
  /\bsay\b/i,
  /голосом/i,
  /voice message/i,
  /voice note/i,
  /надішли/i,
  /запиши/i
];

function makeError(code, detail) {
  const err = new Error(detail || code);
  err.code = code;
  err.detail = detail || code;
  return err;
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeText(value, { maxLen = 255, field = 'field', required = true } = {}) {
  const text = (value ?? '').toString().trim();
  if (!text) {
    if (!required) return '';
    throw makeError(`bad_${field}`, `${field} is required`);
  }
  return text.slice(0, maxLen);
}

function normalizeList(value, limits, field) {
  if (!Array.isArray(value)) {
    throw makeError(`bad_${field}`, `${field} must be an array`);
  }
  const items = value
    .map((item) => (item ?? '').toString().trim())
    .filter(Boolean)
    .map((item) => item.slice(0, limits.maxItemLen));
  if (items.length < limits.minItems || items.length > limits.maxItems) {
    throw makeError(
      `bad_${field}`,
      `${field} must contain ${limits.minItems}-${limits.maxItems} items`
    );
  }
  return items;
}

function normalizeOptionalList(value, limits, field) {
  const parsed = parseJsonArray(value);
  if (!parsed.length) return [];
  return normalizeList(parsed, limits, field);
}

function normalizeObject(value, { field = 'field', required = false } = {}) {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    if (!required) return {};
    throw makeError(`bad_${field}`, `${field} must be an object`);
  }
  return parsed;
}

function normalizeLevelKey(rawKey) {
  const key = (rawKey ?? '').toString().trim().toLowerCase();
  return TOPIC_LEVEL_KEYS.has(key) ? key : '';
}

function normalizeLevelQuestionList(value, field) {
  return normalizeList(parseJsonArray(value), TOPIC_LEVEL_QUESTION_LIMITS, field);
}

function buildDefaultLevelQuestionMap(list = []) {
  return Array.isArray(list) && list.length ? { default: [...list] } : {};
}

function normalizeLevelQuestionMap(value, fallbackList = [], field = 'questions_by_level') {
  const parsed = parseJsonObject(value);
  if (!parsed) return buildDefaultLevelQuestionMap(fallbackList);

  const entries = Object.entries(parsed)
    .map(([key, listValue]) => {
      const levelKey = normalizeLevelKey(key);
      if (!levelKey) return null;
      const list = normalizeLevelQuestionList(listValue, `${field}.${levelKey}`);
      return list.length ? [levelKey, list] : null;
    })
    .filter(Boolean);

  if (!entries.length) return buildDefaultLevelQuestionMap(fallbackList);
  return Object.fromEntries(entries);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function chooseValue(raw, existingValue, fallbackValue, key) {
  if (hasOwn(raw, key)) return raw[key];
  if (existingValue !== undefined) return existingValue;
  return fallbackValue;
}

function normalizeGrammarTargets(value, existingValue = {}) {
  const resolved = value === undefined ? existingValue : value;
  return normalizeObject(resolved, { field: 'grammar_targets_json', required: false });
}

function normalizeTopicModeValue(rawTopicMode, topicId) {
  const normalized = (rawTopicMode ?? '').toString().trim().toLowerCase();
  if (!normalized) return deriveTopicMode(topicId);
  if (!TOPIC_MODES.has(normalized)) {
    throw makeError('bad_topic_mode', 'topic_mode must be open_chat, roleplay, or rehearsal');
  }
  return normalized;
}

function normalizeOptionalTextField(raw, existingValue, maxLen, field, fallbackValue = '') {
  if (raw === undefined) return normalizeText(existingValue ?? fallbackValue, { maxLen, field, required: false });
  return normalizeText(raw, { maxLen, field, required: false });
}

function normalizeOptionalArrayField(raw, existingValue, limits, field, fallbackValue = []) {
  if (raw === undefined) {
    return normalizeOptionalList(existingValue ?? fallbackValue, limits, field);
  }
  return normalizeOptionalList(raw, limits, field);
}

export function slugifyTopicId(value, fallback = 'topic') {
  const text = (value ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return text || fallback;
}

export function normalizeTopicId(value, { required = true } = {}) {
  const topicId = slugifyTopicId(value);
  if (!topicId) {
    if (!required) return '';
    throw makeError('bad_topic_id', 'topic_id is required');
  }
  if (!TOPIC_ID_PATTERN.test(topicId)) {
    throw makeError('bad_topic_id', 'topic_id must be lowercase letters, numbers, and dashes');
  }
  return topicId.slice(0, 64);
}

export function defaultEmojiForTopicId(topicIdRaw) {
  const topicId = normalizeTopicId(topicIdRaw, { required: false });
  return LEGACY_TOPIC_EMOJIS[topicId] || TOPIC_DEFAULT_EMOJI;
}

export function normalizeTopicEmoji(value, topicIdRaw = '') {
  const emoji = (value ?? '').toString().trim();
  if (!emoji) return defaultEmojiForTopicId(topicIdRaw);
  return emoji.slice(0, 16);
}

export function normalizeTopicAccessTier(raw) {
  const accessTier = (raw ?? 'all').toString().trim().toLowerCase() || 'all';
  if (!TOPIC_ACCESS_TIERS.has(accessTier)) {
    throw makeError('bad_access_tier', 'access_tier must be all, free, or pro');
  }
  return accessTier;
}

export function normalizeTopicMode(rawTopicMode, topicIdRaw = '') {
  return normalizeTopicModeValue(rawTopicMode, normalizeTopicId(topicIdRaw, { required: false }));
}

export function deriveTopicMode(topicIdRaw = '') {
  const topicId = normalizeTopicId(topicIdRaw, { required: false });
  return TOPIC_MODE_FALLBACKS[topicId] || 'open_chat';
}

export function selectTopicQuestionsForLevel(topicRaw, fieldPrefix, levelRaw) {
  const topic = topicRaw && typeof topicRaw === 'object' ? topicRaw : {};
  const fallback = Array.isArray(topic[`${fieldPrefix}_target`])
    ? topic[`${fieldPrefix}_target`].map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const map = normalizeLevelQuestionMap(topic[`${fieldPrefix}_by_level_target`], fallback, `${fieldPrefix}_by_level_target`);
  const level = normalizeLevelKey(levelRaw);
  if (level && Array.isArray(map[level]) && map[level].length) return map[level];
  if (Array.isArray(map.default) && map.default.length) return map.default;
  return fallback;
}

export function pickTopicStarterQuestion(packRaw, { level = '', preferOpeningPrompt = true } = {}) {
  const pack = packRaw && typeof packRaw === 'object' ? packRaw : {};
  if (preferOpeningPrompt) {
    const opening = normalizeText(pack.opening_prompt_target, {
      maxLen: 280,
      field: 'opening_prompt_target',
      required: false
    });
    if (opening) return opening;
  }
  const raw = selectTopicQuestionsForLevel(pack, 'starter_questions', level);
  const cleaned = raw.map((item) => String(item || '').trim()).filter(Boolean);
  return (
    cleaned.find((item) => QUESTION_MARK_RE.test(item) && !STARTER_BANNED_PATTERNS.some((re) => re.test(item))) ||
    cleaned.find((item) => !STARTER_BANNED_PATTERNS.some((re) => re.test(item))) ||
    cleaned[0] ||
    ''
  );
}

export function buildOpeningPromptTarget(topicRaw, { level = '' } = {}) {
  const topic = topicRaw && typeof topicRaw === 'object' ? topicRaw : {};
  const existing = normalizeText(topic.opening_prompt_target, {
    maxLen: 280,
    field: 'opening_prompt_target',
    required: false
  });
  if (existing) return existing;
  return pickTopicStarterQuestion(topic, { level, preferOpeningPrompt: false });
}

export function normalizeTopicPayload(raw, { requireAll = true, existingTopic = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw makeError('bad_topic_payload', 'topic payload must be an object');
  }

  const existing = existingTopic && typeof existingTopic === 'object' ? existingTopic : null;
  const topicId = normalizeTopicId(
    chooseValue(raw, existing?.topic_id, raw.topic_id, 'topic_id'),
    { required: requireAll || Boolean(existing?.topic_id) }
  );
  const sortOrderRaw = Number(chooseValue(raw, existing?.sort_order, 0, 'sort_order') ?? 0);
  if (!Number.isInteger(sortOrderRaw) || sortOrderRaw < 0 || sortOrderRaw > 100000) {
    throw makeError('bad_sort_order', 'sort_order must be an integer between 0 and 100000');
  }

  const accessTier = normalizeTopicAccessTier(
    chooseValue(raw, existing?.access_tier, raw.topic_access_tier ?? 'all', 'access_tier')
  );
  const titleBase = normalizeText(chooseValue(raw, existing?.title_base, '', 'title_base'), {
    maxLen: 120,
    field: 'title_base',
    required: requireAll || Boolean(existing?.title_base)
  });
  const goalBase = normalizeText(chooseValue(raw, existing?.goal_base, '', 'goal_base'), {
    maxLen: 280,
    field: 'goal_base',
    required: requireAll || Boolean(existing?.goal_base)
  });
  const allowedBase = normalizeList(
    chooseValue(raw, existing?.allowed_base, [], 'allowed_base'),
    TOPIC_ALLOWED_LIMITS,
    'allowed_base'
  );
  const avoidBase = normalizeList(
    chooseValue(raw, existing?.avoid_base, [], 'avoid_base'),
    TOPIC_AVOID_LIMITS,
    'avoid_base'
  );
  const starterQuestionsTarget = normalizeList(
    chooseValue(raw, existing?.starter_questions_target, [], 'starter_questions_target'),
    TOPIC_STARTER_LIMITS,
    'starter_questions_target'
  );
  const recoveryQuestionsTarget = normalizeList(
    chooseValue(raw, existing?.recovery_questions_target, [], 'recovery_questions_target'),
    TOPIC_RECOVERY_LIMITS,
    'recovery_questions_target'
  );

  const starterQuestionsByLevelTarget = normalizeLevelQuestionMap(
    chooseValue(raw, existing?.starter_questions_by_level_target, starterQuestionsTarget, 'starter_questions_by_level_target'),
    starterQuestionsTarget,
    'starter_questions_by_level_target'
  );
  const recoveryQuestionsByLevelTarget = normalizeLevelQuestionMap(
    chooseValue(raw, existing?.recovery_questions_by_level_target, recoveryQuestionsTarget, 'recovery_questions_by_level_target'),
    recoveryQuestionsTarget,
    'recovery_questions_by_level_target'
  );
  const topicMode = normalizeTopicModeValue(
    chooseValue(raw, existing?.topic_mode, '', 'topic_mode'),
    topicId
  );
  const speechActsBase = normalizeOptionalArrayField(
    hasOwn(raw, 'speech_acts_base') ? raw.speech_acts_base : undefined,
    existing?.speech_acts_base,
    TOPIC_OPTIONAL_LIST_LIMITS,
    'speech_acts_base'
  );
  const lexicalAnchorsTarget = normalizeOptionalArrayField(
    hasOwn(raw, 'lexical_anchors_target') ? raw.lexical_anchors_target : undefined,
    existing?.lexical_anchors_target,
    TOPIC_OPTIONAL_LIST_LIMITS,
    'lexical_anchors_target'
  );
  const grammarTargetsJson = normalizeGrammarTargets(
    hasOwn(raw, 'grammar_targets_json') ? raw.grammar_targets_json : undefined,
    existing?.grammar_targets_json
  );
  const bridgePatternsTarget = normalizeOptionalArrayField(
    hasOwn(raw, 'bridge_patterns_target') ? raw.bridge_patterns_target : undefined,
    existing?.bridge_patterns_target,
    TOPIC_OPTIONAL_LIST_LIMITS,
    'bridge_patterns_target'
  );
  const hardBlockBase = normalizeOptionalArrayField(
    hasOwn(raw, 'hard_block_base') ? raw.hard_block_base : undefined,
    existing?.hard_block_base,
    TOPIC_OPTIONAL_LIST_LIMITS,
    'hard_block_base'
  );
  const softRedirectBase = normalizeOptionalArrayField(
    hasOwn(raw, 'soft_redirect_base') ? raw.soft_redirect_base : undefined,
    existing?.soft_redirect_base,
    TOPIC_OPTIONAL_LIST_LIMITS,
    'soft_redirect_base',
    avoidBase
  );

  const merged = {
    topic_id: topicId,
    emoji: normalizeTopicEmoji(chooseValue(raw, existing?.emoji, '', 'emoji'), topicId),
    access_tier: accessTier,
    title_base: titleBase,
    goal_base: goalBase,
    allowed_base: allowedBase,
    avoid_base: avoidBase,
    starter_questions_target: starterQuestionsTarget,
    recovery_questions_target: recoveryQuestionsTarget,
    sort_order: sortOrderRaw,
    topic_mode: topicMode,
    speech_acts_base: speechActsBase,
    lexical_anchors_target: lexicalAnchorsTarget,
    grammar_targets_json: grammarTargetsJson,
    starter_questions_by_level_target: starterQuestionsByLevelTarget,
    recovery_questions_by_level_target: recoveryQuestionsByLevelTarget,
    bridge_patterns_target: bridgePatternsTarget,
    hard_block_base: hardBlockBase,
    soft_redirect_base: softRedirectBase
  };

  return {
    ...merged,
    opening_prompt_target: normalizeOptionalTextField(
      hasOwn(raw, 'opening_prompt_target') ? raw.opening_prompt_target : undefined,
      existing?.opening_prompt_target,
      280,
      'opening_prompt_target',
      buildOpeningPromptTarget(merged)
    )
  };
}

export function normalizeTopicRow(row) {
  if (!row || typeof row !== 'object') return null;
  const topicId = normalizeTopicId(row.topic_id || row.id, { required: false });
  if (!topicId) return null;

  const allowedBase = normalizeList(parseJsonArray(row.allowed_base), TOPIC_ALLOWED_LIMITS, 'allowed_base');
  const avoidBase = normalizeList(parseJsonArray(row.avoid_base), TOPIC_AVOID_LIMITS, 'avoid_base');
  const starterQuestionsTarget = normalizeList(
    parseJsonArray(row.starter_questions_target),
    TOPIC_STARTER_LIMITS,
    'starter_questions_target'
  );
  const recoveryQuestionsTarget = normalizeList(
    parseJsonArray(row.recovery_questions_target),
    TOPIC_RECOVERY_LIMITS,
    'recovery_questions_target'
  );

  const normalized = {
    bot_key: (row.bot_key ?? '').toString().trim().toLowerCase(),
    topic_id: topicId,
    emoji: normalizeTopicEmoji(row.emoji, topicId),
    access_tier: TOPIC_ACCESS_TIERS.has(String(row.access_tier || row.topic_access_tier || '').trim().toLowerCase())
      ? String(row.access_tier || row.topic_access_tier || '').trim().toLowerCase()
      : 'all',
    title_base: normalizeText(row.title_base, { maxLen: 120, field: 'title_base' }),
    goal_base: normalizeText(row.goal_base, { maxLen: 280, field: 'goal_base' }),
    allowed_base: allowedBase,
    avoid_base: avoidBase,
    starter_questions_target: starterQuestionsTarget,
    recovery_questions_target: recoveryQuestionsTarget,
    sort_order: Number.isInteger(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    topic_mode: normalizeTopicModeValue(row.topic_mode, topicId),
    speech_acts_base: normalizeOptionalList(row.speech_acts_base, TOPIC_OPTIONAL_LIST_LIMITS, 'speech_acts_base'),
    lexical_anchors_target: normalizeOptionalList(
      row.lexical_anchors_target,
      TOPIC_OPTIONAL_LIST_LIMITS,
      'lexical_anchors_target'
    ),
    grammar_targets_json: normalizeObject(row.grammar_targets_json, {
      field: 'grammar_targets_json',
      required: false
    }),
    starter_questions_by_level_target: normalizeLevelQuestionMap(
      row.starter_questions_by_level_target,
      starterQuestionsTarget,
      'starter_questions_by_level_target'
    ),
    recovery_questions_by_level_target: normalizeLevelQuestionMap(
      row.recovery_questions_by_level_target,
      recoveryQuestionsTarget,
      'recovery_questions_by_level_target'
    ),
    bridge_patterns_target: normalizeOptionalList(
      row.bridge_patterns_target,
      TOPIC_OPTIONAL_LIST_LIMITS,
      'bridge_patterns_target'
    ),
    hard_block_base: normalizeOptionalList(row.hard_block_base, TOPIC_OPTIONAL_LIST_LIMITS, 'hard_block_base'),
    soft_redirect_base: normalizeOptionalList(
      row.soft_redirect_base,
      TOPIC_OPTIONAL_LIST_LIMITS,
      'soft_redirect_base'
    )
  };

  return {
    ...normalized,
    opening_prompt_target: normalizeOptionalTextField(
      row.opening_prompt_target,
      '',
      280,
      'opening_prompt_target',
      buildOpeningPromptTarget(normalized)
    )
  };
}

export function buildTopicPackFromRow(row, { level = '' } = {}) {
  const topic = normalizeTopicRow(row);
  if (!topic) return null;

  const starterQuestions = selectTopicQuestionsForLevel(topic, 'starter_questions', level);
  const recoveryQuestions = selectTopicQuestionsForLevel(topic, 'recovery_questions', level);

  return {
    topic_id: topic.topic_id,
    emoji: topic.emoji,
    access_tier: topic.access_tier,
    title_base: topic.title_base,
    goal_base: topic.goal_base,
    allowed_base: topic.allowed_base,
    avoid_base: topic.avoid_base,
    starter_questions_target: starterQuestions,
    recovery_questions_target: recoveryQuestions,
    topic_mode: topic.topic_mode,
    speech_acts_base: topic.speech_acts_base,
    lexical_anchors_target: topic.lexical_anchors_target,
    grammar_targets_json: topic.grammar_targets_json,
    starter_questions_by_level_target: topic.starter_questions_by_level_target,
    recovery_questions_by_level_target: topic.recovery_questions_by_level_target,
    bridge_patterns_target: topic.bridge_patterns_target,
    hard_block_base: topic.hard_block_base,
    soft_redirect_base: topic.soft_redirect_base,
    opening_prompt_target: buildOpeningPromptTarget(
      { ...topic, starter_questions_target: starterQuestions },
      { level }
    )
  };
}

export function normalizeEffectiveTopicAccessTier(rawTier) {
  const tier = (rawTier ?? '').toString().trim().toLowerCase();
  return tier === 'free' ? 'free' : 'pro';
}

export function topicIsVisibleForTier(topicRaw, userTierRaw) {
  const topic = normalizeTopicRow(topicRaw);
  if (!topic) return false;
  return Boolean(normalizeEffectiveTopicAccessTier(userTierRaw));
}

export function topicRequiresSubscriptionForTier(topicRaw, userTierRaw) {
  const topic = normalizeTopicRow(topicRaw);
  if (!topic) return false;
  if ((topic.access_tier || 'all') !== 'pro') return false;
  const userTier = normalizeEffectiveTopicAccessTier(userTierRaw);
  return userTier !== 'pro';
}
