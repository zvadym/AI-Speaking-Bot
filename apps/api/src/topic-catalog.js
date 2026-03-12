const TOPIC_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const TOPIC_DEFAULT_EMOJI = '🧩';
export const TOPIC_ALLOWED_LIMITS = { minItems: 2, maxItems: 6, maxItemLen: 80 };
export const TOPIC_AVOID_LIMITS = { minItems: 2, maxItems: 6, maxItemLen: 80 };
export const TOPIC_STARTER_LIMITS = { minItems: 6, maxItems: 10, maxItemLen: 220 };
export const TOPIC_RECOVERY_LIMITS = { minItems: 6, maxItems: 10, maxItemLen: 220 };
export const TOPIC_ACCESS_TIERS = new Set(['all', 'free', 'pro']);

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

function makeError(code, detail) {
  const err = new Error(detail || code);
  err.code = code;
  err.detail = detail || code;
  return err;
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

export function normalizeTopicPayload(raw, { requireAll = true } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw makeError('bad_topic_payload', 'topic payload must be an object');
  }
  const topicId = normalizeTopicId(raw.topic_id, { required: requireAll });
  const sortOrderRaw = Number(raw.sort_order ?? 0);
  if (!Number.isInteger(sortOrderRaw) || sortOrderRaw < 0 || sortOrderRaw > 100000) {
    throw makeError('bad_sort_order', 'sort_order must be an integer between 0 and 100000');
  }
  const accessTier = normalizeTopicAccessTier(raw.access_tier ?? raw.topic_access_tier ?? 'all');
  return {
    topic_id: topicId,
    emoji: normalizeTopicEmoji(raw.emoji, topicId),
    access_tier: accessTier,
    title_base: normalizeText(raw.title_base, { maxLen: 120, field: 'title_base', required: requireAll }),
    goal_base: normalizeText(raw.goal_base, { maxLen: 280, field: 'goal_base', required: requireAll }),
    allowed_base: normalizeList(raw.allowed_base, TOPIC_ALLOWED_LIMITS, 'allowed_base'),
    avoid_base: normalizeList(raw.avoid_base, TOPIC_AVOID_LIMITS, 'avoid_base'),
    starter_questions_target: normalizeList(raw.starter_questions_target, TOPIC_STARTER_LIMITS, 'starter_questions_target'),
    recovery_questions_target: normalizeList(raw.recovery_questions_target, TOPIC_RECOVERY_LIMITS, 'recovery_questions_target'),
    sort_order: sortOrderRaw
  };
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

export function normalizeTopicRow(row) {
  if (!row || typeof row !== 'object') return null;
  const topicId = normalizeTopicId(row.topic_id || row.id, { required: false });
  if (!topicId) return null;
  return {
    bot_key: (row.bot_key ?? '').toString().trim().toLowerCase(),
    topic_id: topicId,
    emoji: normalizeTopicEmoji(row.emoji, topicId),
    access_tier: TOPIC_ACCESS_TIERS.has(String(row.access_tier || row.topic_access_tier || '').trim().toLowerCase())
      ? String(row.access_tier || row.topic_access_tier || '').trim().toLowerCase()
      : 'all',
    title_base: normalizeText(row.title_base, { maxLen: 120, field: 'title_base' }),
    goal_base: normalizeText(row.goal_base, { maxLen: 280, field: 'goal_base' }),
    allowed_base: normalizeList(parseJsonArray(row.allowed_base), TOPIC_ALLOWED_LIMITS, 'allowed_base'),
    avoid_base: normalizeList(parseJsonArray(row.avoid_base), TOPIC_AVOID_LIMITS, 'avoid_base'),
    starter_questions_target: normalizeList(
      parseJsonArray(row.starter_questions_target),
      TOPIC_STARTER_LIMITS,
      'starter_questions_target'
    ),
    recovery_questions_target: normalizeList(
      parseJsonArray(row.recovery_questions_target),
      TOPIC_RECOVERY_LIMITS,
      'recovery_questions_target'
    ),
    sort_order: Number.isInteger(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

export function buildTopicPackFromRow(row) {
  const topic = normalizeTopicRow(row);
  if (!topic) return null;
  return {
    topic_id: topic.topic_id,
    emoji: topic.emoji,
    access_tier: topic.access_tier,
    title_base: topic.title_base,
    goal_base: topic.goal_base,
    allowed_base: topic.allowed_base,
    avoid_base: topic.avoid_base,
    starter_questions_target: topic.starter_questions_target,
    recovery_questions_target: topic.recovery_questions_target
  };
}

export function normalizeEffectiveTopicAccessTier(rawTier) {
  const tier = (rawTier ?? '').toString().trim().toLowerCase();
  return tier === 'free' ? 'free' : 'pro';
}

export function topicIsVisibleForTier(topicRaw, userTierRaw) {
  const topic = normalizeTopicRow(topicRaw);
  if (!topic) return false;
  const accessTier = topic.access_tier || 'all';
  if (accessTier === 'all') return true;
  const userTier = normalizeEffectiveTopicAccessTier(userTierRaw);
  if (userTier === 'pro') return true;
  return accessTier !== 'pro';
}

export function pickTopicStarterQuestion(packRaw) {
  const pack = packRaw && typeof packRaw === 'object' ? packRaw : {};
  const raw = Array.isArray(pack.starter_questions_target) ? pack.starter_questions_target : [];
  const cleaned = raw.map((item) => String(item || '').trim()).filter(Boolean);
  const banned = [
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
  return (
    cleaned.find((item) => item.endsWith('?') && !banned.some((re) => re.test(item))) ||
    cleaned.find((item) => !banned.some((re) => re.test(item))) ||
    cleaned[0] ||
    ''
  );
}
