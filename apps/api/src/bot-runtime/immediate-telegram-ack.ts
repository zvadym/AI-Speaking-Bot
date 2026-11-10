import type { NormalizedTelegramUpdate } from './contracts.js';

const DEFAULT_TIMEOUT_MS = 500;

type AckInputKind = 'text' | 'voice';
type AckOutcome = 'succeeded' | 'timed_out' | 'failed';

interface ImmediateAckTelegramClient {
  callTelegramApi(
    botKey: string,
    method: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>;
}

export interface ImmediateAckEvent {
  botKey: string;
  inputKind: AckInputKind;
  outcome: AckOutcome;
  receivedToAckMs: number;
  telegramDurationMs: number;
  errorCode: string | null;
}

function elapsedMs(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function normalizedErrorCode(error: unknown): string {
  const value = error && typeof error === 'object'
    ? error as { code?: unknown; name?: unknown }
    : {};
  const raw = value.code || value.name || 'telegram_chat_action_failed';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, '_')
    .slice(0, 128) || 'telegram_chat_action_failed';
}

function defaultReportEvent(event: ImmediateAckEvent, eventName = 'telegram-immediate-ack'): void {
  const payload = {
    botKey: event.botKey,
    inputKind: event.inputKind,
    outcome: event.outcome,
    receivedToAckMs: event.receivedToAckMs,
    telegramDurationMs: event.telegramDurationMs,
    errorCode: event.errorCode
  };
  if (event.outcome === 'succeeded') {
    console.info(eventName, payload);
  } else {
    console.warn(eventName, payload);
  }
}

export function immediateAckInputKind(input: NormalizedTelegramUpdate): AckInputKind | null {
  if (
    input.updateType !== 'message' ||
    !input.isPrivate ||
    input.sender.isBot ||
    input.chatId === null ||
    !Number.isSafeInteger(input.chatId) ||
    input.chatId <= 0
  ) {
    return null;
  }
  if (input.message.hasVoice) return 'voice';
  return input.message.hasText ? 'text' : null;
}

export function startImmediateTelegramAck({
  telegramClient,
  enabledBotKeys,
  botKey,
  input,
  receivedAtMs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => performance.now(),
  reportEvent = defaultReportEvent
}: {
  telegramClient: ImmediateAckTelegramClient;
  enabledBotKeys: ReadonlySet<string>;
  botKey: string;
  input: NormalizedTelegramUpdate;
  receivedAtMs: number;
  timeoutMs?: number;
  now?: () => number;
  reportEvent?: (event: ImmediateAckEvent) => void;
}): boolean {
  if (!enabledBotKeys.has(botKey)) return false;
  return startTelegramTyping({
    telegramClient, botKey, input, receivedAtMs, timeoutMs, now, reportEvent
  });
}

// Worker handlers renew typing independently of webhook rollout flags.
// Neither an unavailable Telegram API nor a stuck client may delay the AI call.
export function startTelegramTyping({
  telegramClient,
  botKey,
  input,
  receivedAtMs = performance.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => performance.now(),
  reportEvent = (event: ImmediateAckEvent) => defaultReportEvent(event, 'telegram-typing')
}: {
  telegramClient: ImmediateAckTelegramClient;
  botKey: string;
  input: NormalizedTelegramUpdate;
  receivedAtMs?: number;
  timeoutMs?: number;
  now?: () => number;
  reportEvent?: (event: ImmediateAckEvent) => void;
}): boolean {
  const inputKind = immediateAckInputKind(input);
  if (!inputKind) return false;

  const controller = new AbortController();
  const telegramStartedAt = now();
  const reportQuietly = (event: ImmediateAckEvent): void => {
    try {
      reportEvent(event);
    } catch {
      // A best-effort UX signal must not fail durable webhook ingestion.
    }
  };
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('telegram_chat_action_timed_out'), {
        code: 'telegram_chat_action_timed_out'
      }));
    }, timeoutMs);
  });
  let telegramPromise: Promise<unknown>;
  try {
    telegramPromise = Promise.resolve(telegramClient.callTelegramApi(
      botKey,
      'sendChatAction',
      {
        chat_id: input.chatId,
        action: 'typing'
      },
      { signal: controller.signal }
    ));
  } catch (error) {
    telegramPromise = Promise.reject(error);
  }

  void Promise.race([telegramPromise, timeoutPromise])
    .then(() => {
      reportQuietly({
        botKey,
        inputKind,
        outcome: 'succeeded',
        receivedToAckMs: elapsedMs(now, receivedAtMs),
        telegramDurationMs: elapsedMs(now, telegramStartedAt),
        errorCode: null
      });
    })
    .catch((error) => {
      const timedOut = controller.signal.aborted ||
        normalizedErrorCode(error) === 'telegram_chat_action_timed_out';
      reportQuietly({
        botKey,
        inputKind,
        outcome: timedOut ? 'timed_out' : 'failed',
        receivedToAckMs: elapsedMs(now, receivedAtMs),
        telegramDurationMs: elapsedMs(now, telegramStartedAt),
        errorCode: timedOut ? 'telegram_chat_action_timed_out' : normalizedErrorCode(error)
      });
    })
    .finally(() => {
      if (timeout) clearTimeout(timeout);
    });

  return true;
}
