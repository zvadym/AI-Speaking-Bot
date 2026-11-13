import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { fetchKeyboardState } from '../context-loader.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import {
  buildPersistentKeyboardState,
  buildPersistentReplyMarkup
} from '../keyboard-state.js';
import {
  buildOnboardingCompletionMarkup,
  buildOnboardingPracticeCard,
  buildOnboardingPracticeMarkup,
  buildOnboardingScenarioPicker,
  buildOnboardingWelcome,
  confirmOnboardingLevel,
  getOnboardingLocale,
  loadOnboardingSession,
  normalizeSuggestedLevel,
  recordOnboardingBonus,
  resetOnboardingScenario,
  selectOnboardingScenario,
  type OnboardingScenario
} from '../onboarding/onboarding.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../delivery/telegram-text-delivery.js';
import { buildStaticRouteMessage } from './static-routes.js';

interface OnboardingTelegramClient extends TelegramTextClient {
  answerTelegramCallbackQuery(
    callbackQueryId: string,
    text?: string,
    options?: { botKey?: string | null; showAlert?: boolean }
  ): Promise<unknown>;
}

function firstName(update: PreparedUpdate): string | null {
  const value = String(update.input.sender.firstName || '').trim();
  return value || null;
}

function levelPicker() {
  return {
    inline_keyboard: [
      [
        { text: 'A1', callback_data: 'onb:level:a1' },
        { text: 'A2', callback_data: 'onb:level:a2' },
        { text: 'B1', callback_data: 'onb:level:b1' }
      ],
      [
        { text: 'B2', callback_data: 'onb:level:b2' },
        { text: 'C1', callback_data: 'onb:level:c1' }
      ]
    ]
  };
}

export function createOnboardingStartHandler({
  pool,
  getBotLocale,
  telegramClient,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler<'command.start'> {
  return {
    route: 'command.start',
    version: BOT_RUNTIME_HANDLER_VERSIONS['command.start'],
    async execute(update) {
      const chatId = update.input.chatId;
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_start_update', { retryable: false });
      }
      const localeRaw = getBotLocale(update.botKey);
      const locale = getOnboardingLocale(localeRaw);
      const session = locale ? await loadOnboardingSession(pool, chatId, update.botKey) : null;
      if (!session) {
        const completion = await pool.query('SELECT 1 FROM bot_onboarding_completion WHERE chat_id = $1 AND bot_key = $2 LIMIT 1', [chatId, update.botKey]);
        if (completion.rows.length) {
          const keyboard = buildPersistentReplyMarkup(buildPersistentKeyboardState(await fetchKeyboardState(pool, chatId, update.botKey), localeRaw, update.input));
          return textDeliverer({pool,update,telegramClient,stepKey:'command.start:already-onboarded:v1',
            text: locale?.already_completed || String((localeRaw as Record<string, unknown>)?.msg_start_completed || 'You are ready. Send a text or voice message to continue.'),replyMarkup:keyboard});
        }
      }
      if (!locale || !session) {
        const fallback = buildStaticRouteMessage('command.start', update, localeRaw);
        if (!fallback) return { status: 'noop' };
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'command.start:legacy:v1',
          text: fallback.text,
          parseMode: fallback.parseMode,
          replyMarkup: fallback.replyMarkup
        });
      }

      if (session.state === 'completed') {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'command.start:onboarding-completed:v2',
          text: locale.already_completed,
          replyMarkup: buildPersistentReplyMarkup(buildPersistentKeyboardState(await fetchKeyboardState(pool, chatId, update.botKey), localeRaw, update.input))
        });
      }

      if (
        session.state === 'await_practice'
        && session.scenario
        && session.scenario !== 'freeform'
      ) {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'command.start:onboarding-resume:v2',
          text: buildOnboardingPracticeCard(locale, session.scenario, session.first_input_mode || 'voice'),
          replyMarkup: buildOnboardingPracticeMarkup(locale)
        });
      }

      return textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'command.start:onboarding-picker:v2',
        text: buildOnboardingWelcome(locale, firstName(update)),
        replyMarkup: buildOnboardingScenarioPicker(locale)
      });
    }
  };
}

export function createOnboardingCallbackHandler({
  pool,
  getBotLocale,
  telegramClient,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: OnboardingTelegramClient;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler<'callback.onboarding'> {
  return {
    route: 'callback.onboarding',
    version: BOT_RUNTIME_HANDLER_VERSIONS['callback.onboarding'],
    async execute(update) {
      const callback = update.input.callbackQuery;
      const chatId = update.input.chatId;
      if (!callback || chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_onboarding_callback', { retryable: false });
      }
      const localeRaw = getBotLocale(update.botKey);
      const locale = getOnboardingLocale(localeRaw);
      const session = locale ? await loadOnboardingSession(pool, chatId, update.botKey) : null;
      const payload = String(update.routingFacts.callback?.payload || '').trim().toLowerCase();
      const [kind, rawValue] = payload.split(':');
      const callbackText = locale
        ? (kind === 'level' ? String((localeRaw as Record<string, unknown>)?.callback_saved || '') : '')
        : '';
      try {
        await telegramClient.answerTelegramCallbackQuery(callback.id, callbackText || undefined, {
          botKey: update.botKey
        });
      } catch {
        // Callback acknowledgements are ephemeral and do not own durable state.
      }

      if (!locale || !session) {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'callback.onboarding:expired:v2',
          text: locale?.errors.expired || String((localeRaw as Record<string, unknown>)?.callback_expired || 'Expired')
        });
      }

      if (kind === 'scenario' && rawValue === 'choose' && session.state !== 'completed') {
        await resetOnboardingScenario(pool, chatId, update.botKey);
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'callback.onboarding:scenario-picker:v2',
          text: locale.choose_scenario,
          replyMarkup: buildOnboardingScenarioPicker(locale)
        });
      }

      if (kind === 'scenario' && ['about_self', 'daily_life', 'travel'].includes(rawValue)) {
        if (session.state === 'completed') {
          return textDeliverer({
            pool,
            update,
            telegramClient,
            stepKey: 'callback.onboarding:already-completed:v2',
            text: locale.already_completed,
            replyMarkup: buildOnboardingCompletionMarkup(locale, session.suggested_level)
          });
        }
        const scenario = rawValue as Exclude<OnboardingScenario, 'freeform'>;
        await selectOnboardingScenario(pool, { chatId, botKey: update.botKey, scenario });
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: `callback.onboarding:scenario-${scenario}:v2`,
          text: buildOnboardingPracticeCard(locale, scenario),
          replyMarkup: buildOnboardingPracticeMarkup(locale)
        });
      }

      if (kind === 'mode' && rawValue === 'text' && session.state === 'await_practice') {
        if (!session.scenario || session.scenario === 'freeform') {
          return textDeliverer({
            pool,
            update,
            telegramClient,
            stepKey: 'callback.onboarding:mode-text-freeform:v2',
            text: locale.text_instruction
          });
        }
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'callback.onboarding:mode-text:v2',
          text: buildOnboardingPracticeCard(locale, session.scenario, 'text'),
          replyMarkup: {
            inline_keyboard: [[{
              text: locale.buttons.change_scenario,
              callback_data: 'onb:scenario:choose'
            }]]
          }
        });
      }

      if (kind === 'level' && rawValue === 'choose' && session.state === 'completed') {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'callback.onboarding:level-picker:v2',
          text: String((localeRaw as Record<string, unknown>)?.choose_level_text || locale.level_suggestion),
          replyMarkup: levelPicker()
        });
      }

      const level = kind === 'level' ? normalizeSuggestedLevel(rawValue) : null;
      if (level && session.state === 'completed') {
        const confirmed = await confirmOnboardingLevel(pool, {
          chatId,
          botKey: update.botKey,
          level
        });
        const replyMarkup = confirmed
          ? buildPersistentReplyMarkup(buildPersistentKeyboardState(
              await fetchKeyboardState(pool, chatId, update.botKey),
              localeRaw,
              update.input
            ))
          : undefined;
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'callback.onboarding:level-confirmed:v2',
          text: confirmed
            ? `${String((localeRaw as Record<string, unknown>)?.level_saved_prefix || 'Level: ')}${level.toUpperCase()}`
            : locale.errors.expired,
          replyMarkup
        });
      }

      if (kind === 'bonus' && (rawValue === 'retry' || rawValue === 'continue')) {
        const action = rawValue as 'retry' | 'continue';
        const recorded = await recordOnboardingBonus(pool, {
          chatId,
          botKey: update.botKey,
          action
        });
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: `callback.onboarding:bonus-${action}:v2`,
          text: recorded
            ? (action === 'retry' ? locale.retry_corrected : locale.continue_prompt)
            : locale.errors.expired
        });
      }

      return textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'callback.onboarding:expired-state:v2',
        text: session.state === 'completed' ? locale.already_completed : locale.errors.expired
      });
    }
  };
}
