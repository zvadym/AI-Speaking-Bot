const ACQ_START_STORAGE_KEY = 'als_acquisition_start_payload_v1';

function readFirstQueryValue(query, key) {
  if (!query || typeof query !== 'object') return '';
  const raw = query[key];
  if (Array.isArray(raw)) return (raw[0] ?? '').toString();
  return (raw ?? '').toString();
}

function normalizeStartToken(input, maxLen) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return '';
  const cleaned = raw
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/_+/g, '_')
    .replace(/^[-_]+/g, '')
    .replace(/[-_]+$/g, '');
  if (!cleaned) return '';
  const limit = Number.isFinite(maxLen) ? Math.max(1, Math.floor(maxLen)) : 24;
  return cleaned.slice(0, limit);
}

export function deriveLandingStartPayloadFromQuery(query) {
  const source = normalizeStartToken(readFirstQueryValue(query, 'utm_source'), 18);
  const campaign = normalizeStartToken(readFirstQueryValue(query, 'utm_campaign'), 28);

  const attributed = !!(source || campaign);
  const parts = ['landing'];
  if (source) parts.push(source);
  if (campaign) parts.push(campaign);

  let payload = parts.join('_').slice(0, 64);
  payload = payload.replace(/[-_]+$/g, '');
  if (!payload) payload = 'landing';

  return { payload, attributed };
}

export function persistLandingStartPayloadFromQuery(query) {
  if (!import.meta.client) return;
  const { payload, attributed } = deriveLandingStartPayloadFromQuery(query);
  if (!attributed) return;

  try {
    const existing = window.localStorage?.getItem(ACQ_START_STORAGE_KEY);
    if (!existing) window.localStorage?.setItem(ACQ_START_STORAGE_KEY, payload);
  } catch {
    // ignore
  }
}

export function getLandingStartPayload(query) {
  const { payload, attributed } = deriveLandingStartPayloadFromQuery(query);
  if (attributed) return payload;

  if (!import.meta.client) return 'landing';
  try {
    const stored = window.localStorage?.getItem(ACQ_START_STORAGE_KEY);
    const normalized = normalizeStartToken(stored, 64);
    return normalized || 'landing';
  } catch {
    return 'landing';
  }
}

export function withLandingStartParam(urlRaw, startPayload = 'landing') {
  const raw = (urlRaw || '').toString().trim();
  if (!raw) return '';

  const payload = normalizeStartToken(startPayload, 64) || 'landing';

  try {
    const url = new URL(raw);
    url.searchParams.set('start', payload);
    return url.toString();
  } catch {
    const [basePart, hashPart] = raw.split('#', 2);
    const base = (basePart || '').toString();
    const hash = hashPart ? `#${hashPart}` : '';
    if (!base) return raw;

    if (/[?&]start=/.test(base)) {
      return `${base.replace(/([?&])start=[^&#]*/u, `$1start=${payload}`)}${hash}`;
    }

    const delimiter = base.includes('?') ? '&' : '?';
    return `${base}${delimiter}start=${payload}${hash}`;
  }
}

export function getPracticePathStartPayload(practicePath, landingPayload = 'landing') {
  const slug = normalizeStartToken(practicePath?.slug || '', 24);
  const base = slug || 'landing';
  const attributed = normalizeStartToken(landingPayload, 36);
  if (!attributed || attributed === 'landing') return base;
  return normalizeStartToken(`${base}_${attributed}`, 64) || base;
}

export function getPracticePathTelegramUrl(practicePath, landingPayload = 'landing') {
  if (!practicePath) return '';
  const direct = (practicePath.telegramUrl || '').toString().trim();
  return withLandingStartParam(direct, getPracticePathStartPayload(practicePath, landingPayload));
}
