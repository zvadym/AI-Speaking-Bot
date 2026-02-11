<template>
  <div class="shell fade-in">
    <header class="page-hero">
      <div class="kicker">{{ $t('about.kicker') }}</div>
      <h1>{{ $t('about.title') }}</h1>
      <p class="sub">
        {{ $t('about.sub') }}
      </p>
    </header>

    <section class="card">
      <h2>{{ $t('about.school.title') }}</h2>
      <p class="card-sub">{{ $t('about.school.desc') }}</p>
      <button class="school-link" type="button" @click="openSchoolUrl">
        {{ $t('about.school.linkLabel') }} ↗
      </button>
      <p class="url-hint">{{ schoolUrlLabel }}</p>
    </section>

    <section class="card">
      <h2>{{ $t('about.multilingual.title') }}</h2>
      <p class="card-sub">{{ $t('about.multilingual.desc') }}</p>
      <ul>
        <li>{{ $t('about.multilingual.availableNow', { languages: languageCount, teachers: teacherCount }) }}</li>
        <li><b>{{ $t('about.multilingual.languagesTitle') }}</b>: {{ languagesSummary }}</li>
        <li><b>{{ $t('about.multilingual.teachersTitle') }}</b>: {{ teachersSummary }}</li>
      </ul>
    </section>

    <section class="card">
      <h2>{{ $t('about.saved.title') }}</h2>
      <ul>
        <li><b>{{ $t('about.saved.languageTitle') }}</b>: {{ $t('about.saved.languageDesc') }}</li>
        <li><b>{{ $t('about.saved.levelTitle') }}</b>: {{ $t('about.saved.levelDesc') }}</li>
        <li><b>{{ $t('about.saved.subscriptionTitle') }}</b>: {{ $t('about.saved.subscriptionDesc') }}</li>
      </ul>
    </section>

    <section class="card">
      <h2>{{ $t('about.tips.title') }}</h2>
      <ul>
        <li>{{ $t('about.tips.pickLanguageFirst') }}</li>
        <li>{{ $t('about.tips.sendVoice') }}</li>
      </ul>
    </section>

    <BackToMenu @navigate="(path) => $emit('navigate', path)" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import BackToMenu from '../components/BackToMenu.vue';
import { useI18n } from '../i18n.js';
import { tgOpenLink } from '../lib/tg.js';

const props = defineProps({
  bots: { type: Array, default: () => [] }
});
defineEmits(['navigate']);

const { t } = useI18n({ useScope: 'global' });
const schoolUrl = ((import.meta.env.VITE_SCHOOL_URL || 'https://ai-language-school.online/').toString()).trim();

function languageLabelForCode(codeRaw) {
  const code = (codeRaw || '').toString().trim().toLowerCase();
  if (!code) return '';
  if (code === 'en') return t('practiceLanguages.en');
  if (code === 'de') return t('practiceLanguages.de');
  return code.toUpperCase();
}

const normalizedBots = computed(() =>
  (Array.isArray(props.bots) ? props.bots : [])
    .map((row) => {
      const botKey = (row?.bot_key || '').toString().trim().toLowerCase();
      if (!botKey) return null;
      const [baseFromKey, learningFromKey] = botKey.split('-');
      const learningCode = (
        row?.learning_language ||
        row?.target_lang ||
        learningFromKey ||
        ''
      ).toString().trim().toLowerCase();
      const baseCode = (row?.base_language || baseFromKey || '').toString().trim().toLowerCase();
      const botName = (row?.bot_name || '').toString().trim();
      return {
        bot_key: botKey,
        learningCode,
        baseCode,
        botName
      };
    })
    .filter(Boolean)
);

const languages = computed(() => {
  const labels = new Set(
    normalizedBots.value
      .map((bot) => languageLabelForCode(bot.learningCode))
      .filter(Boolean)
  );
  return Array.from(labels);
});

const teachers = computed(() => {
  const names = new Set(
    normalizedBots.value
      .map((bot) => bot.botName)
      .filter(Boolean)
  );
  return Array.from(names);
});

const languageCount = computed(() => languages.value.length);
const teacherCount = computed(() => teachers.value.length);

const languagesSummary = computed(() =>
  languages.value.length > 0
    ? languages.value.join(', ')
    : t('about.multilingual.noneLanguages')
);

const teachersSummary = computed(() =>
  teachers.value.length > 0
    ? teachers.value.join(', ')
    : t('about.multilingual.noneTeachers')
);

const schoolUrlLabel = computed(() => {
  try {
    return new URL(schoolUrl).hostname;
  } catch {
    return schoolUrl;
  }
});

function openSchoolUrl() {
  tgOpenLink(schoolUrl);
}
</script>

<style scoped>
.shell {
  width: min(860px, 100%);
  padding: 40px 22px 72px;
  display: grid;
  gap: 18px;
}

.page-hero {
  display: grid;
  gap: 10px;
  margin-bottom: 4px;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

.page-hero h1 {
  font-family: var(--font-display);
  font-size: clamp(28px, 4.6vw, 44px);
  line-height: 1.04;
  margin: 0;
}

.sub {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.6;
  max-width: 60ch;
}

.card {
  border: 1px solid var(--stroke);
  border-radius: 18px;
  padding: 18px 18px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 18px 40px var(--shadow);
}

.card h2 {
  margin: 0 0 10px 0;
  font-size: 16px;
  letter-spacing: 0.01em;
}

.card-sub {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
}

.school-link {
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.62);
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
  font-weight: 700;
  color: var(--ink);
  transition: transform 120ms ease, box-shadow 120ms ease;
  box-shadow: 0 10px 22px var(--shadow);
}

.school-link:active {
  transform: translateY(1px);
  box-shadow: 0 8px 16px var(--shadow);
}

.url-hint {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 12px;
}

ul {
  margin: 0;
  padding-left: 18px;
  color: var(--ink);
}

li {
  margin: 8px 0;
  line-height: 1.55;
}

</style>
