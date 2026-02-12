<template>
  <RouterLink class="card teacher-card" :to="`/teachers/${teacher.slug}`">
    <TeacherAvatar :teacher="teacher" :name="name" :size="56" />

    <div class="info">
      <div class="h3 name">{{ name }}</div>
      <div class="muted meta">
        <span>{{ teachesLine }}</span>
      </div>
    </div>
  </RouterLink>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import TeacherAvatar from './TeacherAvatar.vue';
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
const teachesLine = computed(() => {
  const pieces = [];
  if (props.teacher?.learningLanguage) pieces.push(`${t('teacher.teachesPrefix')} ${t(`languageName.${props.teacher.learningLanguage}`)}`);
  if (tagline.value) pieces.push(tagline.value);
  return pieces.filter(Boolean).join(' • ');
});
</script>

<style scoped>
.teacher-card {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 14px 16px;
  align-items: start;
  transition: transform 120ms ease, border-color 120ms ease;
}

.teacher-card:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--fg) 22%, var(--border));
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

</style>
