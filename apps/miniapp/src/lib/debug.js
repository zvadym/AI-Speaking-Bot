const STORAGE_KEY = 'miniapp_debug_logs_v1';
const FLAG_KEY = 'miniapp_debug_enabled_v1';
const MAX_LOGS = 200;
const listeners = new Set();

function readFlagFromStorage() {
  try {
    return window.localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function isDebugEnabled() {
  const envEnabled = (import.meta.env.VITE_DEBUG_UI || '').toString().toLowerCase() === 'true';
  if (envEnabled) return true;

  try {
    const params = new URLSearchParams(window.location.search);
    const queryFlag = (params.get('debug') || '').toLowerCase();
    if (queryFlag === '1' || queryFlag === 'true') return true;
  } catch {
    // ignore
  }

  return readFlagFromStorage();
}

export function setDebugEnabled(enabled) {
  try {
    if (enabled) window.localStorage.setItem(FLAG_KEY, '1');
    else window.localStorage.removeItem(FLAG_KEY);
  } catch {
    // ignore
  }
}

function safeReadLogs() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readDebugLogs() {
  return safeReadLogs();
}

function persistLogs(logs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // ignore
  }
}

function notify(logs) {
  for (const listener of listeners) {
    try {
      listener(logs);
    } catch {
      // ignore
    }
  }
}

function normalizeDetails(details) {
  if (!details) return {};
  if (typeof details === 'object') {
    return details;
  }
  return { value: String(details) };
}

export function addDebugLog(event, details) {
  if (!isDebugEnabled()) return;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    event: String(event || 'event'),
    details: normalizeDetails(details)
  };
  const next = [...safeReadLogs(), entry].slice(-MAX_LOGS);
  persistLogs(next);
  notify(next);
}

export function clearDebugLogs() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  notify([]);
}

export function subscribeDebugLogs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
