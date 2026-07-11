import type { Pool, PoolClient } from 'pg';
import type { PreparedUpdate } from './contracts.js';
import {
  loadEntitlementContext,
  type EntitlementContext
} from './entitlement-context.js';
import { runBotUpdateEffect } from './effect-repository.js';
import {
  BotRuntimeHandlerError,
  type BotHandlerOutcome
} from './handler-registry.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from './telegram-text-delivery.js';

type Locale = Record<string, unknown>;

export const PRACTICE_QUOTA_EFFECT_STEP_KEY = 'practice-quota:paywall-event:v1';
export const PRACTICE_QUOTA_DELIVERY_STEP_KEY = 'practice-quota:paywall:v1';

interface PaywallEffectResult extends Record<string, unknown> {
  recorded: boolean;
}

export type PracticeQuotaDecision =
  | { allowed: true; context: EntitlementContext }
  | { allowed: false; context: EntitlementContext; outcome: BotHandlerOutcome };

export type PracticeQuotaGuard = typeof enforcePracticeQuota;

function localeRecord(value: unknown): Locale {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Locale
    : {};
}

function localeText(locale: Locale, key: string, fallback: string): string {
  const value = String(locale[key] || '').trim();
  return value || fallback;
}

export function buildLimitReachedSubscriptionUrl(webappUrl: string, botKey: string): string {
  const url = new URL(webappUrl);
  url.pathname = '/subscription';
  url.search = '';
  url.searchParams.set('bot-key', botKey);
  url.searchParams.set('entry', 'limit_reached');
  return url.toString();
}

async function recordPaywallShown(client: PoolClient, update: PreparedUpdate): Promise<PaywallEffectResult> {
  const result = await client.query(
    `INSERT INTO action_events (
       chat_id, bot_key, action_type, source, idempotency_key, properties, occurred_at
     ) VALUES (
       $1::bigint, $2::text, 'paywall_shown', 'bot_runtime',
       'paywall_shown:' || $1::text || ':' || $2::text || ':' ||
         to_char(date_trunc('day', NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD'),
       $3::jsonb,
       NOW()
     )
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      update.input.chatId,
      update.botKey,
      JSON.stringify({
        route: update.route,
        reason: 'practice_limit_reached',
        source: 'telegram'
      })
    ]
  );
  return { recorded: result.rowCount === 1 };
}

export async function enforcePracticeQuota({
  pool,
  update,
  getBotLocale,
  telegramClient,
  webappUrl,
  entitlementLoader = loadEntitlementContext,
  effectRunner = runBotUpdateEffect,
  textDeliverer = deliverTelegramText,
  beforeBlockedDelivery
}: {
  pool: Pool;
  update: PreparedUpdate;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
  webappUrl: string;
  entitlementLoader?: typeof loadEntitlementContext;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
  beforeBlockedDelivery?: () => Promise<unknown>;
}): Promise<PracticeQuotaDecision> {
  const chatId = update.input.chatId;
  if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
    throw new BotRuntimeHandlerError('invalid_practice_quota_chat_id', { retryable: false });
  }

  let context: EntitlementContext;
  try {
    context = await entitlementLoader(pool, chatId);
  } catch (error) {
    throw new BotRuntimeHandlerError('practice_quota_unavailable', {
      retryable: true,
      cause: error
    });
  }
  if (!context.limitReached) return { allowed: true, context };

  try {
    await effectRunner(pool, {
      decisionId: update.decisionId,
      stepKey: PRACTICE_QUOTA_EFFECT_STEP_KEY,
      execute: (client) => recordPaywallShown(client, update)
    });
  } catch (error) {
    if (error instanceof BotRuntimeHandlerError) throw error;
    throw new BotRuntimeHandlerError('practice_paywall_state_unavailable', {
      retryable: true,
      cause: error
    });
  }

  if (beforeBlockedDelivery) await beforeBlockedDelivery();
  const locale = localeRecord(getBotLocale(update.botKey));
  const outcome = await textDeliverer({
    pool,
    update,
    telegramClient,
    stepKey: PRACTICE_QUOTA_DELIVERY_STEP_KEY,
    text: localeText(locale, 'msg_limit_reached', 'Your practice limit has been reached.'),
    replyMarkup: {
      inline_keyboard: [[{
        text: localeText(locale, 'btn_open_subscription', 'Open subscription'),
        web_app: {
          url: buildLimitReachedSubscriptionUrl(webappUrl, update.botKey)
        }
      }]]
    }
  });
  return { allowed: false, context, outcome };
}
