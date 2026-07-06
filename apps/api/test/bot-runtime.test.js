import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPreparedUpdate,
  buildPersistentKeyboardState,
  normalizeTelegramUpdate,
  parseCallbackData,
  resolvePreparedRoute
} from '../src/bot-runtime/update-preparation.js';

test('prepare update parses callback data and routes assistant translation callbacks', () => {
  const prepared = buildPreparedUpdate({
    botKey: 'UK-DE',
    telegramUpdate: {
      callback_query: {
        id: 'cb-123',
        data: 'tr:456:010',
        from: { id: 42, is_bot: false, username: 'alice' },
        message: {
          message_id: 900,
          chat: { id: 42, type: 'private' },
          text: 'Assistant reply'
        }
      }
    }
  });

  assert.equal(prepared.bot_key, 'uk-de');
  assert.equal(prepared.route, 'callback.translate');
  assert.equal(prepared.intent.source, 'callback_query');
  assert.deepEqual(prepared.callback, {
    callback_id: 'cb-123',
    data: 'tr:456:010',
    group: 'tr',
    value: '456',
    payload: '456:010',
    tier: '010',
    user_id: 42
  });
});

test('persistent keyboard detects reply keyboard intents and keeps labels stable', () => {
  const update = {
    message: {
      message_id: 1001,
      text: '· 📚 A2',
      chat: { id: 42, type: 'private' },
      from: { id: 42, is_bot: false }
    }
  };
  const keyboard = buildPersistentKeyboardState(
    {
      level: 'a2',
      reply_mode: 'voice',
      onboarding_complete_at: '2026-03-11T08:00:00.000Z',
      topic_enabled: true,
      topic_pack_json: JSON.stringify({ title_base: 'Coffee chat' }),
      xp_total: 420,
      xp_level: 3
    },
    {
      keyboard_btn_topic_none: 'Free chat',
      keyboard_btn_voice_text: 'Text',
      keyboard_btn_voice_voice: 'Voice',
      keyboard_btn_xp_prefix: 'XP'
    },
    normalizeTelegramUpdate(update)
  );

  assert.equal(keyboard.enabled, true);
  assert.equal(keyboard.button_intent, 'level');
  assert.equal(keyboard.level_button_text, '· 📚 A2');
  assert.equal(keyboard.topic_button_text, '· 🧩 Coffee chat');
  assert.equal(keyboard.voice_button_text, '· 🎤 Voice');
  assert.equal(keyboard.xp_button_text, '· XP: 420 • L3');
});

test('prepare update routes reply keyboard before pending feedback', () => {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-de',
    telegramUpdate: {
      message: {
        message_id: 1002,
        text: '· 🎤 Voice',
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false }
      }
    },
    keyboardState: {
      reply_mode: 'voice',
      onboarding_complete_at: '2026-03-11T08:00:00.000Z'
    },
    locale: {
      keyboard_btn_voice_voice: 'Voice'
    },
    pendingFeedback: true
  });

  assert.equal(prepared.route, 'reply_keyboard.voice_toggle');
  assert.equal(prepared.guards.pending_feedback, true);
  assert.equal(prepared.keyboard.button_intent, 'voice');
});

test('prepare update routes non-command pending feedback text', () => {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-de',
    telegramUpdate: {
      message: {
        message_id: 1003,
        text: 'The feedback body',
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false }
      }
    },
    pendingFeedback: true
  });

  assert.equal(prepared.route, 'pending_feedback.text');
});

test('prepare update guards group chats before normal message routing', () => {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-de',
    telegramUpdate: {
      message: {
        message_id: 1004,
        text: 'hello',
        chat: { id: -100123, type: 'supergroup' },
        from: { id: 42, is_bot: false }
      }
    }
  });

  assert.equal(prepared.route, 'guard.private_only');
  assert.equal(prepared.guards.is_group, true);
});

test('callback parser returns null for empty callback data', () => {
  assert.equal(parseCallbackData({ data: '' }), null);
  assert.equal(resolvePreparedRoute({ updateInfo: { message: {}, sender: {} } }), 'message.unsupported');
});
