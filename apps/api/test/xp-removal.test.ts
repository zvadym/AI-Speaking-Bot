import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fetchKeyboardState } from '../src/bot-runtime/context-loader.js';
import { buildPersistentReplyMarkup } from '../src/bot-runtime/keyboard-state.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { messageUpdate } from './fixtures/telegram-updates.js';
import { buildStaticRouteMessage } from '../src/bot-runtime/handlers/static-routes.js';

test('keyboard loading never queries retired XP state', async () => {
  const pool = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> {
      assert.doesNotMatch(sql, /\b(xp_events|user_progress|grant_xp)\b/);
      return { rows: [] };
    }
  };
  await fetchKeyboardState(pool, 42, 'uk-en');
});

for (const text of ['/progress', '/xp', '· XP: 340 • L2', '· 📈 Мій прогрес']) {
  test(`${text} is retired and refreshes the keyboard`, () => {
    const update = buildPreparedUpdate({
      botKey: 'uk-en',
      input: normalizeTelegramUpdate(messageUpdate({ text })),
      keyboardState: { level: 'b1', onboarding_complete_at: '2026-01-01' },
      locale: { msg_error_command: 'Unknown command' }
    });
    assert.equal(update.route, 'command.unknown');
    const markup = buildPersistentReplyMarkup(update.context.keyboard);
    assert.doesNotMatch(JSON.stringify(markup), /XP|• L\d/);
    assert.equal(markup.keyboard.flat().length, 1);
    assert.doesNotMatch(JSON.stringify(markup), /📈|progress|прогрес/);
    const message = buildStaticRouteMessage('command.unknown', update, { msg_error_command: 'Unknown command' });
    assert.equal(message?.text, 'Unknown command');
    assert.deepEqual(message?.replyMarkup, markup);
    assert.match(JSON.stringify(markup), /⚙️/);
  });
}

test('all configured bots retire public progress and XP controls', () => {
  const directory = new URL('../../../deploy/bots/', import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const bot = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
    assert.equal('progress_empty_text' in bot.locale, false, file);
    assert.equal('keyboard_btn_progress' in bot.locale, false, file);
    assert.ok(!bot.telegram_presentation.commands.some((command: { command: string }) => command.command === 'progress'), file);
    assert.ok(!bot.telegram_presentation.commands.some((command: { command: string }) => command.command === 'xp'), file);
    assert.doesNotMatch(JSON.stringify(bot.locale), /\bXP\b/);
    const update = buildPreparedUpdate({
      botKey: bot.bot_key,
      input: normalizeTelegramUpdate(messageUpdate({ text: '· 📈 My progress' })),
      keyboardState: { onboarding_complete_at: '2026-01-01' },
      locale: bot.locale
    });
    assert.equal(update.route, 'command.unknown', file);
    assert.equal(buildStaticRouteMessage('command.unknown', update, bot.locale)?.text, bot.locale.msg_error_command, file);
  }
});
