<template>
  <RouterLink class="card teacher-card" :to="teacherCanonicalPath">
    <TeacherAvatar :teacher="teacher" :name="name" :size="64" />

    <div class="info">
      <div class="name-row">
        <div class="h3 name">{{ name }}</div>
        <span class="go" aria-hidden="true">↗</span>
      </div>
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
import { getTeacherName } from '../data/teachers.js';
import { useI18n } from '../i18n.js';
import { getTeacherCanonicalPath } from '../data/teacherSlugs.js';

const props = defineProps({
  teacher: {
    type: Object,
    required: true
  }
});

const { t, locale } = useI18n();

const name = computed(() => getTeacherName(props.teacher, locale.value));
const teacherCanonicalPath = computed(() => getTeacherCanonicalPath(props.teacher));
const localizedTagline = computed(() => (props.teacher?.taglines?.[locale.value] || '').toString().trim());
const teachesLine = computed(() => {
  const pieces = [];
  if (props.teacher?.learningLanguage) pieces.push(`${t('teacher.teachesPrefix')} ${t(`languageName.${props.teacher.learningLanguage}`)}`);
  if (localizedTagline.value) pieces.push(localizedTagline.value);
  return pieces.filter(Boolean).join(' • ');
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
  border-color: color-mix(in srgb, var(--fg) 20%, var(--border));
  box-shadow: 0 16px 34px color-mix(in srgb, var(--fg) 10%, transparent);
}

.info {
  min-width: 0;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.name {
  margin: 0;
}

.go {
  margin-left: auto;
  line-height: 1;
  font-size: 16px;
  opacity: 0.7;
}

.meta {
  margin-top: 6px;
  font-size: 14px;
  line-height: 1.5;
}

</style>
