import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { loadBotConfigs } from '../src/bot-configs.js';
import { parseOnboardingEnabledBotKeys } from '../src/bot-runtime/onboarding-config.js';
import {
  buildOnboardingCompletionMarkup,
  buildOnboardingPracticeCard,
  buildOnboardingScenarioPicker,
  getOnboardingLocale,
  validateOnboardingLocale
} from '../src/bot-runtime/onboarding.js';
import {
  classifyOnboardingResponseStyle,
  onboardingReplyText,
  suggestedOnboardingLevel
} from '../src/bot-runtime/handlers/conversation.js';
import { createOnboardingStartHandler } from '../src/bot-runtime/handlers/onboarding.js';
import { bootstrapTelegramUser } from '../src/bot-runtime/user-bootstrap.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';

const configs = loadBotConfigs() as Record<string, { locale: unknown }>;

async function runBootstrap({
  text,
  updateId,
  existingUserBot,
  enabled
}: {
  text: string;
  updateId: number;
  existingUserBot: boolean;
  enabled: boolean;
}) {
  const calls: Array<{ source: string; params: unknown[] }> = [];
  const client = {
    async query(source: string, params: unknown[] = []) {
      calls.push({ source, params });
      if (source.includes('INSERT INTO user_bots')) {
        return { rows: existingUserBot ? [] : [{ chat_id: 42 }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = {
    async connect() { return client; }
  } as unknown as Pool;
  const input = normalizeTelegramUpdate({
    update_id: updateId,
    message: {
      message_id: 1,
      text,
      chat: { id: 42, type: 'private' },
      from: { id: 42, is_bot: false, first_name: 'Оля' }
    }
  });
  await bootstrapTelegramUser(pool, {
    botKey: 'uk-en',
    input,
    onboardingEnabledBotKeys: enabled ? new Set(['uk-en']) : new Set()
  });
  return calls;
}

function preparedStart() {
  return buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate({
      update_id: 9701,
      message: {
        message_id: 1,
        text: '/start',
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'Оля' }
      }
    })
  });
}

test('onboarding rollout config supports dark, canary, and all-bot activation', () => {
  const known = ['uk-en', 'de-es'];
  assert.deepEqual([...parseOnboardingEnabledBotKeys('', known)], []);
  assert.deepEqual([...parseOnboardingEnabledBotKeys('UK-EN, uk-en', known)], ['uk-en']);
  assert.deepEqual([...parseOnboardingEnabledBotKeys('*', known)], known);
  assert.throws(
    () => parseOnboardingEnabledBotKeys('missing', known),
    /unknown_onboarding_bot_key/
  );
});

test('enabled /start creates or atomically restarts onboarding for an existing user', async () => {
  const calls = await runBootstrap({
    text: '/start',
    updateId: 9801,
    existingUserBot: true,
    enabled: true
  });
  const reset = calls.find((call) => call.source.includes('INSERT INTO bot_onboarding_sessions'));
  assert.ok(reset);
  assert.deepEqual(reset.params, [42, 'uk-en', 9801]);
  assert.match(reset.source, /ON CONFLICT \(chat_id, bot_key\) DO UPDATE/);
  assert.match(reset.source, /state = 'choose_scenario'/);
  assert.match(reset.source, /scenario = NULL/);
  assert.match(reset.source, /completed_at = NULL/);
  assert.match(reset.source, /last_start_update_id < EXCLUDED\.last_start_update_id/);
});

test('onboarding bootstrap keeps non-start and disabled-bot behavior scoped', async () => {
  const newUserCalls = await runBootstrap({
    text: 'Hello',
    updateId: 9802,
    existingUserBot: false,
    enabled: true
  });
  const created = newUserCalls.find((call) => call.source.includes('INSERT INTO bot_onboarding_sessions'));
  assert.ok(created);
  assert.deepEqual(created.params, [42, 'uk-en', null]);

  const existingMessageCalls = await runBootstrap({
    text: 'Hello',
    updateId: 9803,
    existingUserBot: true,
    enabled: true
  });
  assert.equal(existingMessageCalls.some((call) => call.source.includes('bot_onboarding_sessions')), false);

  const disabledStartCalls = await runBootstrap({
    text: '/start',
    updateId: 9804,
    existingUserBot: true,
    enabled: false
  });
  assert.equal(disabledStartCalls.some((call) => call.source.includes('bot_onboarding_sessions')), false);
});

test('every production bot has a complete onboarding locale contract', () => {
  assert.equal(Object.keys(configs).length, 15);
  for (const [botKey, config] of Object.entries(configs)) {
    assert.deepEqual(validateOnboardingLocale(config.locale), [], botKey);
    const locale = getOnboardingLocale(config.locale);
    assert.ok(locale, botKey);
    for (const scenario of Object.values(locale.scenarios)) {
      assert.ok(scenario.prompt.length > 10, `${botKey} prompt`);
      assert.ok(scenario.example.length > 10, `${botKey} example`);
    }
  }
});

test('localized builders keep stable callback payloads and optional level row', () => {
  const locale = getOnboardingLocale(configs['uk-en'].locale);
  assert.ok(locale);
  assert.deepEqual(buildOnboardingScenarioPicker(locale).inline_keyboard.map((row) => (
    row.map((button) => button.callback_data)
  )), [
    ['onb:scenario:about_self', 'onb:scenario:daily_life'],
    ['onb:scenario:travel']
  ]);
  assert.match(buildOnboardingPracticeCard(locale, 'daily_life'), /This morning/);
  assert.equal(buildOnboardingCompletionMarkup(locale, null).inline_keyboard.length, 1);
  assert.equal(buildOnboardingCompletionMarkup(locale, 'a2').inline_keyboard[0][0].callback_data, 'onb:level:a2');
});

test('onboarding level and repeated-example classification are conservative', () => {
  const locale = getOnboardingLocale(configs['uk-en'].locale);
  assert.ok(locale);
  const mediumLevelResponse = {
    detected_language: 'en',
    is_target_language: true,
    has_mistakes: false,
    reply_text: 'Great',
    explanation_html: '',
    suggested_level: 'a2' as const,
    suggested_level_confidence: 'medium' as const
  };
  assert.equal(suggestedOnboardingLevel({
    ...mediumLevelResponse
  }), 'a2');
  assert.match(onboardingReplyText('Great start!', {
    locale,
    session: {} as never,
    ai: { scenario: 'daily_life', prompt: 'Prompt', example: 'Example' }
  }, mediumLevelResponse), /A2/);
  assert.equal(suggestedOnboardingLevel({
    detected_language: 'en',
    is_target_language: true,
    has_mistakes: false,
    reply_text: 'Great',
    explanation_html: '',
    suggested_level: 'c1',
    suggested_level_confidence: 'low'
  }), null);
  assert.equal(
    classifyOnboardingResponseStyle(
      'This morning I had coffee and went to work',
      'This morning, I had coffee and went to work.'
    ),
    'repeated_example'
  );
  assert.equal(
    classifyOnboardingResponseStyle('I stayed home today.', 'This morning I had coffee.'),
    'custom'
  );
});

test('new-user start handler renders the persisted onboarding state', async () => {
  const update = preparedStart();
  const deliveries: Array<Record<string, unknown>> = [];
  const pool = {
    async query(source: string) {
      assert.match(source, /FROM bot_onboarding_sessions/);
      return {
        rows: [{
          chat_id: 42,
          bot_key: 'uk-en',
          version: 2,
          state: 'choose_scenario',
          scenario: null,
          first_input_mode: null,
          suggested_level: null,
          completion_decision_id: null,
          last_start_update_id: 9701,
          started_at: new Date(),
          updated_at: new Date(),
          completed_at: null
        }]
      };
    }
  } as unknown as Pool;
  const handler = createOnboardingStartHandler({
    pool,
    getBotLocale: () => configs['uk-en'].locale,
    telegramClient: { async sendTelegramTextMessage() { return { message_id: 1 }; } },
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: 1 };
    }
  });

  assert.deepEqual(await handler.execute(update as never), {
    status: 'delivered',
    telegramMessageId: 1
  });
  assert.equal(deliveries[0].stepKey, 'command.start:onboarding-picker:v2');
  assert.match(String(deliveries[0].text), /Оля/);
  assert.match(JSON.stringify(deliveries[0].replyMarkup), /onb:scenario:travel/);
});
