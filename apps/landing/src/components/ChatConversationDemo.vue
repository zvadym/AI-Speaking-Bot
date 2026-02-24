<template>
  <div class="chat">
    <div class="bubble you audio-bubble">
      <div class="muted mini">{{ t('home.chatDemo.you') }}</div>
      <div class="voice-card user-voice">
        <button class="voice-play" type="button" :aria-label="t('home.chatDemo.userAudio')">
          <span class="voice-play-icon" aria-hidden="true">▶</span>
        </button>
        <div class="voice-body">
          <div class="voice-title">{{ t('home.chatDemo.userAudio') }}</div>
          <div class="voice-wave" aria-hidden="true">
            <span
              v-for="(barHeight, idx) in waveformBars"
              :key="`user-wave-${idx}`"
              class="voice-wave-bar"
              :style="{ '--bar-height': `${barHeight}px` }"
            />
          </div>
          <div class="voice-meta">
            <span>{{ scenarioAudio.user.duration }}</span>
            <span class="voice-dot" aria-hidden="true">•</span>
            <span>{{ scenarioAudio.user.sentAt }}</span>
            <span class="voice-check" aria-hidden="true">✓✓</span>
          </div>
        </div>
      </div>
    </div>

    <div class="bubble you transcript-bubble">
      <div class="muted mini">{{ t('home.chatDemo.transcriptLabel') }}</div>
      <div>{{ scenarioTarget.userTranscript }}</div>
      <div class="chat-inline-actions inline-right">
        <button
          class="chat-inline-btn"
          type="button"
          :disabled="showUserTranscriptTranslation || isTranslatingUserTranscript"
          @click="handleTranslateUserTranscript"
        >
          {{ isTranslatingUserTranscript ? t('home.chatDemo.translateLoading') : translateActionLabel }}
        </button>
      </div>
      <div v-if="showUserTranscriptTranslation" class="chat-translation">
        <div class="chat-translation-title">{{ translationHeaderLabel }}</div>
        <div>{{ scenarioBase.userTranscript }}</div>
      </div>
    </div>

    <div class="bubble bot audio-bubble">
      <div class="muted mini">{{ t('home.chatDemo.bot') }}</div>
      <div class="voice-card bot-voice">
        <button class="voice-play" type="button" :aria-label="t('home.chatDemo.botAudio')">
          <span class="voice-play-icon" aria-hidden="true">▶</span>
        </button>
        <div class="voice-body">
          <div class="voice-title">{{ t('home.chatDemo.botAudio') }}</div>
          <div class="voice-wave" aria-hidden="true">
            <span
              v-for="(barHeight, idx) in waveformBars"
              :key="`bot-wave-${idx}`"
              class="voice-wave-bar"
              :style="{ '--bar-height': `${barHeight}px` }"
            />
          </div>
          <div class="voice-meta">
            <span>{{ scenarioAudio.bot.duration }}</span>
            <span class="voice-dot" aria-hidden="true">•</span>
            <span>{{ scenarioAudio.bot.sentAt }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="bubble bot">
      <div class="muted mini">{{ t('home.chatDemo.botTranscriptLabel') }}</div>
      <div>{{ scenarioTarget.botTranscript }}</div>
      <div v-if="showReplyTranslation" class="chat-translation">
        <div class="chat-translation-title">{{ translationHeaderLabel }}</div>
        <div>{{ scenarioBase.botTranscript }}</div>
      </div>
    </div>

    <div class="chat-inline-actions">
      <button
        class="chat-inline-btn"
        type="button"
        :disabled="showReplyTranslation || isTranslatingReply"
        @click="handleTranslateReply"
      >
        {{ isTranslatingReply ? t('home.chatDemo.translateLoading') : translateActionLabel }}
      </button>
      <button class="chat-inline-btn" type="button" :disabled="showFollowUp || isLoadingHints" @click="handleFollowUp">
        {{ isLoadingHints ? t('home.chatDemo.followUpLoading') : t('home.chatDemo.followUpAction') }}
      </button>
    </div>

    <div v-if="showFollowUp" class="bubble bot follow-up">
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
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { normalizeLocale, useI18n } from '../i18n.js';
import { resolveScenario } from '../data/chatDemoScenarios.js';

const props = defineProps({
  scenarioId: {
    type: String,
    default: 'jobInterview'
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
  }
});

const { t, locale } = useI18n();

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

const showUserTranscriptTranslation = ref(false);
const showReplyTranslation = ref(false);
const showFollowUp = ref(false);
const isTranslatingUserTranscript = ref(false);
const isTranslatingReply = ref(false);
const isLoadingHints = ref(false);
let userTranscriptTranslateTimer = null;
let replyTranslateTimer = null;
let hintsTimer = null;

function clearDemoTimers() {
  if (userTranscriptTranslateTimer) {
    clearTimeout(userTranscriptTranslateTimer);
    userTranscriptTranslateTimer = null;
  }
  if (replyTranslateTimer) {
    clearTimeout(replyTranslateTimer);
    replyTranslateTimer = null;
  }
  if (hintsTimer) {
    clearTimeout(hintsTimer);
    hintsTimer = null;
  }
}

function resetDemoState() {
  clearDemoTimers();
  showUserTranscriptTranslation.value = false;
  showReplyTranslation.value = false;
  showFollowUp.value = false;
  isTranslatingUserTranscript.value = false;
  isTranslatingReply.value = false;
  isLoadingHints.value = false;
}

function handleTranslateUserTranscript() {
  if (showUserTranscriptTranslation.value || isTranslatingUserTranscript.value) return;
  isTranslatingUserTranscript.value = true;
  userTranscriptTranslateTimer = setTimeout(() => {
    isTranslatingUserTranscript.value = false;
    showUserTranscriptTranslation.value = true;
    userTranscriptTranslateTimer = null;
  }, 520);
}

function handleTranslateReply() {
  if (showReplyTranslation.value || isTranslatingReply.value) return;
  isTranslatingReply.value = true;
  replyTranslateTimer = setTimeout(() => {
    isTranslatingReply.value = false;
    showReplyTranslation.value = true;
    replyTranslateTimer = null;
  }, 560);
}

function handleFollowUp() {
  if (showFollowUp.value || isLoadingHints.value) return;
  isLoadingHints.value = true;
  hintsTimer = setTimeout(() => {
    isLoadingHints.value = false;
    showFollowUp.value = true;
    hintsTimer = null;
  }, 650);
}

watch(
  () => `${props.scenarioId}|${baseLocaleCode.value}|${resolvedScenario.value.targetLocale}`,
  () => resetDemoState()
);

watch(
  () => [props.targetByBaseLocale, props.scenarios],
  () => resetDemoState(),
  { deep: true }
);

onBeforeUnmount(() => clearDemoTimers());
</script>

<style scoped>
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
.follow-up {
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
  justify-self: start;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: flex-start;
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
  justify-self: end;
  margin-top: 10px;
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
