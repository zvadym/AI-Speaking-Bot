<template>
  <section class="page">
    <div class="container">
      <div v-if="teacher" class="card profile">
        <TeacherAvatar :teacher="teacher" :name="name" :size="88" />

        <div class="main">
          <h1 class="h2">{{ name }}</h1>
          <div class="muted meta">
            {{ teachesLine }}
          </div>

          <p v-if="tagline" class="bio">{{ tagline }}</p>

          <div class="details">
            <div class="detail">
              <div class="muted label">{{ t('teacher.teachesPrefix') }}</div>
              <div class="value">{{ t(`languageName.${teacher.learningLanguage}`) }}</div>
            </div>
            <div class="detail">
              <div class="muted label">{{ t('teacher.baseLanguagePrefix') }}</div>
              <div class="value">{{ t(`languageName.${teacher.baseLanguage}`) }}</div>
            </div>
            <div v-if="styleTags.length" class="detail">
              <div class="muted label">{{ t('teacher.stylePrefix') }}</div>
              <div class="tags">
                <span v-for="tag in styleTags" :key="tag" class="tag">{{ tag }}</span>
              </div>
            </div>
          </div>

          <div class="actions">
            <a
              v-if="telegramUrl"
              class="btn primary"
              :href="telegramUrl"
              target="_blank"
              rel="noreferrer"
            >
              {{ t('cta.openTelegram') }}
            </a>
            <RouterLink class="btn" to="/teachers">{{ t('cta.backToTeachers') }}</RouterLink>
          </div>
        </div>
      </div>

      <div v-else class="card">
        <h1 class="h2">{{ t('notFound.title') }}</h1>
        <p class="muted">{{ t('notFound.desc') }}</p>
        <RouterLink class="btn" to="/teachers">{{ t('nav.teachers') }}</RouterLink>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import TeacherAvatar from '../components/TeacherAvatar.vue';
import { getTeacherBySlug, getTeacherName, getTeacherTagline } from '../data/teachers.js';
import { getTeacherTelegramUrl } from '../lib/telegram.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  slug: { type: String, required: true }
});

const teacher = computed(() => getTeacherBySlug(props.slug));
const { t, locale } = useI18n();

const name = computed(() => getTeacherName(teacher.value, locale.value));
const tagline = computed(() => getTeacherTagline(teacher.value, locale.value));
const styleTags = computed(() => (Array.isArray(teacher.value?.styleTags) ? teacher.value.styleTags : []));
const teachesLine = computed(() => {
  if (!teacher.value) return '';
  const parts = [];
  parts.push(`${t('teacher.teachesPrefix')} ${t(`languageName.${teacher.value.learningLanguage}`)}`);
  if (tagline.value) parts.push(tagline.value);
  return parts.join(' • ');
});

const telegramUrl = computed(() => getTeacherTelegramUrl(teacher.value));
</script>

<style scoped>
.page {
  padding: 56px 0;
}

.profile {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 18px;
  align-items: start;
}

.meta {
  margin-top: 6px;
}

.bio {
  margin: 14px 0 0;
  line-height: 1.65;
}

.details {
  margin-top: 18px;
  display: grid;
  gap: 10px;
}

.detail .label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.detail .value {
  margin-top: 4px;
  font-weight: 600;
}

.tags {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag {
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
}

.actions {
  margin-top: 20px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

@media (min-width: 860px) {
  .profile {
    grid-template-columns: 96px 1fr;
  }
}
</style>
