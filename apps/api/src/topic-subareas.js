const SUBAREA_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function cleanText(value, maxLen = 255) {
  return String(value || '').trim().slice(0, maxLen);
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

function normalizeKeywordList(value, { maxItems = 12, maxItemLen = 80 } = {}) {
  return parseJsonArray(value)
    .map((item) => cleanText(item, maxItemLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function slugifySubareaId(value, fallback = 'subarea') {
  const text = cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return text || fallback;
}

function normalizeRawSubareas(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return null;
    }
  }
  if (value == null) return [];
  return null;
}

function normalizeSubareaEntry(raw, index, { allowEmptyTargetKeywords = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`subareas_json[${index}] must be an object`);
  }
  const labelBase = cleanText(raw.label_base, 120);
  if (!labelBase) {
    throw new Error(`subareas_json[${index}].label_base is required`);
  }

  const fallbackId = `subarea-${index + 1}`;
  const id = slugifySubareaId(raw.id || labelBase, fallbackId);
  if (!SUBAREA_ID_PATTERN.test(id)) {
    throw new Error(`subareas_json[${index}].id must be a lowercase slug`);
  }

  const keywordsTarget = normalizeKeywordList(raw.keywords_target);
  const keywordsBase = normalizeKeywordList(raw.keywords_base);
  if (!allowEmptyTargetKeywords && !keywordsTarget.length) {
    throw new Error(`subareas_json[${index}].keywords_target must contain at least 1 item`);
  }

  return {
    id,
    label_base: labelBase,
    keywords_target: keywordsTarget,
    keywords_base: keywordsBase
  };
}

export function normalizeStoredSubareas(value, { allowedBase = [] } = {}) {
  const raw = normalizeRawSubareas(value);
  if (!Array.isArray(raw) || !raw.length) return [];

  try {
    const subareas = raw.map((entry, index) => normalizeSubareaEntry(entry, index));
    const ids = new Set();
    for (const subarea of subareas) {
      if (ids.has(subarea.id)) return [];
      ids.add(subarea.id);
    }
    if (Array.isArray(allowedBase) && allowedBase.length && subareas.length !== allowedBase.length) {
      return [];
    }
    return subareas;
  } catch {
    return [];
  }
}

export function normalizeTopicSubareas(value, { allowedBase = [], field = 'subareas_json' } = {}) {
  const raw = normalizeRawSubareas(value);
  if (raw === null) {
    throw new Error(`${field} must be an array`);
  }
  if (!raw.length) return [];

  const subareas = raw.map((entry, index) => normalizeSubareaEntry(entry, index));
  const ids = new Set();
  for (const subarea of subareas) {
    if (ids.has(subarea.id)) {
      throw new Error(`${field} ids must be unique`);
    }
    ids.add(subarea.id);
  }
  if (Array.isArray(allowedBase) && allowedBase.length && subareas.length !== allowedBase.length) {
    throw new Error(`${field} must contain the same number of items as allowed_base`);
  }
  return subareas;
}

export function buildFallbackSubareas(allowedBase = []) {
  const list = Array.isArray(allowedBase) ? allowedBase : [];
  return list
    .map((label, index) => {
      const cleanedLabel = cleanText(label, 120);
      if (!cleanedLabel) return null;
      const slug = slugifySubareaId(cleanedLabel, `subarea-${index + 1}`);
      return {
        id: slug || `subarea-${index + 1}`,
        label_base: cleanedLabel,
        keywords_target: [],
        keywords_base: [cleanedLabel]
      };
    })
    .filter(Boolean);
}

function tokenizeText(value) {
  return cleanText(value, 500).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function matchKeyword(sourceLower, tokenSet, keyword) {
  const normalized = cleanText(keyword, 80).toLowerCase();
  if (!normalized) return null;
  const keywordTokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  if (!keywordTokens.length) return null;
  if (keywordTokens.length === 1) {
    return tokenSet.has(keywordTokens[0]) ? {
      phraseSize: 1,
      keywordLength: keywordTokens[0].length
    } : null;
  }
  return sourceLower.includes(normalized) ? {
    phraseSize: keywordTokens.length,
    keywordLength: normalized.length
  } : null;
}

export function legacyInferSubarea(text, allowedBase = []) {
  const tokens = tokenizeText(text);
  if (!tokens.length) return '';
  const tokenSet = new Set(tokens);
  let best = '';
  let bestScore = 0;
  for (const rawArea of Array.isArray(allowedBase) ? allowedBase : []) {
    const area = cleanText(rawArea, 120);
    if (!area) continue;
    const areaTokens = area.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (!areaTokens.length) continue;
    const score = areaTokens.reduce((sum, token) => sum + (tokenSet.has(token) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = area;
    }
  }
  return bestScore > 0 ? best : '';
}

function mapLegacyLabelToSubareaId(legacyLabel, subareas = []) {
  const normalized = cleanText(legacyLabel, 120).toLowerCase();
  if (!normalized) return '';
  const match = subareas.find((subarea) => cleanText(subarea.label_base, 120).toLowerCase() === normalized);
  return match?.id || '';
}

export function inferSubareaId(text, subareas = [], { legacyAllowedBase = [] } = {}) {
  const source = cleanText(text, 500);
  if (!source) return '';

  const normalizedSubareas = Array.isArray(subareas) ? subareas : [];
  const sourceLower = source.toLowerCase();
  const tokenSet = new Set(tokenizeText(source));
  let best = null;

  for (const subarea of normalizedSubareas) {
    const keywordsTarget = normalizeKeywordList(subarea.keywords_target);
    const keywordsBase = normalizeKeywordList(subarea.keywords_base);
    let score = 0;
    let strongestPhrase = 0;
    let longestKeyword = 0;
    let distinctHits = 0;

    for (const keyword of keywordsTarget) {
      const match = matchKeyword(sourceLower, tokenSet, keyword);
      if (!match) continue;
      distinctHits += 1;
      strongestPhrase = Math.max(strongestPhrase, match.phraseSize);
      longestKeyword = Math.max(longestKeyword, match.keywordLength);
      score += 10 + (match.phraseSize * 4) + match.keywordLength;
    }

    for (const keyword of keywordsBase) {
      const match = matchKeyword(sourceLower, tokenSet, keyword);
      if (!match) continue;
      distinctHits += 1;
      strongestPhrase = Math.max(strongestPhrase, match.phraseSize);
      longestKeyword = Math.max(longestKeyword, match.keywordLength);
      score += 3 + (match.phraseSize * 2) + Math.round(match.keywordLength / 2);
    }

    if (!score) continue;
    const candidate = {
      id: cleanText(subarea.id, 80),
      score,
      strongestPhrase,
      longestKeyword,
      distinctHits
    };
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.strongestPhrase > best.strongestPhrase) ||
      (candidate.score === best.score && candidate.strongestPhrase === best.strongestPhrase && candidate.longestKeyword > best.longestKeyword) ||
      (candidate.score === best.score && candidate.strongestPhrase === best.strongestPhrase && candidate.longestKeyword === best.longestKeyword && candidate.distinctHits > best.distinctHits)
    ) {
      best = candidate;
    }
  }

  if (best?.id) return best.id;
  const legacyLabel = legacyInferSubarea(source, legacyAllowedBase);
  return mapLegacyLabelToSubareaId(legacyLabel, normalizedSubareas);
}
