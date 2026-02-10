const DEFAULT_POSTHOG_HOST = 'https://app.posthog.com';

function getPosthogKey() {
  return (import.meta.env.VITE_POSTHOG_KEY || '').toString().trim();
}

function getPosthogHost() {
  const raw = (import.meta.env.VITE_POSTHOG_HOST || DEFAULT_POSTHOG_HOST).toString().trim();
  return raw.replace(/\/+$/, '') || DEFAULT_POSTHOG_HOST;
}

function getOrCreateSessionId() {
  try {
    const existing = window.sessionStorage.getItem('miniapp_session_id');
    if (existing) return existing;
    const next = (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`).toString();
    window.sessionStorage.setItem('miniapp_session_id', next);
    return next;
  } catch {
    return (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`).toString();
  }
}

function ensurePosthogSnippetLoaded(host) {
  if (typeof window === 'undefined') return null;

  window.posthog = window.posthog || [];

  if (window.posthog.__ph_loaded) return window.posthog;
  window.posthog.__ph_loaded = true;

  // Minimal PostHog loader (based on the official snippet pattern).
  const posthog = window.posthog;
  posthog._i = posthog._i || [];
  posthog.init = function (token, config, name) {
    const instanceName = name || 'posthog';
    const target = posthog[instanceName] = posthog[instanceName] || [];
    target.people = target.people || [];
    target.toString = function () {
      let base = 'posthog';
      if (instanceName !== 'posthog') base += `.${instanceName}`;
      if (!config || !config.disable_capturing) base += ' (stub)';
      return base;
    };
    target._i = target._i || [];
    target._i.push([token, config, instanceName]);
    posthog._i.push([token, config, instanceName]);
  };

  const methods = [
    'capture',
    'identify',
    'alias',
    'people.set',
    'people.set_once',
    'people.unset',
    'people.increment',
    'people.append',
    'people.remove',
    'people.delete_user',
    'set_config',
    'register',
    'register_once',
    'unregister',
    'reset',
    'group',
    'startSessionRecording',
    'stopSessionRecording',
    'feature_flag',
    'isFeatureEnabled',
    'onFeatureFlags',
    'getFeatureFlag',
    'getFeatureFlagPayload',
    'reloadFeatureFlags',
    'opt_in_capturing',
    'opt_out_capturing',
    'has_opted_in_capturing',
    'has_opted_out_capturing',
    'debug'
  ];

  function makeStub(method) {
    return function () {
      // eslint-disable-next-line prefer-rest-params
      posthog.push([method].concat([].slice.call(arguments, 0)));
    };
  }

  methods.forEach((method) => {
    const parts = method.split('.');
    if (parts.length === 1) {
      posthog[method] = makeStub(method);
      return;
    }
    const [root, leaf] = parts;
    posthog[root] = posthog[root] || {};
    posthog[root][leaf] = makeStub(method);
  });

  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.async = true;
  script.src = `${host}/static/array.js`;
  const first = document.getElementsByTagName('script')[0];
  if (first?.parentNode) first.parentNode.insertBefore(script, first);
  else document.head.appendChild(script);

  return posthog;
}

let inited = false;
let sessionId = null;
let lastScreenKey = '';

export function initAnalytics() {
  const apiKey = getPosthogKey();
  if (!apiKey) return;
  if (inited) return;
  inited = true;

  sessionId = getOrCreateSessionId();
  const host = getPosthogHost();
  const posthog = ensurePosthogSnippetLoaded(host);
  if (!posthog) return;

  posthog.init(apiKey, {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true
  });

  posthog.register({ app: 'miniapp', session_id: sessionId });
  if (import.meta.env.DEV) posthog.debug(false);
}

export function identifyUser(user) {
  if (!inited || !user) return;
  const posthog = window.posthog;
  if (!posthog?.identify) return;

  const distinctId = (user.chat_id ?? user.chatId ?? user.id ?? '').toString();
  if (!distinctId) return;

  posthog.identify(distinctId, {
    plan_tier: (user.plan_tier ?? user.planTier ?? 'free').toString(),
    bot_key: (user.bot_key ?? user.botKey ?? '').toString(),
    target_lang: (user.target_lang ?? user.targetLang ?? '').toString(),
    level: (user.level ?? '').toString()
  });
}

export function track(event, props = {}) {
  if (!inited) return;
  const posthog = window.posthog;
  if (!posthog?.capture) return;
  posthog.capture(event, props);
}

export function trackScreen({ path, screen }) {
  const key = `${String(path || '')}|${String(screen || '')}`;
  if (key === lastScreenKey) return;
  lastScreenKey = key;
  track('screen_view', { path: String(path || ''), screen: String(screen || '') });
}

export function getSessionId() {
  return sessionId;
}
