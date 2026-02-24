<template>
  <div ref="scrollWindowEl" class="chat-window" @wheel="handleWheel">
    <div class="chat">
      <div v-for="message in messages" :key="message.id" :class="bubbleClass(message)">
        <template v-if="message.kind === 'voice'">
          <div class="muted mini">{{ t(message.labelKey) }}</div>
          <div class="voice-card" :class="message.voiceRole === 'user' ? 'user-voice' : 'bot-voice'">
            <button
              class="voice-play"
              type="button"
              :aria-label="t(message.voiceRole === 'user' ? 'home.chatDemo.userAudio' : 'home.chatDemo.botAudio')"
            >
              <span class="voice-play-icon" aria-hidden="true">▶</span>
            </button>
            <div class="voice-body">
              <div class="voice-title">{{ t(message.voiceRole === 'user' ? 'home.chatDemo.userAudio' : 'home.chatDemo.botAudio') }}</div>
              <div class="voice-wave" aria-hidden="true">
                <span
                  v-for="(barHeight, idx) in waveformBars"
                  :key="`${message.id}-wave-${idx}`"
                  class="voice-wave-bar"
                  :style="{ '--bar-height': `${barHeight}px` }"
                />
              </div>
              <div class="voice-meta">
                <span>{{ resolveAudioMeta(message.voiceRole).duration }}</span>
                <span class="voice-dot" aria-hidden="true">•</span>
                <span>{{ resolveAudioMeta(message.voiceRole).sentAt }}</span>
                <span v-if="message.voiceRole === 'user'" class="voice-check" aria-hidden="true">✓✓</span>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="message.kind === 'status'">
          <div class="muted mini">{{ t('home.chatDemo.bot') }}</div>
          <div class="chat-status">
            <span class="chat-status-text">{{ t(message.i18nKey) }}</span>
            <span v-if="message.dots" class="chat-dots" aria-hidden="true">...</span>
          </div>
        </template>

        <template v-else-if="message.kind === 'text'">
          <div class="muted mini">{{ t(message.headerKey) }}</div>
          <div>{{ resolveText(message.text) }}</div>

          <div
            v-if="Array.isArray(message.actions) && message.actions.length"
            :class="['chat-inline-actions', message.from === 'user' ? 'inline-right' : '']"
          >
            <button
              v-for="action in message.actions"
              :key="`${message.id}-${action.id}`"
              class="chat-inline-btn"
              type="button"
              :disabled="isActionDisabled(action.id)"
              @click="triggerAction(action.id)"
            >
              {{ actionLabel(action.id) }}
            </button>
          </div>

          <div v-if="messageTranslationVisible(message)" class="chat-translation">
            <div class="chat-translation-title">{{ translationHeaderLabel }}</div>
            <div>{{ resolveText(messageTranslationRef(message)) }}</div>
          </div>
        </template>

        <template v-else-if="message.kind === 'explanation'">
          <div class="muted mini">{{ explanationTitle(message.titleKey) }}</div>

          <div v-if="hasExplanationExample" class="explanation-example">
            <div class="explanation-line">
              <span class="explanation-icon" aria-hidden="true">❌</span>
              <span>{{ explanationExampleValue.wrong }}</span>
            </div>
            <div class="explanation-line">
              <span class="explanation-icon" aria-hidden="true">✅</span>
              <span>{{ explanationExampleValue.right }}</span>
            </div>

            <div class="explanation-rule">
              <span class="explanation-icon" aria-hidden="true">🧠</span>
              <span>
                <span class="explanation-rule-label">[{{ explanationExampleValue.ruleLabel }}]</span>
                <span> {{ explanationExampleValue.ruleText }}</span>
              </span>
            </div>
          </div>

          <div v-else class="explanation-body">
            <div
              v-for="(block, idx) in explanationBlocks(message.blocksKey)"
              :key="`${message.id}-block-${idx}`"
              class="explanation-block"
            >
              <div class="explanation-label">{{ block.title }}</div>
              <div class="explanation-text">{{ block.body }}</div>
            </div>
          </div>
        </template>

        <template v-else-if="message.kind === 'hints'">
          <div class="muted mini">{{ t('home.chatDemo.followUpTitle') }}</div>
          <div class="hint-intro">{{ t('home.chatDemo.hintsIntro') }}</div>

        <div class="hint-block">
          <div class="hint-label">{{ t('home.chatDemo.questionLabel') }}</div>
          <div class="hint-body">
            <div class="hint-line">
              <span class="hint-flag" aria-hidden="true">{{ targetLocaleFlag }}</span>
              <span>{{ scenarioTarget.followUp.question }}</span>
            </div>
            <div class="hint-line">
              <span class="hint-flag" aria-hidden="true">{{ baseLocaleFlag }}</span>
              <span>{{ scenarioBase.followUp.question }}</span>
            </div>
          </div>
        </div>

        <div class="hint-block">
          <div class="hint-label">{{ t('home.chatDemo.simpleLabel') }}</div>
          <div class="hint-body">
            <code>{{ scenarioTarget.followUp.simple }}</code>
            <div>{{ scenarioBase.followUp.simple }}</div>
          </div>
        </div>

        <div class="hint-block">
          <div class="hint-label">{{ t('home.chatDemo.conversationalLabel') }}</div>
          <div class="hint-body">
            <code>{{ scenarioTarget.followUp.conversational }}</code>
            <div>{{ scenarioBase.followUp.conversational }}</div>
          </div>
        </div>

        <div class="hint-block">
          <div class="hint-label">{{ t('home.chatDemo.advancedLabel') }}</div>
          <div class="hint-body">
            <code>{{ scenarioTarget.followUp.advanced }}</code>
            <div>{{ scenarioBase.followUp.advanced }}</div>
          </div>
        </div>

        <div class="hint-block">
          <div class="hint-label">{{ t('home.chatDemo.phrasesLabel') }}</div>
          <div class="hint-body phrase-list">
            <div><code>{{ scenarioTarget.followUp.phrases[0] }}</code> - {{ scenarioBase.followUp.phrases[0] }}</div>
            <div><code>{{ scenarioTarget.followUp.phrases[1] }}</code> - {{ scenarioBase.followUp.phrases[1] }}</div>
            <div><code>{{ scenarioTarget.followUp.phrases[2] }}</code> - {{ scenarioBase.followUp.phrases[2] }}</div>
          </div>
        </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { normalizeLocale, useI18n } from '../i18n.js';
import { resolveScenario } from '../data/chatDemoScenarios.js';
import { resolveConversation } from '../data/chatDemoConversations.js';

const props = defineProps({
  scenarioId: {
    type: String,
    default: 'jobInterview'
  },
  conversationId: {
    type: String,
    default: 'voiceWorkflow'
  },
  autoplay: {
    type: Boolean,
    default: true
  },
  baseLocale: {
    type: String,
    default: ''
  },
  targetByBaseLocale: {
    type: Object,
    default: () => ({})
  },
  scenarios: {
    type: Object,
    default: () => ({})
  },
  conversations: {
    type: Object,
    default: () => ({})
  }
});

const { t, tm, locale } = useI18n();

const waveformBars = [8, 10, 14, 18, 16, 12, 10, 9, 13, 17, 15, 11, 9, 12, 16, 14, 10, 8];
const LOCALE_FLAG_MAP = {
  en: '🇬🇧',
  de: '🇩🇪',
  es: '🇪🇸',
  pt: '🇵🇹',
  uk: '🇺🇦',
  it: '🇮🇹'
};

const baseLocaleCode = computed(() => normalizeLocale(props.baseLocale || locale.value) || 'en');
const resolvedScenario = computed(() =>
  resolveScenario({
    scenarioId: props.scenarioId,
    baseLocale: baseLocaleCode.value,
    targetByBaseLocale: props.targetByBaseLocale,
    scenarios: props.scenarios
  })
);
const targetLocaleCode = computed(() => normalizeLocale(resolvedScenario.value?.targetLocale) || 'en');
const scenarioTarget = computed(() => resolvedScenario.value.targetContent);
const scenarioBase = computed(() => resolvedScenario.value.baseContent);
const scenarioAudio = computed(() => resolvedScenario.value.audio);
const baseLocaleFlag = computed(() => LOCALE_FLAG_MAP[baseLocaleCode.value] || '🏳️');
const targetLocaleFlag = computed(() => LOCALE_FLAG_MAP[targetLocaleCode.value] || '🏳️');

function stripLeadingDecorators(value) {
  return String(value || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

const translateActionLabel = computed(() => `${baseLocaleFlag.value} ${stripLeadingDecorators(t('home.chatDemo.translateAction'))}`);
const translationHeaderLabel = computed(() => `${baseLocaleFlag.value} ${stripLeadingDecorators(t('home.chatDemo.translationHeader'))}`);

const conversation = computed(() =>
  resolveConversation({
    conversationId: props.conversationId,
    conversations: props.conversations
  })
);

const isMounted = ref(false);
const scrollWindowEl = ref(null);
const messages = ref([]);
const actionState = ref({
  translateTranscript: { loading: false, done: false },
  translateReply: { loading: false, done: false },
  followUpHints: { loading: false, done: false }
});

const activeTimeouts = new Set();
let activeRunId = 0;
let scrollRafId = 0;

function scheduleScrollToBottom(behavior = 'smooth') {
  if (!import.meta.client) return;
  if (!isMounted.value) return;

  if (scrollRafId) cancelAnimationFrame(scrollRafId);
  scrollRafId = requestAnimationFrame(async () => {
    scrollRafId = 0;
    await nextTick();
    const el = scrollWindowEl.value;
    if (!el) return;
    const top = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTo({ top, behavior });
  });
}

function handleWheel(event) {
  const el = scrollWindowEl.value;
  if (!el) return;

  const deltaY = event.deltaY || 0;
  if (deltaY === 0) return;

  const epsilon = 1;
  const atTop = el.scrollTop <= epsilon;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - epsilon;

  if ((deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function setDemoTimeout(fn, ms) {
  const id = setTimeout(() => {
    activeTimeouts.delete(id);
    fn();
  }, ms);
  activeTimeouts.add(id);
  return id;
}

function clearDemoTimeouts() {
  for (const id of activeTimeouts) clearTimeout(id);
  activeTimeouts.clear();
}

function delay(ms) {
  return new Promise((resolve) => setDemoTimeout(resolve, ms));
}

function resetDemoState() {
  activeRunId += 1;
  clearDemoTimeouts();
  messages.value = [];
  actionState.value = {
    translateTranscript: { loading: false, done: false },
    translateReply: { loading: false, done: false },
    followUpHints: { loading: false, done: false }
  };
}

function upsertMessage(nextMessage) {
  const idx = messages.value.findIndex((msg) => msg.id === nextMessage.id);
  if (idx >= 0) messages.value.splice(idx, 1, nextMessage);
  else messages.value.push(nextMessage);
  scheduleScrollToBottom();
}

function removeMessageById(id) {
  const idx = messages.value.findIndex((msg) => msg.id === id);
  if (idx >= 0) messages.value.splice(idx, 1);
  scheduleScrollToBottom();
}

function ensureHintsMessage() {
  if (messages.value.some((msg) => msg.kind === 'hints')) return;
  messages.value.push({ id: 'hints', kind: 'hints', from: 'bot' });
  scheduleScrollToBottom();
}

function resolveAudioMeta(voiceRole) {
  if (voiceRole === 'bot') return scenarioAudio.value.bot;
  return scenarioAudio.value.user;
}

function resolveText(refDef) {
  const refObj = refDef && typeof refDef === 'object' ? refDef : {};
  if (refObj.source !== 'scenario') return '';
  const which = refObj.which === 'base' ? 'base' : 'target';
  const path = (refObj.path || '').toString().trim();
  if (!path) return '';

  const source = which === 'base' ? scenarioBase.value : scenarioTarget.value;
  return (source?.[path] || '').toString();
}

function explanationBlocks(blocksKey) {
  const raw = tm(blocksKey);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((block) => ({
      title: (block?.title || '').toString().trim(),
      body: (block?.body || '').toString().trim()
    }))
    .filter((block) => block.title && block.body);
}

function explanationTitle(key) {
  const titleKey = (key || '').toString().trim() || 'home.chatDemo.explanationTitle';
  const raw = tm(titleKey, baseLocaleCode.value);
  if (typeof raw === 'string') return raw;
  return t(titleKey);
}

const explanationExampleValue = computed(() => {
  const raw = tm('home.chatDemo.explanationExample', baseLocaleCode.value);
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    wrong: (value?.wrong || '').toString().trim(),
    right: (value?.right || '').toString().trim(),
    ruleLabel: (value?.ruleLabel || '').toString().trim(),
    ruleText: (value?.ruleText || '').toString().trim()
  };
});

const hasExplanationExample = computed(() =>
  Boolean(
    explanationExampleValue.value.wrong
    && explanationExampleValue.value.right
    && explanationExampleValue.value.ruleLabel
    && explanationExampleValue.value.ruleText
  )
);

function bubbleClass(message) {
  const from = message?.from === 'user' ? 'user' : 'bot';
  const kind = message?.kind || '';
  const headerKey = (message?.headerKey || '').toString();

  return {
    bubble: true,
    you: from === 'user',
    bot: from === 'bot',
    'audio-bubble': kind === 'voice',
    'transcript-bubble': kind === 'text' && headerKey === 'home.chatDemo.transcriptLabel',
    'status-bubble': kind === 'status',
    'explanation-bubble': kind === 'explanation',
    'follow-up': kind === 'hints'
  };
}

function buildMessageFromStep(step) {
  const kind = (step.kind || '').toString();
  const from = step.from === 'user' ? 'user' : 'bot';

  if (kind === 'voice') {
    const source = (step.source || '').toString();
    const voiceRole = step.voiceRole === 'bot' ? 'bot' : step.voiceRole === 'user' ? 'user' : source.endsWith('.bot') ? 'bot' : 'user';
    return {
      id: step.id,
      kind: 'voice',
      from,
      voiceRole,
      labelKey: voiceRole === 'user' ? 'home.chatDemo.you' : 'home.chatDemo.bot'
    };
  }

  if (kind === 'status') {
    return {
      id: step.id,
      kind: 'status',
      from,
      i18nKey: (step.i18nKey || '').toString() || 'home.chatDemo.statusPreparing',
      dots: Boolean(step.dots)
    };
  }

  if (kind === 'text') {
    return {
      id: step.id,
      kind: 'text',
      from,
      headerKey: (step.headerKey || '').toString() || 'home.chatDemo.transcriptLabel',
      text: step.text || null,
      actions: Array.isArray(step.actions) ? step.actions.map((action) => ({ id: action?.id })) : []
    };
  }

  if (kind === 'explanation') {
    return {
      id: step.id,
      kind: 'explanation',
      from,
      titleKey: (step.titleKey || '').toString() || 'home.chatDemo.explanationTitle',
      blocksKey: (step.blocksKey || '').toString() || 'home.chatDemo.explanationBlocks'
    };
  }

  if (kind === 'hints') {
    return {
      id: step.id,
      kind: 'hints',
      from
    };
  }

  return null;
}

function isActionDisabled(actionId) {
  const state = actionState.value[actionId];
  if (!state) return true;
  return Boolean(state.loading || state.done);
}

function actionLabel(actionId) {
  const state = actionState.value[actionId];
  const loading = Boolean(state?.loading);

  if (actionId === 'translateTranscript' || actionId === 'translateReply') {
    return loading ? t('home.chatDemo.translateLoading') : translateActionLabel.value;
  }

  if (actionId === 'followUpHints') {
    return loading ? t('home.chatDemo.followUpLoading') : t('home.chatDemo.followUpAction');
  }

  return actionId;
}

function triggerAction(actionId) {
  const state = actionState.value[actionId];
  if (!state || state.loading || state.done) return;

  if (actionId === 'translateTranscript') {
    state.loading = true;
    setDemoTimeout(() => {
      state.loading = false;
      state.done = true;
      scheduleScrollToBottom();
    }, 2200);
    return;
  }

  if (actionId === 'translateReply') {
    state.loading = true;
    setDemoTimeout(() => {
      state.loading = false;
      state.done = true;
      scheduleScrollToBottom();
    }, 2200);
    return;
  }

  if (actionId === 'followUpHints') {
    state.loading = true;
    setDemoTimeout(() => {
      state.loading = false;
      state.done = true;
      ensureHintsMessage();
      scheduleScrollToBottom();
    }, 2600);
  }
}

function messageTranslationRef(message) {
  const actions = Array.isArray(message?.actions) ? message.actions : [];
  const actionIds = new Set(actions.map((action) => action?.id));

  let actionId = '';
  if (actionIds.has('translateTranscript')) actionId = 'translateTranscript';
  else if (actionIds.has('translateReply')) actionId = 'translateReply';
  else return null;

  const state = actionState.value[actionId];
  if (!state?.done) return null;

  const src = message?.text && typeof message.text === 'object' ? message.text : null;
  if (!src || src.source !== 'scenario' || src.which !== 'target') return null;
  if (!src.path) return null;

  return { source: 'scenario', which: 'base', path: src.path };
}

function messageTranslationVisible(message) {
  return Boolean(messageTranslationRef(message));
}

function seedAutoplayStart(steps) {
  for (const step of steps) {
    if (step.op === 'wait' || step.op === 'invoke') return;
    if (step.op === 'add') {
      const msg = buildMessageFromStep(step);
      if (msg) upsertMessage(msg);
      continue;
    }
    if (step.op === 'remove') removeMessageById(step.id);
  }
}

function seedStaticConversation(steps) {
  for (const step of steps) {
    if (step.op === 'add') {
      const msg = buildMessageFromStep(step);
      if (msg) upsertMessage(msg);
      continue;
    }
    if (step.op === 'remove') removeMessageById(step.id);
  }
}

async function playConversation(steps, runId) {
  for (const step of steps) {
    if (runId !== activeRunId) return;

    if (step.op === 'add') {
      const msg = buildMessageFromStep(step);
      if (msg) upsertMessage(msg);
      continue;
    }

    if (step.op === 'remove') {
      removeMessageById(step.id);
      continue;
    }

    if (step.op === 'wait') {
      const ms = Number(step.ms);
      await delay(Number.isFinite(ms) ? ms : 0);
      continue;
    }

    if (step.op === 'invoke') {
      triggerAction(step.actionId);
    }
  }
}

function restartDemo() {
  resetDemoState();
  const steps = conversation.value.steps;

  if (props.autoplay) seedAutoplayStart(steps);
  else seedStaticConversation(steps);

  if (!isMounted.value || !props.autoplay) return;
  playConversation(steps, activeRunId);
}

watch(
  () => `${props.scenarioId}|${baseLocaleCode.value}|${targetLocaleCode.value}|${props.conversationId}|${props.autoplay}`,
  () => restartDemo()
);

watch(
  () => [props.targetByBaseLocale, props.scenarios, props.conversations],
  () => restartDemo(),
  { deep: true }
);

onMounted(() => {
  isMounted.value = true;
  restartDemo();
  scheduleScrollToBottom('auto');
});

onBeforeUnmount(() => {
  clearDemoTimeouts();
  if (scrollRafId) cancelAnimationFrame(scrollRafId);
});
</script>

<style scoped>
.chat-window {
  width: 100%;
  --chat-window-height: min(560px, 72vh);
  max-height: var(--chat-window-height);
  min-height: var(--chat-window-height);
  overflow-y: auto;
  overscroll-behavior: none;
  padding-right: 6px;
}

.chat {
  width: min(680px, 100%);
  display: grid;
  gap: 12px;
}

.bubble {
  width: fit-content;
  max-width: 78%;
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--bg);
  box-shadow: var(--shadow);
  line-height: 1.55;
}

.mini {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.you {
  justify-self: end;
  background: color-mix(in srgb, var(--bg) 72%, var(--surface));
}

.bot {
  justify-self: start;
  background: color-mix(in srgb, var(--bg) 88%, var(--surface));
}

.audio-bubble {
  width: min(420px, 100%);
  max-width: 92%;
  min-width: 0;
}

.voice-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border-radius: 26px;
  padding: 8px 10px;
}

.user-voice {
  background: #4e7fb3;
  border: 1px solid #5b8ebf;
  color: #f4f9ff;
}

.bot-voice {
  background: #557ea7;
  border: 1px solid #648db7;
  color: #f4f9ff;
}

.voice-play {
  width: 46px;
  height: 46px;
  border: 0;
  border-radius: 999px;
  background: #f7f9fc;
  display: grid;
  place-items: center;
  padding: 0;
  color: #38608b;
  flex: 0 0 auto;
}

.voice-play-icon {
  font-size: 18px;
  transform: translateX(2px);
}

.voice-body {
  display: grid;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.voice-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  opacity: 0.92;
}

.voice-wave {
  height: 18px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  overflow: hidden;
}

.voice-wave-bar {
  width: 3px;
  height: var(--bar-height, 10px);
  border-radius: 999px;
  background: rgba(250, 253, 255, 0.95);
}

.voice-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 800;
  opacity: 0.94;
  flex-wrap: wrap;
  min-width: 0;
}

.voice-check {
  letter-spacing: -0.08em;
}

.voice-dot {
  font-weight: 800;
}

.transcript-bubble {
  max-width: min(620px, 100%);
}

.transcript-bubble,
.follow-up,
.explanation-bubble {
  max-width: 92%;
}

.chat-translation {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
}

.chat-translation-title {
  font-size: 12px;
  font-weight: 800;
  margin-bottom: 4px;
  color: color-mix(in srgb, var(--fg) 84%, var(--muted));
}

.chat-inline-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: flex-start;
  margin-top: 10px;
}

.chat-inline-btn {
  border: 1px solid color-mix(in srgb, var(--fg) 18%, var(--border));
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
  background: color-mix(in srgb, var(--bg) 84%, var(--surface));
  color: var(--fg);
  cursor: pointer;
  align-self: flex-start;
  height: auto;
}

.chat-inline-btn:disabled {
  cursor: default;
  opacity: 0.72;
}

.inline-right {
  justify-content: flex-end;
}

.status-bubble {
  max-width: 64%;
}

.chat-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 800;
}

.chat-status-text {
  color: color-mix(in srgb, var(--fg) 92%, var(--muted));
}

.chat-dots {
  display: inline-block;
  width: 1.2em;
  overflow: hidden;
  line-height: 1;
  transform: translateY(1px);
  animation: chatDots 1.2s steps(4, end) infinite;
  opacity: 0.9;
}

@keyframes chatDots {
  0% {
    width: 0;
  }
  100% {
    width: 1.2em;
  }
}

.explanation-bubble {
  width: min(620px, 100%);
  display: grid;
  gap: 10px;
  background: color-mix(in srgb, var(--surface) 65%, var(--bg));
}

.explanation-example {
  display: grid;
  gap: 6px;
}

.explanation-line,
.explanation-rule {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.explanation-icon {
  font-size: 16px;
  line-height: 1;
  transform: translateY(1px);
}

.explanation-rule {
  line-height: 1.55;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
}

.explanation-rule-label {
  font-weight: 900;
}

.explanation-body {
  display: grid;
  gap: 10px;
}

.explanation-block {
  border: 1px solid color-mix(in srgb, var(--fg) 12%, var(--border));
  border-radius: 12px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--bg) 75%, var(--surface));
}

.explanation-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  margin-bottom: 6px;
  color: color-mix(in srgb, var(--fg) 78%, var(--muted));
}

.explanation-text {
  line-height: 1.55;
}

.follow-up {
  justify-self: start;
  width: min(620px, 100%);
  max-width: 100%;
  display: grid;
  gap: 8px;
  background: color-mix(in srgb, var(--surface) 70%, var(--bg));
}

.hint-intro {
  line-height: 1.45;
}

.hint-block {
  border: 1px solid color-mix(in srgb, var(--fg) 12%, var(--border));
  border-radius: 12px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--bg) 75%, var(--surface));
}

.hint-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  margin-bottom: 6px;
  color: color-mix(in srgb, var(--fg) 78%, var(--muted));
}

.hint-body {
  display: grid;
  gap: 4px;
  line-height: 1.45;
}

.hint-line {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.hint-flag {
  font-size: 16px;
  line-height: 1;
  transform: translateY(1px);
}

.hint-body code {
  background: color-mix(in srgb, var(--surface) 55%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
  border-radius: 8px;
  padding: 2px 6px;
  width: fit-content;
}

.phrase-list {
  gap: 6px;
}

@media (max-width: 420px) {
  .bubble {
    padding: 10px 12px;
  }

  .voice-card {
    border-radius: 22px;
    padding: 7px 9px;
    gap: 8px;
  }

  .voice-play {
    width: 40px;
    height: 40px;
  }

  .voice-wave {
    height: 16px;
  }

  .voice-wave-bar {
    width: 2px;
  }

  .voice-meta {
    font-size: 11px;
    gap: 5px;
  }
}
</style>
