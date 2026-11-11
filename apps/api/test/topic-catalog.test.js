import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOpeningPromptTarget,
  buildTopicPackFromRow,
  deriveTopicMode,
  normalizeEffectiveTopicAccessTier,
  normalizeTopicAccessTier,
  normalizeTopicPayload,
  topicRequiresSubscriptionForTier,
  topicIsVisibleForTier
} from '../src/topic-catalog.js';

function makeTopic(accessTier, overrides = {}) {
  return {
    topic_id: `${accessTier}-topic`,
    emoji: '🧩',
    access_tier: accessTier,
    title_base: `${accessTier} title`,
    goal_base: `${accessTier} goal`,
    allowed_base: ['one', 'two'],
    subareas_json: [
      { id: 'one', label_base: 'one', keywords_target: ['first'], keywords_base: ['one'] },
      { id: 'two', label_base: 'two', keywords_target: ['second'], keywords_base: ['two'] }
    ],
    avoid_base: ['three', 'four'],
    starter_questions_target: [
      'Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'
    ],
    recovery_questions_target: [
      'R1?', 'R2?', 'R3?', 'R4?', 'R5?', 'R6?'
    ],
    sort_order: 10,
    ...overrides
  };
}

test('topic payload normalization accepts and preserves access tiers', () => {
  const payload = normalizeTopicPayload({
    ...makeTopic('pro'),
    access_tier: 'PRO'
  });

  assert.equal(payload.access_tier, 'pro');
  assert.equal(payload.topic_mode, 'open_chat');
  assert.deepEqual(payload.subareas_json, [
    { id: 'one', label_base: 'one', keywords_target: ['first'], keywords_base: ['one'] },
    { id: 'two', label_base: 'two', keywords_target: ['second'], keywords_base: ['two'] }
  ]);
  assert.deepEqual(payload.starter_questions_by_level_target, {
    default: ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?']
  });
  assert.deepEqual(payload.soft_redirect_base, ['three', 'four']);
  assert.equal(payload.opening_prompt_target, 'Q1?');
  assert.equal(normalizeTopicAccessTier(' free '), 'free');
  assert.throws(() => normalizeTopicAccessTier('vip'), /access_tier must be all, free, or pro/);
});

test('topic payload normalization preserves existing v2 fields when legacy admin payload omits them', () => {
  const existingTopic = normalizeTopicPayload({
    ...makeTopic('all', { topic_id: 'coffee' }),
    topic_mode: 'roleplay',
    subareas_json: [
      { id: 'drink-type', label_base: 'ordering drinks', keywords_target: ['coffee'], keywords_base: ['ordering drinks'] },
      { id: 'milk', label_base: 'asking for milk', keywords_target: ['milk'], keywords_base: ['asking for milk'] }
    ],
    speech_acts_base: ['ordering', 'clarifying'],
    lexical_anchors_target: ['latte', 'oat milk'],
    grammar_targets_json: { tense: ['present simple'] },
    starter_questions_by_level_target: {
      default: ['Default starter?'],
      a1: ['Easy starter?']
    },
    recovery_questions_by_level_target: {
      default: ['Default recovery?']
    },
    bridge_patterns_target: ['How about...'],
    hard_block_base: ['politics'],
    soft_redirect_base: ['too abstract'],
    opening_prompt_target: 'Do you want a latte or cappuccino?'
  });

  const updated = normalizeTopicPayload(
    {
      topic_id: 'coffee',
      emoji: '☕',
      access_tier: 'all',
      title_base: 'Coffee shop',
      goal_base: 'Practice a short cafe order.',
      allowed_base: ['ordering drinks', 'asking for milk'],
      avoid_base: ['politics', 'weather'],
      starter_questions_target: ['New Q1?', 'New Q2?', 'New Q3?', 'New Q4?', 'New Q5?', 'New Q6?'],
      recovery_questions_target: ['New R1?', 'New R2?', 'New R3?', 'New R4?', 'New R5?', 'New R6?'],
      sort_order: 12
    },
    { existingTopic }
  );

  assert.equal(updated.topic_mode, 'roleplay');
  assert.deepEqual(updated.subareas_json, [
    { id: 'drink-type', label_base: 'ordering drinks', keywords_target: ['coffee'], keywords_base: ['ordering drinks'] },
    { id: 'milk', label_base: 'asking for milk', keywords_target: ['milk'], keywords_base: ['asking for milk'] }
  ]);
  assert.deepEqual(updated.speech_acts_base, ['ordering', 'clarifying']);
  assert.deepEqual(updated.lexical_anchors_target, ['latte', 'oat milk']);
  assert.deepEqual(updated.grammar_targets_json, { tense: ['present simple'] });
  assert.deepEqual(updated.starter_questions_by_level_target, {
    default: ['Default starter?'],
    a1: ['Easy starter?']
  });
  assert.deepEqual(updated.recovery_questions_by_level_target, {
    default: ['Default recovery?']
  });
  assert.deepEqual(updated.bridge_patterns_target, ['How about...']);
  assert.deepEqual(updated.hard_block_base, ['politics']);
  assert.deepEqual(updated.soft_redirect_base, ['too abstract']);
  assert.equal(updated.opening_prompt_target, 'Do you want a latte or cappuccino?');
});

test('topic pack builder selects level-specific starters and opening prompt', () => {
  const pack = buildTopicPackFromRow(
    makeTopic('all', {
      topic_id: 'interview',
      topic_mode: 'rehearsal',
      starter_questions_by_level_target: {
        default: ['Default starter?'],
        b1: ['Tell me about your last role?']
      },
      recovery_questions_by_level_target: {
        default: ['Default recovery?'],
        b1: ['What projects are you most proud of?']
      },
      opening_prompt_target: 'Walk me through your recent experience.'
    }),
    { level: 'b1' }
  );

  assert.equal(pack.topic_mode, 'rehearsal');
  assert.equal(pack.subareas_json.length, 2);
  assert.deepEqual(pack.starter_questions_target, ['Tell me about your last role?']);
  assert.deepEqual(pack.recovery_questions_target, ['What projects are you most proud of?']);
  assert.equal(pack.opening_prompt_target, 'Walk me through your recent experience.');
});

test('opening prompt falls back to selected starter question when explicit prompt is missing', () => {
  const prompt = buildOpeningPromptTarget({
    starter_questions_target: ['Starter one?', 'Starter two?'],
    starter_questions_by_level_target: {
      default: ['Starter one?'],
      a2: ['Level starter?']
    }
  }, { level: 'a2' });

  assert.equal(prompt, 'Level starter?');
});

test('topic mode derivation matches runtime defaults', () => {
  assert.equal(deriveTopicMode('coffee'), 'roleplay');
  assert.equal(deriveTopicMode('office'), 'rehearsal');
  assert.equal(deriveTopicMode('movies'), 'open_chat');
});

test('effective topic tier normalization maps non-free paid plans to pro', () => {
  assert.equal(normalizeEffectiveTopicAccessTier('free'), 'free');
  assert.equal(normalizeEffectiveTopicAccessTier('pro'), 'pro');
  assert.equal(normalizeEffectiveTopicAccessTier('legacy-paid'), 'pro');
  assert.equal(normalizeEffectiveTopicAccessTier('trialing'), 'pro');
  assert.equal(normalizeEffectiveTopicAccessTier(''), 'pro');
});

test('topic visibility keeps all catalog topics visible in the menu', () => {
  const allTopic = makeTopic('all');
  const freeTopic = makeTopic('free');
  const proTopic = makeTopic('pro');

  assert.equal(topicIsVisibleForTier(allTopic, 'free'), true);
  assert.equal(topicIsVisibleForTier(allTopic, 'pro'), true);
  assert.equal(topicIsVisibleForTier(freeTopic, 'free'), true);
  assert.equal(topicIsVisibleForTier(freeTopic, 'pro'), true);
  assert.equal(topicIsVisibleForTier(proTopic, 'free'), true);
  assert.equal(topicIsVisibleForTier(proTopic, 'pro'), true);
});

test('topic subscription gate only locks pro topics for free users', () => {
  const allTopic = makeTopic('all');
  const freeTopic = makeTopic('free');
  const proTopic = makeTopic('pro');

  assert.equal(topicRequiresSubscriptionForTier(allTopic, 'free'), false);
  assert.equal(topicRequiresSubscriptionForTier(freeTopic, 'free'), false);
  assert.equal(topicRequiresSubscriptionForTier(proTopic, 'free'), true);
  assert.equal(topicRequiresSubscriptionForTier(proTopic, 'pro'), false);
});

test('topic pack builder includes access tier in stored snapshot payload', () => {
  const pack = buildTopicPackFromRow(makeTopic('pro'));
  assert.equal(pack.access_tier, 'pro');
  assert.equal(pack.topic_id, 'pro-topic');
  assert.equal(pack.subareas_json.length, 2);
  assert.equal(pack.starter_questions_target.length, 6);
  assert.equal(pack.opening_prompt_target, 'Q1?');
});
