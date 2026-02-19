<template>
  <a
    class="card teacher-card"
    :href="telegramUrl"
    target="_blank"
    rel="noreferrer"
    :aria-label="ariaLabel"
    @click="emit('choose')"
  >
    <TeacherAvatar :teacher="teacher" :name="name" :size="64" />

    <div class="info">
      <div class="name-row">
        <div class="h3 name">{{ name }}</div>
        <span class="tg-pill">
          <span class="telegram-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M20.66 4.21a2.05 2.05 0 0 0-2.08-.24L3.61 10.3a1.17 1.17 0 0 0 .09 2.18l3.08 1.06 1.16 4.38a1.19 1.19 0 0 0 2.02.51l2.2-2.26 4.24 3.14a1.77 1.77 0 0 0 2.78-1.01l2.46-12.3a2.05 2.05 0 0 0-.98-1.79Z" />
              <path d="m8.01 13.14 8.99-5.49a.45.45 0 0 1 .57.67l-7.39 7.36-.47 2.34-.95-3.55a1.46 1.46 0 0 1-.75-1.33Z" />
            </svg>
          </span>
          <span>{{ t('cta.openTelegram') }}</span>
        </span>
      </div>
      <div class="muted meta">
        <span>{{ teachesLine }}</span>
      </div>
    </div>
  </a>
</template>

<script setup>
import { computed } from 'vue';
import TeacherAvatar from './TeacherAvatar.vue';
import { getTeacherName } from '../data/teachers.js';
import { useI18n } from '../i18n.js';
import { getTeacherTelegramUrl } from '../lib/telegram.js';

const props = defineProps({
  teacher: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['choose']);

const { t, locale } = useI18n();

const name = computed(() => getTeacherName(props.teacher, locale.value));
const telegramUrl = computed(() => getTeacherTelegramUrl(props.teacher));
const localizedTagline = computed(() => (props.teacher?.taglines?.[locale.value] || '').toString().trim());

const teachesLine = computed(() => {
  const pieces = [];
  if (props.teacher?.learningLanguage) pieces.push(`${t('teacher.teachesPrefix')} ${t(`languageName.${props.teacher.learningLanguage}`)}`);
  if (localizedTagline.value) pieces.push(localizedTagline.value);
  return pieces.filter(Boolean).join(' • ');
});

const ariaLabel = computed(() => {
  const label = t('cta.openTelegram');
  return `${label}: ${name.value}`;
});
</script>

<style scoped>
.teacher-card {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 14px 18px;
  align-items: start;
  padding: 18px;
  transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}

.teacher-card:hover {
  text-decoration: none;
  transform: translateY(-2px);
  border-color: color-mix(in srgb, #229ed9 35%, var(--border));
  box-shadow: 0 18px 42px color-mix(in srgb, #229ed9 18%, transparent);
}

.info {
  min-width: 0;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.name {
  margin: 0;
}

.tg-pill {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: color-mix(in srgb, #229ed9 82%, var(--fg));
  background:
    radial-gradient(120% 140% at 10% 10%, color-mix(in srgb, #229ed9 18%, transparent), transparent 55%),
    color-mix(in srgb, var(--surface) 78%, var(--bg));
  border: 1px solid color-mix(in srgb, #229ed9 28%, var(--border));
}

.telegram-mark {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
}

.telegram-mark svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}

.meta {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.5;
}
</style>

