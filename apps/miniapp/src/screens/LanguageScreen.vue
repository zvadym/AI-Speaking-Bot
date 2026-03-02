<template>
  <div class="shell fade-in">
    <header class="page-hero">
      <div class="kicker">{{ $t('language.kicker') }}</div>
      <h1>{{ $t('language.title') }}</h1>
      <p class="sub">
        {{ $t('language.sub') }}
      </p>
    </header>

    <section class="teachers">
      <div v-if="primarySection" class="teacher-sections">
        <article
          v-for="section in visibleSections"
          :key="section.code"
          class="teacher-section"
        >
          <div class="section-head">
            <h2>{{ $t('language.baseTeachersHeading', { language: section.label }) }}</h2>
          </div>

          <button
            v-for="teacher in section.teachers"
            :key="teacher.bot_key"
            class="row"
            type="button"
            :class="{ busy: busy === teacher.bot_key }"
            :disabled="Boolean(busy)"
            @click="chooseTeacher(teacher)"
          >
            <div class="avatar" aria-hidden="true">
              <img
                v-if="teacher.avatarUrl && !isAvatarBroken(teacher.bot_key)"
                class="avatar-image"
                :src="teacher.avatarUrl"
                :alt="teacher.name"
                loading="lazy"
                @error="onAvatarError(teacher.bot_key)"
              />
              <span v-else-if="teacher.avatarEmoji" class="avatar-emoji">{{ teacher.avatarEmoji }}</span>
              <span v-else class="avatar-letter">{{ teacher.initial }}</span>
            </div>
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
        </article>
      </div>

      <button
        v-if="canShowMoreToggle"
        class="show-more"
        type="button"
        :disabled="Boolean(busy)"
        @click="toggleShowMore"
      >
        {{ showMoreSections ? $t('language.showLessTeachers') : $t('language.showMoreTeachers') }}
      </button>

      <p v-if="!primarySection" class="empty">
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
import BackToMenu from '../components/BackToMenu.vue';

const props = defineProps({
  me: { type: Object, default: null },
  bots: { type: Array, default: () => [] },
  toast: { type: Function, required: true }
});

defineEmits(['navigate']);
const { t, locale } = useI18n({ useScope: 'global' });

const busy = ref('');
const showMoreSections = ref(false);
const brokenAvatarByBotKey = ref({});
const schoolUrl = normalizeBaseUrl(import.meta.env.VITE_SCHOOL_URL || 'https://ai-language-school.online/');

function normalizeBaseUrl(urlRaw) {
  const raw = (urlRaw || '').toString().trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function buildAvatarUrl(botKeyRaw) {
  const botKey = (botKeyRaw || '').toString().trim().toLowerCase();
  if (!botKey || !schoolUrl) return '';
  return `${schoolUrl}/teachers/thumbnail/${encodeURIComponent(botKey)}.png`;
}

function languageLabelForCode(codeRaw) {
  const code = (codeRaw || '').toString().trim().toLowerCase();
  if (!code) return '';
  const key = `locales.${code}`;
  const label = t(key);
  if (label !== key) return label;
  return code.toUpperCase();
}

function isAvatarBroken(botKeyRaw) {
  const botKey = (botKeyRaw || '').toString().trim().toLowerCase();
  if (!botKey) return false;
  return Boolean(brokenAvatarByBotKey.value[botKey]);
}

function onAvatarError(botKeyRaw) {
  const botKey = (botKeyRaw || '').toString().trim().toLowerCase();
  if (!botKey || brokenAvatarByBotKey.value[botKey]) return;
  brokenAvatarByBotKey.value = { ...brokenAvatarByBotKey.value, [botKey]: true };
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
      const avatarEmoji = (row?.teacher_avatar_emoji || '').toString().trim();
      const name = teacherName || `${t('language.teacherFallback')} ${learningLabel}`;

      return {
        bot_key: botKey,
        baseCode,
        learningCode,
        name,
        subtitle: learningLabel || botKey,
        initial: name.slice(0, 1).toUpperCase() || '?',
        avatarEmoji,
        avatarUrl: buildAvatarUrl(botKey),
        telegramUrl: (row?.telegram_url || '').toString().trim()
      };
    })
    .filter(Boolean)
);

const sections = computed(() => {
  const grouped = new Map();
  for (const teacher of teachers.value) {
    const baseCode = teacher.baseCode || 'en';
    if (!grouped.has(baseCode)) grouped.set(baseCode, []);
    grouped.get(baseCode).push(teacher);
  }

  return Array.from(grouped.entries())
    .map(([code, rows]) => ({
      code,
      label: languageLabelForCode(code),
      teachers: rows.sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        return a.bot_key.localeCompare(b.bot_key);
      })
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

const currentLocaleCode = computed(() => (locale?.value || 'en').toString().trim().toLowerCase());

const primarySectionCode = computed(() => {
  const availableCodes = sections.value.map((section) => section.code);
  if (!availableCodes.length) return '';
  if (currentLocaleCode.value && availableCodes.includes(currentLocaleCode.value)) return currentLocaleCode.value;
  if (availableCodes.includes('en')) return 'en';
  return [...availableCodes].sort((a, b) => a.localeCompare(b))[0];
});

const primarySection = computed(() =>
  sections.value.find((section) => section.code === primarySectionCode.value) || null
);

const secondarySections = computed(() =>
  sections.value
    .filter((section) => section.code !== primarySectionCode.value)
    .sort((a, b) => a.label.localeCompare(b.label))
);

const canShowMoreToggle = computed(() => secondarySections.value.length > 0);

const visibleSections = computed(() => {
  if (!primarySection.value) return [];
  if (!showMoreSections.value) return [primarySection.value];
  return [primarySection.value, ...secondarySections.value];
});

watch(
  primarySectionCode,
  () => {
    showMoreSections.value = false;
  }
);

function toggleShowMore() {
  if (busy.value || !canShowMoreToggle.value) return;
  showMoreSections.value = !showMoreSections.value;
  tgHaptic('selection');
}

async function chooseTeacher(teacher) {
  if (!teacher?.bot_key) return;
  if (busy.value) return;

  busy.value = teacher.bot_key;
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

.teachers {
  display: grid;
  gap: 12px;
}

.teacher-sections {
  display: grid;
  gap: 12px;
}

.teacher-section {
  display: grid;
  gap: 10px;
}

.section-head h2 {
  margin: 0;
  font-size: 15px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent-2);
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

.avatar {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(30, 26, 22, 0.08);
  overflow: hidden;
}

.avatar-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.avatar-emoji {
  font-size: 22px;
  line-height: 1;
}

.avatar-letter {
  font-family: var(--font-display);
  font-size: 18px;
  line-height: 1;
  font-weight: 700;
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

.show-more {
  justify-self: start;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 12px 24px var(--shadow);
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.show-more:active {
  transform: translateY(1px);
}

.show-more:disabled {
  cursor: default;
  opacity: 0.65;
}

.empty {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 14px;
}
</style>
