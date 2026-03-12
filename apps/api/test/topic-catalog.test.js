import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTopicPackFromRow,
  normalizeEffectiveTopicAccessTier,
  normalizeTopicAccessTier,
  normalizeTopicPayload,
  topicIsVisibleForTier
} from '../src/topic-catalog.js';

function makeTopic(accessTier) {
  return {
    topic_id: `${accessTier}-topic`,
    emoji: '🧩',
    access_tier: accessTier,
    title_base: `${accessTier} title`,
    goal_base: `${accessTier} goal`,
    allowed_base: ['one', 'two'],
    avoid_base: ['three', 'four'],
    starter_questions_target: [
      'Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'
    ],
    recovery_questions_target: [
      'R1?', 'R2?', 'R3?', 'R4?', 'R5?', 'R6?'
    ],
    sort_order: 10
  };
}

test('topic payload normalization accepts and preserves access tiers', () => {
  const payload = normalizeTopicPayload({
    ...makeTopic('pro'),
    access_tier: 'PRO'
  });

  assert.equal(payload.access_tier, 'pro');
  assert.equal(normalizeTopicAccessTier(' free '), 'free');
  assert.throws(() => normalizeTopicAccessTier('vip'), /access_tier must be all, free, or pro/);
});

test('effective topic tier normalization maps non-free paid plans to pro', () => {
  assert.equal(normalizeEffectiveTopicAccessTier('free'), 'free');
  assert.equal(normalizeEffectiveTopicAccessTier('pro'), 'pro');
  assert.equal(normalizeEffectiveTopicAccessTier('plus'), 'pro');
  assert.equal(normalizeEffectiveTopicAccessTier('trialing'), 'pro');
  assert.equal(normalizeEffectiveTopicAccessTier(''), 'pro');
});

test('topic visibility keeps pro additive and free users away from pro-only topics', () => {
  const allTopic = makeTopic('all');
  const freeTopic = makeTopic('free');
  const proTopic = makeTopic('pro');

  assert.equal(topicIsVisibleForTier(allTopic, 'free'), true);
  assert.equal(topicIsVisibleForTier(allTopic, 'pro'), true);
  assert.equal(topicIsVisibleForTier(freeTopic, 'free'), true);
  assert.equal(topicIsVisibleForTier(freeTopic, 'pro'), true);
  assert.equal(topicIsVisibleForTier(proTopic, 'free'), false);
  assert.equal(topicIsVisibleForTier(proTopic, 'pro'), true);
});

test('topic pack builder includes access tier in stored snapshot payload', () => {
  const pack = buildTopicPackFromRow(makeTopic('pro'));
  assert.equal(pack.access_tier, 'pro');
  assert.equal(pack.topic_id, 'pro-topic');
  assert.equal(pack.starter_questions_target.length, 6);
});
