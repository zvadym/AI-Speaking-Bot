import type { PersistentKeyboardState } from './contracts.js';
import type { XpContext } from './xp-context.js';

type Locale = Record<string, unknown>;

export interface XpMessage {
  text: string;
  replyMarkup: {
    keyboard: Array<Array<{ text: string }>>;
    resize_keyboard: true;
    one_time_keyboard: false;
  };
}

function localeText(locale: Locale, key: string, fallback: string): string {
  const value = String(locale[key] || '');
  return value.trim() ? value : fallback;
}

export function buildXpProgressBar(used: number, limit: number): string {
  const segments = 8;
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return `[${'□'.repeat(segments)}]`;
  }
  const ratio = Math.max(0, Math.min(1, used / limit));
  const filled = Math.max(0, Math.min(segments, Math.round(ratio * segments)));
  return `[${'■'.repeat(filled)}${'□'.repeat(segments - filled)}]`;
}

export function buildXpMessage({
  context,
  locale: localeRaw,
  keyboard
}: {
  context: XpContext;
  locale: unknown;
  keyboard: PersistentKeyboardState;
}): XpMessage {
  const locale = localeRaw && typeof localeRaw === 'object' && !Array.isArray(localeRaw)
    ? localeRaw as Locale
    : {};
  const multiplierText = `x${context.streakMultiplier.toFixed(2)}`;
  const lines = [
    localeText(locale, 'xp_title', '<b>🔥 Your progress</b>'),
    '',
    '<blockquote>🔥 <b>' + localeText(locale, 'xp_streak_label', 'Streak') + ':</b> ' +
      String(context.streakCurrent) + ' · 🏆 <b>' +
      localeText(locale, 'xp_best_label', 'Best streak') + ':</b> ' +
      String(context.streakBest) + '\n🏅 <b>' +
      localeText(locale, 'xp_level_label', 'Level') + ':</b> ' +
      String(context.level) + ' · ⭐ <b>' +
      localeText(locale, 'xp_total_label', 'XP') + ':</b> ' +
      String(context.xpTotal) + '</blockquote>',
    '',
    '<b>' + localeText(locale, 'xp_today_title', 'Today') + '</b>',
    '<code>' + buildXpProgressBar(context.xpDailyToday, context.xpDailyLimit) + '</code> <b>' +
      String(context.xpDailyToday) + '</b> / ' + String(context.xpDailyLimit) + ' XP',
    localeText(locale, 'xp_daily_cap_label', 'Daily cap') + ': <b>' +
      String(context.xpDailyLimit) + '</b>',
    localeText(locale, 'xp_today_left_label', 'Left today') + ': <b>' +
      String(context.xpDailyRemaining) + '</b>',
    '',
    '<b>' + localeText(locale, 'xp_level_progress_label', 'Level progress') + '</b>',
    '<code>' + buildXpProgressBar(context.xpIntoLevel, context.xpPerLevel) + '</code> <b>' +
      String(context.xpIntoLevel) + '</b> / ' + String(context.xpPerLevel) + ' XP',
    '➡️ ' + localeText(locale, 'xp_next_label', 'To next level') + ': <b>' +
      String(context.xpToNext) + '</b>',
    '',
    '<b>' + localeText(locale, 'xp_streak_bonus_label', 'Streak bonus') + '</b>',
    '<code>' + multiplierText + '</code>',
    '<i>' + localeText(
      locale,
      'xp_streak_bonus_pending',
      'Streak multiplier is not applied yet.'
    ) + '</i>'
  ];

  return {
    text: lines.join('\n'),
    replyMarkup: {
      keyboard: [
        [{ text: keyboard.topicButtonText }, { text: keyboard.levelButtonText }],
        [{ text: keyboard.voiceButtonText }, { text: keyboard.xpButtonText }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}
