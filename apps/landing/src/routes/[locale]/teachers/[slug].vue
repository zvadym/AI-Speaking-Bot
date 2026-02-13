<template>
  <TeacherProfilePage :slug="slug" />
</template>

<script setup>
import { computed } from 'vue';
import { setResponseStatus } from 'h3';
import TeacherProfilePage from '~/pages/TeacherProfilePage.vue';
import { getTeacherBySlug, getTeacherName, getTeacherTagline } from '~/data/teachers.js';
import { isSupportedLocale, normalizeLocale, useI18n } from '~/i18n.js';
import { useLocalizedSeo } from '~/seo.js';

definePageMeta({
  validate: (route) => isSupportedLocale(route.params?.locale)
});

const route = useRoute();
const event = useRequestEvent();
const localeCode = computed(() => normalizeLocale(route.params?.locale) || 'en');
const slug = computed(() => {
  const raw = route.params?.slug;
  if (Array.isArray(raw)) return (raw[0] || '').toString();
  return (raw || '').toString();
});
const teacher = computed(() => getTeacherBySlug(slug.value));
const { t } = useI18n();

if (event && !teacher.value) {
  setResponseStatus(event, 404);
}

const teacherName = computed(() => getTeacherName(teacher.value, localeCode.value) || t('notFound.title'));
const teacherDesc = computed(() => getTeacherTagline(teacher.value, localeCode.value) || t('teachers.subhead'));

useLocalizedSeo({
  locale: localeCode,
  title: () => `${teacherName.value} — AI Language School`,
  description: () => teacherDesc.value,
  noindex: () => !teacher.value
});
</script>
