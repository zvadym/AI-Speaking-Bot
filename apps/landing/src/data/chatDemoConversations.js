function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeConversationId(value) {
  return (value || '').toString().trim() || '';
}

function isStep(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.op === 'string';
}

function sanitizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.filter(isStep).map((step) => ({ ...step }));
}

export const DEFAULT_CONVERSATIONS = {
  voiceWorkflow: {
    id: 'voiceWorkflow',
    steps: [
      { op: 'add', id: 'userVoice', kind: 'voice', from: 'user', source: 'scenarioAudio.user' },
      { op: 'wait', ms: 300 },

      { op: 'add', id: 'listening', kind: 'status', from: 'bot', i18nKey: 'home.chatDemo.statusListening', dots: true },
      { op: 'wait', ms: 1100 },
      { op: 'remove', id: 'listening' },

      {
        op: 'add',
        id: 'userTranscript',
        kind: 'text',
        from: 'user',
        headerKey: 'home.chatDemo.transcriptLabel',
        text: { source: 'scenario', which: 'target', path: 'userTranscript' },
        actions: [{ id: 'translateTranscript' }]
      },

      { op: 'wait', ms: 300 },
      { op: 'add', id: 'preparing', kind: 'status', from: 'bot', i18nKey: 'home.chatDemo.statusPreparing', dots: true },
      { op: 'wait', ms: 1200 },
      { op: 'remove', id: 'preparing' },

      { op: 'add', id: 'botVoice', kind: 'voice', from: 'bot', source: 'scenarioAudio.bot' },
      {
        op: 'add',
        id: 'botReply',
        kind: 'text',
        from: 'bot',
        headerKey: 'home.chatDemo.botTranscriptLabel',
        text: { source: 'scenario', which: 'target', path: 'botTranscript' },
        actions: [{ id: 'translateReply' }, { id: 'followUpHints' }]
      },

      { op: 'wait', ms: 350 },
      { op: 'add', id: 'explanation', kind: 'explanation', from: 'bot', titleKey: 'home.chatDemo.explanationTitle', blocksKey: 'home.chatDemo.explanationBlocks' },

      { op: 'wait', ms: 1200 },
      { op: 'invoke', actionId: 'translateReply' },

      { op: 'wait', ms: 1400 },
      { op: 'invoke', actionId: 'followUpHints' }
    ]
  }
};

export function resolveConversation({ conversationId = 'voiceWorkflow', conversations = {} } = {}) {
  const merged = {
    ...DEFAULT_CONVERSATIONS,
    ...asObject(conversations)
  };

  const requestedId = normalizeConversationId(conversationId) || 'voiceWorkflow';
  const requested = merged[requestedId];
  const fallback = merged.voiceWorkflow;
  const first = Object.values(merged)[0];

  const chosen = asObject(requested) || asObject(fallback) || asObject(first);
  const chosenId = normalizeConversationId(chosen.id) || requestedId || 'voiceWorkflow';
  const steps = sanitizeSteps(chosen.steps);

  if (steps.length > 0) {
    return { id: chosenId, steps };
  }

  const fallbackSteps = sanitizeSteps(fallback?.steps);
  if (fallbackSteps.length > 0) return { id: 'voiceWorkflow', steps: fallbackSteps };

  return { id: chosenId, steps: [] };
}
