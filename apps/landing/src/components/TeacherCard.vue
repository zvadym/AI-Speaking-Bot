<template>
  <article class="card teacher-card">
    <div class="avatar">
      <span v-if="teacher.avatarEmoji" class="avatar-emoji" aria-hidden="true">{{ teacher.avatarEmoji }}</span>
      <span v-else class="avatar-letter" aria-hidden="true">{{ letter }}</span>
    </div>

    <div class="info">
      <div class="h3 name">{{ name }}</div>
      <div class="muted meta">
        <span>{{ teachesLine }}</span>
      </div>
    </div>

    <div class="actions">
      <RouterLink class="btn" :to="`/teachers/${teacher.slug}`">{{ t('cta.viewProfile') }}</RouterLink>
      <a
        v-if="telegramUrl"
        class="btn primary"
        :href="telegramUrl"
        target="_blank"
        rel="noreferrer"
      >
        {{ t('cta.openTelegram') }}
      </a>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { getTeacherTelegramUrl } from '../lib/telegram.js';
import { getTeacherName, getTeacherTagline } from '../data/teachers.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  teacher: {
    type: Object,
    required: true
  }
});

const { t, locale } = useI18n();

const name = computed(() => getTeacherName(props.teacher, locale.value));
const tagline = computed(() => getTeacherTagline(props.teacher, locale.value));
const letter = computed(() => (name.value || '?').toString().trim().slice(0, 1).toUpperCase());
const teachesLine = computed(() => {
  const pieces = [];
  if (props.teacher?.learningLanguage) pieces.push(`${t('teacher.teachesPrefix')} ${t(`languageName.${props.teacher.learningLanguage}`)}`);
  if (tagline.value) pieces.push(tagline.value);
  return pieces.filter(Boolean).join(' • ');
});
const telegramUrl = computed(() => getTeacherTelegramUrl(props.teacher));
</script>

<style scoped>
.teacher-card {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 14px 16px;
  align-items: start;
}

.avatar {
  width: 56px;
  height: 56px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  overflow: hidden;
}

.avatar-emoji {
  font-size: 24px;
  line-height: 1;
}

.avatar-letter {
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-weight: 900;
}

.info {
  min-width: 0;
}

.name {
  margin: 0;
}

.meta {
  margin-top: 4px;
  font-size: 14px;
}

.actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
