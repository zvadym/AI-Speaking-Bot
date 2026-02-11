<template>
  <div class="shell fade-in">
    <header class="page-hero">
      <div class="kicker">{{ $t('language.kicker') }}</div>
      <h1>{{ $t('language.title') }}</h1>
      <p class="sub">
        {{ $t('language.sub') }}
      </p>
    </header>

    <section class="language-tabs" v-if="languages.length">
      <button
        v-for="lang in languages"
        :key="lang.code"
        class="language-tab"
        type="button"
        :class="{ active: selectedLanguage === lang.code }"
        :disabled="Boolean(busy)"
        @click="selectLanguage(lang.code)"
      >
        <span class="tab-flag" aria-hidden="true">{{ lang.flag }}</span>
        <span class="tab-label">{{ lang.label }}</span>
        <span class="tab-count">{{ $t('language.teacherCount', { count: lang.teacherCount }) }}</span>
      </button>
    </section>

    <section class="teachers">
      <div class="section-head">
        <h2>{{ $t('language.chooseTeacher', { language: selectedLanguageLabel }) }}</h2>
      </div>

      <button
        v-for="teacher in teachersForSelectedLanguage"
        :key="teacher.bot_key"
        class="row"
        type="button"
        :class="{ busy: busy === teacher.bot_key }"
        :disabled="Boolean(busy)"
        @click="chooseTeacher(teacher)"
      >
        <div class="flag" aria-hidden="true">{{ teacher.flag }}</div>
        <div class="mid">
          <div class="top">
            <span class="label">{{ teacher.name }}</span>
          </div>
          <div class="note">{{ teacher.subtitle }}</div>
        </div>
        <div class="right" aria-hidden="true">
          <span>→</span>
        </div>
      </button>

      <p v-if="teachersForSelectedLanguage.length === 0" class="empty">
        {{ $t('language.noTeachers') }}
      </p>
    </section>

    <BackToMenu @navigate="(path) => $emit('navigate', path)" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from '../i18n.js';
import { tgHaptic, tgOpenLink } from '../lib/tg.js';
import { track } from '../lib/metrics.js';
import BackToMenu from '../components/BackToMenu.vue';

const props = defineProps({
  me: { type: Object, default: null },
  bots: { type: Array, default: () => [] },
  toast: { type: Function, required: true }
});

defineEmits(['navigate']);
const { t } = useI18n({ useScope: 'global' });

const busy = ref('');
const selectedLanguage = ref('');

function languageLabelForCode(codeRaw) {
  const code = (codeRaw || '').toString().trim().toLowerCase();
  if (!code) return '';
  if (code === 'en') return t('practiceLanguages.en');
  if (code === 'de') return t('practiceLanguages.de');
  return code.toUpperCase();
}

function flagForLanguage(codeRaw) {
  const code = (codeRaw || '').toString().trim().toLowerCase();
  if (code === 'en') return '🇬🇧';
  if (code === 'de') return '🇩🇪';
  return '🌐';
}

const teachers = computed(() =>
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
      if (!learningCode) return null;

      const baseCode = (row?.base_language || baseFromKey || '').toString().trim().toLowerCase();
      const teacherName = (row?.bot_name || '').toString().trim();
      const learningLabel = languageLabelForCode(learningCode);
      const baseLabel = languageLabelForCode(baseCode);

      return {
        bot_key: botKey,
        languageCode: learningCode,
        flag: flagForLanguage(learningCode),
        name: teacherName || `${t('language.teacherFallback')} ${learningLabel}`,
        subtitle: baseLabel && learningLabel ? `${baseLabel} → ${learningLabel}` : learningLabel || botKey,
        telegramUrl: (row?.telegram_url || '').toString().trim()
      };
    })
    .filter(Boolean)
);

const currentLanguage = computed(() => {
  return (props.me?.learning_language || props.me?.target_lang || '').toString().trim().toLowerCase();
});

const languages = computed(() => {
  const knownOrder = ['en', 'de'];
  const uniqueCodes = Array.from(new Set(teachers.value.map((teacher) => teacher.languageCode)));
  uniqueCodes.sort((a, b) => {
    const indexA = knownOrder.indexOf(a);
    const indexB = knownOrder.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

  return uniqueCodes.map((code) => ({
    code,
    flag: flagForLanguage(code),
    label: languageLabelForCode(code),
    teacherCount: teachers.value.filter((teacher) => teacher.languageCode === code).length
  }));
});

const teachersForSelectedLanguage = computed(() =>
  teachers.value.filter((teacher) => teacher.languageCode === selectedLanguage.value)
);

const selectedLanguageLabel = computed(() => languageLabelForCode(selectedLanguage.value));

watch(
  [languages, currentLanguage],
  ([nextLanguages, nextCurrentLanguage]) => {
    const available = nextLanguages.map((lang) => lang.code);
    if (!available.length) {
      selectedLanguage.value = '';
      return;
    }
    if (selectedLanguage.value && available.includes(selectedLanguage.value)) return;
    if (nextCurrentLanguage && available.includes(nextCurrentLanguage)) {
      selectedLanguage.value = nextCurrentLanguage;
      return;
    }
    selectedLanguage.value = available[0];
  },
  { immediate: true }
);

function selectLanguage(code) {
  if (!code || code === selectedLanguage.value || busy.value) return;
  selectedLanguage.value = code;
  track('ui_click', { id: 'language_tab_select', language: code });
  tgHaptic('selection');
}

async function chooseTeacher(teacher) {
  if (!teacher?.bot_key) return;
  if (busy.value) return;

  busy.value = teacher.bot_key;
  track('ui_click', { id: 'teacher_select', bot_key: teacher.bot_key, language: teacher.languageCode });
  tgHaptic('impact', 'light');

  try {
    if (!teacher.telegramUrl) {
      props.toast(t('common.errors.couldNotSave'));
      tgHaptic('notification', 'error');
      return;
    }
    tgOpenLink(teacher.telegramUrl);
  } catch (err) {
    console.error(err);
    props.toast(t('common.errors.couldNotSave'));
    tgHaptic('notification', 'error');
  } finally {
    busy.value = '';
  }
}
</script>

<style scoped>
.shell {
  width: min(900px, 100%);
  padding: 40px 22px 72px;
  display: grid;
  gap: 18px;
}

.page-hero {
  display: grid;
  gap: 10px;
  margin-bottom: 6px;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

.page-hero h1 {
  font-family: var(--font-display);
  font-size: clamp(28px, 4.8vw, 46px);
  line-height: 1.04;
  margin: 0;
}

.sub {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.6;
}

.language-tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.language-tab {
  border: 1px solid var(--stroke);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 14px 30px var(--shadow);
  padding: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-start;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.language-tab.active {
  border-color: rgba(31, 107, 99, 0.32);
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(31, 107, 99, 0.16), transparent 55%),
    rgba(255, 255, 255, 0.65);
}

.language-tab:disabled {
  cursor: default;
  opacity: 0.68;
}

.language-tab:active {
  transform: translateY(2px);
  box-shadow: 0 10px 22px var(--shadow);
}

.tab-label {
  font-weight: 800;
  letter-spacing: -0.01em;
}

.tab-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}

.teachers {
  display: grid;
  gap: 12px;
}

.section-head h2 {
  margin: 4px 0 0;
  font-size: 16px;
}

.row {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 14px;
  text-align: left;
  align-items: center;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 0 16px 38px var(--shadow);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.row.busy {
  opacity: 0.8;
}

.row:active {
  transform: translateY(2px);
  box-shadow: 0 12px 26px var(--shadow);
}

.row:disabled {
  cursor: default;
  opacity: 0.65;
}

.flag {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 22px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(30, 26, 22, 0.08);
}

.top {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.label {
  font-weight: 800;
  letter-spacing: -0.01em;
  font-size: 17px;
}

.note {
  margin-top: 6px;
  font-size: 14px;
  color: var(--muted);
  line-height: 1.5;
}

.right {
  font-size: 18px;
  opacity: 0.72;
}

.empty {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 14px;
}
</style>
