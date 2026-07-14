import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHourlyIdiomPracticeScheduleKey,
  buildIdiomPracticeScheduleKey,
  isCurrentIdiomPracticeScheduleKey
} from '../src/idiom-phrases.js';

test('idiom practice schedule keys distinguish daily UTC delivery slots', () => {
  const morning = new Date('2026-07-14T07:15:00.000Z');
  const evening = new Date('2026-07-14T17:15:00.000Z');

  assert.equal(buildIdiomPracticeScheduleKey(morning), '2026-07-14');
  assert.equal(buildHourlyIdiomPracticeScheduleKey(morning), '2026-07-14:h07');
  assert.equal(buildHourlyIdiomPracticeScheduleKey(evening), '2026-07-14:h17');
});

test('idiom practice accepts current slotted and legacy daily schedule keys', () => {
  const now = new Date('2026-07-14T18:00:00.000Z');

  assert.equal(isCurrentIdiomPracticeScheduleKey('2026-07-14', now), true);
  assert.equal(isCurrentIdiomPracticeScheduleKey('2026-07-14:h07', now), true);
  assert.equal(isCurrentIdiomPracticeScheduleKey('2026-07-14:h17', now), true);
  assert.equal(isCurrentIdiomPracticeScheduleKey('2026-07-13:h17', now), false);
  assert.equal(isCurrentIdiomPracticeScheduleKey('2026-07-14:h24', now), false);
  assert.equal(isCurrentIdiomPracticeScheduleKey('manual_test:run', now), false);
});
