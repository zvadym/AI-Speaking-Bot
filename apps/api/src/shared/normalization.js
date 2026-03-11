export const PURCHASE_ALLOWED_TIERS = new Set(['pro']);
export const PURCHASE_ALLOWED_BILLING_INTERVALS = new Set(['month', 'year']);
export const QUERY_TRUE_VALUES = new Set(['true', '1', 'yes']);
export const FEEDBACK_CATEGORIES = new Set(['bug', 'idea', 'billing', 'coach']);

export function normalizeBillingInterval(raw, fallback = 'month') {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return fallback;
  if (!PURCHASE_ALLOWED_BILLING_INTERVALS.has(value)) return null;
  return value;
}

export function parseQueryBoolean(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return false;
  return QUERY_TRUE_VALUES.has(value);
}

export function normalizeBotKey(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return null;
  return value.slice(0, 32);
}

export function normalizeLanguageCode(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return null;
  if (value === 'ua' || value === 'uk-ua' || value === 'ua-ua') return 'uk';
  return value.slice(0, 16);
}

export function normalizeCurrencyCode(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(value)) return null;
  return value;
}

export function normalizeRuntimeCurrencyCode(raw) {
  const currency = normalizeCurrencyCode(raw);
  return currency ? currency.toUpperCase() : null;
}

export function normalizeOptionalText(raw, maxLen) {
  const value = (raw ?? '').toString().trim();
  if (!value) return null;
  return value.slice(0, maxLen);
}

export function normalizeFeedbackCategory(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return null;
  if (!FEEDBACK_CATEGORIES.has(value)) return null;
  return value;
}

export function normalizeStringArray(raw, { maxItems = 12, maxItemLen = 32 } = {}) {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .map((value) => (value ?? '').toString().trim())
    .filter(Boolean)
    .map((value) => value.slice(0, maxItemLen))
    .slice(0, maxItems);
  return items.length ? items : null;
}

export function parsePositiveInteger(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function clampInteger(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.trunc(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

export function clampNumber(value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, fallback = 0 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

export function parseChatIdList(raw) {
  const value = (raw ?? '').toString().trim();
  if (!value) return [];

  const parts = value.split(/[\s,]+/g);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const next = (part ?? '').toString().trim();
    if (!next) continue;
    if (!/^\d{4,20}$/.test(next)) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    if (out.length >= 200) break;
  }
  return out;
}
