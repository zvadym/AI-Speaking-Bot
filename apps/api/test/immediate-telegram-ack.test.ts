import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImmediateAckEnabledBotKeys } from '../src/bot-runtime/delivery/immediate-ack-config.js';
import {
  immediateAckInputKind,
  startImmediateTelegramAck,
  type ImmediateAckEvent
} from '../src/bot-runtime/delivery/immediate-telegram-ack.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { callbackUpdate, messageUpdate, voice } from './fixtures/telegram-updates.js';

test('immediate acknowledgement config supports disabled, canary, and all-bot rollout', () => {
  const known = ['uk-de', 'uk-en'];
  assert.deepEqual([...parseImmediateAckEnabledBotKeys('', known)], []);
  assert.deepEqual(
    [...parseImmediateAckEnabledBotKeys('UK-DE, uk-de', known)],
    ['uk-de']
  );
  assert.deepEqual([...parseImmediateAckEnabledBotKeys('*', known)], known);
  assert.throws(
    () => parseImmediateAckEnabledBotKeys('missing-bot', known),
    /unknown_immediate_ack_bot_key:missing-bot/
  );
});

test('only private user text and voice messages are eligible for immediate acknowledgement', () => {
  assert.equal(
    immediateAckInputKind(normalizeTelegramUpdate(messageUpdate({ text: 'Hello' }))),
    'text'
  );
  assert.equal(
    immediateAckInputKind(normalizeTelegramUpdate(messageUpdate({ text: '/stats' }))),
    'text'
  );
  assert.equal(
    immediateAckInputKind(normalizeTelegramUpdate(messageUpdate({ voice }))),
    'voice'
  );
  assert.equal(immediateAckInputKind(normalizeTelegramUpdate(messageUpdate({
    text: 'Hello',
    chatId: -10042,
    chatType: 'supergroup'
  }))), null);
  assert.equal(immediateAckInputKind(normalizeTelegramUpdate(messageUpdate({
    text: 'Hello',
    senderIsBot: true
  }))), null);
  assert.equal(immediateAckInputKind(normalizeTelegramUpdate(messageUpdate({
    extraMessage: { pinned_message: { message_id: 1 } }
  }))), null);
  assert.equal(immediateAckInputKind(normalizeTelegramUpdate(callbackUpdate({
    data: 'tr:1:000'
  }))), null);
});

test('immediate acknowledgement sends typing action and reports privacy-safe timing', async () => {
  const calls: Array<{
    botKey: string;
    method: string;
    body: Record<string, unknown>;
    signal: AbortSignal | undefined;
  }> = [];
  let clock = 100;
  const eventPromise = new Promise<ImmediateAckEvent>((resolve) => {
    const started = startImmediateTelegramAck({
      telegramClient: {
        async callTelegramApi(botKey, method, body, options) {
          calls.push({ botKey, method, body, signal: options?.signal });
          clock = 125;
          return { ok: true };
        }
      },
      enabledBotKeys: new Set(['uk-de']),
      botKey: 'uk-de',
      input: normalizeTelegramUpdate(messageUpdate({ text: '/stats' })),
      receivedAtMs: 90,
      now: () => clock,
      reportEvent: resolve
    });
    assert.equal(started, true);
  });

  const event = await eventPromise;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].botKey, 'uk-de');
  assert.equal(calls[0].method, 'sendChatAction');
  assert.deepEqual(calls[0].body, { chat_id: 42, action: 'typing' });
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.deepEqual(event, {
    botKey: 'uk-de',
    inputKind: 'text',
    outcome: 'succeeded',
    receivedToAckMs: 35,
    telegramDurationMs: 25,
    errorCode: null
  });
});

test('disabled acknowledgement does not call Telegram', () => {
  let calls = 0;
  const started = startImmediateTelegramAck({
    telegramClient: {
      async callTelegramApi() {
        calls += 1;
        return { ok: true };
      }
    },
    enabledBotKeys: new Set(),
    botKey: 'uk-de',
    input: normalizeTelegramUpdate(messageUpdate({ text: 'Hello' })),
    receivedAtMs: performance.now()
  });
  assert.equal(started, false);
  assert.equal(calls, 0);
});

test('Telegram timeout is contained and reported without awaiting the underlying client', async () => {
  let signal: AbortSignal | undefined;
  const eventPromise = new Promise<ImmediateAckEvent>((resolve) => {
    const started = startImmediateTelegramAck({
      telegramClient: {
        callTelegramApi(_botKey, _method, _body, options) {
          signal = options?.signal;
          return new Promise(() => {});
        }
      },
      enabledBotKeys: new Set(['uk-de']),
      botKey: 'uk-de',
      input: normalizeTelegramUpdate(messageUpdate({ voice })),
      receivedAtMs: performance.now(),
      timeoutMs: 5,
      reportEvent: resolve
    });
    assert.equal(started, true);
  });

  const event = await eventPromise;
  assert.equal(signal?.aborted, true);
  assert.equal(event.inputKind, 'voice');
  assert.equal(event.outcome, 'timed_out');
  assert.equal(event.errorCode, 'telegram_chat_action_timed_out');
});

test('synchronous Telegram adapter failures remain best-effort', async () => {
  const eventPromise = new Promise<ImmediateAckEvent>((resolve) => {
    assert.equal(startImmediateTelegramAck({
      telegramClient: {
        callTelegramApi() {
          throw Object.assign(new Error('unavailable'), { code: 'telegram_unavailable' });
        }
      },
      enabledBotKeys: new Set(['uk-de']),
      botKey: 'uk-de',
      input: normalizeTelegramUpdate(messageUpdate({ text: 'Hello' })),
      receivedAtMs: performance.now(),
      reportEvent: resolve
    }), true);
  });

  const event = await eventPromise;
  assert.equal(event.outcome, 'failed');
  assert.equal(event.errorCode, 'telegram_unavailable');
});
