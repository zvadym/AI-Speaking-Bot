import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fetchKeyboardState } from '../src/bot-runtime/context-loader.js';
import { buildPersistentReplyMarkup } from '../src/bot-runtime/keyboard-state.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { messageUpdate } from './fixtures/telegram-updates.js';
import { buildProgressMessage } from '../src/bot-runtime/handlers/progress.js';

test('keyboard loading never queries retired XP state', async () => {
  const pool = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> {
      assert.doesNotMatch(sql, /\b(xp_events|user_progress|grant_xp)\b/);
      return { rows: [] };
    }
  };
  await fetchKeyboardState(pool, 42, 'uk-en');
});

for (const text of ['/progress', '/xp', '· XP: 340 • L2']) {
  test(`${text} opens progress without game metrics`, () => {
    const update = buildPreparedUpdate({
      botKey: 'uk-en',
      input: normalizeTelegramUpdate(messageUpdate({ text })),
      keyboardState: { level: 'b1', onboarding_complete_at: '2026-01-01' },
      locale: { keyboard_btn_progress: 'My progress' }
    });
    assert.equal(update.route, 'command.progress');
    const markup = buildPersistentReplyMarkup(update.context.keyboard);
    assert.doesNotMatch(JSON.stringify(markup), /XP|• L\d/);
    assert.match(JSON.stringify(markup), /My progress/);
    assert.match(JSON.stringify(markup), /B1/);
  });
}

test('all configured bots offer localized progress and retire public XP commands', () => {
  const directory = new URL('../../../deploy/bots/', import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const bot = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
    assert.ok(bot.locale.progress_empty_text, file);
    assert.ok(bot.locale.keyboard_btn_progress, file);
    assert.ok(bot.telegram_presentation.commands.some((command: { command: string }) => command.command === 'progress'), file);
    assert.ok(!bot.telegram_presentation.commands.some((command: { command: string }) => command.command === 'xp'), file);
    assert.doesNotMatch(JSON.stringify(bot.locale), /\bXP\b/);
    const update = buildPreparedUpdate({
      botKey: bot.bot_key,
      input: normalizeTelegramUpdate(messageUpdate({ text: `· 📈 ${bot.locale.keyboard_btn_progress}` })),
      keyboardState: { onboarding_complete_at: '2026-01-01' },
      locale: bot.locale
    });
    assert.equal(update.route, 'command.progress', file);
    assert.equal(buildProgressMessage(update, bot.locale).text, bot.locale.progress_empty_text, file);
  }
});
