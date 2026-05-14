<template>
  <section class="telegram-device" :aria-label="t('home.chatDemo.windowLabel')">
    <div class="telegram-frame">
      <div class="telegram-screen">
        <div class="telegram-statusbar" aria-hidden="true">
          <span>9:41</span>
          <span class="dynamic-island" />
          <span class="telegram-status-icons">
            <span class="status-bars"><span /><span /><span /></span>
            <span class="status-battery" />
          </span>
        </div>

        <div class="telegram-header">
          <span class="telegram-back" aria-hidden="true" />
          <div class="telegram-avatar" aria-hidden="true">R</div>
          <div class="telegram-title-block">
            <div class="telegram-title">Romi</div>
            <div class="telegram-subtitle">{{ t('home.chatDemo.telegramSubtitle') }}</div>
          </div>
          <span class="telegram-menu" aria-hidden="true" />
        </div>

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
              <span class="explanation-icon bad" aria-hidden="true">!</span>
              <span>{{ explanationExampleValue.wrong }}</span>
            </div>
            <div class="explanation-line">
              <span class="explanation-icon good" aria-hidden="true">✓</span>
              <span>{{ explanationExampleValue.right }}</span>
            </div>

            <div class="explanation-rule">
              <span class="explanation-icon rule" aria-hidden="true">i</span>
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

        <div class="telegram-composer" aria-hidden="true">
          <span class="composer-plus">+</span>
          <span class="composer-input">{{ t('home.chatDemo.composerPlaceholder') }}</span>
          <span class="composer-mic" />
        </div>
      </div>
    </div>
  </section>
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
.telegram-device {
  width: min(340px, 100%);
  margin: 0 auto;
  color: #17212b;
  --tg-blue: #229ed9;
  --tg-blue-dark: #178ac2;
  --tg-green: #d9fdd3;
  --tg-wall: #dfeaf0;
}

.telegram-frame {
  aspect-ratio: 71.9 / 150;
  border-radius: 38px;
  padding: 8px;
  background:
    linear-gradient(145deg, #28333c, #0f1419 58%, #303b45);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 34px 72px rgba(23, 33, 43, 0.24),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.telegram-screen {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 31px;
  background: #f8fafb;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.telegram-statusbar {
  position: relative;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: #f8fafb;
  color: #17212b;
  font-size: 12px;
  font-weight: 900;
}

.dynamic-island {
  position: absolute;
  left: 50%;
  top: 7px;
  width: 88px;
  height: 24px;
  border-radius: 999px;
  background: #0b0f13;
  transform: translateX(-50%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.telegram-status-icons {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.status-bars {
  display: inline-flex;
  align-items: end;
  gap: 2px;
  height: 12px;
}

.status-bars span {
  width: 3px;
  border-radius: 2px;
  background: #17212b;
}

.status-bars span:nth-child(1) {
  height: 5px;
}

.status-bars span:nth-child(2) {
  height: 8px;
}

.status-bars span:nth-child(3) {
  height: 11px;
}

.status-battery {
  width: 22px;
  height: 10px;
  border: 1.7px solid #17212b;
  border-radius: 3px;
  position: relative;
}

.status-battery::before {
  content: '';
  position: absolute;
  right: -4px;
  top: 2px;
  width: 2px;
  height: 4px;
  border-radius: 0 2px 2px 0;
  background: #17212b;
}

.status-battery::after {
  content: '';
  position: absolute;
  inset: 2px 5px 2px 2px;
  border-radius: 1px;
  background: #17212b;
}

.telegram-header {
  min-height: 54px;
  display: grid;
  grid-template-columns: 22px 36px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 9px;
  padding: 6px 11px 7px;
  background: #ffffff;
  border-bottom: 1px solid rgba(23, 33, 43, 0.08);
}

.telegram-back {
  width: 22px;
  height: 22px;
  position: relative;
}

.telegram-back::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 5px;
  width: 9px;
  height: 9px;
  border-left: 2px solid var(--tg-blue);
  border-bottom: 2px solid var(--tg-blue);
  transform: rotate(45deg);
}

.telegram-avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background:
    linear-gradient(135deg, #37b7ef, #1a8fc7 52%, #26a269);
  color: #ffffff;
  font-weight: 900;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
}

.telegram-title-block {
  min-width: 0;
}

.telegram-title {
  font-size: 14px;
  font-weight: 900;
  line-height: 1.15;
}

.telegram-subtitle {
  margin-top: 2px;
  color: #748391;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.telegram-menu {
  width: 24px;
  height: 24px;
  position: relative;
}

.telegram-menu::before,
.telegram-menu::after {
  content: '';
  position: absolute;
  left: 10px;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--tg-blue);
  box-shadow: 0 7px 0 var(--tg-blue);
}

.telegram-menu::before {
  top: 4px;
}

.telegram-menu::after {
  display: none;
}

.chat-window {
  width: 100%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 7px 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(23, 33, 43, 0.24) transparent;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.32) 0 1px, transparent 1px 26px),
    linear-gradient(45deg, rgba(34, 158, 217, 0.11) 0 1px, transparent 1px 28px),
    var(--tg-wall);
}

.chat-window::-webkit-scrollbar {
  width: 6px;
}

.chat-window::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(23, 33, 43, 0.24);
}

.chat {
  width: 100%;
  min-height: 100%;
  display: grid;
  align-content: end;
  gap: 7px;
}

.bubble {
  position: relative;
  width: fit-content;
  max-width: 84%;
  padding: 7px 9px 6px;
  border: 0;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(23, 33, 43, 0.12);
  line-height: 1.4;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.bubble::after {
  content: '';
  position: absolute;
  bottom: 0;
  width: 10px;
  height: 10px;
  background: inherit;
}

.mini {
  color: #68818f;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: none;
  margin-bottom: 3px;
}

.you {
  justify-self: end;
  background: var(--tg-green);
  border-bottom-right-radius: 5px;
}

.you::after {
  right: -5px;
  clip-path: polygon(0 0, 100% 100%, 0 100%);
}

.you .mini {
  color: #4b7f43;
}

.bot {
  justify-self: start;
  background: #ffffff;
  border-bottom-left-radius: 5px;
}

.bot::after {
  left: -5px;
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
}

.audio-bubble {
  width: min(274px, 90%);
  max-width: 90%;
  min-width: 0;
  padding: 7px 9px;
}

.voice-card {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border-radius: 0;
  padding: 0;
  color: inherit;
}

.voice-play {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  display: grid;
  place-items: center;
  padding: 0;
  color: #ffffff;
  flex: 0 0 auto;
  cursor: pointer;
}

.bot-voice .voice-play {
  background: var(--tg-blue);
}

.user-voice .voice-play {
  background: #55b95a;
}

.voice-play-icon {
  font-size: 15px;
  transform: translateX(1px);
}

.voice-body {
  display: grid;
  gap: 3px;
  width: 100%;
  min-width: 0;
}

.voice-title {
  color: #5e7482;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: none;
}

.voice-wave {
  height: 16px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  overflow: hidden;
}

.voice-wave-bar {
  width: 2px;
  height: var(--bar-height, 10px);
  border-radius: 999px;
}

.bot-voice .voice-wave-bar {
  background: rgba(34, 158, 217, 0.58);
}

.user-voice .voice-wave-bar {
  background: rgba(56, 150, 54, 0.54);
}

.voice-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #6d818d;
  font-size: 11px;
  font-weight: 800;
  flex-wrap: wrap;
  min-width: 0;
}

.voice-check {
  color: var(--tg-blue);
  letter-spacing: 0;
}

.voice-dot {
  font-weight: 800;
}

.transcript-bubble,
.follow-up,
.explanation-bubble {
  max-width: 90%;
}

.chat-translation {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(23, 33, 43, 0.10);
}

.chat-translation-title {
  color: #516977;
  font-size: 11px;
  font-weight: 900;
  margin-bottom: 4px;
}

.chat-inline-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: flex-start;
  margin-top: 8px;
}

.chat-inline-btn {
  border: 1px solid rgba(34, 158, 217, 0.18);
  border-radius: 10px;
  padding: 6px 9px;
  font-size: 11px;
  font-weight: 900;
  line-height: 1.2;
  background: rgba(255, 255, 255, 0.78);
  color: var(--tg-blue-dark);
  cursor: pointer;
  align-self: flex-start;
  height: auto;
}

.chat-inline-btn:disabled {
  cursor: default;
  opacity: 0.68;
}

.inline-right {
  justify-content: flex-end;
}

.status-bubble {
  max-width: 68%;
  color: #546a78;
}

.chat-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 900;
}

.chat-status-text {
  color: #546a78;
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
  width: min(292px, 90%);
  display: grid;
  gap: 9px;
  background: #ffffff;
}

.explanation-example {
  display: grid;
  gap: 6px;
}

.explanation-line,
.explanation-rule {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.explanation-icon {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: #ffffff;
  font-size: 11px;
  font-weight: 900;
  line-height: 1;
}

.explanation-icon.bad {
  background: #e8594f;
}

.explanation-icon.good {
  background: #35a853;
}

.explanation-icon.rule {
  background: var(--tg-blue);
  font-style: italic;
}

.explanation-rule {
  line-height: 1.45;
  margin-top: 5px;
  padding-top: 8px;
  border-top: 1px solid rgba(23, 33, 43, 0.10);
}

.explanation-rule-label {
  font-weight: 900;
}

.explanation-body {
  display: grid;
  gap: 8px;
}

.explanation-block,
.hint-block {
  border: 1px solid rgba(23, 33, 43, 0.08);
  border-radius: 12px;
  padding: 8px 9px;
  background: rgba(248, 250, 251, 0.72);
}

.explanation-label,
.hint-label {
  color: #5c7380;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: none;
  margin-bottom: 5px;
}

.explanation-text {
  line-height: 1.45;
}

.follow-up {
  justify-self: start;
  width: min(292px, 90%);
  display: grid;
  gap: 8px;
  background: #ffffff;
}

.hint-intro {
  line-height: 1.4;
}

.hint-body {
  display: grid;
  gap: 4px;
  line-height: 1.4;
}

.hint-line {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.hint-flag {
  font-size: 15px;
  line-height: 1;
  transform: translateY(1px);
}

.hint-body code {
  width: fit-content;
  max-width: 100%;
  border: 1px solid rgba(34, 158, 217, 0.14);
  border-radius: 8px;
  padding: 2px 5px;
  background: rgba(34, 158, 217, 0.08);
  color: #12638f;
  white-space: normal;
}

.phrase-list {
  gap: 6px;
}

.telegram-composer {
  min-height: 50px;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 32px;
  align-items: center;
  gap: 7px;
  padding: 8px 9px 9px;
  background: #f8fafb;
  border-top: 1px solid rgba(23, 33, 43, 0.08);
}

.composer-plus,
.composer-mic {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: #7a8996;
  font-weight: 900;
  background: #edf1f4;
}

.composer-input {
  min-width: 0;
  border-radius: 999px;
  padding: 8px 12px;
  background: #ffffff;
  color: #8b99a5;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-mic {
  position: relative;
}

.composer-mic::before {
  content: '';
  width: 10px;
  height: 15px;
  border: 2px solid currentColor;
  border-radius: 8px;
  border-bottom-width: 3px;
}

.composer-mic::after {
  content: '';
  position: absolute;
  left: 15px;
  bottom: 7px;
  width: 6px;
  height: 2px;
  border-radius: 999px;
  background: currentColor;
}

@media (max-width: 420px) {
  .telegram-device {
    width: min(318px, 100%);
  }

  .telegram-frame {
    border-radius: 32px;
    padding: 8px;
  }

  .telegram-screen {
    border-radius: 26px;
  }

  .telegram-header {
    grid-template-columns: 20px 34px minmax(0, 1fr) 22px;
    gap: 8px;
    padding-inline: 10px;
  }

  .telegram-avatar {
    width: 34px;
    height: 34px;
  }

  .bubble {
    max-width: 86%;
    padding: 7px 9px;
    font-size: 12px;
  }

  .audio-bubble,
  .transcript-bubble,
  .follow-up,
  .explanation-bubble {
    max-width: 90%;
  }

  .voice-play {
    width: 34px;
    height: 34px;
  }

  .voice-wave {
    height: 15px;
  }

  .voice-wave-bar {
    width: 2px;
  }

  .voice-meta {
    font-size: 10px;
    gap: 4px;
  }
}
</style>
