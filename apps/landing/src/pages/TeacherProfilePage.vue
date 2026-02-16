<template>
  <section class="page">
    <div class="container">
      <article v-if="teacher && content" class="profile-page">
        <header class="card hero" id="teacher-hero">
          <div class="hero-top">
            <TeacherAvatar
              :teacher="teacher"
              :name="name"
              :size="96"
              loading="eager"
              fetchpriority="high"
            />

            <div class="hero-meta">
              <h1 class="h1 hero-title">{{ content.h1 }}</h1>
              <p class="muted hero-lead">{{ content.heroLead }}</p>
              <p class="muted hero-outcome">{{ content.heroOutcome }}</p>
            </div>
          </div>

          <ul class="hero-bullets">
            <li v-for="bullet in content.coreBullets" :key="bullet">{{ bullet }}</li>
          </ul>

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
            <a class="btn" href="#other-teachers">{{ content.secondaryCta }}</a>
          </div>

          <div class="muted teacher-line">
            {{ teachesLine }}
          </div>
        </header>

        <section class="card section" aria-labelledby="how-title">
          <h2 id="how-title" class="h2">{{ content.howTitle }}</h2>
          <div class="steps-grid">
            <article v-for="step in content.howSteps" :key="step.title" class="step-item">
              <h3 class="h3">{{ step.title }}</h3>
              <p class="muted">{{ step.description }}</p>
            </article>
          </div>
        </section>

        <section class="card section" aria-labelledby="for-who-title">
          <h2 id="for-who-title" class="h2">{{ content.forWhoTitle }}</h2>
          <p class="muted section-intro">{{ content.forWhoIntro }}</p>
          <div class="for-who-grid">
            <article v-for="item in content.forWhoItems" :key="item.title" class="focus-item">
              <h3 class="h3">{{ item.title }}</h3>
              <p class="muted">{{ item.description }}</p>
            </article>
          </div>
        </section>

        <section class="card section" aria-labelledby="dialogues-title">
          <h2 id="dialogues-title" class="h2">{{ content.dialoguesTitle }}</h2>
          <p class="muted section-intro">{{ content.dialoguesIntro }}</p>
          <div class="dialogues-grid">
            <article v-for="example in content.dialogueExamples" :key="example.scenario" class="dialogue-item">
              <h3 class="h3">{{ example.scenario }}</h3>
              <p class="dialogue-line"><span class="label">Learner:</span> {{ example.learnerLine }}</p>
              <p class="dialogue-line"><span class="label">Teacher:</span> {{ example.teacherLine }}</p>
              <p class="muted dialogue-note">{{ example.note }}</p>
            </article>
          </div>
        </section>

        <section class="card section" aria-labelledby="deep-dive-title">
          <h2 id="deep-dive-title" class="h2">{{ content.deepDiveTitle }}</h2>
          <div class="deep-dive">
            <p v-for="paragraph in content.deepDiveParagraphs" :key="paragraph" class="muted deep-paragraph">
              {{ paragraph }}
            </p>
          </div>
        </section>

        <section class="card section" aria-labelledby="faq-title">
          <h2 id="faq-title" class="h2">{{ content.faqTitle }}</h2>
          <div class="faq-list">
            <article v-for="item in content.faqItems" :key="item.question" class="faq-item">
              <h3 class="h3 faq-question">{{ item.question }}</h3>
              <p class="muted faq-answer">{{ item.answer }}</p>
            </article>
          </div>
        </section>

        <section id="other-teachers" class="card section" aria-labelledby="other-teachers-title">
          <h2 id="other-teachers-title" class="h2">{{ content.otherTeachersTitle }}</h2>
          <div class="grid-2">
            <TeacherCard v-for="row in otherTeachers" :key="row.teacherKey || row.slug" :teacher="row" />
          </div>
        </section>
      </article>

      <div v-else class="card">
        <h2 class="h2">{{ t('notFound.title') }}</h2>
        <p class="muted">{{ t('notFound.desc') }}</p>
        <RouterLink class="btn" :to="routeWithLocale('teachers')">{{ t('nav.teachers') }}</RouterLink>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import TeacherAvatar from '../components/TeacherAvatar.vue';
import TeacherCard from '../components/TeacherCard.vue';
import { teachers, getTeacherName, getTeacherTagline } from '../data/teachers.js';
import { getTeacherTelegramUrl } from '../lib/telegram.js';
import { routeWithLocale, useI18n } from '../i18n.js';
import { getTeacherSeoContent } from '../data/seoTeacherContent.js';

const props = defineProps({
  teacher: {
    type: Object,
    default: null
  }
});

const { t, locale } = useI18n();

const content = computed(() => {
  if (!props.teacher) return null;
  return getTeacherSeoContent(props.teacher, locale.value);
});

const name = computed(() => getTeacherName(props.teacher, locale.value));
const tagline = computed(() => getTeacherTagline(props.teacher, locale.value));
const teachesLine = computed(() => {
  if (!props.teacher) return '';
  const parts = [];
  parts.push(`${t('teacher.teachesPrefix')} ${t(`languageName.${props.teacher.learningLanguage}`)}`);
  if (tagline.value) parts.push(tagline.value);
  return parts.join(' • ');
});

const telegramUrl = computed(() => getTeacherTelegramUrl(props.teacher));
const otherTeachers = computed(() => (Array.isArray(teachers) ? teachers : []));

useHead(() => {
  if (!props.teacher?.avatarImage) return {};
  const links = [];

  if (props.teacher.avatarSources?.avif) {
    links.push({
      rel: 'preload',
      as: 'image',
      href: props.teacher.avatarSources.avif,
      type: 'image/avif',
      fetchpriority: 'high'
    });
  }

  if (props.teacher.avatarSources?.webp) {
    links.push({
      rel: 'preload',
      as: 'image',
      href: props.teacher.avatarSources.webp,
      type: 'image/webp',
      fetchpriority: 'high'
    });
  }

  links.push({
    rel: 'preload',
    as: 'image',
    href: props.teacher.avatarImage,
    fetchpriority: 'high'
  });

  return {
    link: links
  };
});
</script>

<style scoped>
.page {
  padding: 42px 0 56px;
}

.profile-page {
  display: grid;
  gap: 18px;
}

.hero {
  display: grid;
  gap: 16px;
}

.hero-top {
  display: grid;
  gap: 16px;
  align-items: start;
}

.hero-meta {
  min-width: 0;
}

.hero-title {
  font-size: clamp(28px, 4vw, 48px);
  line-height: 1.1;
}

.hero-lead,
.hero-outcome {
  margin-top: 10px;
  font-size: 18px;
  line-height: 1.65;
}

.hero-bullets {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 8px;
  line-height: 1.6;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.teacher-line {
  font-size: 14px;
}

.section {
  display: grid;
  gap: 14px;
}

.section-intro {
  margin: 0;
  line-height: 1.65;
}

.steps-grid,
.for-who-grid,
.dialogues-grid {
  display: grid;
  gap: 12px;
}

.step-item,
.focus-item,
.dialogue-item,
.faq-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px;
  background: color-mix(in srgb, var(--surface) 55%, var(--bg));
}

.dialogue-line {
  margin: 10px 0 0;
  line-height: 1.6;
}

.label {
  font-weight: 700;
}

.dialogue-note {
  margin-top: 10px;
}

.deep-dive {
  display: grid;
  gap: 12px;
}

.deep-paragraph {
  margin: 0;
  line-height: 1.7;
}

.faq-list {
  display: grid;
  gap: 10px;
}

.faq-question {
  font-size: 18px;
}

.faq-answer {
  margin-top: 8px;
  line-height: 1.65;
}

@media (min-width: 860px) {
  .hero-top {
    grid-template-columns: 96px minmax(0, 1fr);
  }

  .steps-grid,
  .for-who-grid,
  .dialogues-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
