import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPublicBotCatalog } from '../src/shared/bot-catalog.js';
import {
  normalizeBroadcastFilters,
  normalizeBroadcastReplyMarkup
} from '../src/shared/broadcast.js';
import {
  normalizeBillingInterval,
  parseQueryBoolean,
  normalizeLanguageCode
} from '../src/shared/normalization.js';
import { sanitizeTelegramHtml } from '../src/shared/telegram-delivery.js';

test('buildPublicBotCatalog merges bot configs and token-backed keys', () => {
  const catalog = buildPublicBotCatalog(
    {
      'uk-de': {
        bot_key: 'uk-de',
        bot_name: 'Deutsch Coach',
        learning_language: 'de',
        base_language: 'uk',
        teacher_tagline_en: 'Serious grammar, short sessions.'
      }
    },
    {
      'uk-de': 'token-1',
      'uk-en': 'token-2'
    }
  );

  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map((item) => item.bot_key), ['uk-de', 'uk-en']);
  assert.equal(catalog[0].bot_name, 'Deutsch Coach');
  assert.equal(catalog[1].learning_language, 'en');
});

test('broadcast helpers normalize filters and validate reply markup', () => {
  const filters = normalizeBroadcastFilters({
    username: '  alice  ',
    plans: ['FREE', 'pro', 'bad'],
    bots: ['uk-de', 'UK-DE', 'uk-en'],
    lastActivityMode: 'inactive_for',
    lastActivityDays: '9',
    usageMode: 'percent_gte',
    usagePercent: '87.5'
  });

  assert.equal(filters.username, 'alice');
  assert.deepEqual(filters.plans, ['free', 'pro']);
  assert.deepEqual(filters.bots, ['uk-de', 'uk-en']);
  assert.equal(filters.lastActivityMode, 'inactive_for');
  assert.equal(filters.lastActivityDays, 9);
  assert.equal(filters.usageMode, 'percent_gte');
  assert.equal(filters.usagePercent, 87.5);

  const markup = normalizeBroadcastReplyMarkup({
    inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]]
  });
  assert.equal(markup.ok, true);
  assert.deepEqual(markup.replyMarkup, {
    inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]]
  });

  const badMarkup = normalizeBroadcastReplyMarkup({
    inline_keyboard: [[{ text: 'Broken', url: 'javascript:alert(1)' }]]
  });
  assert.equal(badMarkup.ok, false);
  assert.equal(badMarkup.error, 'inline_keyboard_bad_url_scheme');
});

test('shared normalization and telegram sanitizing stay stable', () => {
  assert.equal(normalizeBillingInterval('YEAR'), 'year');
  assert.equal(normalizeBillingInterval('weekly'), null);
  assert.equal(parseQueryBoolean('YES'), true);
  assert.equal(normalizeLanguageCode('ua'), 'uk');

  assert.equal(
    sanitizeTelegramHtml('<strong>Hello</strong><script>alert(1)</script><br>world'),
    '<b>Hello</b>&lt;script&gt;alert(1)&lt;/script&gt;\nworld'
  );
});
