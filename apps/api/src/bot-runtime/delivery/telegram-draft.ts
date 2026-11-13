import type { PreparedUpdate } from '../contracts.js';

interface DraftClient {
  callTelegramApi(botKey: string, method: string, body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

// Drafts are disposable previews. Only the existing durable sendMessage path
// commits a reply. At most one request and one coalesced update are pending.
export function createTelegramDraft(
  telegramClient: DraftClient,
  update: PreparedUpdate,
  { intervalMs = 800, timeoutMs = 500 } = {}
) {
  let stopped = false;
  let disabled = false;
  let latest = '';
  let sent = '';
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let lastStarted = -Infinity;
  const draftId = (update.updateId % 2147483646) + 1;
  const schedule = () => {
    if (stopped || disabled || inFlight || timer || !latest || latest === sent) return;
    const delay = Math.max(0, intervalMs - (Date.now() - lastStarted));
    if (delay) {
      timer = setTimeout(() => { timer = undefined; schedule(); }, delay);
      return;
    }
    const text = latest;
    lastStarted = Date.now();
    controller = new AbortController();
    const signal = controller.signal;
    inFlight = (async () => {
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(() => telegramClient.callTelegramApi(update.botKey, 'sendMessageDraft', {
            chat_id: update.input.chatId, draft_id: draftId, text
          }, { signal })),
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              controller?.abort();
              reject(new Error('draft_timeout'));
            }, timeoutMs);
          })
        ]);
        sent = text;
      } catch {
        // Includes unsupported clients, 429 and timeouts: fall back to final text.
        disabled = true;
      } finally {
        clearTimeout(timeout);
      }
    })().finally(() => { inFlight = null; controller = null; schedule(); });
  };
  return {
    update(text: string) {
      if (stopped || disabled || !update.input.isPrivate) return;
      latest = text.slice(0, 4096).replace(/[\uD800-\uDBFF]$/u, '');
      schedule();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      // Bounded drain prevents a pending preview from being sent after final text.
      await inFlight;
    }
  };
}
