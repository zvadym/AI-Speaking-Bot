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
            <span>{{ t('home.chatDemo.userAudioDuration') }}</span>
            <span class="voice-dot" aria-hidden="true">•</span>
            <span>{{ t('home.chatDemo.userAudioSentAt') }}</span>
            <span class="voice-check" aria-hidden="true">✓✓</span>
          </div>
        </div>
      </div>
    </div>

    <div class="bubble you transcript-bubble">
      <div class="muted mini">{{ t('home.chatDemo.transcriptLabel') }}</div>
      <div>{{ demoTarget.userTranscriptText }}</div>
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
        <div>{{ t('home.chatDemo.userTranscriptTranslation') }}</div>
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
            <span>{{ t('home.chatDemo.botAudioDuration') }}</span>
            <span class="voice-dot" aria-hidden="true">•</span>
            <span>{{ t('home.chatDemo.botAudioSentAt') }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="bubble bot">
      <div class="muted mini">{{ t('home.chatDemo.botTranscriptLabel') }}</div>
      <div>{{ demoTarget.botTranscriptText }}</div>
      <div v-if="showReplyTranslation" class="chat-translation">
        <div class="chat-translation-title">{{ translationHeaderLabel }}</div>
        <div>{{ t('home.chatDemo.botTranscriptTranslation') }}</div>
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
          <div>❓ {{ demoTarget.question }}</div>
          <div>📝 {{ t('home.chatDemo.questionBase') }}</div>
        </div>
      </div>

      <div class="hint-block">
        <div class="hint-label">{{ t('home.chatDemo.simpleLabel') }}</div>
        <div class="hint-body">
          <code>{{ demoTarget.simple }}</code>
          <div>{{ t('home.chatDemo.simpleBase') }}</div>
        </div>
      </div>

      <div class="hint-block">
        <div class="hint-label">{{ t('home.chatDemo.conversationalLabel') }}</div>
        <div class="hint-body">
          <code>{{ demoTarget.conversational }}</code>
          <div>{{ t('home.chatDemo.conversationalBase') }}</div>
        </div>
      </div>

      <div class="hint-block">
        <div class="hint-label">{{ t('home.chatDemo.advancedLabel') }}</div>
        <div class="hint-body">
          <code>{{ demoTarget.advanced }}</code>
          <div>{{ t('home.chatDemo.advancedBase') }}</div>
        </div>
      </div>

      <div class="hint-block">
        <div class="hint-label">{{ t('home.chatDemo.phrasesLabel') }}</div>
        <div class="hint-body phrase-list">
          <div><code>{{ demoTarget.phraseOne }}</code> - {{ t('home.chatDemo.phraseOneBase') }}</div>
          <div><code>{{ demoTarget.phraseTwo }}</code> - {{ t('home.chatDemo.phraseTwoBase') }}</div>
          <div><code>{{ demoTarget.phraseThree }}</code> - {{ t('home.chatDemo.phraseThreeBase') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from '../i18n.js';

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
const TARGET_BY_BASE_LOCALE = {
  en: 'es',
  de: 'en',
  es: 'en',
  pt: 'en',
  uk: 'en',
  it: 'en'
};
const TARGET_DEMO_CONTENT = {
  en: {
    userTranscriptText:
      'Tomorrow I have a job interview for a Product Manager role. What can I say when they ask, "Why should we hire you?"',
    botTranscriptText:
      'Good question. Keep it short and concrete: connect your experience to results, then end with confidence. What is one achievement with a measurable impact you can mention?',
    question: 'What is one achievement with a measurable impact you can mention?',
    simple: 'In my last role, I improved onboarding and reduced drop-off by 12%.',
    conversational:
      'I focus on turning messy processes into clear steps, and that helped our team cut onboarding drop-off by 12%.',
    advanced:
      'I combine product thinking with execution: I mapped friction points, aligned the team on priorities, and we delivered changes that improved onboarding retention by 12%.',
    phraseOne: 'I can add value from day one.',
    phraseTwo: 'I focus on measurable outcomes.',
    phraseThree: 'I work well across teams.'
  },
  es: {
    userTranscriptText:
      'Mañana tengo una entrevista de trabajo para un puesto de Product Manager. ¿Qué puedo decir cuando me pregunten: «¿Por qué deberíamos contratarte?»',
    botTranscriptText:
      'Buena pregunta. Mantenlo breve y concreto: conecta tu experiencia con resultados y termina con seguridad. ¿Qué logro con impacto medible puedes mencionar?',
    question: '¿Qué logro con impacto medible puedes mencionar?',
    simple: 'En mi último puesto, mejoré el onboarding y reduje el abandono en un 12%.',
    conversational:
      'Me enfoco en convertir procesos desordenados en pasos claros, y eso ayudó a nuestro equipo a reducir el abandono del onboarding en un 12%.',
    advanced:
      'Combino pensamiento de producto con ejecución: identifiqué puntos de fricción, alineé al equipo en prioridades y aplicamos cambios que mejoraron la retención en onboarding en un 12%.',
    phraseOne: 'Puedo aportar valor desde el primer día.',
    phraseTwo: 'Me enfoco en resultados medibles.',
    phraseThree: 'Trabajo bien entre equipos.'
  }
};

function stripLeadingDecorators(value) {
  return String(value || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

const baseLocaleCode = computed(() => (locale.value || 'en').toString().trim().toLowerCase());
const baseLocaleFlag = computed(() => LOCALE_FLAG_MAP[baseLocaleCode.value] || '🏳️');
const activeTargetCode = computed(() => TARGET_BY_BASE_LOCALE[baseLocaleCode.value] || 'en');
const demoTarget = computed(() => TARGET_DEMO_CONTENT[activeTargetCode.value] || TARGET_DEMO_CONTENT.en);
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
  min-width: min(320px, 78%);
}

.voice-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 280px;
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
}

.voice-wave-bar {
  width: 3px;
  height: var(--bar-height, 10px);
  border-radius: 999px;
  background: rgba(250, 253, 255, 0.95);
}

.voice-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 800;
  opacity: 0.94;
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
}

.chat-inline-btn {
  border: 1px solid color-mix(in srgb, var(--fg) 18%, var(--border));
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 800;
  background: color-mix(in srgb, var(--bg) 84%, var(--surface));
  color: var(--fg);
  cursor: pointer;
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
</style>
