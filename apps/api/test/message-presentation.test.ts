import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { Pool } from 'pg';
import { createTelegramClient } from '../src/shared/telegram-delivery.js';
import { createMessagePresentationService, type PresentationClient, type PresentationKey } from '../src/bot-runtime/message-presentation.js';
import { conversationReplyMarkup } from '../src/bot-runtime/handlers/conversation.js';
import { createSupportCallbackHandlers } from '../src/bot-runtime/handlers/support-callbacks.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import type { BotAiClient } from '../src/bot-runtime/bot-ai.js';
import type { runBotUpdateEffect } from '../src/bot-runtime/effect-repository.js';
import { callbackUpdate } from './fixtures/telegram-updates.js';

test('rich voice edit uploads multipart to the existing message and preserves its keyboard', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const telegram = createTelegramClient({
    env: { defaultBotKey: 'uk-en', telegramBotTokensByBotKey: { 'uk-en': 'test-token' } },
    fetchImpl: (async (url, options) => {
      requests.push({ url: String(url), body: options?.body });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 44 } }), { status: 200 });
    }) as typeof fetch
  });
  const rich = { blocks: [{ type: 'paragraph', text: 'Hello' },
    { type: 'voice_note', voice_note: { type: 'voice_note', media: 'attach://voice' } }] };
  const markup = conversationReplyMarkup(3, {});
  await telegram.editTelegramMessageRich(42, 44, rich, {
    botKey: 'uk-en', replyMarkup: markup, audio: Buffer.from('ogg')
  });
  assert.ok(requests[0].url.endsWith('/editMessageText'));
  const form = requests[0].body as FormData;
  assert.equal(form.get('message_id'), '44');
  assert.deepEqual(JSON.parse(String(form.get('rich_message'))), rich);
  assert.deepEqual(JSON.parse(String(form.get('reply_markup'))), markup);
  assert.equal(await (form.get('voice') as Blob).text(), 'ogg');
  await telegram.editTelegramMessageReplyMarkup(42, 44, markup, { botKey: 'uk-en' });
  assert.ok(requests[1].url.endsWith('/editMessageReplyMarkup'));
  assert.equal(JSON.parse(String(requests[1].body)).text, undefined);
});

const databaseUrl = process.env.BOT_RUNTIME_TEST_DATABASE_URL;
const skip = databaseUrl ? false : 'BOT_RUNTIME_TEST_DATABASE_URL is not configured';

async function fixture(telegram: PresentationClient) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const result = await pool.query(`INSERT INTO messages (chat_id, bot_key, role, content)
    VALUES (42, 'uk-en', 'assistant', 'Hello there!') RETURNING id`);
  const key: PresentationKey = { messageId: Number(result.rows[0].id), chatId: 42, botKey: 'uk-en', telegramMessageId: 44 };
  const service = createMessagePresentationService(pool, telegram);
  return { pool, key, service, async cleanup() {
    await pool.query('DELETE FROM messages WHERE id = $1', [key.messageId]);
    await pool.end();
  } };
}

test('voice attachment and stale translation/hints/vocabulary callbacks preserve each other under concurrency', { skip }, async () => {
  let active = 0;
  let maxActive = 0;
  const richEdits: Array<{ blocks: Array<Record<string, any>> }> = [];
  const markups: object[] = [];
  let uploadStarted!: () => void;
  const started = new Promise<void>((resolve) => { uploadStarted = resolve; });
  const telegram: PresentationClient = {
    async editTelegramMessageRich(_chat, id, message, options) {
      assert.equal(id, 44);
      maxActive = Math.max(maxActive, ++active);
      uploadStarted();
      await new Promise((resolve) => setTimeout(resolve, 15));
      richEdits.push(message as never); markups.push(options.replyMarkup);
      active--;
      return { rich_message: { blocks: [{ type: 'voice_note', voice_note: { file_id: 'saved-voice' } }] } };
    },
    async editTelegramMessageText() { throw new Error('must preserve voice in a rich edit'); },
    async editTelegramMessageReplyMarkup(_chat, _id, markup) { markups.push(markup); return true; }
  };
  const f = await fixture(telegram);
  try {
    await f.service.initialize(f.key, 'Hello there!', conversationReplyMarkup(f.key.messageId, {}));
    const effects: typeof runBotUpdateEffect = async (_pool, { stepKey }) => ({ duplicate: false, result: (
      stepKey.includes('translate') ? { translation: 'Привіт!' } : stepKey.includes('hints')
        ? { hints: { question: 'How are you?', useful_phrases: [] } } : { items: [] }
    ) as never });
    const deliveries: string[] = [];
    const handlers = createSupportCallbackHandlers({
      pool: f.pool as Pool, getBotLocale: () => ({}), presentation: f.service,
      ai: {} as BotAiClient, effectRunner: effects,
      telegramClient: {
        ...telegram,
        async sendTelegramTextMessage() { throw new Error('unexpected direct send'); },
        async answerTelegramCallbackQuery() {}
      },
      textDeliverer: async ({ stepKey }) => { deliveries.push(stepKey); return { status: 'delivered', telegramMessageId: 99 }; }
    });
    const callback = async (group: string, updateId: number) => {
      const raw = callbackUpdate({ data: `${group}:${f.key.messageId}:000`, updateId }) as any;
      raw.callback_query.message = { message_id: 44, chat: { id: 42, type: 'private' },
        rich_message: { blocks: [{ type: 'paragraph', text: 'stale snapshot' }] } };
      const update = buildPreparedUpdate({ botKey: 'uk-en', input: normalizeTelegramUpdate(raw) });
      assert.equal(update.input.callbackQuery?.messageText, '');
      await handlers.find((handler) => handler.route === update.route)!.execute(update as never);
    };
    // Hold the first upload in flight while all three callbacks arrive with stale bits.
    const upload = f.service.mutate(f.key, { audio: Buffer.from('ogg'), ensureVoice: true });
    await started;
    await Promise.all([upload, callback('tr', 10001), callback('hint', 10002), callback('voc', 10003)]);
    assert.equal(maxActive, 1);
    assert.equal(richEdits.length, 2); // Upload and translation; hints/vocab edit only markup.
    assert.equal(richEdits.at(-1)!.blocks[0].text, 'Hello there!\n\nTranslation:\nПривіт!');
    assert.equal(richEdits.at(-1)!.blocks[1].voice_note.media, 'saved-voice');
    const state = (await f.pool.query('SELECT state, pending_audio FROM bot_message_presentations WHERE message_id=$1', [f.key.messageId])).rows[0];
    assert.equal(state.state.voiceFileId, 'saved-voice');
    assert.equal(state.pending_audio, null);
    assert.ok(state.state.replyMarkup.inline_keyboard.flat().every((button: any) => button.callback_data === 'busy:1'));
    assert.equal(deliveries.length, 2);
    assert.deepEqual(markups.at(-1), state.state.replyMarkup);
  } finally { await f.cleanup(); }
});

test('ambiguous voice edit retains audio durably and a later translation cannot remove it', { skip }, async () => {
  let attempts = 0;
  let lastRich: any;
  const f = await fixture({
    async editTelegramMessageRich(_chat, _id, rich, options) {
      lastRich = rich;
      assert.equal(options.audio?.toString(), 'ogg');
      if (++attempts === 1) throw new Error('network timeout after upload');
      return { rich_message: { blocks: [{ type: 'voice_note', voice_note: { file_id: 'recovered' } }] } };
    },
    async editTelegramMessageText() { throw new Error('audio must not be removed'); },
    async editTelegramMessageReplyMarkup() { return true; }
  });
  try {
    await f.service.initialize(f.key, 'Hello there!', conversationReplyMarkup(f.key.messageId, {}));
    await assert.rejects(f.service.mutate(f.key, { audio: Buffer.from('ogg'), ensureVoice: true }), /telegram_delivery_timeout/);
    assert.equal(await f.service.hasVoice(f.key), true);
    await f.service.mutate(f.key, { translation: { text: 'Привіт!', header: 'Translation:' }, usedAction: 'tr' });
    assert.equal(lastRich.blocks[1].voice_note.media, 'attach://voice');
    assert.match(lastRich.blocks[0].text, /Привіт/);
    await f.service.mutate(f.key, { ensureVoice: true });
    assert.equal(attempts, 2);
    assert.equal(await f.service.mutate({ ...f.key, chatId: 123 }, { usedAction: 'hint' }), false);
  } finally { await f.cleanup(); }
});

test('callback initialization racing the first delivery preserves its edits and uses the owning message', { skip }, async () => {
  let text = '';
  let rich: any;
  const f = await fixture({
    async editTelegramMessageRich(_chat, _id, value) {
      rich = value;
      return { rich_message: { blocks: [{ type: 'voice_note', voice_note: { file_id: 'late-audio' } }] } };
    },
    async editTelegramMessageText(_chat, _id, value) { text = value; return true; },
    async editTelegramMessageReplyMarkup() { return true; }
  });
  try {
    await f.service.initialize(f.key, '', conversationReplyMarkup(f.key.messageId, {}));
    await f.service.mutate(f.key, { translation: { text: 'Привіт', header: 'Translation:' } });
    await f.service.initialize(f.key, 'Hello there!', conversationReplyMarkup(f.key.messageId, {}));
    assert.equal(text, 'Hello there!\n\nTranslation:\nПривіт');
    const state = (await f.pool.query('SELECT state FROM bot_message_presentations WHERE message_id=$1', [f.key.messageId])).rows[0].state;
    assert.equal(state.translation.text, 'Привіт');
    await f.service.mutate(f.key, { audio: Buffer.from('ogg'), ensureVoice: true });
    assert.equal(rich.blocks[0].text, text);
    assert.equal(rich.blocks[1].voice_note.media, 'attach://voice');
  } finally { await f.cleanup(); }
});
