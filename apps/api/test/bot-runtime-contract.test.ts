import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BotRuntimeInputError,
  PREPARED_UPDATE_CONTRACT_VERSION,
  ROUTES,
  type KeyboardStateRow,
  type PrepareUpdateContext,
  type Route
} from '../src/bot-runtime/contracts.js';
import { buildPersistentKeyboardState } from '../src/bot-runtime/keyboard-state.js';
import { prepareBotUpdate } from '../src/bot-runtime/prepare-update-service.js';
import {
  normalizeTelegramUpdate,
  parseCallbackData,
  parseCommand
} from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { callbackUpdate, messageUpdate, voice } from './fixtures/telegram-updates.js';

type RouteFixture = {
  name: string;
  route: Route;
  update: Record<string, unknown>;
  keyboardState?: KeyboardStateRow;
  pendingFeedback?: boolean;
};

function prepareFixture(fixture: RouteFixture) {
  return buildPreparedUpdate({
    botKey: 'uk-de',
    input: normalizeTelegramUpdate(fixture.update),
    keyboardState: fixture.keyboardState,
    pendingFeedback: fixture.pendingFeedback,
    locale: {
      keyboard_btn_voice_text: 'Text',
      keyboard_btn_voice_voice: 'Voice',
      keyboard_btn_xp_prefix: 'XP'
    }
  });
}

const callbackFixtures: RouteFixture[] = [
  ['busy', 'callback.busy'],
  ['idiom_more', 'callback.idiom_more'],
  ['trv', 'callback.transcript_translate'],
  ['tr', 'callback.translate'],
  ['hint', 'callback.hints'],
  ['voc', 'callback.vocab'],
  ['lang', 'callback.lang'],
  ['level', 'callback.level'],
  ['reply', 'callback.reply'],
  ['onb', 'callback.onboarding'],
  ['settings', 'callback.settings'],
  ['unknown_group', 'callback.unknown']
].map(([group, route], index) => ({
  name: `callback ${group}`,
  route: route as Route,
  update: callbackUpdate({ updateId: 2000 + index, data: `${group}:value:pro` })
}));

const routeFixtures: RouteFixture[] = [
  { name: 'settings command', route: 'command.settings', update: messageUpdate({text:'/settings'}) },
  {
    name: 'pinned service update',
    route: 'ignore',
    update: messageUpdate({ updateId: 1001, extraMessage: { pinned_message: { message_id: 1 } } })
  },
  {
    name: 'group message',
    route: 'guard.private_only',
    update: messageUpdate({ updateId: 1002, text: 'hello', chatId: -10042, chatType: 'supergroup' })
  },
  {
    name: 'bot sender',
    route: 'guard.bot_sender',
    update: messageUpdate({ updateId: 1003, text: 'hello', senderIsBot: true })
  },
  ...callbackFixtures,
  {
    name: 'start command',
    route: 'command.start',
    update: messageUpdate({ updateId: 1101, text: '/start source_1' })
  },
  {
    name: 'voice command',
    route: 'command.voice',
    update: messageUpdate({ updateId: 1102, text: '/voice' })
  },
  {
    name: 'language command',
    route: 'command.lang',
    update: messageUpdate({ updateId: 1103, text: '/lang' })
  },
  {
    name: 'level command',
    route: 'command.level',
    update: messageUpdate({ updateId: 1104, text: '/level' })
  },
  {
    name: 'stats command',
    route: 'command.stats',
    update: messageUpdate({ updateId: 1105, text: '/stats' })
  },
  {
    name: 'feedback command with body',
    route: 'command.feedback',
    update: messageUpdate({ updateId: 1108, text: '/feedback The feedback body' })
  },
  {
    name: 'unknown command',
    route: 'command.unknown',
    update: messageUpdate({ updateId: 1109, text: '/not-a-command' })
  },
  {
    name: 'reply keyboard voice toggle',
    route: 'reply_keyboard.voice_toggle',
    update: messageUpdate({ updateId: 1201, text: '· 🎤 Voice' }),
    keyboardState: {
      reply_mode: 'voice',
      onboarding_complete_at: '2026-03-11T08:00:00.000Z'
    }
  },
  {
    name: 'pending feedback voice',
    route: 'pending_feedback.voice',
    update: messageUpdate({ updateId: 1301, voice }),
    pendingFeedback: true
  },
  {
    name: 'pending feedback text',
    route: 'pending_feedback.text',
    update: messageUpdate({ updateId: 1302, text: 'Feedback text' }),
    pendingFeedback: true
  },
  {
    name: 'pending feedback unsupported',
    route: 'pending_feedback.unsupported',
    update: messageUpdate({ updateId: 1303, extraMessage: { photo: [{ file_id: 'photo-1' }] } }),
    pendingFeedback: true
  },
  {
    name: 'voice message',
    route: 'message.voice',
    update: messageUpdate({ updateId: 1401, voice })
  },
  {
    name: 'text message',
    route: 'message.text',
    update: messageUpdate({ updateId: 1402, text: 'Practice text' })
  },
  {
    name: 'unsupported message',
    route: 'message.unsupported',
    update: messageUpdate({ updateId: 1403, extraMessage: { photo: [{ file_id: 'photo-1' }] } })
  }
];

test('route fixture matrix covers every current route exactly once; retired commands stay parser-only', () => {
  assert.deepEqual(
    routeFixtures.map((fixture) => fixture.route).sort(),
    ROUTES.filter((route) => route !== 'command.xp' && route !== 'command.progress').sort()
  );
});

for (const fixture of routeFixtures) {
  test(`prepare update routes ${fixture.name}`, () => {
    const prepared = prepareFixture(fixture);
    assert.equal(prepared.route, fixture.route);
    assert.equal(prepared.contractVersion, PREPARED_UPDATE_CONTRACT_VERSION);
    assert.equal(prepared.decisionId, `v1:uk-de:${prepared.updateId}`);
  });
}

test('Contract v1 is camelCase and excludes the raw Telegram update', () => {
  const prepared = prepareFixture({
    name: 'callback contract',
    route: 'callback.translate',
    update: callbackUpdate({ updateId: 2500, data: 'tr:456:pro' })
  });

  assert.deepEqual(Object.keys(prepared), [
    'contractVersion',
    'decisionId',
    'botKey',
    'updateId',
    'route',
    'input',
    'routingFacts',
    'context'
  ]);
  assert.equal(prepared.input.updateId, 2500);
  assert.equal(prepared.input.callbackQuery?.data, 'tr:456:pro');
  assert.equal(prepared.input.callbackQuery?.messageText, 'Assistant reply');
  assert.equal(prepared.routingFacts.callback?.payload, '456:pro');
  assert.equal('update' in prepared.input, false);

  const assertCamelCaseKeys = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(assertCamelCaseKeys);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(key.includes('_'), false, `Expected camelCase key, received ${key}`);
      assertCamelCaseKeys(child);
    }
  };
  assertCamelCaseKeys(prepared);
});

test('routing precedence is guard, callback, command, keyboard, pending feedback, then message', () => {
  const pinnedGroupBot = prepareFixture({
    name: 'pinned group bot update',
    route: 'ignore',
    update: messageUpdate({
      updateId: 2598,
      chatId: -10042,
      chatType: 'group',
      senderIsBot: true,
      extraMessage: { pinned_message: { message_id: 1 } }
    })
  });
  assert.equal(pinnedGroupBot.route, 'ignore');

  const groupBot = prepareFixture({
    name: 'group bot update',
    route: 'guard.private_only',
    update: messageUpdate({
      updateId: 2599,
      text: 'hello',
      chatId: -10042,
      chatType: 'group',
      senderIsBot: true
    })
  });
  assert.equal(groupBot.route, 'guard.private_only');

  const groupCallback = prepareFixture({
    name: 'group callback',
    route: 'guard.private_only',
    update: callbackUpdate({ data: 'tr:1', chatId: -10042, chatType: 'group' })
  });
  assert.equal(groupCallback.route, 'guard.private_only');

  const botCallback = prepareFixture({
    name: 'bot callback',
    route: 'guard.bot_sender',
    update: callbackUpdate({ data: 'tr:1', senderIsBot: true })
  });
  assert.equal(botCallback.route, 'guard.bot_sender');

  const pendingCallback = prepareFixture({
    name: 'pending callback',
    route: 'callback.translate',
    update: callbackUpdate({ data: 'tr:1' }),
    pendingFeedback: true
  });
  assert.equal(pendingCallback.route, 'callback.translate');

  const pendingCommand = prepareFixture({
    name: 'pending command',
    route: 'command.stats',
    update: messageUpdate({ text: '/stats' }),
    pendingFeedback: true
  });
  assert.equal(pendingCommand.route, 'command.stats');

  const pendingKeyboard = prepareFixture({
    name: 'pending keyboard',
    route: 'reply_keyboard.voice_toggle',
    update: messageUpdate({ text: '· 🎤 Voice' }),
    keyboardState: {
      reply_mode: 'voice',
      onboarding_complete_at: '2026-03-11T08:00:00.000Z'
    },
    pendingFeedback: true
  });
  assert.equal(pendingKeyboard.route, 'reply_keyboard.voice_toggle');
});

test('all known non-private chat types use the private-only guard', () => {
  for (const chatType of ['group', 'supergroup', 'channel']) {
    const prepared = prepareFixture({
      name: `${chatType} message`,
      route: 'guard.private_only',
      update: messageUpdate({
        updateId: 2800 + chatType.length,
        text: 'hello',
        chatId: -10042,
        chatType
      })
    });
    assert.equal(prepared.route, 'guard.private_only');
  }
});

test('command parsing supports bot qualification and only documented arguments', () => {
  const qualifiedStats = prepareFixture({
    name: 'qualified stats',
    route: 'command.stats',
    update: messageUpdate({ updateId: 3001, text: '/stats@language_bot' })
  });
  assert.equal(qualifiedStats.route, 'command.stats');
  assert.deepEqual(qualifiedStats.routingFacts.command, {
    name: '/stats',
    args: '',
    botUsername: 'language_bot'
  });

  assert.equal(prepareFixture({
    name: 'stats arguments',
    route: 'command.unknown',
    update: messageUpdate({ updateId: 3002, text: '/stats now' })
  }).route, 'command.unknown');

  const start = prepareFixture({
    name: 'qualified start',
    route: 'command.start',
    update: messageUpdate({ updateId: 3003, text: '/start@language_bot source_1' })
  });
  assert.equal(start.route, 'command.start');
  assert.equal(start.routingFacts.startPayload, 'source_1');

  assert.equal(prepareFixture({
    name: 'invalid start payload',
    route: 'command.unknown',
    update: messageUpdate({ updateId: 3004, text: '/start invalid payload' })
  }).route, 'command.unknown');

  assert.equal(prepareFixture({
    name: 'feedback body',
    route: 'command.feedback',
    update: messageUpdate({ updateId: 3005, text: '/feedback body text' })
  }).route, 'command.feedback');

  assert.equal(prepareFixture({
    name: 'feedback prefix collision',
    route: 'command.unknown',
    update: messageUpdate({ updateId: 3006, text: '/feedbackfoo' })
  }).route, 'command.unknown');
});

test('persistent keyboard uses locale and requires completed onboarding', () => {
  const input = normalizeTelegramUpdate(messageUpdate({ updateId: 4001, text: '· 📚 A2' }));
  const keyboard = buildPersistentKeyboardState(
    {
      level: 'a2',
      reply_mode: 'voice',
      onboarding_complete_at: '2026-03-11T08:00:00.000Z',
      xp_total: 420,
      xp_level: 3
    },
    {
      keyboard_btn_voice_text: 'Text',
      keyboard_btn_voice_voice: 'Voice',
      keyboard_btn_xp_prefix: 'XP'
    },
    input
  );

  assert.equal(keyboard.enabled, true);
  assert.equal(keyboard.buttonIntent, 'level');
  assert.equal(keyboard.levelButtonText, '· 📚 A2');
  assert.equal(keyboard.voiceButtonText, '· 🎤 Voice');
  assert.equal('progressButtonText' in keyboard, false);

  const disabled = buildPersistentKeyboardState({ level: 'a2' }, {}, input);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.buttonIntent, null);
});

test('empty callback data is an explicit unknown callback', () => {
  const input = normalizeTelegramUpdate(callbackUpdate({ updateId: 4100, data: '' }));
  assert.equal(parseCallbackData(input.callbackQuery), null);
  assert.equal(buildPreparedUpdate({ botKey: 'uk-de', input }).route, 'callback.unknown');
});

test('normalization rejects missing, negative, non-integer, and non-number update IDs', () => {
  for (const updateId of [undefined, -1, 1.5, '123', 'not-a-number']) {
    const update = messageUpdate({ text: 'hello' });
    if (updateId === undefined) delete update.update_id;
    else update.update_id = updateId;
    assert.throws(
      () => normalizeTelegramUpdate(update),
      (error: unknown) => error instanceof BotRuntimeInputError && error.code === 'invalid_update'
    );
  }
});

test('service rejects unknown bots and invalid updates before database access', async () => {
  let queryCount = 0;
  const ctx: PrepareUpdateContext = {
    pool: {
      async query() {
        queryCount += 1;
        return { rows: [] };
      }
    },
    getBotLocale: () => ({}),
    publicBotMetaForKey: (botKey) => botKey === 'uk-de' ? { bot_key: 'uk-de' } : null
  };

  await assert.rejects(
    () => prepareBotUpdate(ctx, { botKey: 'missing-bot', telegramUpdate: messageUpdate({ text: 'hello' }) }),
    (error: unknown) => error instanceof BotRuntimeInputError && error.code === 'unknown_bot'
  );

  const invalidUpdate = messageUpdate({ text: 'hello' });
  delete invalidUpdate.update_id;
  await assert.rejects(
    () => prepareBotUpdate(ctx, { botKey: 'uk-de', telegramUpdate: invalidUpdate }),
    (error: unknown) => error instanceof BotRuntimeInputError && error.code === 'invalid_update'
  );

  assert.equal(queryCount, 0);
});

test('parseCommand distinguishes non-commands and malformed command text', () => {
  assert.equal(parseCommand('hello'), null);
  assert.deepEqual(parseCommand('/feedback body'), {
    name: '/feedback',
    args: 'body',
    botUsername: null
  });
});

test('removed commands and stored keyboard buttons are unknown; retired callbacks cannot select anything', () => {
  for (const text of ['/topic', '/topics', '/topic@TeacherBot', '· 🧩 Coffee chat']) {
    const prepared = buildPreparedUpdate({botKey:'uk-en', input:normalizeTelegramUpdate(messageUpdate({text})), keyboardState:{onboarding_complete_at:'2026-01-01'}});
    assert.equal(prepared.route, 'command.unknown', text);
  }
  for (const data of ['topic:travel', 'topic:clear']) {
    const prepared = buildPreparedUpdate({botKey:'uk-en', input:normalizeTelegramUpdate(callbackUpdate({data}))});
    assert.equal(prepared.route, 'callback.unknown');
  }
});
