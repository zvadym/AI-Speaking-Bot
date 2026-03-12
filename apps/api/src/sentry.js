import * as SentrySdk from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { env } from './env.js';

let initialized = false;
let enabled = false;
let processTag = 'api';
const testCapturedEvents = [];

function isTestMode() {
  return (process.env.SENTRY_TEST_MODE || '').toString().trim() === '1';
}

function isServerError(error) {
  const rawStatus = error?.status ?? error?.statusCode;
  if (rawStatus === undefined || rawStatus === null || rawStatus === '') {
    return true;
  }
  const status = Number(rawStatus);
  return !Number.isFinite(status) || status >= 500;
}

function scrubHeaders(headers = {}) {
  const nextHeaders = { ...headers };
  delete nextHeaders.authorization;
  delete nextHeaders.cookie;
  delete nextHeaders['stripe-signature'];
  return nextHeaders;
}

function buildTransport() {
  if (!isTestMode()) return undefined;

  return () => ({
    send: async () => ({ statusCode: 200 }),
    flush: async () => true
  });
}

export function shouldCaptureError(error) {
  return isServerError(error);
}

export function ensureSentryInitialized({ processName = 'api' } = {}) {
  processTag = processName || processTag;
  if (initialized) {
    if (enabled) {
      SentrySdk.setTag('process', processTag);
    }
    return enabled;
  }

  initialized = true;
  if (!env.sentryDsn) {
    return false;
  }

  const integrations = [];
  if (env.sentryProfileSessionSampleRate > 0) {
    integrations.push(nodeProfilingIntegration());
  }

  SentrySdk.init({
    dsn: env.sentryDsn,
    environment: env.sentryEnvironment || process.env.NODE_ENV || 'development',
    release: env.sentryRelease || undefined,
    tracesSampleRate: env.sentryTracesSampleRate,
    profileSessionSampleRate: env.sentryProfileSessionSampleRate,
    sendDefaultPii: false,
    integrations,
    transport: buildTransport(),
    disableInstrumentationWarnings: isTestMode(),
    beforeSend(event, hint) {
      const error = hint?.originalException;
      if (!shouldCaptureError(error)) {
        return null;
      }

      if (event.request?.headers) {
        event.request.headers = scrubHeaders(event.request.headers);
      }

      event.tags = {
        ...event.tags,
        process: processTag
      };

      if (isTestMode()) {
        testCapturedEvents.push(event);
      }

      return event;
    }
  });

  enabled = true;
  SentrySdk.setTag('process', processTag);
  return true;
}

export function setupExpressErrorHandler(app) {
  if (!enabled) return;
  SentrySdk.setupExpressErrorHandler(app);
}

export function setSentryUser(user) {
  if (!enabled) return;
  SentrySdk.setUser(user);
}

export function captureException(error, context = {}) {
  if (!enabled || !shouldCaptureError(error)) {
    return null;
  }

  const { tags = {}, extra = {}, level } = context;
  if (isTestMode()) {
    testCapturedEvents.push({
      error: error?.message || String(error),
      tags: { ...tags }
    });
  }
  return SentrySdk.withScope((scope) => {
    for (const [key, value] of Object.entries(tags)) {
      if (value !== undefined && value !== null && value !== '') {
        scope.setTag(key, String(value));
      }
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        scope.setExtra(key, value);
      }
    }
    if (level) {
      scope.setLevel(level);
    }
    return SentrySdk.captureException(error);
  });
}

export async function flushSentry(timeout = 2000) {
  if (!enabled) return true;
  return SentrySdk.flush(timeout);
}

export function __resetCapturedEventsForTests() {
  testCapturedEvents.length = 0;
}

export function __getCapturedEventsForTests() {
  return [...testCapturedEvents];
}
