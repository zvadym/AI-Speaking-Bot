import type { StatsContext } from './stats-context.js';

type Locale = Record<string, unknown>;

export interface StatsMessage {
  text: string;
  replyMarkup: {
    inline_keyboard: Array<Array<{
      text: string;
      web_app: { url: string };
    }>>;
  };
}

function localeText(locale: Locale, key: string, fallback: string): string {
  const value = String(locale[key] || '');
  return value.trim() ? value : fallback;
}

export function buildStatsProgressBar(used: number, limit: number): string {
  const segments = 6;
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return `[${'□'.repeat(segments)}]`;
  }
  const ratio = Math.max(0, used) / limit;
  const filled = Math.max(0, Math.min(segments, Math.floor(ratio * segments)));
  return `[${'■'.repeat(filled)}${'□'.repeat(segments - filled)}]`;
}

export function buildStatsSubscriptionUrl(
  webappUrl: string,
  botKey: string
): string {
  const url = new URL(webappUrl);
  url.pathname = '/subscription';
  url.search = '';
  url.searchParams.set('bot-key', botKey);
  url.searchParams.set('entry', 'subscription_stats');
  return url.toString();
}

export function buildStatsMessage({
  context,
  locale: localeRaw,
  botKey,
  webappUrl
}: {
  context: StatsContext;
  locale: unknown;
  botKey: string;
  webappUrl: string;
}): StatsMessage {
  const locale = localeRaw && typeof localeRaw === 'object' && !Array.isArray(localeRaw)
    ? localeRaw as Locale
    : {};
  const isPaid = context.tier === 'pro';
  const tier = isPaid
    ? localeText(locale, 'tier_pro', 'PRO 🚀')
    : localeText(locale, 'tier_free', 'FREE');
  const pendingTier = context.pendingPlanTier === 'pro' ? 'PRO' : 'FREE';
  const pending = context.pendingPlanTier
    ? `${localeText(locale, 'pending_change_prefix', 'change to ')}${pendingTier}${localeText(locale, 'pending_change_suffix', ' at period end')}`
    : '—';
  const lines = [
    localeText(locale, 'stats_title', '<b>💎 Subscription</b>'),
    '',
    localeText(locale, 'stats_plan_prefix', 'Plan: ') + tier
  ];

  if (context.planExpiresOn) {
    lines.push(
      localeText(locale, 'plan_valid_until_prefix', 'Valid until: ') + context.planExpiresOn
    );
  }
  lines.push(
    '',
    isPaid
      ? localeText(locale, 'stats_week_title', '<b>This month</b>')
      : localeText(locale, 'stats_free_title', '<b>Free plan limit</b>'),
    localeText(locale, 'stats_practice_prefix', '🎙️ Practice: ') +
      `<code>${buildStatsProgressBar(context.usedSeconds, context.limitSeconds)}</code>`
  );
  if (isPaid) {
    lines.push(
      '',
      localeText(locale, 'stats_autorenew_prefix', 'Auto-renew: ') +
        (context.planAutorenew
          ? localeText(locale, 'autorenew_on', 'on ✅')
          : localeText(locale, 'autorenew_off', 'off ⛔')),
      localeText(locale, 'stats_pending_prefix', 'Scheduled change: ') + pending
    );
  }
  lines.push('', localeText(locale, 'stats_footer', 'Manage your subscription in the app below.'));

  return {
    text: lines.join('\n'),
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: localeText(locale, 'btn_open_subscription', '💎 Open subscription'),
            web_app: { url: buildStatsSubscriptionUrl(webappUrl, botKey) }
          }
        ]
      ]
    }
  };
}
